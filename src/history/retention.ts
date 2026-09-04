import "server-only";

import * as Sentry from "@sentry/nextjs";
import { and, inArray, lt, sql } from "drizzle-orm";

import { removeUnreferencedChartArtifacts } from "@/chart/artifact-storage";
import { getDatabase } from "@/db/client";
import { chartArtifacts, scanSlots } from "@/db/schema";

const RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAINTENANCE_INTERVAL_MS = 60 * 60_000;

const maintenanceState = globalThis as typeof globalThis & {
  specialStockRetentionLastAttempt?: number;
  specialStockRetentionInFlight?: Promise<void>;
};

export async function purgeExpiredScanGraphs(input: {
  now?: Date;
  artifactRoot?: string;
} = {}) {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const database = await getDatabase();
  const terminalBeforeCutoff = and(
    inArray(scanSlots.status, ["completed", "failed", "skipped"]),
    lt(sql<Date>`coalesce(${scanSlots.completedAt}, ${scanSlots.updatedAt})`, cutoff),
  );
  const [{ artifactCount }] = await database.select({ artifactCount: sql<number>`count(${chartArtifacts.id})::int` })
    .from(chartArtifacts)
    .innerJoin(scanSlots, sql`${scanSlots.id} = ${chartArtifacts.scanSlotId}`)
    .where(terminalBeforeCutoff);
  const deletedSlots = await database.delete(scanSlots).where(terminalBeforeCutoff).returning({ id: scanSlots.id });
  const retainedArtifacts = await database.select({ reference: chartArtifacts.storageReference }).from(chartArtifacts);
  const referenced = new Set(retainedArtifacts.flatMap(({ reference }) => reference ? [reference] : []));
  const files = await removeUnreferencedChartArtifacts({
    referenced,
    olderThan: cutoff,
    rootOverride: input.artifactRoot,
  });
  return {
    slots: deletedSlots.length,
    artifacts: artifactCount ?? 0,
    filesRemoved: files.removed,
    fileFailures: files.failed,
  };
}

export async function maybeRunRetention() {
  const now = Date.now();
  if (
    maintenanceState.specialStockRetentionInFlight ||
    now - (maintenanceState.specialStockRetentionLastAttempt ?? 0) < MAINTENANCE_INTERVAL_MS
  ) return maintenanceState.specialStockRetentionInFlight;

  maintenanceState.specialStockRetentionLastAttempt = now;
  maintenanceState.specialStockRetentionInFlight = Sentry.startSpan(
    { name: "Purge expired scan history", op: "specialstock.retention" },
    async (span) => {
      try {
        const counts = await purgeExpiredScanGraphs({ now: new Date(now) });
        span.setAttributes({
          "specialstock.retention.slots": counts.slots,
          "specialstock.retention.artifacts": counts.artifacts,
          "specialstock.retention.files_removed": counts.filesRemoved,
          "specialstock.retention.file_failures": counts.fileFailures,
        });
        span.setStatus({ code: counts.fileFailures ? 2 : 1 });
        Sentry.logger.info("retention.completed", {
          "specialstock.retention.slots": counts.slots,
          "specialstock.retention.artifacts": counts.artifacts,
          "specialstock.retention.files_removed": counts.filesRemoved,
          "specialstock.retention.file_failures": counts.fileFailures,
        });
      } catch (error) {
        span.setStatus({ code: 2, message: "Retention maintenance failed." });
        Sentry.logger.error("retention.failed", {
          "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
        });
      } finally {
        maintenanceState.specialStockRetentionInFlight = undefined;
      }
    },
  );
  return maintenanceState.specialStockRetentionInFlight;
}
