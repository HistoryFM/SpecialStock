"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SymbolDashboardItem } from "@/dashboard/data";
import { WatchlistTable } from "@/app/(protected)/dashboard/watchlist-table";

type Status = {
  due: boolean;
  slotKey: string | null;
  nextScanAt: string | null;
  marketOpen: boolean;
  automaticSymbols: string[];
  enabledCount: number;
  configuredCount: number;
  runningScans: Array<{ symbol: string; startedAt: string | null }>;
  scanRevision: string | null;
};

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
    byClass?: { routine_compact?: number; manual_compact?: number; full_analysis?: number };
    routineProjectionUsd?: number | null;
  };
  demoMode: boolean;
}) {
  const router = useRouter();
  const tabId = useRef(crypto.randomUUID());
  const lastSlot = useRef<string | null>(null);
  const batchInFlight = useRef<string | null>(null);
  const nextBatchRetryAt = useRef(0);
  const scanRevision = useRef<string | null>(null);
  const revisionInitialized = useRef(false);
  const inFlight = useRef(new Set<string>());
  const tickInFlight = useRef(false);
  const lastLeadershipState = useRef<boolean | null>(null);
  const lastStatusSignature = useRef<string | null>(null);
  const schedulerStatusHealthy = useRef(true);
  const [message, setMessage] = useState("Scheduler is checking the market session…");
  const [automaticOverrides, setAutomaticOverrides] = useState<Map<string, boolean>>(new Map());
  const [busySymbols, setBusySymbols] = useState<Set<string>>(new Set());
  const [batchBusySymbols, setBatchBusySymbols] = useState<Set<string>>(new Set());
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

  const run = useCallback(
    async (symbol: string, mode: "manual" | "scheduled", slotKey?: string, refresh = true) => {
      if (inFlight.current.has(symbol)) return false;
      inFlight.current.add(symbol);
      setBusySymbols((current) => new Set(current).add(symbol));
      try {
        const response = await fetch(`/api/scans/${encodeURIComponent(symbol)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, ...(slotKey ? { slotKey } : {}) }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Scan failed");
        setMessage(`${symbol} ${mode} scan completed.`);
        if (refresh) router.refresh();
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Scan failed.");
        return false;
      } finally {
        inFlight.current.delete(symbol);
        setBusySymbols((current) => {
          const next = new Set(current);
          next.delete(symbol);
          return next;
        });
      }
    },
    [router],
  );

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
    setBatchBusySymbols(new Set(symbols));
    return Sentry.startSpan(
      {
        name: "Request scheduled scan batch",
        op: "specialstock.scheduler.batch",
        forceTransaction: true,
        attributes: {
          "specialstock.scheduler.tab_id": tabId.current,
          "specialstock.scan.slot": slotKey,
          "specialstock.scan.batch_size": symbols.length,
          "specialstock.scan.symbols": symbols.join(","),
        },
      },
      async (span) => {
        const started = performance.now();
        Sentry.logger.info("scheduler.batch.requested", {
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
          if (!response.ok || !payload.counts) {
            throw new Error(payload.error ?? "Scheduled batch failed.");
          }
          lastSlot.current = slotKey;
          nextBatchRetryAt.current = 0;
          const successful = payload.counts.completed + payload.counts.alreadyCompleted;
          const pending = payload.counts.alreadyRunning;
          const failed = payload.counts.terminalFailed + payload.counts.failed;
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
          return true;
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
          setBatchBusySymbols(new Set());
        }
      },
    );
  }, [router]);

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
        const response = await fetch("/api/scans/status", { cache: "no-store" });
        if (!response.ok) throw new Error(`Scheduler status returned HTTP ${response.status}.`);
        const status = (await response.json()) as Status;
        if (cancelled) return;
        const statusSignature = [
          status.slotKey ?? "none",
          status.due,
          status.marketOpen,
          status.enabledCount,
          status.configuredCount,
          status.runningScans.map((scan) => scan.symbol).sort().join(","),
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
            "specialstock.scheduler.next_scan_at": status.nextScanAt ?? "none",
          });
        }
        if (!schedulerStatusHealthy.current) {
          schedulerStatusHealthy.current = true;
          Sentry.logger.info("scheduler.status.recovered", {
            "specialstock.scheduler.tab_id": tabId.current,
          });
        }
        setRemoteBusySymbols(new Set(status.runningScans.map((scan) => scan.symbol)));
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
        const heartbeatResponse = await fetch("/api/scans/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId: tabId.current, isLeader: leader }),
        });
        if (!heartbeatResponse.ok) throw new Error(`Scheduler heartbeat returned HTTP ${heartbeatResponse.status}.`);
        if (
          leader && status.due && status.slotKey && lastSlot.current !== status.slotKey &&
          Date.now() >= nextBatchRetryAt.current
        ) {
          leadershipHeartbeat = window.setInterval(
            () => void acquireLeadership(),
            Math.floor(LEASE_MS / 3),
          );
          if (acquireLeadership()) {
            await runScheduledBatch(status.automaticSymbols, status.slotKey);
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
    return Sentry.startSpan(
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
    );
  }, []);

  const enabledCount = items.filter((item) => item.automaticScanEnabled).length;
  const allBusySymbols = new Set([...remoteBusySymbols, ...busySymbols, ...batchBusySymbols]);
  const busySymbolList = [...allBusySymbols];
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
        <span className="tabular" title="Scheduled compact · manual compact · full analysis">
          <strong>By use</strong> ${(budget.byClass?.routine_compact ?? 0).toFixed(4)} · ${(budget.byClass?.manual_compact ?? 0).toFixed(4)} · ${(budget.byClass?.full_analysis ?? 0).toFixed(4)}
        </span>
        <span className="tabular"><strong>2k routine</strong> {budget.routineProjectionUsd === null || budget.routineProjectionUsd === undefined ? "Collecting data" : `$${budget.routineProjectionUsd.toFixed(2)}`}</span>
      </div>
      <WatchlistTable
        items={items}
        busySymbols={allBusySymbols}
        onAutomaticScanChange={setAutomaticScanning}
        onRun={(symbol) => void run(symbol, "manual")}
      />
    </>
  );
}
