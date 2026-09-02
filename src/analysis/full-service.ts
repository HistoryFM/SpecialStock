import "server-only";

import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { reserveAnalysisBudget, settleAnalysisBudget } from "@/analysis/budget";
import { createAnalysisModelProvider } from "@/analysis/factory";
import { FULL_PROMPT_VERSION } from "@/analysis/prompt";
import { AnalysisModelError } from "@/analysis/provider";
import type { ChartAnalysisInput, ModelAttemptResult } from "@/analysis/types";
import { readChartArtifact } from "@/chart/artifact-storage";
import { getDatabase } from "@/db/client";
import { analyses, chartArtifacts, modelAttempts, modelRuns } from "@/db/schema";

const LEASE_MS = 2 * 60_000;

export class AnalysisNotFoundError extends Error {}
export class FullAnalysisRetryRequiredError extends Error {}

async function loadAnalysis(id: string) {
  const database = await getDatabase();
  const [row] = await database.select({
    analysis: analyses,
    compactRun: modelRuns,
    artifact: chartArtifacts,
  }).from(analyses)
    .innerJoin(modelRuns, eq(modelRuns.id, analyses.modelRunId))
    .leftJoin(chartArtifacts, eq(chartArtifacts.id, modelRuns.chartArtifactId))
    .where(eq(analyses.id, id)).limit(1);
  if (!row) throw new AnalysisNotFoundError("Analysis not found.");
  return row;
}

export async function getFullAnalysisStatus(id: string) {
  const { analysis } = await loadAnalysis(id);
  return {
    analysisId: analysis.id,
    state: analysis.fullAnalysisState,
    error: analysis.fullError,
    full: analysis.fullAnalysisState === "available" ? {
      setupType: analysis.setupType,
      immediateBias: analysis.immediateBias,
      broaderTrend: analysis.broaderTrend,
      candlestickAnalysis: analysis.candlestickAnalysis,
      vwapKeltnerAnalysis: analysis.vwapKeltnerAnalysis,
      cciAnalysis: analysis.cciAnalysis,
      indicatorReadings: analysis.indicatorReadings,
      supportingEvidence: analysis.supportingEvidence,
      conflictingEvidence: analysis.conflictingEvidence,
      supportLevels: analysis.supportLevels,
      resistanceLevels: analysis.resistanceLevels,
      deeperScenario: analysis.deeperScenario,
      dataQualityFlags: analysis.dataQualityFlags,
      summary: analysis.summary,
    } : null,
  };
}

async function saveAttempts(runId: string, attempts: ModelAttemptResult[]) {
  if (!attempts.length) return null;
  const database = await getDatabase();
  const [latest] = await database.select({ attemptNumber: modelAttempts.attemptNumber })
    .from(modelAttempts).where(eq(modelAttempts.modelRunId, runId))
    .orderBy(desc(modelAttempts.attemptNumber)).limit(1);
  const offset = latest?.attemptNumber ?? 0;
  await database.insert(modelAttempts).values(attempts.map((attempt) => ({
    modelRunId: runId,
    attemptNumber: attempt.attemptNumber + offset,
    responseId: attempt.responseId,
    status: attempt.status,
    latencyMs: attempt.latencyMs,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    costUsd: attempt.costUsd === null ? null : String(attempt.costUsd),
    estimatedCostUsd: attempt.estimatedCostUsd === null ? null : String(attempt.estimatedCostUsd),
    errorCode: attempt.errorCode,
    rawResponse: attempt.rawResponse,
  }))).onConflictDoNothing();
  const [totals] = await database.select({
    inputTokens: sql<string>`coalesce(sum(${modelAttempts.inputTokens}), 0)`,
    outputTokens: sql<string>`coalesce(sum(${modelAttempts.outputTokens}), 0)`,
    costUsd: sql<string>`coalesce(sum(coalesce(${modelAttempts.costUsd}, ${modelAttempts.estimatedCostUsd})), 0)`,
    latencyMs: sql<string>`coalesce(sum(${modelAttempts.latencyMs}), 0)`,
  }).from(modelAttempts).where(eq(modelAttempts.modelRunId, runId));
  return {
    inputTokens: Number(totals?.inputTokens ?? 0), outputTokens: Number(totals?.outputTokens ?? 0),
    costUsd: Number(totals?.costUsd ?? 0), latencyMs: Number(totals?.latencyMs ?? 0),
  };
}

export async function generateFullAnalysis(id: string, options: { retry?: boolean } = {}) {
  const loaded = await loadAnalysis(id);
  if (loaded.analysis.fullAnalysisState === "ineligible" || loaded.analysis.fullAnalysisState === "available") {
    return { claimed: false, status: await getFullAnalysisStatus(id) };
  }
  if (loaded.analysis.fullAnalysisState === "failed" && !options.retry) {
    throw new FullAnalysisRetryRequiredError("Full analysis failed. Retry explicitly to make another provider request.");
  }
  if (!loaded.artifact?.storageReference) throw new Error("The verified chart artifact is unavailable.");

  const database = await getDatabase();
  const now = new Date();
  const leaseToken = randomUUID();
  const [claimed] = await database.update(analyses).set({
    fullAnalysisState: "running",
    fullLeaseToken: leaseToken,
    fullLeaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    fullError: null,
  }).where(and(
    eq(analyses.id, id),
    or(
      eq(analyses.fullAnalysisState, "not_requested"),
      options.retry ? eq(analyses.fullAnalysisState, "failed") : undefined,
      and(eq(analyses.fullAnalysisState, "running"), lt(analyses.fullLeaseExpiresAt, now)),
    ),
  )).returning({ id: analyses.id });
  if (!claimed) return { claimed: false, status: await getFullAnalysisStatus(id) };

  const [run] = await database.insert(modelRuns).values({
    scanSlotId: loaded.compactRun.scanSlotId,
    chartArtifactId: loaded.artifact.id,
    runRole: "primary",
    phase: "full",
    requestedModel: loaded.compactRun.requestedModel,
    promptVersion: FULL_PROMPT_VERSION,
    inputHash: loaded.compactRun.inputHash,
    status: "pending",
  }).onConflictDoUpdate({
    target: [modelRuns.scanSlotId, modelRuns.runRole, modelRuns.requestedModel, modelRuns.phase],
    set: { status: "pending", startedAt: now, completedAt: null, validationErrors: [] },
  }).returning();
  if (!run) throw new Error("The full model run could not be claimed.");
  const reservation = await reserveAnalysisBudget({
    model: run.requestedModel, runRole: "primary", usageClass: "full_analysis", modelRunId: run.id, now,
  });

  try {
    const png = await readChartArtifact(loaded.artifact.storageReference, loaded.artifact.imageHash);
    const result = await createAnalysisModelProvider().analyze({
      frozen: loaded.artifact.frozenInput as ChartAnalysisInput,
      png, model: run.requestedModel, phase: "full", usageClass: "full_analysis", maxAttempts: 2,
      lockedSignal: {
        observedPrice: loaded.analysis.observedPrice === null ? null : Number(loaded.analysis.observedPrice),
        verdict: loaded.analysis.verdict,
        conviction: loaded.analysis.conviction,
        target: loaded.analysis.primaryTarget === null ? null : Number(loaded.analysis.primaryTarget),
        invalidation: loaded.analysis.invalidationLevel === null ? null : Number(loaded.analysis.invalidationLevel),
      },
    });
    if (result.phase !== "full") throw new Error("Full analysis returned the wrong model phase.");
    await settleAnalysisBudget(reservation, result.costUsd, "settled");
    const totals = await saveAttempts(run.id, result.attempts);
    const full = result.analysis;
    await database.update(modelRuns).set({
      actualModel: result.actualModel, actualProvider: result.actualProvider, status: "valid",
      latencyMs: totals?.latencyMs ?? result.latencyMs,
      inputTokens: totals?.inputTokens ?? result.inputTokens,
      outputTokens: totals?.outputTokens ?? result.outputTokens,
      costUsd: String(totals?.costUsd ?? result.costUsd ?? 0), rawResponse: result.rawResponse,
      completedAt: new Date(),
    }).where(eq(modelRuns.id, run.id));
    await database.update(analyses).set({
      fullAnalysisState: "available", fullModelRunId: run.id,
      fullLeaseToken: null, fullLeaseExpiresAt: null, fullError: null,
      setupType: full.setup_type, immediateBias: full.immediate_bias, broaderTrend: full.broader_trend,
      candlestickAnalysis: full.candlestick_analysis, vwapKeltnerAnalysis: full.vwap_keltner_analysis,
      cciAnalysis: full.cci_analysis, indicatorReadings: full.indicator_readings,
      supportingEvidence: full.supporting_evidence, conflictingEvidence: full.conflicting_evidence,
      supportLevels: full.support_levels, resistanceLevels: full.resistance_levels,
      deeperScenario: full.deeper_scenario, dataQualityFlags: full.data_quality_flags, summary: full.summary,
    }).where(and(eq(analyses.id, id), eq(analyses.fullLeaseToken, leaseToken)));
    return { claimed: true, status: await getFullAnalysisStatus(id) };
  } catch (error) {
    const failure = error instanceof AnalysisModelError ? error : null;
    const totals = failure ? await saveAttempts(run.id, failure.metadata.attempts) : null;
    await settleAnalysisBudget(
      reservation,
      failure?.metadata.costUsd ?? null,
      failure && failure.metadata.attempts.length > 0
        ? (failure.metadata.costUsd === null ? "estimated" : "settled")
        : "released",
    );
    await database.update(modelRuns).set({
      status: failure?.metadata.status ?? "failed",
      latencyMs: totals?.latencyMs ?? failure?.metadata.latencyMs ?? null,
      inputTokens: totals?.inputTokens ?? failure?.metadata.inputTokens ?? null,
      outputTokens: totals?.outputTokens ?? failure?.metadata.outputTokens ?? null,
      costUsd: totals ? String(totals.costUsd) : failure?.metadata.costUsd === null || failure?.metadata.costUsd === undefined ? null : String(failure.metadata.costUsd),
      validationErrors: [error instanceof Error ? error.message.slice(0, 500) : "Full analysis failed."],
      completedAt: new Date(),
    }).where(eq(modelRuns.id, run.id));
    await database.update(analyses).set({
      fullAnalysisState: "failed",
      fullError: error instanceof Error ? error.message.slice(0, 500) : "Full analysis failed.",
      fullLeaseToken: null, fullLeaseExpiresAt: null,
    }).where(and(eq(analyses.id, id), eq(analyses.fullLeaseToken, leaseToken)));
    throw error;
  }
}
