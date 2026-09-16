import "server-only";

import * as Sentry from "@sentry/nextjs";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
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
import { getActiveSwingPrompt, getSwingConfiguration, getSwingWatchlistVersion } from "@/swing/repository";
import { eligibleSwingSlot, missedSwingSlot } from "@/swing/schedule";
import { SWING_MACRO_SYMBOLS, SWING_MODEL_ID, SWING_TEMPLATE_VERSION, type SwingAttempt } from "@/swing/types";

export class SwingRunUnavailableError extends Error {}
export class SwingRunConflictError extends Error {}

const macroExchange: Record<(typeof SWING_MACRO_SYMBOLS)[number], string> = { SPY: "AMEX", QQQ: "NASDAQ", GLD: "AMEX", TLT: "NASDAQ" };

async function pool<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await task(items[index]!, index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

function safeError(error: unknown) {
  if (error instanceof SwingChartError || error instanceof SwingModelError) return { code: error instanceof SwingChartError ? error.code : error.failureKind, message: error.message.slice(0, 300) };
  return { code: "internal", message: "Swing analysis failed unexpectedly." };
}

async function expireStaleRun(now: Date) {
  const database = await getDatabase();
  await database.update(swingRuns).set({ status: "failed", stage: "lease_expired", errorCode: "lease_expired", errorMessage: "The previous Swing run lease expired and was released.", completedAt: now, updatedAt: now })
    .where(and(inArray(swingRuns.status, ["scheduled", "running"]), lt(swingRuns.leaseExpiresAt, now)));
}

export async function createSwingRun(input: { mode: "manual" | "automatic"; requestId?: string; now?: Date }) {
  const now = input.now ?? new Date();
  const configuration = await getSwingConfiguration();
  if (!configuration.settings.activeWatchlistVersionId || !configuration.entries.length) throw new SwingRunUnavailableError("Import and activate a Swing watchlist before running analysis.");
  if (input.mode === "automatic" && !configuration.settings.automaticEnabled) throw new SwingRunUnavailableError("Automatic Swing analysis is disabled.");
  const prompt = await getActiveSwingPrompt();
  const provider = createMarketDataProvider();
  const session = await provider.getSession(now);
  const slot = input.mode === "automatic" ? eligibleSwingSlot(now, session) : null;
  const missedFor = input.mode === "automatic" ? missedSwingSlot(now, session) : null;
  if (input.mode === "automatic" && !slot && !missedFor) throw new SwingRunUnavailableError("There is no eligible automatic Swing slot right now.");
  const requestId = input.requestId ?? randomUUID();
  const idempotencyKey = input.mode === "automatic" ? `swing:auto:${session.date}` : `swing:manual:${requestId}`;
  const database = await getDatabase();
  await expireStaleRun(now);
  const [existing] = await database.select().from(swingRuns).where(eq(swingRuns.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) {
    if (existing.status === "failed" && existing.errorCode === "lease_expired") {
      if (input.mode === "automatic" && missedFor) {
        const [expired] = await database.update(swingRuns).set({ status: "missed", stage: "missed", errorCode: "slot_missed", errorMessage: "The automatic Swing slot expired before recovery completed.", leaseToken: null, leaseExpiresAt: null, completedAt: now, updatedAt: now }).where(eq(swingRuns.id, existing.id)).returning();
        return { run: expired!, created: false };
      }
      const [reclaimed] = await database.update(swingRuns).set({ status: "scheduled", stage: "queued", errorCode: null, errorMessage: null, leaseToken: null, leaseExpiresAt: new Date(now.getTime() + 2 * 60_000), startedAt: null, completedAt: null, updatedAt: now }).where(eq(swingRuns.id, existing.id)).returning();
      return { run: reclaimed!, created: true };
    }
    return { run: existing, created: false };
  }
  const [active] = await database.select().from(swingRuns).where(inArray(swingRuns.status, ["scheduled", "running"])).limit(1);
  if (active) throw new SwingRunConflictError("Another Swing run is already in progress.");
  try {
    const [run] = await database.insert(swingRuns).values({
      mode: input.mode, status: missedFor ? "missed" : "scheduled", sessionDate: slot?.sessionDate ?? session.date ?? marketDate(now), idempotencyKey,
      requestId: input.mode === "manual" ? requestId : null,
      watchlistVersionId: configuration.settings.activeWatchlistVersionId,
      promptRevisionId: prompt.id, scheduledFor: slot?.scheduledFor ?? missedFor ?? now,
      stage: missedFor ? "missed" : "queued", totalCandidates: configuration.entries.length,
      leaseExpiresAt: missedFor ? null : new Date(now.getTime() + 2 * 60_000),
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
    costUsd: input.attempts.some((attempt) => attempt.costUsd !== null) ? String(input.attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? 0), 0)) : null,
    rawResponse: last?.rawResponse ?? null, failureKind: last?.failureKind ?? null, completedAt: new Date(),
  }).returning();
  if (!modelRun) throw new Error("The Swing model audit could not be persisted.");
  if (input.attempts.length) await database.insert(swingModelAttempts).values(input.attempts.map((attempt) => ({
    modelRunId: modelRun.id, attemptNumber: attempt.attemptNumber, status: attempt.status, failureKind: attempt.failureKind,
    queueWaitMs: attempt.queueWaitMs, latencyMs: attempt.latencyMs, inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens,
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
    if (["completed", "partial", "failed", "missed"].includes(run.status)) return run;
    const leaseToken = randomUUID();
    const [claimed] = await database.update(swingRuns).set({ status: "running", stage: "macro_capture", leaseToken, leaseExpiresAt: new Date(now.getTime() + 15 * 60_000), startedAt: now, updatedAt: now })
      .where(and(eq(swingRuns.id, run.id), eq(swingRuns.status, "scheduled"))).returning();
    if (!claimed) return run;
    const [{ entries }, promptRow] = await Promise.all([
      getSwingWatchlistVersion(run.watchlistVersionId),
      database.select().from(swingPromptRevisions).where(eq(swingPromptRevisions.id, run.promptRevisionId)).limit(1).then((rows) => rows[0]),
    ]);
    if (!promptRow) throw new Error("The captured Swing prompt revision is unavailable.");
    const prompt = { id: promptRow.id, revisionNumber: promptRow.revisionNumber, instructions: promptRow.instructions, instructionsHash: promptRow.instructionsHash, templateVersion: promptRow.templateVersion };
    await database.insert(swingCandidates).values(entries.map((entry) => ({ runId: run.id, watchlistPosition: entry.position, stockName: entry.stockName, symbol: entry.symbol, exchange: entry.exchange }))).onConflictDoNothing();
    const chartProvider = new SwingChartImgProvider();
    const modelProvider = new SwingOpenRouterProvider();
    let providerCalls = 0;
    let cost = 0;
    const renewLease = () => new Date(Date.now() + 15 * 60_000);
    const captureChart: SwingChartImgProvider["capture"] = async (input) => {
      try {
        const captured = await chartProvider.capture(input);
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
      const macroSettled = await Promise.allSettled(SWING_MACRO_SYMBOLS.map(async (symbol) => {
        const captured = await captureChart({ role: "macro", symbol, exchange: macroExchange[symbol], capturedAt: now });
        return { captured, artifact: await persistCapturedChart(run.id, captured) };
      }));
      const macroFailure = macroSettled.find((result) => result.status === "rejected");
      if (macroFailure?.status === "rejected") throw macroFailure.reason;
      const macroCaptures = macroSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      await database.update(swingRuns).set({ stage: "macro_analysis", providerCalls, leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id));
      const macroImages = await Promise.all(macroCaptures.map(({ artifact }) => readSwingArtifact(artifact.storageReference, artifact.imageHash)));
      const macroPrompt = buildSwingMacroPrompt({ revision: prompt, charts: macroCaptures.map(({ captured }) => ({ ...captured.input, imageHash: captured.imageHash })) });
      let macroModel;
      try {
        macroModel = await modelProvider.analyzeMacro({ prompt: macroPrompt, images: macroImages });
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
        const captured = await captureChart({ role: "candidate", symbol: entry.symbol, exchange: entry.exchange, capturedAt: now });
        const artifact = await persistCapturedChart(run.id, captured);
        await database.update(swingCandidates).set({ chartArtifactId: artifact.id }).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.symbol, entry.symbol)));
        return { entry, captured, artifact };
      });
      let failed = 0;
      for (let index = 0; index < captures.length; index += 1) {
        const capture = captures[index]!;
        if (capture.status === "fulfilled") continue;
        failed += 1;
        const error = safeError(capture.reason);
        await database.update(swingCandidates).set({ status: "failed", errorCode: error.code, errorMessage: error.message, completedAt: new Date() }).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.symbol, entries[index]!.symbol)));
      }
      let completed = 0;
      await database.update(swingRuns).set({ stage: "stock_analysis", failedCandidates: failed, providerCalls, costUsd: String(cost), leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id));

      const successful = captures.flatMap((capture) => capture.status === "fulfilled" ? [capture.value] : []);
      const analyses = await pool(successful, 5, async ({ entry, captured, artifact }) => {
        const [candidate] = await database.select().from(swingCandidates).where(and(eq(swingCandidates.runId, run.id), eq(swingCandidates.symbol, entry.symbol))).limit(1);
        if (!candidate) throw new Error("The Swing candidate row is missing.");
        let stockPrompt = "";
        try {
          const bytes = await readSwingArtifact(artifact.storageReference, artifact.imageHash);
          stockPrompt = buildSwingStockPrompt({ revision: prompt, chart: { ...captured.input, imageHash: captured.imageHash }, macro: macroModel.result });
          const model = await modelProvider.analyzeCandidate({ prompt: stockPrompt, image: bytes, symbol: entry.symbol });
          accountAttempts(model.attempts);
          await persistModelAudit({ runId: run.id, candidateId: candidate.id, phase: "stock", promptRevisionId: prompt.id, prompt: stockPrompt, imageHashes: [artifact.imageHash], attempts: model.attempts, result: model });
          const processed = postProcessSwingCandidate(model.result, entry.position);
          await database.update(swingCandidates).set({
            status: "completed", direction: processed.direction, originalDirection: processed.originalDirection,
            observedPrice: processed.observed_price === null ? null : String(processed.observed_price), entryZoneLow: processed.entry_zone_low === null ? null : String(processed.entry_zone_low),
            entryZoneHigh: processed.entry_zone_high === null ? null : String(processed.entry_zone_high), stopLoss: processed.stop_loss === null ? null : String(processed.stop_loss),
            profitTarget1: processed.profit_target_1 === null ? null : String(processed.profit_target_1), profitTarget2: processed.profit_target_2 === null ? null : String(processed.profit_target_2),
            conviction: processed.conviction_level, visualQuality: processed.visual_quality,
            riskReward: processed.riskReward === null ? null : String(processed.riskReward), proximityPercent: processed.proximityPercent === null ? null : String(processed.proximityPercent),
            rejectionReason: processed.rejectionReason, result: model.result, completedAt: new Date(),
          }).where(eq(swingCandidates.id, candidate.id));
          completed += 1;
          await database.update(swingRuns).set({ completedCandidates: completed, failedCandidates: failed, providerCalls, costUsd: String(cost), leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id));
          Sentry.logger.info("swing.run.progress", { "specialstock.swing.run_id": run.id, "specialstock.swing.completed": completed, "specialstock.swing.failed": failed, "specialstock.swing.provider_calls": providerCalls });
          return processed;
        } catch (error) {
          if (error instanceof SwingModelError) {
            accountAttempts(error.attempts);
            await persistModelAudit({ runId: run.id, candidateId: candidate.id, phase: "stock", promptRevisionId: prompt.id, prompt: stockPrompt, imageHashes: [artifact.imageHash], attempts: error.attempts });
          }
          failed += 1;
          const safe = safeError(error);
          await database.update(swingCandidates).set({ status: "failed", errorCode: safe.code, errorMessage: safe.message, completedAt: new Date() }).where(eq(swingCandidates.id, candidate.id));
          await database.update(swingRuns).set({ completedCandidates: completed, failedCandidates: failed, providerCalls, costUsd: String(cost), leaseExpiresAt: renewLease(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id));
          Sentry.logger.info("swing.run.progress", { "specialstock.swing.run_id": run.id, "specialstock.swing.completed": completed, "specialstock.swing.failed": failed, "specialstock.swing.provider_calls": providerCalls });
          throw error;
        }
      });
      for (const analysis of analyses) {
        if (analysis.status === "rejected" && analysis.reason instanceof Error && analysis.reason.message === "The Swing candidate row is missing.") throw analysis.reason;
      }
      const status = failed ? (completed ? "partial" : "failed") : "completed";
      const [finished] = await database.update(swingRuns).set({ status, stage: "finished", completedCandidates: completed, failedCandidates: failed, providerCalls, costUsd: String(cost), leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id)).returning();
      span.setAttributes({ "specialstock.swing.status": status, "specialstock.swing.completed": completed, "specialstock.swing.failed": failed, "specialstock.swing.provider_calls": providerCalls });
      span.setStatus({ code: 1 });
      return finished!;
    } catch (error) {
      const safe = safeError(error);
      const [failed] = await database.update(swingRuns).set({ status: "failed", stage: "failed", providerCalls, costUsd: String(cost), errorCode: safe.code, errorMessage: safe.message, leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(swingRuns.id, run.id)).returning();
      span.setStatus({ code: 2, message: safe.code });
      Sentry.logger.warn("swing.run.failed", { "specialstock.swing.run_id": run.id, "specialstock.swing.failure_kind": safe.code, "specialstock.swing.provider_calls": providerCalls });
      return failed!;
    }
  });
}

function numeric(value: string | null) { return value === null ? null : Number(value); }

export async function getSwingRun(runId: string) {
  const database = await getDatabase();
  const [run] = await database.select().from(swingRuns).where(eq(swingRuns.id, runId)).limit(1);
  if (!run) return null;
  const rows = await database.select().from(swingCandidates).where(eq(swingCandidates.runId, runId)).orderBy(asc(swingCandidates.watchlistPosition));
  const candidates = rows.map((row) => ({ ...row, observedPrice: numeric(row.observedPrice), entryZoneLow: numeric(row.entryZoneLow), entryZoneHigh: numeric(row.entryZoneHigh), stopLoss: numeric(row.stopLoss), profitTarget1: numeric(row.profitTarget1), profitTarget2: numeric(row.profitTarget2), riskReward: numeric(row.riskReward), proximityPercent: numeric(row.proximityPercent), createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null }));
  const actionable = sortActionableSwingCandidates(candidates.filter((candidate) => candidate.status === "completed" && candidate.direction !== null).map((candidate) => ({ ...candidate, direction: candidate.direction!, conviction_level: candidate.conviction as "HIGH" | "MEDIUM" | "LOW", visual_quality: candidate.visualQuality as "CLEAR" | "PARTIAL" | "UNREADABLE", proximityPercent: candidate.proximityPercent, riskReward: candidate.riskReward })));
  return { ...run, costUsd: numeric(run.costUsd), scheduledFor: run.scheduledFor?.toISOString() ?? null, startedAt: run.startedAt?.toISOString() ?? null, completedAt: run.completedAt?.toISOString() ?? null, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), candidates, actionableIds: actionable.map((candidate) => candidate.id) };
}

export async function listSwingRuns(limit = 20) {
  const database = await getDatabase();
  const rows = await database.select().from(swingRuns).orderBy(desc(swingRuns.createdAt)).limit(limit);
  return rows.map((run) => ({ ...run, costUsd: numeric(run.costUsd), createdAt: run.createdAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null }));
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
