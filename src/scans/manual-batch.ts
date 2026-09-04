import "server-only";

import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";

import type { ManualScanTimeframe } from "@/analysis/types";
import { getDatabase } from "@/db/client";
import { appSettings } from "@/db/schema";
import { createMarketDataProvider } from "@/market-data/factory";
import { runScan, ScanAlreadyRunningError } from "@/scans/service";

export type ManualBatchOutcome = "completed" | "reused" | "already_running" | "failed";

export type ManualBatchResult = {
  symbol: string;
  timeframe: ManualScanTimeframe;
  outcome: ManualBatchOutcome;
  slotId: string | null;
  analysisId: string | null;
  error: string | null;
};

export class InvalidManualBatchError extends Error {}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 180) : "The scan failed.";
}

export async function runManualBatch(input: {
  runs: Array<{ symbol: string; timeframe: ManualScanTimeframe }>;
  requestId: string;
  now?: Date;
}) {
  const intervals = new Set(input.runs.map(({ timeframe }) => timeframe));
  const intervalProfile = intervals.size === 1 ? input.runs[0]!.timeframe : "mixed";
  const intervalCounts = {
    "specialstock.scan.batch_interval_1m": input.runs.filter(({ timeframe }) => timeframe === "1m").length,
    "specialstock.scan.batch_interval_5m": input.runs.filter(({ timeframe }) => timeframe === "5m").length,
    "specialstock.scan.batch_interval_10m": input.runs.filter(({ timeframe }) => timeframe === "10m").length,
  };
  return Sentry.startSpan(
    {
      name: "Run manual scan batch",
      op: "specialstock.scan.manual_batch",
      attributes: {
        "specialstock.scan.batch_size": input.runs.length,
        "specialstock.scan.batch_interval_profile": intervalProfile,
        ...intervalCounts,
      },
    },
    async (span) => {
      const started = performance.now();
      const now = input.now ?? new Date();
      const database = await getDatabase();
      await database.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
      const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
      const entriesBySymbol = new Map(settings?.watchlist.map((entry) => [entry.symbol, entry]) ?? []);
      const unknownSymbols = input.runs.filter(({ symbol }) => !entriesBySymbol.has(symbol));
      if (unknownSymbols.length) {
        throw new InvalidManualBatchError("Every symbol must currently exist in the watchlist.");
      }

      const session = await createMarketDataProvider().getSession(now);
      let inFlight = 0;
      let peakInFlight = 0;
      Sentry.logger.info("scan.manual_batch.started", {
        "specialstock.scan.batch_size": input.runs.length,
        "specialstock.scan.batch_interval_profile": intervalProfile,
        ...intervalCounts,
      });

      const settled = await Promise.allSettled(input.runs.map(({ symbol, timeframe }, index) => Sentry.startSpan(
        {
          name: `manual batch item ${symbol}`,
          op: "specialstock.scan.manual_batch.item",
          attributes: {
            "specialstock.symbol": symbol,
            "specialstock.scan.batch_index": index,
            "specialstock.chart.interval": timeframe,
          },
        },
        async (itemSpan) => {
          const itemStarted = performance.now();
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          try {
            const result = await runScan({
              symbol,
              mode: "manual",
              now,
              timeframe,
              manualRequestId: input.requestId,
              resolvedEntry: entriesBySymbol.get(symbol),
              resolvedSession: session,
            });
            itemSpan.setAttributes({
              "specialstock.scan.item_status": result.status,
              "specialstock.scan.item_reused": result.reused,
              "specialstock.scan.item_duration_ms": Math.round(performance.now() - itemStarted),
            });
            itemSpan.setStatus({ code: 1 });
            return result;
          } catch (error) {
            itemSpan.setAttribute("error.type", error instanceof Error ? error.constructor.name : "UnknownError");
            itemSpan.setStatus({ code: 2, message: safeMessage(error) });
            throw error;
          } finally {
            inFlight -= 1;
          }
        },
      )));

      const results: ManualBatchResult[] = settled.map((result, index) => {
        const { symbol, timeframe } = input.runs[index]!;
        if (result.status === "rejected") {
          if (result.reason instanceof ScanAlreadyRunningError) {
            return { symbol, timeframe, outcome: "already_running", slotId: null, analysisId: null, error: safeMessage(result.reason) };
          }
          Sentry.captureException(result.reason, { tags: { route: "api.scans.manual_batch", symbol } });
          return { symbol, timeframe, outcome: "failed", slotId: null, analysisId: null, error: safeMessage(result.reason) };
        }
        const value = result.value;
        const outcome: ManualBatchOutcome = value.reused
          ? value.status === "running" ? "already_running" : value.status === "completed" ? "reused" : "failed"
          : "completed";
        return {
          symbol,
          timeframe,
          outcome,
          slotId: value.slotId,
          analysisId: "analysisId" in value ? value.analysisId ?? null : null,
          error: outcome === "failed" ? value.status : null,
        };
      });
      const counts = {
        completed: results.filter((result) => result.outcome === "completed").length,
        reused: results.filter((result) => result.outcome === "reused").length,
        alreadyRunning: results.filter((result) => result.outcome === "already_running").length,
        failed: results.filter((result) => result.outcome === "failed").length,
      };
      const durationMs = Math.round(performance.now() - started);
      span.setAttributes({
        "specialstock.scan.batch_completed": counts.completed,
        "specialstock.scan.batch_reused": counts.reused,
        "specialstock.scan.batch_running": counts.alreadyRunning,
        "specialstock.scan.batch_failed": counts.failed,
        "specialstock.scan.batch_peak_in_flight": peakInFlight,
        "specialstock.scan.duration_ms": durationMs,
      });
      span.setStatus({ code: 1 });
      Sentry.logger.info("scan.manual_batch.completed", {
        "specialstock.scan.batch_size": input.runs.length,
        "specialstock.scan.batch_interval_profile": intervalProfile,
        ...intervalCounts,
        "specialstock.scan.batch_peak_in_flight": peakInFlight,
        "specialstock.scan.duration_ms": durationMs,
        "specialstock.scan.batch_completed": counts.completed,
        "specialstock.scan.batch_reused": counts.reused,
        "specialstock.scan.batch_running": counts.alreadyRunning,
        "specialstock.scan.batch_failed": counts.failed,
      });
      return { requestId: input.requestId, total: results.length, counts, results };
    },
  );
}
