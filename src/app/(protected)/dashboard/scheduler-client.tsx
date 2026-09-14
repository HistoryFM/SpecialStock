"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SymbolDashboardItem } from "@/dashboard/data";
import type { ManualScanTimeframe } from "@/analysis/types";
import {
  type ManualBatchRun,
  type ManualBatchSelectionResult,
  WatchlistTable,
} from "@/app/(protected)/dashboard/watchlist-table";

type Status = {
  due: boolean;
  slotKey: string | null;
  nextScanAt: string | null;
  marketOpen: boolean;
  automaticSymbols: string[];
  enabledCount: number;
  configuredCount: number;
  runningScans: Array<{ symbol: string; timeframe: ManualScanTimeframe; startedAt: string | null }>;
  scanRevision: string | null;
};

type ProgressStatus = "pending" | "running" | "completed" | "failed";
type ProgressItem = { symbol: string; timeframe: ManualScanTimeframe; status: ProgressStatus };
type ProgressBatch = { label: string; items: ProgressItem[] };

const LEADER_KEY = "specialstock-scheduler-leader";
const LEASE_MS = 15_000;

export function SchedulerClient({
  initialItems,
  database,
  budget,
  demoMode,
}: {
  initialItems: SymbolDashboardItem[];
  database: { engine: string; status: string };
  budget: {
    todayUsd: number;
    monthUsd: number;
    targetUsd: number;
    byClass?: { routine_compact?: number; manual_compact?: number; full_analysis?: number; chat_followup?: number };
    routineProjectionUsd?: number | null;
  };
  demoMode: boolean;
}) {
  const router = useRouter();
  const tabId = useRef(crypto.randomUUID());
  const lastSlot = useRef<string | null>(null);
  const pendingScheduledSlot = useRef<string | null>(null);
  const batchInFlight = useRef<string | null>(null);
  const nextBatchRetryAt = useRef(0);
  const scanRevision = useRef<string | null>(null);
  const revisionInitialized = useRef(false);
  const tickInFlight = useRef(false);
  const lastLeadershipState = useRef<boolean | null>(null);
  const lastStatusSignature = useRef<string | null>(null);
  const schedulerStatusHealthy = useRef(true);
  const [message, setMessage] = useState("Scheduler is checking the market session…");
  const [automaticOverrides, setAutomaticOverrides] = useState<Map<string, boolean>>(new Map());
  const [progressBatches, setProgressBatches] = useState<Record<string, ProgressBatch>>({});
  const [remoteBusySymbols, setRemoteBusySymbols] = useState<Set<string>>(new Set());
  const items = useMemo(() => initialItems.map((item) => ({
    ...item,
    automaticScanEnabled:
      automaticOverrides.get(item.symbol) ?? item.automaticScanEnabled,
  })), [automaticOverrides, initialItems]);

  const acquireLeadership = useCallback(() => {
    const now = Date.now();
    const raw = localStorage.getItem(LEADER_KEY);
    const lease = raw ? (JSON.parse(raw) as { tabId: string; expiresAt: number }) : null;
    if (!lease || lease.expiresAt < now || lease.tabId === tabId.current) {
      localStorage.setItem(
        LEADER_KEY,
        JSON.stringify({ tabId: tabId.current, expiresAt: now + LEASE_MS }),
      );
      return true;
    }
    return false;
  }, []);

  const trackProgress = useCallback((mode: "manual" | "scheduled", id: string, runs: Array<{ symbol: string; timeframe: ManualScanTimeframe }>) => {
    const key = `${mode}:${id}`;
    const initial = runs.map((run) => ({ ...run, status: "pending" as const }));
    const lastStatuses = new Map(initial.map((run) => [`${run.symbol}:${run.timeframe}`, run.status as ProgressStatus]));
    let active = true;
    let polling = false;
    setProgressBatches((current) => ({ ...current, [key]: {
      label: mode === "manual" ? "Manual batch" : "Automatic batch", items: initial,
    } }));
    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const response = await Sentry.suppressTracing(() => fetch(`/api/scans/progress?mode=${mode}&id=${encodeURIComponent(id)}`, { cache: "no-store" }));
        if (!response.ok) return;
        const payload = (await response.json()) as { items: ProgressItem[] };
        if (!active) return;
        const found = new Map(payload.items.map((item) => [`${item.symbol}:${item.timeframe}`, item.status]));
        const next = initial.map((item) => ({ ...item, status: found.get(`${item.symbol}:${item.timeframe}`) ?? "pending" }));
        const newlySettled = next.some((item) => {
          const runKey = `${item.symbol}:${item.timeframe}`;
          const previous = lastStatuses.get(runKey);
          lastStatuses.set(runKey, item.status);
          return (item.status === "completed" || item.status === "failed") && previous !== item.status;
        });
        setProgressBatches((current) => current[key]
          ? { ...current, [key]: { ...current[key], items: next } } : current);
        if (newlySettled) router.refresh();
      } catch {
        // The final batch response remains authoritative when progress polling is unavailable.
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 3_000);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer);
      setProgressBatches((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
  }, [router]);

  const runManualBatch = useCallback(async (
    runs: ManualBatchRun[],
  ): Promise<ManualBatchSelectionResult | null> => {
    const requestId = crypto.randomUUID();
    const symbols = [...new Set(runs.map(({ symbol }) => symbol))];
    const intervals = new Set(runs.map(({ timeframe }) => timeframe));
    const intervalProfile = intervals.size === 1 ? runs[0]?.timeframe ?? "5m" : "mixed";
    const stopProgress = trackProgress("manual", requestId, runs);
    return Sentry.startNewTrace(() => Sentry.startSpan(
      {
        name: "Request manual scan batch",
        op: "specialstock.scan.manual_batch.request",
        forceTransaction: true,
        attributes: {
          "specialstock.telemetry.origin": "client",
          "specialstock.scan.request_id": requestId,
          "specialstock.scan.batch_size": runs.length,
          "specialstock.scan.batch_interval_profile": intervalProfile,
          "specialstock.scan.batch_interval_1m": runs.filter(({ timeframe }) => timeframe === "1m").length,
          "specialstock.scan.batch_interval_5m": runs.filter(({ timeframe }) => timeframe === "5m").length,
          "specialstock.scan.batch_interval_10m": runs.filter(({ timeframe }) => timeframe === "10m").length,
          "specialstock.scan.symbols": symbols.join(","),
        },
      },
      async (span) => {
        const started = performance.now();
        Sentry.logger.info("scan.manual_batch.client_requested", {
          "specialstock.telemetry.origin": "client",
          "specialstock.scan.request_id": requestId,
          "specialstock.scan.batch_size": runs.length,
          "specialstock.scan.batch_interval_profile": intervalProfile,
          ...Object.fromEntries(["1m", "5m", "10m"].map((timeframe) => [
            `specialstock.scan.batch_interval_${timeframe}`,
            runs.filter((run) => run.timeframe === timeframe).length,
          ])),
        });
        try {
          const response = await fetch("/api/scans/manual-batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runs, requestId }),
          });
          const payload = (await response.json()) as ManualBatchSelectionResult & {
            error?: string;
            counts?: { completed: number; reused: number; alreadyRunning: number; failed: number };
          };
          if (!response.ok || !payload.counts || !payload.results) {
            throw new Error(payload.error ?? "Manual batch failed.");
          }
          const counts = payload.counts;
          const completed = counts.completed + counts.reused;
          span.setAttributes({
            "specialstock.scan.batch_completed": payload.counts.completed,
            "specialstock.scan.batch_reused": payload.counts.reused,
            "specialstock.scan.batch_running": payload.counts.alreadyRunning,
            "specialstock.scan.batch_failed": payload.counts.failed,
            "specialstock.scan.duration_ms": Math.round(performance.now() - started),
          });
          span.setStatus({ code: 1 });
          Sentry.withActiveSpan(span, () => Sentry.logger.info("scan.manual_batch.client_completed", {
            "specialstock.telemetry.origin": "client",
            "specialstock.scan.request_id": requestId,
            "specialstock.scan.batch_completed": counts.completed,
            "specialstock.scan.batch_reused": counts.reused,
            "specialstock.scan.batch_running": counts.alreadyRunning,
            "specialstock.scan.batch_failed": counts.failed,
            "specialstock.scan.duration_ms": Math.round(performance.now() - started),
          }));
          setMessage(
            `Manual batch settled · ${completed} completed${payload.counts.alreadyRunning ? ` · ${payload.counts.alreadyRunning} already running` : ""}${payload.counts.failed ? ` · ${payload.counts.failed} failed` : ""}.`,
          );
          router.refresh();
          return payload;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Manual batch failed.";
          span.setAttributes({
            "specialstock.scan.request_outcome": "failed",
            "specialstock.scan.duration_ms": Math.round(performance.now() - started),
            "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
          });
          span.setStatus({ code: 2, message: message.slice(0, 200) });
          Sentry.withActiveSpan(span, () => Sentry.logger.warn("scan.manual_batch.client_failed", {
            "specialstock.telemetry.origin": "client",
            "specialstock.scan.request_id": requestId,
            "specialstock.scan.batch_size": runs.length,
            "specialstock.scan.duration_ms": Math.round(performance.now() - started),
            "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
          }));
          setMessage(message);
          return null;
        } finally {
          stopProgress();
        }
      },
    ));
  }, [router, trackProgress]);

  const runScheduledBatch = useCallback(async (symbols: string[], slotKey: string) => {
    if (batchInFlight.current) {
      Sentry.logger.info("scheduler.batch.suppressed", {
        "specialstock.scheduler.tab_id": tabId.current,
        "specialstock.scan.slot": slotKey,
        "specialstock.scheduler.suppression": "batch_already_in_flight",
        "specialstock.scheduler.active_slot": batchInFlight.current,
      });
      return false;
    }
    batchInFlight.current = slotKey;
    const stopProgress = trackProgress("scheduled", slotKey, symbols.map((symbol) => ({ symbol, timeframe: "5m" })));
    const retry = pendingScheduledSlot.current === slotKey;
    return Sentry.startNewTrace(() => Sentry.startSpan(
      {
        name: "Request scheduled scan batch",
        op: "specialstock.scheduler.batch",
        forceTransaction: true,
        attributes: {
          "specialstock.telemetry.origin": "client",
          "specialstock.scheduler.tab_id": tabId.current,
          "specialstock.scan.slot": slotKey,
          "specialstock.scan.batch_size": symbols.length,
          "specialstock.scan.symbols": symbols.join(","),
          "specialstock.scheduler.retry": retry,
        },
      },
      async (span) => {
        const started = performance.now();
        Sentry.logger.info("scheduler.batch.requested", {
          "specialstock.telemetry.origin": "client",
          "specialstock.scheduler.tab_id": tabId.current,
          "specialstock.scan.slot": slotKey,
          "specialstock.scan.batch_size": symbols.length,
          "specialstock.scan.symbols": symbols.join(","),
        });
        try {
          const response = await fetch("/api/scans/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slotKey }),
          });
          const payload = (await response.json()) as {
            error?: string;
            total?: number;
            counts?: {
              completed: number;
              alreadyCompleted: number;
              alreadyRunning: number;
              terminalFailed: number;
              failed: number;
            };
            results?: Array<{ symbol: string; outcome: string }>;
          };
          if (response.status === 409 && pendingScheduledSlot.current === slotKey) {
            pendingScheduledSlot.current = null;
            nextBatchRetryAt.current = 0;
            setMessage("The pending automatic slot expired; the scheduler will use the latest five-minute slot.");
            return false;
          }
          if (!response.ok || !payload.counts) {
            throw new Error(payload.error ?? "Scheduled batch failed.");
          }
          const successful = payload.counts.completed + payload.counts.alreadyCompleted;
          const pending = payload.counts.alreadyRunning;
          const failed = payload.counts.terminalFailed + payload.counts.failed;
          if (pending) {
            pendingScheduledSlot.current = slotKey;
            nextBatchRetryAt.current = Date.now() + 10_000;
          } else {
            pendingScheduledSlot.current = null;
            lastSlot.current = slotKey;
            nextBatchRetryAt.current = 0;
          }
          const durationMs = Math.round(performance.now() - started);
          const outcomes = payload.results?.map((result) => `${result.symbol}:${result.outcome}`).join(",") ?? "unavailable";
          span.setAttributes({
            "specialstock.scheduler.outcome": failed ? "completed_with_failures" : "completed",
            "specialstock.scheduler.duration_ms": durationMs,
            "specialstock.scan.batch_completed": payload.counts.completed,
            "specialstock.scan.batch_reused": payload.counts.alreadyCompleted,
            "specialstock.scan.batch_running": payload.counts.alreadyRunning,
            "specialstock.scan.batch_terminal_failed": payload.counts.terminalFailed,
            "specialstock.scan.batch_failed": payload.counts.failed,
            "specialstock.scan.batch_outcomes": outcomes,
          });
          span.setStatus({ code: 1 });
          Sentry.logger.info("scheduler.batch.completed", {
            "specialstock.telemetry.origin": "client",
            "specialstock.scheduler.tab_id": tabId.current,
            "specialstock.scan.slot": slotKey,
            "specialstock.scan.batch_size": symbols.length,
            "specialstock.scheduler.duration_ms": durationMs,
            "specialstock.scan.batch_completed": payload.counts.completed,
            "specialstock.scan.batch_reused": payload.counts.alreadyCompleted,
            "specialstock.scan.batch_running": payload.counts.alreadyRunning,
            "specialstock.scan.batch_terminal_failed": payload.counts.terminalFailed,
            "specialstock.scan.batch_failed": payload.counts.failed,
            "specialstock.scan.batch_outcomes": outcomes,
          });
          setMessage(
            `Scheduled batch settled · ${successful} completed${pending ? ` · ${pending} already running` : ""}${failed ? ` · ${failed} failed` : ""}.`,
          );
          router.refresh();
          return pending === 0;
        } catch (error) {
          const durationMs = Math.round(performance.now() - started);
          const errorType = error instanceof Error ? error.constructor.name : "UnknownError";
          const errorMessage = error instanceof Error ? error.message : "Scheduled batch failed.";
          nextBatchRetryAt.current = Date.now() + 30_000;
          span.setAttributes({
            "specialstock.scheduler.outcome": "failed",
            "specialstock.scheduler.duration_ms": durationMs,
            "specialstock.scheduler.retry_at": new Date(nextBatchRetryAt.current).toISOString(),
            "error.type": errorType,
          });
          span.setStatus({ code: 2, message: errorMessage.slice(0, 200) });
          Sentry.logger.warn("scheduler.batch.failed", {
            "specialstock.telemetry.origin": "client",
            "specialstock.scheduler.tab_id": tabId.current,
            "specialstock.scan.slot": slotKey,
            "specialstock.scan.batch_size": symbols.length,
            "specialstock.scheduler.duration_ms": durationMs,
            "specialstock.scheduler.retry_at": new Date(nextBatchRetryAt.current).toISOString(),
            "error.type": errorType,
            "error.message": errorMessage.slice(0, 500),
          });
          setMessage(`${errorMessage} Retrying shortly.`);
          return false;
        } finally {
          batchInFlight.current = null;
          stopProgress();
        }
      },
    ));
  }, [router, trackProgress]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (tickInFlight.current) return;
      tickInFlight.current = true;
      let leadershipHeartbeat: number | null = null;
      const leader = acquireLeadership();
      if (lastLeadershipState.current !== leader) {
        lastLeadershipState.current = leader;
        Sentry.logger.info("scheduler.leadership.changed", {
          "specialstock.scheduler.tab_id": tabId.current,
          "specialstock.scheduler.is_leader": leader,
          "specialstock.scheduler.lease_ms": LEASE_MS,
        });
      }
      try {
        const response = await Sentry.suppressTracing(() => fetch("/api/scans/status", { cache: "no-store" }));
        if (!response.ok) throw new Error(`Scheduler status returned HTTP ${response.status}.`);
        const status = (await response.json()) as Status;
        if (cancelled) return;
        const statusSignature = [
          status.slotKey ?? "none",
          status.due,
          status.marketOpen,
          status.enabledCount,
          status.configuredCount,
          status.runningScans.map((scan) => `${scan.symbol}:${scan.timeframe}`).sort().join(","),
        ].join("|");
        if (lastStatusSignature.current !== statusSignature) {
          lastStatusSignature.current = statusSignature;
          Sentry.logger.info("scheduler.status.changed", {
            "specialstock.scheduler.tab_id": tabId.current,
            "specialstock.scheduler.is_leader": leader,
            "specialstock.scheduler.market_open": status.marketOpen,
            "specialstock.scheduler.due": status.due,
            "specialstock.scan.slot": status.slotKey ?? "none",
            "specialstock.scheduler.enabled_count": status.enabledCount,
            "specialstock.scheduler.configured_count": status.configuredCount,
            "specialstock.scheduler.automatic_symbols": status.automaticSymbols.join(","),
            "specialstock.scheduler.running_count": status.runningScans.length,
            "specialstock.scheduler.running_symbols": status.runningScans.map((scan) => scan.symbol).join(",") || "none",
            "specialstock.scheduler.running_pairs": status.runningScans.map((scan) => `${scan.symbol}:${scan.timeframe}`).join(",") || "none",
            "specialstock.scheduler.next_scan_at": status.nextScanAt ?? "none",
          });
        }
        if (!schedulerStatusHealthy.current) {
          schedulerStatusHealthy.current = true;
          Sentry.logger.info("scheduler.status.recovered", {
            "specialstock.scheduler.tab_id": tabId.current,
          });
        }
        setRemoteBusySymbols(new Set(status.runningScans.map((scan) => `${scan.symbol}:${scan.timeframe}`)));
        if (!revisionInitialized.current) {
          scanRevision.current = status.scanRevision;
          revisionInitialized.current = true;
        } else if (status.scanRevision !== scanRevision.current) {
          scanRevision.current = status.scanRevision;
          router.refresh();
        }
        setMessage(
          status.marketOpen
            ? status.nextScanAt
              ? `Next scan ${new Date(status.nextScanAt).toLocaleTimeString()}`
              : "Market session active"
            : "Market closed · manual scans remain available",
        );
        const heartbeatResponse = await Sentry.suppressTracing(() => fetch("/api/scans/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId: tabId.current, isLeader: leader }),
        }));
        if (!heartbeatResponse.ok) throw new Error(`Scheduler heartbeat returned HTTP ${heartbeatResponse.status}.`);
        const slotToRun = pendingScheduledSlot.current ?? (status.due ? status.slotKey : null);
        if (
          leader && slotToRun && lastSlot.current !== slotToRun &&
          Date.now() >= nextBatchRetryAt.current
        ) {
          leadershipHeartbeat = window.setInterval(
            () => void acquireLeadership(),
            Math.floor(LEASE_MS / 3),
          );
          if (acquireLeadership()) {
            await runScheduledBatch(status.automaticSymbols, slotToRun);
          }
        }
      } catch (error) {
        if (schedulerStatusHealthy.current) {
          schedulerStatusHealthy.current = false;
          Sentry.logger.warn("scheduler.status.failed", {
            "specialstock.scheduler.tab_id": tabId.current,
            "specialstock.scheduler.is_leader": leader,
            "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
            "error.message": error instanceof Error ? error.message.slice(0, 500) : "Scheduler heartbeat unavailable.",
          });
        }
        if (!cancelled) setMessage("Scheduler heartbeat unavailable.");
      } finally {
        if (leadershipHeartbeat !== null) window.clearInterval(leadershipHeartbeat);
        tickInFlight.current = false;
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [acquireLeadership, router, runScheduledBatch]);

  const setAutomaticScanning = useCallback(async (symbols: string[], enabled: boolean) => {
    return Sentry.startNewTrace(() => Sentry.startSpan(
      {
        name: "Change automatic scan setting",
        op: "ui.action.click",
        forceTransaction: true,
        attributes: {
          "specialstock.scheduler.tab_id": tabId.current,
          "specialstock.settings.requested_symbols": symbols.join(","),
          "specialstock.settings.requested_count": symbols.length,
          "specialstock.settings.requested_enabled": enabled,
        },
      },
      async (span) => {
        const started = performance.now();
        Sentry.logger.info("settings.auto.client_requested", {
          "specialstock.scheduler.tab_id": tabId.current,
          "specialstock.settings.requested_symbols": symbols.join(","),
          "specialstock.settings.requested_enabled": enabled,
        });
        try {
          const response = await fetch("/api/settings/automatic-scans", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols, enabled }),
          });
          const payload = (await response.json()) as {
            error?: string;
            watchlist?: Array<{ symbol: string; automaticScanEnabled: boolean }>;
            enabledCount?: number;
            updatedAt?: string;
          };
          if (!response.ok || !payload.watchlist) {
            throw new Error(payload.error ?? "Automatic-scan settings could not be updated.");
          }
          const automaticState = new Map(
            payload.watchlist.map((entry) => [entry.symbol, entry.automaticScanEnabled]),
          );
          setAutomaticOverrides((current) => {
            const next = new Map(current);
            for (const [symbol, automaticScanEnabled] of automaticState) {
              next.set(symbol, automaticScanEnabled);
            }
            return next;
          });
          const durationMs = Math.round(performance.now() - started);
          span.setAttributes({
            "specialstock.settings.outcome": "updated",
            "specialstock.settings.enabled_count": payload.enabledCount ?? payload.watchlist.filter((entry) => entry.automaticScanEnabled).length,
            "specialstock.settings.updated_version": payload.updatedAt ?? "unavailable",
            "specialstock.settings.duration_ms": durationMs,
          });
          span.setStatus({ code: 1 });
          Sentry.logger.info("settings.auto.client_completed", {
            "specialstock.scheduler.tab_id": tabId.current,
            "specialstock.settings.requested_symbols": symbols.join(","),
            "specialstock.settings.requested_enabled": enabled,
            "specialstock.settings.enabled_count": payload.enabledCount ?? payload.watchlist.filter((entry) => entry.automaticScanEnabled).length,
            "specialstock.settings.updated_version": payload.updatedAt ?? "unavailable",
            "specialstock.settings.duration_ms": durationMs,
          });
          setMessage(`Automatic scanning ${enabled ? "enabled" : "disabled"} for ${symbols.length} stock${symbols.length === 1 ? "" : "s"}.`);
          return true;
        } catch (error) {
          const durationMs = Math.round(performance.now() - started);
          const errorType = error instanceof Error ? error.constructor.name : "UnknownError";
          const errorMessage = error instanceof Error ? error.message : "Automatic-scan settings could not be updated.";
          span.setAttributes({
            "specialstock.settings.outcome": "failed",
            "specialstock.settings.duration_ms": durationMs,
            "error.type": errorType,
          });
          span.setStatus({ code: 2, message: errorMessage.slice(0, 200) });
          Sentry.logger.warn("settings.auto.client_failed", {
            "specialstock.scheduler.tab_id": tabId.current,
            "specialstock.settings.requested_symbols": symbols.join(","),
            "specialstock.settings.requested_enabled": enabled,
            "specialstock.settings.duration_ms": durationMs,
            "error.type": errorType,
            "error.message": errorMessage.slice(0, 500),
          });
          setMessage(errorMessage);
          return false;
        }
      },
    ));
  }, []);

  const enabledCount = items.filter((item) => item.automaticScanEnabled).length;
  const activeProgress = Object.entries(progressBatches);
  const batchBusySymbols = new Set(activeProgress.flatMap(([, batch]) => batch.items
    .filter((item) => item.status === "pending" || item.status === "running")
    .map((item) => `${item.symbol}:${item.timeframe}`)));
  const allBusyRuns = new Set([...remoteBusySymbols, ...batchBusySymbols]);
  const busySymbolList = [...new Set([...allBusyRuns].map((run) => run.split(":")[0]!))];
  const busyLabel = `${busySymbolList.length} stock${busySymbolList.length === 1 ? "" : "s"}`;

  return (
    <>
      <div className="workspace-status-strip" aria-live="polite">
        <span
          className={`status-dot ${demoMode ? "warning" : "live"}${busySymbolList.length ? " scanning" : ""}`}
          aria-hidden="true"
        />
        <span
          className={`status-message${busySymbolList.length ? " scanning" : ""}`}
          title={busySymbolList.length ? `Scanning ${busySymbolList.join(", ")}` : undefined}
        >
          {busySymbolList.length ? `Scanning ${busyLabel} concurrently…` : message}
        </span>
        <span><strong>Charts</strong> {demoMode ? "Not configured" : "Chart-Img / TradingView"}</span>
        <span><strong>Auto</strong> {enabledCount} of {items.length} · {enabledCount ? "Browser active" : "Off"}</span>
        <span><strong>Database</strong> {database.engine} · {database.status}</span>
        <span className="tabular"><strong>Spend</strong> ${budget.todayUsd.toFixed(4)} today · ${budget.targetUsd.toFixed(2)} target</span>
        <span className="tabular" title="Scheduled compact · manual compact · full analysis · chat follow-up">
          <strong>By use</strong> ${(budget.byClass?.routine_compact ?? 0).toFixed(4)} · ${(budget.byClass?.manual_compact ?? 0).toFixed(4)} · ${(budget.byClass?.full_analysis ?? 0).toFixed(4)} · ${(budget.byClass?.chat_followup ?? 0).toFixed(4)}
        </span>
        <span className="tabular"><strong>2k routine</strong> {budget.routineProjectionUsd === null || budget.routineProjectionUsd === undefined ? "Collecting data" : `$${budget.routineProjectionUsd.toFixed(2)}`}</span>
      </div>
      {activeProgress.map(([key, batch]) => {
        const completed = batch.items.filter((item) => item.status === "completed").length;
        const failed = batch.items.filter((item) => item.status === "failed").length;
        return <div className="workspace-status-strip" aria-live="polite" key={key}>
          <strong>{batch.label}: {completed + failed}/{batch.items.length} settled{failed ? ` · ${failed} failed` : ""}</strong>
          <span>{batch.items.map((item) => `${item.symbol} ${item.timeframe}: ${item.status}`).join(" · ")}</span>
        </div>;
      })}
      <WatchlistTable
        items={items}
        busyRuns={allBusyRuns}
        progressRuns={activeProgress.flatMap(([, batch]) => batch.items)}
        onAutomaticScanChange={setAutomaticScanning}
        onRun={runManualBatch}
        onRunSelected={runManualBatch}
      />
    </>
  );
}
