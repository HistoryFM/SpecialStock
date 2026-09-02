import "server-only";

import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { appSettings } from "@/db/schema";
import { createMarketDataProvider } from "@/market-data/factory";
import { requestedScanSlot } from "@/market-data/time";
import { runScan, ScanNotAvailableError } from "@/scans/service";

export type ScheduledBatchOutcome =
  | "completed"
  | "already_completed"
  | "already_running"
  | "terminal_failed"
  | "failed";

export type ScheduledBatchResult = {
  symbol: string;
  outcome: ScheduledBatchOutcome;
  slotId: string | null;
  analysisId: string | null;
  error: string | null;
};

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 180) : "The scan failed.";
}

function reusedOutcome(status: string): ScheduledBatchOutcome {
  if (status === "completed") return "already_completed";
  if (status === "running") return "already_running";
  return "terminal_failed";
}

export async function runScheduledBatch(slotKey: string, now = new Date()) {
  return Sentry.startSpan(
    {
      name: "Run scheduled scan batch",
      op: "specialstock.scan.batch",
      attributes: { "specialstock.scan.requested_slot": slotKey },
    },
    async (span) => {
      const started = performance.now();
      const provider = createMarketDataProvider();
      const session = await provider.getSession(now);
      if (!requestedScanSlot(slotKey, now, session)) {
        throw new ScanNotAvailableError("There is no eligible completed five-minute bar for this batch.");
      }

      const database = await getDatabase();
      await database.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
      const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
      const entries = settings?.watchlist.filter((entry) => entry.automaticScanEnabled).slice(0, 20) ?? [];

      span.setAttribute("specialstock.scan.batch_size", entries.length);
      Sentry.logger.info("scan.batch.started", {
        "specialstock.scan.slot": slotKey,
        "specialstock.scan.batch_size": entries.length,
        "specialstock.scan.symbols": entries.map((entry) => entry.symbol).join(","),
      });

      const settled = await Promise.allSettled(entries.map((entry) => runScan({
        symbol: entry.symbol,
        mode: "scheduled",
        now,
        requestedSlotKey: slotKey,
        scheduledEntry: entry,
        scheduledSession: session,
      })));

      const results: ScheduledBatchResult[] = settled.map((result, index) => {
        const entry = entries[index]!;
        if (result.status === "rejected") {
          Sentry.captureException(result.reason, {
            tags: {
              route: "api.scans.batch",
              symbol: entry.symbol,
              slot_key: slotKey,
            },
          });
          return {
            symbol: entry.symbol,
            outcome: "failed",
            slotId: null,
            analysisId: null,
            error: safeMessage(result.reason),
          };
        }
        return {
          symbol: entry.symbol,
          outcome: result.value.reused ? reusedOutcome(result.value.status) : "completed",
          slotId: result.value.slotId,
          analysisId: "analysisId" in result.value ? result.value.analysisId ?? null : null,
          error: result.value.reused && ["failed", "skipped"].includes(result.value.status)
            ? result.value.status
            : null,
        };
      });

      const counts = {
        completed: results.filter((result) => result.outcome === "completed").length,
        alreadyCompleted: results.filter((result) => result.outcome === "already_completed").length,
        alreadyRunning: results.filter((result) => result.outcome === "already_running").length,
        terminalFailed: results.filter((result) => result.outcome === "terminal_failed").length,
        failed: results.filter((result) => result.outcome === "failed").length,
      };
      const durationMs = Math.round(performance.now() - started);
      span.setAttributes({
        "specialstock.scan.batch_completed": counts.completed,
        "specialstock.scan.batch_reused": counts.alreadyCompleted,
        "specialstock.scan.batch_running": counts.alreadyRunning,
        "specialstock.scan.batch_terminal_failed": counts.terminalFailed,
        "specialstock.scan.batch_failed": counts.failed,
        "specialstock.scan.duration_ms": durationMs,
      });
      span.setStatus({ code: 1 });
      Sentry.logger.info("scan.batch.completed", {
        "specialstock.scan.slot": slotKey,
        "specialstock.scan.batch_size": entries.length,
        "specialstock.scan.duration_ms": durationMs,
        ...counts,
      });
      return { slotKey, total: entries.length, counts, results };
    },
  );
}
