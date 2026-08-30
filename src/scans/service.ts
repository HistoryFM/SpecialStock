import "server-only";

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { reserveAnalysisBudget, settleAnalysisBudget } from "@/analysis/budget";
import { createAnalysisModelProvider } from "@/analysis/factory";
import { PROMPT_VERSION } from "@/analysis/prompt";
import { AnalysisModelError } from "@/analysis/provider";
import type { ChartAnalysisInput, ModelRunResult } from "@/analysis/types";
import { persistChartArtifact, readChartArtifact } from "@/chart/artifact-storage";
import { ChartImgProvider } from "@/chart/chart-img-provider";
import { isDemoMode } from "@/config/env";
import { getDatabase } from "@/db/client";
import {
  analyses,
  appSettings,
  chartArtifacts,
  modelRuns,
  notificationEvents,
  scanSlots,
  theses,
} from "@/db/schema";
import { createMarketDataProvider } from "@/market-data/factory";
import {
  canonicalScanSlot,
  dateFromMarketParts,
  previousWeekday,
  requestedScanSlot,
} from "@/market-data/time";
import { evaluatePendingOutcomes } from "@/outcomes/evaluate";
import {
  getScanExecutionPolicy,
  MANUAL_SMOKE_SLOT_KIND,
  type ScanMode,
} from "@/scans/policy";
import type { WatchlistEntry } from "@/settings/types";

export class ScanNotAvailableError extends Error {}
export class UnknownWatchlistSymbolError extends Error {}
export class AutomaticScansDisabledError extends Error {}

function chartRange(
  now: Date,
  session: { date: string; opensAt: Date; closesAt: Date; isRegularSession: boolean },
  completedThrough?: Date,
) {
  const currentSession =
    session.isRegularSession && now >= session.opensAt && now <= session.closesAt;
  const completedCurrentSession = session.isRegularSession && now > session.closesAt;
  const latestDate = currentSession || completedCurrentSession
    ? session.date
    : previousWeekday(now);
  const closesAt = dateFromMarketParts(latestDate, 16, 0);
  return {
    from: dateFromMarketParts(latestDate, 9, 30),
    to: completedThrough ?? (
      currentSession ? new Date(Math.min(now.getTime(), session.closesAt.getTime())) : closesAt
    ),
  };
}

export const chartRangeForTest = chartRange;

async function createOrClaimSlot(input: {
  entry: WatchlistEntry;
  mode: ScanMode;
  now: Date;
  session: { opensAt: Date; closesAt: Date; isRegularSession: boolean };
  requestedSlotKey?: string;
}) {
  const database = await getDatabase();
  const canonical = input.mode === "scheduled"
    ? input.requestedSlotKey
      ? requestedScanSlot(input.requestedSlotKey, input.now, input.session)
      : canonicalScanSlot(input.now, input.session)
    : null;
  if (input.mode === "scheduled" && !canonical) {
    throw new ScanNotAvailableError("There is no eligible completed five-minute bar right now.");
  }
  const scheduledFor = canonical?.scheduledFor ?? input.now;
  const slotKind = canonical?.kind ?? MANUAL_SMOKE_SLOT_KIND;
  const idempotencyKey =
    input.mode === "scheduled"
      ? `${input.entry.symbol}:${canonical!.idempotencyPart}`
      : `${input.entry.symbol}:manual:${input.now.toISOString().slice(0, 16)}`;
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(input.now.getTime() + 5 * 60_000);
  const [inserted] = await database
    .insert(scanSlots)
    .values({
      idempotencyKey,
      symbol: input.entry.symbol,
      scheduledFor,
      slotKind,
      status: "running",
      provider: "chart-img",
      feed: "tradingview",
      leaseToken,
      leaseExpiresAt,
      startedAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  const completedThrough = canonical
    ? new Date(canonical.candleStartsAt.getTime() + 5 * 60_000)
    : null;
  if (inserted) return { slot: inserted, claimed: true, completedThrough };

  const [existing] = await database
    .select()
    .from(scanSlots)
    .where(eq(scanSlots.idempotencyKey, idempotencyKey));
  if (!existing) throw new Error("The scan slot could not be loaded after claiming.");
  if (existing.status === "completed") {
    return { slot: existing, claimed: false, completedThrough };
  }
  if (existing.status === "running" && existing.leaseExpiresAt && existing.leaseExpiresAt > input.now) {
    return { slot: existing, claimed: false, completedThrough };
  }
  const [reclaimed] = await database
    .update(scanSlots)
    .set({
      status: "running",
      leaseToken,
      leaseExpiresAt,
      startedAt: input.now,
      errorCode: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(scanSlots.id, existing.id),
        inArray(scanSlots.status, ["failed", "scheduled", "running"]),
        existing.leaseExpiresAt ? lt(scanSlots.leaseExpiresAt, input.now) : undefined,
      ),
    )
    .returning();
  return { slot: reclaimed ?? existing, claimed: Boolean(reclaimed), completedThrough };
}

async function persistModelResult(input: {
  slotId: string;
  chartArtifactId: string;
  result: ModelRunResult;
  frozen: ChartAnalysisInput;
}) {
  const database = await getDatabase();
  const [run] = await database
    .insert(modelRuns)
    .values({
      scanSlotId: input.slotId,
      chartArtifactId: input.chartArtifactId,
      runRole: "primary",
      requestedModel: input.result.requestedModel,
      actualModel: input.result.actualModel,
      actualProvider: input.result.actualProvider,
      promptVersion: PROMPT_VERSION,
      inputHash: input.frozen.inputHash,
      status: "valid",
      latencyMs: input.result.latencyMs,
      inputTokens: input.result.inputTokens,
      outputTokens: input.result.outputTokens,
      costUsd: input.result.costUsd === null ? null : String(input.result.costUsd),
      rawResponse: input.result.rawResponse,
      validationErrors: [],
      completedAt: new Date(),
    })
    .returning();
  if (!run) throw new Error("The model run could not be persisted.");
  const result = input.result.analysis;
  const [saved] = await database
    .insert(analyses)
    .values({
      modelRunId: run.id,
      verdict: result.verdict,
      barStatus: input.frozen.barStatus,
      setupType: result.setup_type,
      immediateBias: result.immediate_bias,
      broaderTrend: result.broader_trend,
      conviction: result.conviction,
      observedPrice: result.observed_price === null ? null : String(result.observed_price),
      candlestickAnalysis: result.candlestick_analysis,
      volumeAnalysis: null,
      vwapKeltnerAnalysis: result.vwap_keltner_analysis,
      cciAnalysis: result.cci_analysis,
      indicatorReadings: result.indicator_readings,
      momentumAnalysis: null,
      relativeVelocityAnalysis: null,
      supportingEvidence: result.supporting_evidence,
      conflictingEvidence: result.conflicting_evidence,
      supportLevels: result.support_levels,
      resistanceLevels: result.resistance_levels,
      primaryTarget: result.primary_target === null ? null : String(result.primary_target),
      deeperScenario: result.deeper_scenario,
      invalidationLevel:
        result.invalidation_level === null ? null : String(result.invalidation_level),
      dataQualityFlags: result.data_quality_flags,
      summary: result.summary,
    })
    .returning();
  if (!saved) throw new Error("The validated analysis could not be persisted.");
  return { run, analysis: saved };
}

async function runModel(input: {
  slotId: string;
  chartArtifactId: string;
  model: string;
  maxAttempts: 1 | 2;
  frozen: ChartAnalysisInput;
  png: Buffer;
}) {
  const reservation = await reserveAnalysisBudget({
    model: input.model,
    runRole: "primary",
    now: new Date(input.frozen.capturedAt),
  });
  if (!reservation) return null;
  try {
    const result = await createAnalysisModelProvider().analyze(input);
    await settleAnalysisBudget(reservation, result.costUsd, "settled");
    return persistModelResult({ ...input, result });
  } catch (error) {
    const failure =
      error instanceof AnalysisModelError
        ? error
        : new AnalysisModelError(error instanceof Error ? error.message : "Analysis model failed.", {
            status: "failed",
            requestedModel: input.model,
            actualModel: null,
            actualProvider: "openrouter",
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            rawResponse: null,
          });
    await settleAnalysisBudget(
      reservation,
      failure.metadata.costUsd,
      failure.metadata.costUsd === null ? "released" : "settled",
    );
    await (await getDatabase()).insert(modelRuns).values({
      scanSlotId: input.slotId,
      chartArtifactId: input.chartArtifactId,
      runRole: "primary",
      requestedModel: failure.metadata.requestedModel,
      actualModel: failure.metadata.actualModel,
      actualProvider: failure.metadata.actualProvider,
      promptVersion: PROMPT_VERSION,
      inputHash: input.frozen.inputHash,
      status: failure.metadata.status,
      latencyMs: failure.metadata.latencyMs,
      inputTokens: failure.metadata.inputTokens,
      outputTokens: failure.metadata.outputTokens,
      costUsd: failure.metadata.costUsd === null ? null : String(failure.metadata.costUsd),
      rawResponse: failure.metadata.rawResponse,
      validationErrors: [failure.message.slice(0, 500)],
      completedAt: new Date(),
    }).onConflictDoNothing();
    throw error;
  }
}

async function updateThesisAndNotification(input: {
  symbol: string;
  analysis: Awaited<ReturnType<typeof persistModelResult>>["analysis"];
  demo: boolean;
  now: Date;
}) {
  if (
    input.analysis.verdict === "no_trade" ||
    input.analysis.primaryTarget === null ||
    input.analysis.invalidationLevel === null
  ) return;
  const database = await getDatabase();
  const previous = await database
    .select()
    .from(theses)
    .where(and(eq(theses.symbol, input.symbol), eq(theses.state, "active")))
    .orderBy(desc(theses.openedAt))
    .limit(1);
  const [thesis] = await database.insert(theses).values({
    analysisId: input.analysis.id,
    symbol: input.symbol,
    direction: input.analysis.verdict,
    target: input.analysis.primaryTarget,
    invalidation: input.analysis.invalidationLevel,
    supersedesThesisId: previous[0]?.id ?? null,
    openedAt: input.now,
  }).returning();
  if (!thesis) return;
  if (previous[0]) {
    await database.update(theses)
      .set({ state: "superseded", closedAt: input.now, updatedAt: input.now })
      .where(eq(theses.id, previous[0].id));
  }
  if (input.demo || input.analysis.conviction !== "high") return;
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!settings?.notificationsEnabled) return;
  await database.insert(notificationEvents).values({
    thesisId: thesis.id,
    reason: previous[0]?.direction !== thesis.direction ? "direction_changed" : "new_high_conviction_thesis",
    cooldownUntil: new Date(input.now.getTime() + 30 * 60_000),
  }).onConflictDoNothing();
}

export async function runScan(input: {
  symbol: string;
  mode: ScanMode;
  now?: Date;
  requestedSlotKey?: string;
}) {
  const now = input.now ?? new Date();
  const policy = getScanExecutionPolicy(input.mode);
  const database = await getDatabase();
  await database.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  const entry = settings?.watchlist.find((candidate) => candidate.symbol === input.symbol);
  if (!entry) throw new UnknownWatchlistSymbolError(`${input.symbol} is not in the watchlist.`);
  if (input.mode === "scheduled" && !entry.automaticScanEnabled) {
    throw new AutomaticScansDisabledError(`Automatic scans are disabled for ${input.symbol}.`);
  }

  const marketProvider = createMarketDataProvider();
  const session = await marketProvider.getSession(now);
  const claim = await createOrClaimSlot({
    entry,
    mode: input.mode,
    now,
    session,
    requestedSlotKey: input.requestedSlotKey,
  });
  if (!claim.claimed) return { slotId: claim.slot.id, status: claim.slot.status, reused: true };

  try {
    const capture = await new ChartImgProvider().capture({
      entry,
      capturedAt: now,
      range: chartRange(now, session, claim.completedThrough ?? undefined),
      barStatus: input.mode === "scheduled" ? "closed" : (
        session.isRegularSession && now >= session.opensAt && now < session.closesAt ? "open" : "closed"
      ),
    });
    const storageReference = await persistChartArtifact(capture.png, capture.imageHash);
    const [artifact] = await database.insert(chartArtifacts).values({
      scanSlotId: claim.slot.id,
      rendererVersion: "chart-img-v2",
      inputHash: capture.input.inputHash,
      imageHash: capture.imageHash,
      mimeType: "image/png",
      width: capture.input.width,
      height: capture.input.height,
      byteLength: capture.png.byteLength,
      storageReference,
      frozenInput: capture.input as unknown as Record<string, unknown>,
    }).returning();
    if (!artifact) throw new Error("Chart metadata could not be persisted.");

    const storedPng = await readChartArtifact(storageReference, capture.imageHash);
    const primary = await runModel({
      slotId: claim.slot.id,
      chartArtifactId: artifact.id,
      model: settings.activeModel,
      maxAttempts: policy.modelAttempts,
      frozen: capture.input,
      png: storedPng,
    });
    if (!primary) throw new Error("Daily AI budget is exhausted.");

    if (policy.includeInEvaluation) await evaluatePendingOutcomes(input.symbol, now);
    if (policy.createThesis) {
      await updateThesisAndNotification({
        symbol: input.symbol,
        analysis: primary.analysis,
        demo: isDemoMode(),
        now,
      });
    }
    const inputAsOf = claim.completedThrough ?? now;
    await database.update(scanSlots).set({
      status: "completed",
      latestSourceAt: inputAsOf,
      freshnessSeconds: Math.max(0, Math.floor((now.getTime() - inputAsOf.getTime()) / 1_000)),
      qualityFlags: primary.analysis.dataQualityFlags,
      inputAsOf,
      inputHash: capture.input.inputHash,
      completedAt: new Date(),
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(eq(scanSlots.id, claim.slot.id));
    return {
      slotId: claim.slot.id,
      analysisId: primary.analysis.id,
      status: "completed" as const,
      reused: false,
    };
  } catch (error) {
    await database.update(scanSlots).set({
      status: "failed",
      errorCode: error instanceof Error ? error.message.slice(0, 180) : "scan_failed",
      completedAt: new Date(),
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(eq(scanSlots.id, claim.slot.id));
    throw error;
  }
}
