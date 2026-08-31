"use client";

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
  budget: { todayUsd: number; monthUsd: number; capUsd: number };
  demoMode: boolean;
}) {
  const router = useRouter();
  const tabId = useRef(crypto.randomUUID());
  const lastSlot = useRef<string | null>(null);
  const scanRevision = useRef<string | null>(null);
  const revisionInitialized = useRef(false);
  const inFlight = useRef(new Set<string>());
  const tickInFlight = useRef(false);
  const [message, setMessage] = useState("Scheduler is checking the market session…");
  const [automaticOverrides, setAutomaticOverrides] = useState<Map<string, boolean>>(new Map());
  const [busySymbols, setBusySymbols] = useState<Set<string>>(new Set());
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
    async (symbol: string, mode: "manual" | "scheduled", slotKey?: string) => {
      if (inFlight.current.has(symbol)) return;
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
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Scan failed.");
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

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (tickInFlight.current) return;
      tickInFlight.current = true;
      let leadershipHeartbeat: number | null = null;
      const leader = acquireLeadership();
      try {
        const response = await fetch("/api/scans/status", { cache: "no-store" });
        if (!response.ok) return;
        const status = (await response.json()) as Status;
        if (cancelled) return;
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
        await fetch("/api/scans/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId: tabId.current, isLeader: leader }),
        });
        if (leader && status.due && status.slotKey && lastSlot.current !== status.slotKey) {
          lastSlot.current = status.slotKey;
          leadershipHeartbeat = window.setInterval(
            () => void acquireLeadership(),
            Math.floor(LEASE_MS / 3),
          );
          for (const symbol of status.automaticSymbols) {
            if (!acquireLeadership()) break;
            await run(symbol, "scheduled", status.slotKey);
          }
        }
      } catch {
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
  }, [acquireLeadership, router, run]);

  const setAutomaticScanning = useCallback(async (symbols: string[], enabled: boolean) => {
    try {
      const response = await fetch("/api/settings/automatic-scans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, enabled }),
      });
      const payload = (await response.json()) as {
        error?: string;
        watchlist?: Array<{ symbol: string; automaticScanEnabled: boolean }>;
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
      setMessage(`Automatic scanning ${enabled ? "enabled" : "disabled"} for ${symbols.length} stock${symbols.length === 1 ? "" : "s"}.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Automatic-scan settings could not be updated.");
      return false;
    }
  }, []);

  const enabledCount = items.filter((item) => item.automaticScanEnabled).length;
  const allBusySymbols = new Set([...remoteBusySymbols, ...busySymbols]);

  return (
    <>
      <div className="workspace-status-strip" aria-live="polite">
        <span className={`status-dot ${demoMode ? "warning" : "live"}`} aria-hidden="true" />
        <span className="status-message">
          {allBusySymbols.size ? `Scanning ${[...allBusySymbols].join(", ")}…` : message}
        </span>
        <span><strong>Charts</strong> {demoMode ? "Not configured" : "Chart-Img / TradingView"}</span>
        <span><strong>Auto</strong> {enabledCount} of {items.length} · {enabledCount ? "Browser active" : "Off"}</span>
        <span><strong>Database</strong> {database.engine} · {database.status}</span>
        <span className="tabular"><strong>Spend</strong> ${budget.todayUsd.toFixed(4)} / ${budget.capUsd.toFixed(2)} today</span>
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
