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
      const enabledSymbols = entries.map((entry) => entry.symbol).join(",");

      span.setAttributes({
        "specialstock.scan.batch_size": entries.length,
        "specialstock.scan.symbols": enabledSymbols,
        "specialstock.settings.version": settings?.updatedAt.toISOString() ?? "missing",
      });
      Sentry.logger.info("scan.batch.started", {
        "specialstock.scan.slot": slotKey,
        "specialstock.scan.batch_size": entries.length,
        "specialstock.scan.symbols": enabledSymbols,
        "specialstock.settings.version": settings?.updatedAt.toISOString() ?? "missing",
      });

      let inFlight = 0;
      let peakInFlight = 0;
      const launchOffsetsMs: number[] = [];
      const fanoutStarted = performance.now();
      const settled = await Promise.allSettled(entries.map((entry, index) => {
        const launchOffsetMs = performance.now() - fanoutStarted;
        launchOffsetsMs.push(launchOffsetMs);
        return Sentry.startSpan(
          {
            name: `scheduled batch item ${entry.symbol}`,
            op: "specialstock.scan.batch.item",
            attributes: {
              "specialstock.symbol": entry.symbol,
              "specialstock.scan.slot": slotKey,
              "specialstock.scan.batch_index": index,
              "specialstock.scan.launch_offset_ms": Number(launchOffsetMs.toFixed(3)),
            },
          },
          async (itemSpan) => {
            const itemStarted = performance.now();
            inFlight += 1;
            peakInFlight = Math.max(peakInFlight, inFlight);
            itemSpan.setAttribute("specialstock.scan.in_flight_at_start", inFlight);
            try {
              const result = await runScan({
                symbol: entry.symbol,
                mode: "scheduled",
                now,
                requestedSlotKey: slotKey,
                scheduledEntry: entry,
                scheduledSession: session,
              });
              itemSpan.setAttributes({
                "specialstock.scan.item_status": result.status,
                "specialstock.scan.item_reused": result.reused,
                "specialstock.scan.item_duration_ms": Math.round(performance.now() - itemStarted),
              });
              itemSpan.setStatus({ code: 1 });
              return result;
            } catch (error) {
              itemSpan.setAttributes({
                "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
                "specialstock.scan.item_duration_ms": Math.round(performance.now() - itemStarted),
              });
              itemSpan.setStatus({
                code: 2,
                message: error instanceof Error ? error.message.slice(0, 200) : "The scan failed.",
              });
              throw error;
            } finally {
              inFlight -= 1;
            }
          },
        );
      }));

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
      const launchSpreadMs = launchOffsetsMs.length > 1
        ? Math.max(...launchOffsetsMs) - Math.min(...launchOffsetsMs)
        : 0;
      const outcomes = results.map((result) => `${result.symbol}:${result.outcome}`).join(",");
      span.setAttributes({
        "specialstock.scan.batch_completed": counts.completed,
        "specialstock.scan.batch_reused": counts.alreadyCompleted,
        "specialstock.scan.batch_running": counts.alreadyRunning,
        "specialstock.scan.batch_terminal_failed": counts.terminalFailed,
        "specialstock.scan.batch_failed": counts.failed,
        "specialstock.scan.batch_peak_in_flight": peakInFlight,
        "specialstock.scan.batch_launch_spread_ms": Number(launchSpreadMs.toFixed(3)),
        "specialstock.scan.batch_outcomes": outcomes,
        "specialstock.scan.duration_ms": durationMs,
      });
      span.setStatus({ code: 1 });
      const completionAttributes = {
        "specialstock.scan.slot": slotKey,
        "specialstock.scan.batch_size": entries.length,
        "specialstock.scan.symbols": enabledSymbols,
        "specialstock.scan.batch_peak_in_flight": peakInFlight,
        "specialstock.scan.batch_launch_spread_ms": Number(launchSpreadMs.toFixed(3)),
        "specialstock.scan.batch_outcomes": outcomes,
        "specialstock.scan.duration_ms": durationMs,
        ...counts,
      };
      if (counts.failed || counts.terminalFailed) {
        Sentry.logger.warn("scan.batch.completed_with_failures", completionAttributes);
      } else {
        Sentry.logger.info("scan.batch.completed", completionAttributes);
      }
      return { slotKey, total: entries.length, counts, results };
    },
  );
}
