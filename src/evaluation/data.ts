import "server-only";

import { eq, ne } from "drizzle-orm";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import { analyses, modelRuns, outcomes, reviewLabels, scanSlots, schedulerHeartbeats, theses } from "@/db/schema";
import { MANUAL_SMOKE_SLOT_KIND } from "@/scans/policy";

export async function getEvaluationData() {
  await requireAuthorizedUser();
  const database = await getDatabase();
  const rows = await database
    .select({ run: modelRuns, analysis: analyses })
    .from(modelRuns)
    .innerJoin(analyses, eq(analyses.modelRunId, modelRuns.id))
    .innerJoin(scanSlots, eq(scanSlots.id, modelRuns.scanSlotId))
    .where(ne(scanSlots.slotKind, MANUAL_SMOKE_SLOT_KIND));
  const models = new Map<string, { model: string; runs: number; primary: number; comparisons: number; valid: number; noTrade: number; latency: number[]; cost: number; target: number; invalidation: number; expired: number; ambiguous: number; reviewed: number; unsupported: number }>();
  for (const row of rows) {
    const key = row.run.actualModel ?? row.run.requestedModel;
    const value = models.get(key) ?? { model: key, runs: 0, primary: 0, comparisons: 0, valid: 0, noTrade: 0, latency: [], cost: 0, target: 0, invalidation: 0, expired: 0, ambiguous: 0, reviewed: 0, unsupported: 0 };
    value.runs += 1;
    value.valid += row.run.status === "valid" ? 1 : 0;
    value.primary += row.run.runRole === "primary" || row.run.runRole === "fallback" ? 1 : 0;
    value.comparisons += row.run.runRole === "comparison" ? 1 : 0;
    value.noTrade += row.analysis.verdict === "no_trade" ? 1 : 0;
    if (row.run.latencyMs !== null) value.latency.push(row.run.latencyMs);
    value.cost += Number(row.run.costUsd ?? 0);
    const [thesis] = await database.select().from(theses).where(eq(theses.analysisId, row.analysis.id)).limit(1);
    if (thesis) {
      const [outcome] = await database.select().from(outcomes).where(eq(outcomes.thesisId, thesis.id)).limit(1);
      if (outcome?.result === "target_first") value.target += 1;
      if (outcome?.result === "invalidation_first") value.invalidation += 1;
      if (outcome?.result === "expired") value.expired += 1;
      if (outcome?.result === "ambiguous") value.ambiguous += 1;
    }
    const reviews = await database.select().from(reviewLabels).where(eq(reviewLabels.analysisId, row.analysis.id));
    value.reviewed += reviews.length;
    value.unsupported += reviews.filter((review) => review.unsupportedClaims.length > 0).length;
    models.set(key, value);
  }
  const modelMetrics = [...models.values()].map((value) => ({
    ...value,
    medianLatency: value.latency.length ? [...value.latency].sort((a, b) => a - b)[Math.floor(value.latency.length / 2)]! : null,
    averageCost: value.runs ? value.cost / value.runs : 0,
  }));
  const heartbeats = await database.select().from(schedulerHeartbeats);
  const dates = Map.groupBy(heartbeats.filter((heartbeat) => heartbeat.isLeader), (heartbeat) => heartbeat.marketDate);
  const qualifyingSessions = [...dates.values()].filter((entries) => {
    if (entries.length < 2) return false;
    const times = entries.map((entry) => entry.observedAt.getTime());
    return Math.max(...times) - Math.min(...times) >= 4 * 60 * 60_000;
  }).length;
  return { modelMetrics, qualifyingSessions };
}
