import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import { analyses, chartArtifacts, manualScanGroups, modelRuns, scanSlots } from "@/db/schema";

export async function getManualComparison(symbol: string, groupId: string) {
  await requireAuthorizedUser();
  const database = await getDatabase();
  const [group] = await database.select().from(manualScanGroups).where(and(
    eq(manualScanGroups.id, groupId),
    eq(manualScanGroups.symbol, symbol),
  )).limit(1);
  if (!group) return null;
  const rows = await database.select({
    slot: scanSlots,
    run: modelRuns,
    analysis: analyses,
    artifact: chartArtifacts,
  }).from(scanSlots)
    .leftJoin(modelRuns, and(eq(modelRuns.scanSlotId, scanSlots.id), eq(modelRuns.phase, "compact")))
    .leftJoin(analyses, eq(analyses.modelRunId, modelRuns.id))
    .leftJoin(chartArtifacts, eq(chartArtifacts.id, modelRuns.chartArtifactId))
    .where(eq(scanSlots.manualScanGroupId, group.id))
    .orderBy(asc(scanSlots.scanInterval));
  return {
    group,
    members: group.requestedIntervals.map((timeframe) => {
      const row = rows.find((candidate) => candidate.slot.scanInterval === timeframe);
      return { timeframe, row: row ?? null };
    }),
  };
}
