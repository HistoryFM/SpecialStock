import "server-only";

import * as Sentry from "@sentry/nextjs";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getDatabase } from "@/db/client";
import {
  swingCandidates,
  swingChartArtifacts,
  swingModelAttempts,
  swingModelRuns,
  swingPromptRevisions,
  swingRuns,
} from "@/db/schema";
import { sha256 } from "@/lib/hash";
import { createMarketDataProvider } from "@/market-data/factory";
import { marketDate } from "@/market-data/time";
import { persistSwingArtifact, readSwingArtifact } from "@/swing/artifact-storage";
import { SwingChartError, SwingChartImgProvider } from "@/swing/chart-provider";
import { SwingModelError, SwingOpenRouterProvider } from "@/swing/model-provider";
import { postProcessSwingCandidate, sortActionableSwingCandidates } from "@/swing/postprocess";
import { buildSwingMacroPrompt, buildSwingStockPrompt, swingPromptInputHash } from "@/swing/prompt";
import { abortSwingRun, heartbeatSwingRun as heartbeatControlledRun, registerSwingRun, releaseSwingRun, swingAbortReason } from "@/swing/run-control";
import { getActiveSwingPrompt, getSwingConfiguration, getSwingWatchlistVersion } from "@/swing/repository";
import { eligibleSwingSlot, missedSwingSlot } from "@/swing/schedule";
import { SWING_MARKET_CONFIG, SWING_MODEL_ID, SWING_TEMPLATE_VERSION, type SwingAttempt, type SwingMarket } from "@/swing/types";

export class SwingRunUnavailableError extends Error {}
export class SwingRunConflictError extends Error {}

const dateForMarket = (date: Date, market: SwingMarket) => new Intl.DateTimeFormat("en-CA", {
  timeZone: SWING_MARKET_CONFIG[market].timezone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

const RUN_LEASE_MS = 65_000;

async function pool<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>, shouldStop?: () => boolean): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      if (shouldStop?.()) break;
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await task(items[index]!, index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  for (let index = 0; index < items.length; index += 1) {
    results[index] ??= { status: "rejected", reason: new DOMException("canceled", "AbortError") };
  }
  return results;
}

function safeError(error: unknown) {
  if (error instanceof SwingChartError || error instanceof SwingModelError) return { code: error instanceof SwingChartError ? error.code : error.failureKind, message: error.message.slice(0, 300) };
  return { code: "internal", message: "Swing analysis failed unexpectedly." };
}

async function ensureSwingCandidateRows(runId: string, versionId: string) {
  const database = await getDatabase();
  const { entries } = await getSwingWatchlistVersion(versionId);
  if (entries.length) await database.insert(swingCandidates).values(entries.map((entry) => ({
    runId,
    watchlistPosition: entry.position,
    stockName: entry.stockName,
    symbol: entry.symbol,
    exchange: entry.exchange,
    industry: entry.industry,
  }))).onConflictDoNothing();
}

async function expireStaleRun(now: Date) {
  const database = await getDatabase();
  const stale = await database.select({ id: swingRuns.id, watchlistVersionId: swingRuns.watchlistVersionId }).from(swingRuns).where(and(inArray(swingRuns.status, ["scheduled", "running"]), lt(swingRuns.leaseExpiresAt, now)));
  for (const run of stale) {
    await ensureSwingCandidateRows(run.id, run.watchlistVersionId);
    await database.update(swingCandidates).set({ status: "canceled", errorCode: "server_restart", errorMessage: "Analysis was interrupted when the local server stopped.", completedAt: now })
      .where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.status, "pending")));
    const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(swingCandidates).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.status, "canceled")));
    await database.update(swingRuns).set({ status: "canceled", stage: "canceled", canceledCandidates: count ?? 0, errorCode: "server_restart", errorMessage: "The previous Swing run was interrupted when the local server stopped.", cancelRequestedAt: now, cancelReason: "server_restart", completedAt: now, leaseToken: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(swingRuns.id, run.id), inArray(swingRuns.status, ["scheduled", "running"])));
  }
  return stale.length;
}

export async function createSwingRun(input: { mode: "manual" | "automatic"; requestId?: string; market?: SwingMarket; watchlistVersionId?: string; now?: Date }) {
  const now = input.now ?? new Date();
  const market = input.market ?? "US";
  if (input.mode === "automatic" && market !== "US") throw new SwingRunUnavailableError("Automatic Swing analysis is available only for US lists.");
  const configuration = await getSwingConfiguration(market);
  const versionId = input.mode === "automatic" ? configuration.settings.activeWatchlistVersionId : input.watchlistVersionId ?? configuration.settings.activeWatchlistVersionId;
  if (!versionId) throw new SwingRunUnavailableError(`Import and activate a ${market} Swing list before running analysis.`);
  const selectedWatchlist = await getSwingWatchlistVersion(versionId);
  if (selectedWatchlist.list.market !== market) throw new SwingRunUnavailableError("The selected Swing list belongs to a different market.");
  if (!selectedWatchlist.entries.length) throw new SwingRunUnavailableError("The selected Swing list is empty.");
  if (input.mode === "automatic" && !configuration.settings.automaticEnabled) throw new SwingRunUnavailableError("Automatic Swing analysis is disabled.");
  const prompt = await getActiveSwingPrompt();
  const provider = createMarketDataProvider();
  const session = await provider.getSession(now);
  const slot = input.mode === "automatic" ? eligibleSwingSlot(now, session) : null;
  const missedFor = input.mode === "automatic" ? missedSwingSlot(now, session) : null;
  if (input.mode === "automatic" && !slot && !missedFor) throw new SwingRunUnavailableError("There is no eligible automatic Swing slot right now.");
  const requestId = input.requestId ?? randomUUID();
  const reportDate = dateForMarket(now, market);
  const idempotencyKey = input.mode === "automatic" ? `swing:auto:${market}:${session.date}` : `swing:manual:${requestId}`;
  const database = await getDatabase();
  await expireStaleRun(now);
  const [existing] = await database.select().from(swingRuns).where(eq(swingRuns.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) {
    if (existing.status === "canceled" && existing.errorCode === "server_restart") {
      if (input.mode === "automatic" && missedFor) {
        const [expired] = await database.update(swingRuns).set({ status: "missed", stage: "missed", errorCode: "slot_missed", errorMessage: "The automatic Swing slot expired before recovery completed.", leaseToken: null, leaseExpiresAt: null, completedAt: now, updatedAt: now }).where(eq(swingRuns.id, existing.id)).returning();
        return { run: expired!, created: false };
      }
      return { run: existing, created: false };
    }
    return { run: existing, created: false };
  }
  const [active] = await database.select().from(swingRuns).where(inArray(swingRuns.status, ["scheduled", "running"])).limit(1);
  if (active) throw new SwingRunConflictError("Another Swing run is already in progress.");
  try {
    const [run] = await database.insert(swingRuns).values({
      mode: input.mode, market, status: missedFor ? "missed" : "scheduled", sessionDate: slot?.sessionDate ?? session.date ?? marketDate(now), reportDate, idempotencyKey,
      requestId: input.mode === "manual" ? requestId : null,
      watchlistVersionId: versionId,
      promptRevisionId: prompt.id, scheduledFor: slot?.scheduledFor ?? missedFor ?? now,
      stage: missedFor ? "missed" : "queued", totalCandidates: selectedWatchlist.entries.length,
      leaseExpiresAt: missedFor ? null : new Date(now.getTime() + RUN_LEASE_MS),
      completedAt: missedFor ? now : null,
      errorCode: missedFor ? "slot_missed" : null,
      errorMessage: missedFor ? "The automatic Swing slot expired before an authenticated tab dispatched it." : null,
    }).returning();
    if (!run) throw new Error("The Swing run could not be created.");
    return { run, created: true };
  } catch (error) {
    const [reused] = await database.select().from(swingRuns).where(eq(swingRuns.idempotencyKey, idempotencyKey)).limit(1);
    if (reused) return { run: reused, created: false };
    const [conflicting] = await database.select().from(swingRuns).where(inArray(swingRuns.status, ["scheduled", "running"])).limit(1);
    if (conflicting) throw new SwingRunConflictError("Another Swing run is already in progress.");
    throw error;
  }
}

async function persistCapturedChart(runId: string, captured: Awaited<ReturnType<SwingChartImgProvider["capture"]>>) {
  const database = await getDatabase();
  const storageReference = await persistSwingArtifact(captured.png, captured.imageHash);
  const [artifact] = await database.insert(swingChartArtifacts).values({
    runId, role: captured.input.role, symbol: captured.input.symbol, rendererVersion: "swing-chart-img-v1",
    inputHash: captured.input.inputHash, imageHash: captured.imageHash, mimeType: "image/png", width: 1600, height: 1920,
    byteLength: captured.png.length, storageReference, frozenInput: captured.input, providerInput: captured.requestBody,
  }).onConflictDoUpdate({
    target: [swingChartArtifacts.runId, swingChartArtifacts.role, swingChartArtifacts.symbol],
    set: { inputHash: captured.input.inputHash, imageHash: captured.imageHash, byteLength: captured.png.length, storageReference, frozenInput: captured.input, providerInput: captured.requestBody },
  }).returning();
  if (!artifact) throw new Error("The Swing chart artifact could not be persisted.");
  return artifact;
}

async function persistModelAudit(input: { runId: string; candidateId?: string; phase: "macro" | "stock"; promptRevisionId: string; prompt: string; imageHashes: string[]; attempts: SwingAttempt[]; result?: { actualModel: string | null; actualProvider: string | null } }) {
  const database = await getDatabase();
  const last = input.attempts.at(-1);
  const [modelRun] = await database.insert(swingModelRuns).values({
    runId: input.runId, candidateId: input.candidateId ?? null, phase: input.phase, requestedModel: SWING_MODEL_ID,
    actualModel: input.result?.actualModel ?? last?.actualModel ?? null, actualProvider: input.result?.actualProvider ?? last?.actualProvider ?? null,
    promptRevisionId: input.promptRevisionId, templateVersion: SWING_TEMPLATE_VERSION,
    promptSnapshot: input.prompt, promptHash: sha256(input.prompt), inputHash: swingPromptInputHash(input.prompt, input.imageHashes), imageHashes: input.imageHashes,
    requestSettings: last?.requestSettings ?? {}, status: last?.status === "valid" ? "valid" : "failed",
    queueWaitMs: input.attempts.reduce((sum, attempt) => sum + attempt.queueWaitMs, 0),
    latencyMs: input.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
    inputTokens: input.attempts.some((attempt) => attempt.inputTokens !== null) ? input.attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0) : null,
    outputTokens: input.attempts.some((attempt) => attempt.outputTokens !== null) ? input.attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0) : null,
    reasoningTokens: input.attempts.some((attempt) => attempt.reasoningTokens !== null) ? input.attempts.reduce((sum, attempt) => sum + (attempt.reasoningTokens ?? 0), 0) : null,
    costUsd: input.attempts.some((attempt) => attempt.costUsd !== null) ? String(input.attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? 0), 0)) : null,
    rawResponse: last?.rawResponse ?? null, failureKind: last?.failureKind ?? null, completedAt: new Date(),
  }).returning();
  if (!modelRun) throw new Error("The Swing model audit could not be persisted.");
  if (input.attempts.length) await database.insert(swingModelAttempts).values(input.attempts.map((attempt) => ({
    modelRunId: modelRun.id, attemptNumber: attempt.attemptNumber, status: attempt.status, failureKind: attempt.failureKind,
    queueWaitMs: attempt.queueWaitMs, latencyMs: attempt.latencyMs, inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens,
    reasoningTokens: attempt.reasoningTokens,
    costUsd: attempt.costUsd === null ? null : String(attempt.costUsd), responseId: attempt.responseId,
    actualModel: attempt.actualModel, actualProvider: attempt.actualProvider, requestSettings: attempt.requestSettings,
    rawResponse: attempt.rawResponse, promptSnapshot: attempt.promptSnapshot, promptHash: attempt.promptHash,
  })));
  return modelRun;
}

export async function executeSwingRun(runId: string, now = new Date()) {
  return Sentry.startSpan({ name: "Execute Swing Trade run", op: "specialstock.swing.run", attributes: { "specialstock.swing.run_id": runId } }, async (span) => {
    const database = await getDatabase();
    const [run] = await database.select().from(swingRuns).where(eq(swingRuns.id, runId)).limit(1);
    if (!run) throw new SwingRunUnavailableError("Swing run not found.");
    if (["completed", "partial", "failed", "missed", "canceled"].includes(run.status)) return run;
    const leaseToken = randomUUID();
    const [claimed] = await database.update(swingRuns).set({ status: "running", stage: "macro_capture", leaseToken, leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS), startedAt: now, lastHeartbeatAt: now, updatedAt: now })
      .where(and(eq(swingRuns.id, run.id), eq(swingRuns.status, "scheduled"))).returning();
    if (!claimed) return run;
    const controller = registerSwingRun(run.id);
    const throwIfCanceled = () => {
      if (controller.signal.aborted) throw new DOMException(swingAbortReason(controller.signal), "AbortError");
    };
    const [{ entries }, promptRow] = await Promise.all([
      getSwingWatchlistVersion(run.watchlistVersionId),
      database.select().from(swingPromptRevisions).where(eq(swingPromptRevisions.id, run.promptRevisionId)).limit(1).then((rows) => rows[0]),
    ]);
    if (!promptRow) throw new Error("The captured Swing prompt revision is unavailable.");
    const prompt = { id: promptRow.id, revisionNumber: promptRow.revisionNumber, instructions: promptRow.instructions, instructionsHash: promptRow.instructionsHash, templateVersion: promptRow.templateVersion };
    await ensureSwingCandidateRows(run.id, run.watchlistVersionId);
    const chartProvider = new SwingChartImgProvider();
    const modelProvider = new SwingOpenRouterProvider();
    let providerCalls = 0;
    let cost = 0;
    const renewLease = () => new Date(Date.now() + RUN_LEASE_MS);
    const captureChart: SwingChartImgProvider["capture"] = async (input) => {
      try {
        throwIfCanceled();
        const captured = await chartProvider.capture({ ...input, signal: controller.signal });
        providerCalls += captured.providerCalls;
        return captured;
      } catch (error) {
        if (error instanceof SwingChartError) providerCalls += error.providerCalls;
        throw error;
      }
    };
    const accountAttempts = (attempts: SwingAttempt[]) => {
      providerCalls += attempts.length;
      cost += attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? 0), 0);
    };
    try {
      const macroConfig = SWING_MARKET_CONFIG[run.market as SwingMarket].macro;
      const macroSettled = await Promise.allSettled(macroConfig.map(async (anchor) => {
        const captured = await captureChart({ market: run.market as SwingMarket, role: "macro", symbol: anchor.symbol, exchange: anchor.exchange, capturedAt: now });
        return { captured, artifact: await persistCapturedChart(run.id, captured) };
      }));
      const macroFailure = macroSettled.find((result) => result.status === "rejected");
      if (macroFailure?.status === "rejected") throw macroFailure.reason;
      const macroCaptures = macroSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      await database.update(swingRuns).set({ stage: "macro_analysis", providerCalls, leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id));
      const macroImages = await Promise.all(macroCaptures.map(({ artifact }) => readSwingArtifact(artifact.storageReference, artifact.imageHash)));
      const macroPrompt = buildSwingMacroPrompt({ revision: prompt, market: run.market as SwingMarket, charts: macroCaptures.map(({ captured }) => ({ ...captured.input, imageHash: captured.imageHash })) });
      let macroModel;
      try {
        macroModel = await modelProvider.analyzeMacro({ prompt: macroPrompt, images: macroImages, market: run.market as SwingMarket, signal: controller.signal });
        accountAttempts(macroModel.attempts);
        await persistModelAudit({ runId: run.id, phase: "macro", promptRevisionId: prompt.id, prompt: macroPrompt, imageHashes: macroCaptures.map(({ captured }) => captured.imageHash), attempts: macroModel.attempts, result: macroModel });
      } catch (error) {
        if (error instanceof SwingModelError) {
          accountAttempts(error.attempts);
          await persistModelAudit({ runId: run.id, phase: "macro", promptRevisionId: prompt.id, prompt: macroPrompt, imageHashes: macroCaptures.map(({ captured }) => captured.imageHash), attempts: error.attempts });
        }
        throw error;
      }
      await database.update(swingRuns).set({ macroResult: macroModel.result, stage: "stock_capture", providerCalls, costUsd: String(cost), leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id));

      const captures = await pool(entries, 5, async (entry) => {
        throwIfCanceled();
        const captured = await captureChart({ market: run.market as SwingMarket, role: "candidate", symbol: entry.symbol, exchange: entry.exchange, capturedAt: now });
        const artifact = await persistCapturedChart(run.id, captured);
        await database.update(swingCandidates).set({ chartArtifactId: artifact.id }).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.symbol, entry.symbol), eq(swingCandidates.status, "pending")));
        return { entry, captured, artifact };
      }, () => controller.signal.aborted);
      throwIfCanceled();
      let failed = 0;
      for (let index = 0; index < captures.length; index += 1) {
        const capture = captures[index]!;
        if (capture.status === "fulfilled") continue;
        failed += 1;
        const error = safeError(capture.reason);
        await database.update(swingCandidates).set({ status: "failed", errorCode: error.code, errorMessage: error.message, completedAt: new Date() }).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.symbol, entries[index]!.symbol), eq(swingCandidates.status, "pending")));
      }
      let completed = 0;
      const stockAnalysisStartedAt = new Date();
      await database.update(swingRuns).set({ stage: "stock_analysis", stockAnalysisStartedAt, failedCandidates: failed, providerCalls, costUsd: String(cost), leaseExpiresAt: renewLease(), updatedAt: stockAnalysisStartedAt }).where(and(eq(swingRuns.id, run.id), eq(swingRuns.status, "running"), eq(swingRuns.leaseToken, leaseToken)));

      const successful = captures.flatMap((capture) => capture.status === "fulfilled" ? [capture.value] : []);
      const analyses = await pool(successful, 5, async ({ entry, captured, artifact }) => {
        throwIfCanceled();
        const [candidate] = await database.select().from(swingCandidates).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.symbol, entry.symbol))).limit(1);
        if (!candidate) throw new Error("The Swing candidate row is missing.");
        let stockPrompt = "";
        try {
          const bytes = await readSwingArtifact(artifact.storageReference, artifact.imageHash);
          stockPrompt = buildSwingStockPrompt({ revision: prompt, chart: { ...captured.input, imageHash: captured.imageHash }, macro: macroModel.result });
          const model = await modelProvider.analyzeCandidate({ prompt: stockPrompt, image: bytes, symbol: entry.symbol, signal: controller.signal });
          accountAttempts(model.attempts);
          await persistModelAudit({ runId: run.id, candidateId: candidate.id, phase: "stock", promptRevisionId: prompt.id, prompt: stockPrompt, imageHashes: [artifact.imageHash], attempts: model.attempts, result: model });
          throwIfCanceled();
          const processed = postProcessSwingCandidate(model.result, entry.position);
          await database.update(swingCandidates).set({
            status: "completed", direction: processed.direction, originalDirection: processed.originalDirection,
            observedPrice: processed.observed_price === null ? null : String(processed.observed_price), entryZoneLow: processed.entry_zone_low === null ? null : String(processed.entry_zone_low),
            entryZoneHigh: processed.entry_zone_high === null ? null : String(processed.entry_zone_high), stopLoss: processed.stop_loss === null ? null : String(processed.stop_loss),
            profitTarget1: processed.profit_target_1 === null ? null : String(processed.profit_target_1), profitTarget2: processed.profit_target_2 === null ? null : String(processed.profit_target_2),
            conviction: processed.conviction_level, visualQuality: processed.visual_quality,
            riskReward: processed.riskReward === null ? null : String(processed.riskReward), proximityPercent: processed.proximityPercent === null ? null : String(processed.proximityPercent),
            rejectionReason: processed.rejectionReason, result: model.result, completedAt: new Date(),
          }).where(and(eq(swingCandidates.id, candidate.id), eq(swingCandidates.status, "pending")));
          completed += 1;
          await database.update(swingRuns).set({ completedCandidates: completed, failedCandidates: failed, providerCalls, costUsd: String(cost), leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(and(eq(swingRuns.id, run.id), eq(swingRuns.status, "running"), eq(swingRuns.leaseToken, leaseToken)));
          Sentry.logger.info("swing.run.progress", { "specialstock.swing.run_id": run.id, "specialstock.swing.completed": completed, "specialstock.swing.failed": failed, "specialstock.swing.provider_calls": providerCalls });
          return processed;
        } catch (error) {
          if (error instanceof SwingModelError) {
            accountAttempts(error.attempts);
            await persistModelAudit({ runId: run.id, candidateId: candidate.id, phase: "stock", promptRevisionId: prompt.id, prompt: stockPrompt, imageHashes: [artifact.imageHash], attempts: error.attempts });
          }
          if (controller.signal.aborted) throw error;
          failed += 1;
          const safe = safeError(error);
          await database.update(swingCandidates).set({ status: "failed", errorCode: safe.code, errorMessage: safe.message, completedAt: new Date() }).where(and(eq(swingCandidates.id, candidate.id), eq(swingCandidates.status, "pending")));
          await database.update(swingRuns).set({ completedCandidates: completed, failedCandidates: failed, providerCalls, costUsd: String(cost), leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(and(eq(swingRuns.id, run.id), eq(swingRuns.status, "running"), eq(swingRuns.leaseToken, leaseToken)));
          Sentry.logger.info("swing.run.progress", { "specialstock.swing.run_id": run.id, "specialstock.swing.completed": completed, "specialstock.swing.failed": failed, "specialstock.swing.provider_calls": providerCalls });
          throw error;
        }
      }, () => controller.signal.aborted);
      throwIfCanceled();
      for (const analysis of analyses) {
        if (analysis.status === "rejected" && analysis.reason instanceof Error && analysis.reason.message === "The Swing candidate row is missing.") throw analysis.reason;
      }
      const status = failed ? (completed ? "partial" : "failed") : "completed";
      const [finished] = await database.update(swingRuns).set({ status, stage: "finished", completedCandidates: completed, failedCandidates: failed, providerCalls, costUsd: String(cost), leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(swingRuns.id, run.id), eq(swingRuns.status, "running"), eq(swingRuns.leaseToken, leaseToken))).returning();
      if (!finished) return (await database.select().from(swingRuns).where(eq(swingRuns.id, run.id)).limit(1))[0]!;
      span.setAttributes({ "specialstock.swing.status": status, "specialstock.swing.completed": completed, "specialstock.swing.failed": failed, "specialstock.swing.provider_calls": providerCalls });
      span.setStatus({ code: 1 });
      return finished;
    } catch (error) {
      if (controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") {
        const reason = swingAbortReason(controller.signal);
        await database.update(swingCandidates).set({ status: "canceled", errorCode: "canceled", errorMessage: "Analysis canceled before this symbol completed.", completedAt: new Date() })
          .where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.status, "pending")));
        const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(swingCandidates).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.status, "canceled")));
        const [canceled] = await database.update(swingRuns).set({ status: "canceled", stage: "canceled", canceledCandidates: count ?? 0, providerCalls, costUsd: String(cost), errorCode: "canceled", errorMessage: "Swing analysis was canceled. Completed results were preserved; an accepted provider request may still be billed.", cancelRequestedAt: new Date(), cancelReason: reason, leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(swingRuns.id, run.id), inArray(swingRuns.status, ["scheduled", "running"]))).returning();
        span.setStatus({ code: 2, message: "canceled" });
        return canceled ?? (await database.select().from(swingRuns).where(eq(swingRuns.id, run.id)).limit(1))[0]!;
      }
      const safe = safeError(error);
      const [failed] = await database.update(swingRuns).set({ status: "failed", stage: "failed", providerCalls, costUsd: String(cost), errorCode: safe.code, errorMessage: safe.message, leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id)).returning();
      span.setStatus({ code: 2, message: safe.code });
      Sentry.logger.warn("swing.run.failed", { "specialstock.swing.run_id": run.id, "specialstock.swing.failure_kind": safe.code, "specialstock.swing.provider_calls": providerCalls });
      return failed!;
    } finally {
      releaseSwingRun(run.id);
    }
  });
}

export async function heartbeatSwingRun(runId: string) {
  const database = await getDatabase();
  const now = new Date();
  const [run] = await database.update(swingRuns).set({ lastHeartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS), updatedAt: now })
    .where(and(eq(swingRuns.id, runId), inArray(swingRuns.status, ["scheduled", "running"]))).returning();
  if (!run) return null;
  heartbeatControlledRun(runId);
  return run;
}

export async function cancelSwingRun(runId: string, reason: "user" | "tab_closed" = "user") {
  const database = await getDatabase();
  const now = new Date();
  const [existing] = await database.select().from(swingRuns).where(eq(swingRuns.id, runId)).limit(1);
  if (!existing) return null;
  if (!["scheduled", "running"].includes(existing.status)) return existing;
  await ensureSwingCandidateRows(runId, existing.watchlistVersionId);
  abortSwingRun(runId, reason);
  await database.update(swingCandidates).set({ status: "canceled", errorCode: "canceled", errorMessage: "Analysis canceled before this symbol completed.", completedAt: now })
    .where(and(eq(swingCandidates.runId, runId), eq(swingCandidates.status, "pending")));
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(swingCandidates).where(and(eq(swingCandidates.runId, runId), eq(swingCandidates.status, "canceled")));
  const [run] = await database.update(swingRuns).set({
    status: "canceled", stage: "canceled", canceledCandidates: count ?? 0, cancelRequestedAt: now, cancelReason: reason,
    errorCode: "canceled", errorMessage: "Swing analysis was canceled. Completed results were preserved; an accepted provider request may still be billed.",
    leaseToken: null, leaseExpiresAt: null, completedAt: now, updatedAt: now,
  }).where(and(eq(swingRuns.id, runId), inArray(swingRuns.status, ["scheduled", "running"]))).returning();
  return run ?? (await database.select().from(swingRuns).where(eq(swingRuns.id, runId)).limit(1))[0] ?? null;
}

function numeric(value: string | null) { return value === null ? null : Number(value); }
function normalizeCandidate(row: typeof swingCandidates.$inferSelect) {
  return { ...row, observedPrice: numeric(row.observedPrice), entryZoneLow: numeric(row.entryZoneLow), entryZoneHigh: numeric(row.entryZoneHigh), stopLoss: numeric(row.stopLoss), profitTarget1: numeric(row.profitTarget1), profitTarget2: numeric(row.profitTarget2), riskReward: numeric(row.riskReward), proximityPercent: numeric(row.proximityPercent), createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null };
}

async function swingUsage(runId: string) {
  const database = await getDatabase();
  const [usage] = await database.select({
    attempts: sql<number>`count(*)::int`,
    inputTokens: sql<number | null>`sum(${swingModelRuns.inputTokens})::int`,
    outputTokens: sql<number | null>`sum(${swingModelRuns.outputTokens})::int`,
    reasoningTokens: sql<number | null>`sum(${swingModelRuns.reasoningTokens})::int`,
    costUsd: sql<string | null>`sum(${swingModelRuns.costUsd})`,
    missingCost: sql<number>`count(*) filter (where ${swingModelRuns.costUsd} is null)::int`,
  }).from(swingModelRuns).where(eq(swingModelRuns.runId, runId));
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  return {
    inputTokens, outputTokens, reasoningTokens: usage?.reasoningTokens ?? null,
    totalTokens: inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0),
    costUsd: usage?.costUsd === null || usage?.costUsd === undefined ? null : Number(usage.costUsd),
    costComplete: Boolean(usage?.attempts) && usage?.missingCost === 0,
    modelRuns: usage?.attempts ?? 0,
  };
}

function timingForRun(run: typeof swingRuns.$inferSelect) {
  const end = run.completedAt?.getTime() ?? Date.now();
  const elapsedMs = run.startedAt ? Math.max(0, end - run.startedAt.getTime()) : 0;
  const settled = run.completedCandidates + run.failedCandidates + run.canceledCandidates;
  const remaining = Math.max(0, run.totalCandidates - settled);
  const stockElapsed = run.stockAnalysisStartedAt ? Math.max(1, end - run.stockAnalysisStartedAt.getTime()) : 0;
  const estimatedRemainingMs = run.status === "running" && run.stage === "stock_analysis" && settled >= 2
    ? Math.round(stockElapsed / settled * remaining)
    : null;
  return { elapsedMs, estimatedRemainingMs, concurrency: 5 };
}

export async function getSwingRun(runId: string) {
  const database = await getDatabase();
  await expireStaleRun(new Date());
  const [run] = await database.select().from(swingRuns).where(eq(swingRuns.id, runId)).limit(1);
  if (!run) return null;
  const rows = await database.select().from(swingCandidates).where(eq(swingCandidates.runId, runId)).orderBy(asc(swingCandidates.watchlistPosition));
  const candidates = rows.map(normalizeCandidate);
  const actionable = sortActionableSwingCandidates(candidates.filter((candidate) => candidate.status === "completed" && candidate.direction !== null).map((candidate) => ({ ...candidate, direction: candidate.direction!, conviction_level: candidate.conviction as "HIGH" | "MEDIUM" | "LOW", visual_quality: candidate.visualQuality as "CLEAR" | "PARTIAL" | "UNREADABLE", proximityPercent: candidate.proximityPercent, riskReward: candidate.riskReward })));
  const [{ list }, usage] = await Promise.all([getSwingWatchlistVersion(run.watchlistVersionId), swingUsage(run.id)]);
  return { ...run, market: run.market as SwingMarket, listName: list.name, costUsd: numeric(run.costUsd), scheduledFor: run.scheduledFor?.toISOString() ?? null, startedAt: run.startedAt?.toISOString() ?? null, completedAt: run.completedAt?.toISOString() ?? null, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), candidates, actionableIds: actionable.map((candidate) => candidate.id), usage, timing: timingForRun(run) };
}

export async function listSwingRuns(limit = 50, market?: SwingMarket) {
  const database = await getDatabase();
  await expireStaleRun(new Date());
  const rows = market
    ? await database.select().from(swingRuns).where(eq(swingRuns.market, market)).orderBy(desc(swingRuns.createdAt)).limit(limit)
    : await database.select().from(swingRuns).orderBy(desc(swingRuns.createdAt)).limit(limit);
  return rows.map((run) => ({ ...run, market: run.market as SwingMarket, costUsd: numeric(run.costUsd), createdAt: run.createdAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, timing: timingForRun(run) }));
}

export async function getSwingDailyReport(market: SwingMarket, reportDate: string) {
  const database = await getDatabase();
  const runs = await database.select().from(swingRuns).where(and(eq(swingRuns.market, market), eq(swingRuns.reportDate, reportDate))).orderBy(asc(swingRuns.createdAt));
  const runIds = runs.map((run) => run.id);
  const rows = runIds.length ? await database.select().from(swingCandidates).where(inArray(swingCandidates.runId, runIds)).orderBy(asc(swingCandidates.watchlistPosition)) : [];
  const runMap = new Map(runs.map((run) => [run.id, run]));
  const listNames = new Map(await Promise.all(runs.map(async (run) => [run.id, (await getSwingWatchlistVersion(run.watchlistVersionId)).list.name] as const)));
  const newestSuccessful = new Map<string, ReturnType<typeof normalizeCandidate> & { sourceRunId: string; sourceRunCreatedAt: string; sourceListName: string }>();
  for (const row of rows) {
    if (row.status !== "completed") continue;
    const run = runMap.get(row.runId)!;
    const candidate = { ...normalizeCandidate(row), sourceRunId: run.id, sourceRunCreatedAt: run.createdAt.toISOString(), sourceListName: listNames.get(run.id) ?? "Unknown list" };
    const previous = newestSuccessful.get(row.symbol);
    if (!previous || (candidate.completedAt ?? candidate.sourceRunCreatedAt) > (previous.completedAt ?? previous.sourceRunCreatedAt)) newestSuccessful.set(row.symbol, candidate);
  }
  const completed = [...newestSuccessful.values()];
  const recommended = sortActionableSwingCandidates(completed.filter((candidate) => candidate.direction && candidate.direction !== "NO_TRADE").map((candidate) => ({ ...candidate, direction: candidate.direction!, conviction_level: candidate.conviction as "HIGH" | "MEDIUM" | "LOW", visual_quality: candidate.visualQuality as "CLEAR" | "PARTIAL" | "UNREADABLE" })));
  const directionalNoTrade = completed.filter((candidate) => candidate.direction === "NO_TRADE" && candidate.originalDirection !== "NO_TRADE").toSorted((a, b) => (a.proximityPercent ?? Infinity) - (b.proximityPercent ?? Infinity) || a.watchlistPosition - b.watchlistPosition);
  const undirectedNoTrade = completed.filter((candidate) => candidate.direction === "NO_TRADE" && candidate.originalDirection === "NO_TRADE");
  const failures = rows.filter((candidate) => candidate.status === "failed").map(normalizeCandidate);
  const batches = await Promise.all(runs.map(async (run) => ({
    ...run, listName: listNames.get(run.id) ?? "Unknown list", costUsd: numeric(run.costUsd), createdAt: run.createdAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null,
    usage: await swingUsage(run.id), timing: timingForRun(run),
  })));
  return { market, reportDate, recommended, directionalNoTrade, undirectedNoTrade, failures, batches };
}

export async function getSwingCandidate(candidateId: string) {
  const database = await getDatabase();
  const [candidate] = await database.select().from(swingCandidates).where(eq(swingCandidates.id, candidateId)).limit(1);
  if (!candidate) return null;
  const [run, artifact, modelRun] = await Promise.all([
    database.select().from(swingRuns).where(eq(swingRuns.id, candidate.runId)).limit(1).then((rows) => rows[0]),
    candidate.chartArtifactId ? database.select().from(swingChartArtifacts).where(eq(swingChartArtifacts.id, candidate.chartArtifactId)).limit(1).then((rows) => rows[0]) : null,
    database.select().from(swingModelRuns).where(eq(swingModelRuns.candidateId, candidate.id)).limit(1).then((rows) => rows[0]),
  ]);
  const attempts = modelRun ? await database.select().from(swingModelAttempts).where(eq(swingModelAttempts.modelRunId, modelRun.id)).orderBy(asc(swingModelAttempts.attemptNumber)) : [];
  let verified = false;
  if (artifact) verified = Boolean(await readSwingArtifact(artifact.storageReference, artifact.imageHash).then((bytes) => sha256(bytes) === artifact.imageHash).catch(() => false));
  return { candidate, run, artifact: artifact ? { ...artifact, verified } : null, modelRun, attempts };
}
