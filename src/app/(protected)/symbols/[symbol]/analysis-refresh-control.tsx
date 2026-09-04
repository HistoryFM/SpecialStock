"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { AnalysisFreshness } from "@/symbols/presentation";
import { analysisUrl } from "@/symbols/presentation";

type ScanStatus = {
  status: string;
  slotId: string | null;
  analysisId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

const labels: Record<AnalysisFreshness, string> = {
  running: "Fresh analysis running",
  failed: "Latest scan failed · last valid analysis retained",
  fresh: "Analysis is current",
  stale: "A fresher analysis is recommended",
  market_closed: "Last regular-session analysis · market closed",
};

export function AnalysisRefreshControl({
  symbol,
  currentAnalysisId,
  initialFreshness,
  preserveSelection,
}: {
  symbol: string;
  currentAnalysisId: string | null;
  initialFreshness: AnalysisFreshness;
  preserveSelection: boolean;
}) {
  const router = useRouter();
  const [freshness, setFreshness] = useState(initialFreshness);
  const [message, setMessage] = useState(labels[initialFreshness]);
  const [readyAnalysisId, setReadyAnalysisId] = useState<string | null>(null);
  const [polling, setPolling] = useState(initialFreshness === "running");

  const handleStatus = useCallback((status: ScanStatus) => {
    if (status.status === "running" || status.status === "scheduled") {
      setFreshness("running");
      setMessage(labels.running);
      setPolling(true);
      return;
    }
    if (status.status === "failed") {
      setFreshness("failed");
      setMessage(status.error ? `Latest scan failed · ${status.error}` : labels.failed);
      setPolling(false);
      return;
    }
    if (status.status === "completed" && status.analysisId) {
      setPolling(false);
      if (status.analysisId === currentAnalysisId) {
        setFreshness("fresh");
        setMessage(labels.fresh);
      } else if (preserveSelection) {
        setReadyAnalysisId(status.analysisId);
        setMessage("A newer analysis is ready");
      } else {
        router.replace(analysisUrl(symbol, status.analysisId));
        router.refresh();
      }
    }
  }, [currentAnalysisId, preserveSelection, router, symbol]);

  const check = useCallback(async () => {
    const response = await fetch(`/api/scans/${encodeURIComponent(symbol)}`, { cache: "no-store" });
    if (!response.ok) return;
    handleStatus((await response.json()) as ScanStatus);
  }, [handleStatus, symbol]);

  useEffect(() => {
    if (!polling) return;
    const interval = window.setInterval(() => void check(), 2_000);
    return () => window.clearInterval(interval);
  }, [check, polling]);

  const run = async () => {
    setFreshness("running");
    setMessage(labels.running);
    setPolling(true);
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(symbol)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual", timeframe: "5m", requestId: crypto.randomUUID() }),
      });
      const payload = (await response.json()) as ScanStatus & { error?: string };
      if (response.status === 409) {
        setMessage("Another tab is already running this analysis");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Analysis failed");
      if (payload.analysisId) {
        setPolling(false);
        router.replace(analysisUrl(symbol, payload.analysisId));
        router.refresh();
      } else {
        await check();
      }
    } catch (error) {
      setFreshness("failed");
      setPolling(false);
      setMessage(error instanceof Error ? error.message : "Analysis failed");
    }
  };

  const canRun = !preserveSelection && (
    currentAnalysisId === null || freshness === "failed" || freshness === "stale"
  );

  return (
    <div className={`analysis-refresh ${freshness}`} aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <span>{message}</span>
      {readyAnalysisId ? <a href={analysisUrl(symbol, readyAnalysisId)}>View new analysis</a> : null}
      {canRun ? (
        <button className="secondary-button compact" disabled={polling} onClick={() => void run()} type="button">
          {polling ? "Running…" : "Run fresh analysis"}
        </button>
      ) : null}
    </div>
  );
}
