import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import { analyses, modelAttempts, modelRuns, outcomes, reviewLabels, scanSlots, schedulerHeartbeats, theses } from "@/db/schema";
import { MANUAL_SMOKE_SLOT_KIND } from "@/scans/policy";

function percentile(values: number[], proportion: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * proportion))]!;
}

type ProfileMetric = {
  key: string; profile: string; promptRevisionId: string; model: string;
  runs: number; completed: number; failed: number; noTrade: number; directional: number;
  target: number; invalidation: number; expired: number; ambiguous: number;
  reviewed: number; unsupported: number; retries: number; recoveredRetries: number;
  latency: number[]; queueWait: number[]; reasoningTokens: number[]; cost: number;
  failures: Record<string, number>;
};

export async function getEvaluationData() {
  await requireAuthorizedUser();
  const database = await getDatabase();
  const rows = await database.select({ run: modelRuns, analysis: analyses }).from(modelRuns)
    .innerJoin(scanSlots, eq(scanSlots.id, modelRuns.scanSlotId))
    .leftJoin(analyses, eq(analyses.modelRunId, modelRuns.id))
    .where(and(eq(modelRuns.phase, "compact"), ne(scanSlots.slotKind, MANUAL_SMOKE_SLOT_KIND)));
  const runIds = rows.map(({ run }) => run.id);
  const analysisIds = rows.flatMap(({ analysis }) => analysis ? [analysis.id] : []);
  const attemptRows = runIds.length ? await database.select().from(modelAttempts).where(inArray(modelAttempts.modelRunId, runIds)) : [];
  const thesisRows = analysisIds.length ? await database.select({ thesis: theses, outcome: outcomes }).from(theses)
    .leftJoin(outcomes, eq(outcomes.thesisId, theses.id)).where(inArray(theses.analysisId, analysisIds)) : [];
  const reviews = analysisIds.length ? await database.select().from(reviewLabels).where(inArray(reviewLabels.analysisId, analysisIds)) : [];
  const attemptsByRun = Map.groupBy(attemptRows, (attempt) => attempt.modelRunId);
  const thesisByAnalysis = new Map(thesisRows.map((row) => [row.thesis.analysisId, row]));
  const reviewsByAnalysis = Map.groupBy(reviews, (review) => review.analysisId);
  const profiles = new Map<string, ProfileMetric>();

  for (const row of rows) {
    const profile = row.run.inferenceProfile;
    const promptRevisionId = row.run.promptRevisionId ?? "legacy";
    const key = `${profile}:${promptRevisionId}`;
    const value = profiles.get(key) ?? {
      key, profile, promptRevisionId, model: row.run.actualModel ?? row.run.requestedModel,
      runs: 0, completed: 0, failed: 0, noTrade: 0, directional: 0,
      target: 0, invalidation: 0, expired: 0, ambiguous: 0,
      reviewed: 0, unsupported: 0, retries: 0, recoveredRetries: 0,
      latency: [], queueWait: [], reasoningTokens: [], cost: 0, failures: {},
    };
    const attempts = attemptsByRun.get(row.run.id) ?? [];
    const complete = row.run.status === "valid" && row.analysis !== null;
    value.runs += 1;
    value.completed += complete ? 1 : 0;
    value.failed += complete ? 0 : 1;
    value.retries += attempts.length > 1 ? 1 : 0;
    value.recoveredRetries += attempts.length > 1 && complete ? 1 : 0;
    if (row.run.latencyMs !== null) value.latency.push(row.run.latencyMs);
    value.cost += Number(row.run.costUsd ?? 0);
    for (const attempt of attempts) {
      value.queueWait.push(attempt.queueWaitMs);
      if (attempt.reasoningTokens !== null) value.reasoningTokens.push(attempt.reasoningTokens);
      if (attempt.failureKind) value.failures[attempt.failureKind] = (value.failures[attempt.failureKind] ?? 0) + 1;
    }
    if (row.analysis) {
      value.noTrade += row.analysis.verdict === "no_trade" ? 1 : 0;
      value.directional += row.analysis.verdict === "no_trade" ? 0 : 1;
      const outcome = thesisByAnalysis.get(row.analysis.id)?.outcome;
      if (outcome?.result === "target_first") value.target += 1;
      if (outcome?.result === "invalidation_first") value.invalidation += 1;
      if (outcome?.result === "expired") value.expired += 1;
      if (outcome?.result === "ambiguous") value.ambiguous += 1;
      const analysisReviews = reviewsByAnalysis.get(row.analysis.id) ?? [];
      value.reviewed += analysisReviews.length;
      value.unsupported += analysisReviews.filter((review) => review.unsupportedClaims.length > 0).length;
    }
    profiles.set(key, value);
  }

  const profileMetrics = [...profiles.values()].map((value) => ({
    ...value,
    completionRate: value.runs ? value.completed / value.runs : 0,
    noTradeRate: value.completed ? value.noTrade / value.completed : 0,
    medianLatency: percentile(value.latency, 0.5), p90Latency: percentile(value.latency, 0.9),
    medianQueueWait: percentile(value.queueWait, 0.5), p90QueueWait: percentile(value.queueWait, 0.9),
    medianReasoningTokens: percentile(value.reasoningTokens, 0.5),
    averageCost: value.runs ? value.cost / value.runs : 0,
  }));
  const heartbeats = await database.select().from(schedulerHeartbeats);
  const dates = Map.groupBy(heartbeats.filter((heartbeat) => heartbeat.isLeader), (heartbeat) => heartbeat.marketDate);
  const qualifyingSessions = [...dates.values()].filter((entries) => {
    if (entries.length < 2) return false;
    const times = entries.map((entry) => entry.observedAt.getTime());
    return Math.max(...times) - Math.min(...times) >= 4 * 60 * 60_000;
  }).length;
  const resolvedDirectionalOutcomes = profileMetrics.reduce((sum, metric) => sum + metric.target + metric.invalidation, 0);
  return { profileMetrics, qualifyingSessions, resolvedDirectionalOutcomes };
}
