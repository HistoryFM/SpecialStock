"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnalysisChat } from "@/app/(protected)/symbols/[symbol]/analysis-chat";
import type { FourPhaseReport } from "@/analysis/types";

type FullPayload = {
  analysisId: string;
  state: "ineligible" | "not_requested" | "running" | "available" | "failed";
  error: string | null;
  full: null | {
    setupType: string | null; immediateBias: string | null; broaderTrend: string | null;
    candlestickAnalysis: string | null; vwapKeltnerAnalysis: string | null; cciAnalysis: string | null;
    supportingEvidence: string[] | null; conflictingEvidence: string[] | null;
    deeperScenario: string | null; summary: string | null;
    report?: FourPhaseReport | null;
  };
};

function ReportBody({ text }: { text: string }) {
  const lines = text.split(/\n+/).map((line) => line.trim().replace(/^[•*-]\s*/, "")).filter(Boolean);
  if (lines.length < 2) return <p>{text}</p>;
  return <ul>{lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>;
}

export function FullAnalysisPanel({ initial, capturedAt, chartAvailable = true }: { initial: FullPayload; capturedAt?: string; chartAvailable?: boolean }) {
  const router = useRouter();
  const [payload, setPayload] = useState(initial);
  const [pending, setPending] = useState(false);
  const started = useRef(false);
  const refreshedAvailable = useRef(initial.state === "available");

  const request = useCallback(async (retry = false) => {
    setPending(true);
    try {
      const next = await Sentry.startNewTrace(() => Sentry.startSpan(
        {
          name: "Request full analysis",
          op: "specialstock.analysis.full.request",
          forceTransaction: true,
          attributes: {
            "specialstock.analysis.id": initial.analysisId,
            "specialstock.analysis.retry": retry,
          },
        },
        async (span) => {
          const started = performance.now();
          try {
            const response = await fetch(`/api/analyses/${initial.analysisId}/full`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry }),
            });
            const result = await response.json() as FullPayload & { error?: string };
            if (!response.ok && response.status !== 202) throw new Error(result.error ?? "Full analysis failed.");
            span.setAttributes({
              "specialstock.analysis.state": result.state,
              "specialstock.analysis.duration_ms": Math.round(performance.now() - started),
            });
            span.setStatus({ code: 1 });
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Full analysis failed.";
            span.setAttributes({
              "specialstock.analysis.state": "failed",
              "specialstock.analysis.duration_ms": Math.round(performance.now() - started),
              "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
            });
            span.setStatus({ code: 2, message: message.slice(0, 200) });
            throw error;
          }
        },
      ));
      setPayload(next);
    } catch (error) {
      setPayload((current) => ({ ...current, state: "failed", error: error instanceof Error ? error.message : "Full analysis failed." }));
    } finally {
      setPending(false);
    }
  }, [initial.analysisId]);

  useEffect(() => {
    if (chartAvailable && payload.state === "not_requested" && !started.current) {
      started.current = true;
      void request();
    }
  }, [chartAvailable, payload.state, request]);

  useEffect(() => {
    if (payload.state !== "running") return;
    const timer = window.setInterval(async () => {
      const response = await Sentry.suppressTracing(() => fetch(
        `/api/analyses/${initial.analysisId}/full`,
        { cache: "no-store" },
      ));
      if (response.ok) setPayload(await response.json() as FullPayload);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [initial.analysisId, payload.state]);

  useEffect(() => {
    if (payload.state !== "available" || refreshedAvailable.current) return;
    refreshedAvailable.current = true;
    router.refresh();
  }, [payload.state, router]);

  if (!chartAvailable) {
    return <section className="deep-analysis"><div className="table-empty">Detailed analysis is unavailable because this historical scan has no retained chart.</div></section>;
  }
  if (payload.state === "ineligible") {
    return <section className="deep-analysis"><div className="table-empty">Detailed analysis is unavailable for this historical scan.</div></section>;
  }
  if (payload.state === "failed") {
    return <section className="deep-analysis"><div className="warning-banner"><strong>Full analysis failed</strong><span>{payload.error}</span><button className="secondary-button compact" disabled={pending} onClick={() => void request(true)} type="button">Retry full analysis</button></div></section>;
  }
  if (payload.state !== "available" || !payload.full) {
    return <section className="deep-analysis" aria-live="polite"><div className="table-empty">Generating full analysis from the stored, hash-verified chart…</div></section>;
  }
  const full = payload.full;
  return (<>
    <section className="deep-analysis" aria-labelledby="deep-analysis-heading">
      <div className="deep-analysis-heading"><div><p className="eyebrow">Detailed analysis · cached</p><h2 id="deep-analysis-heading">{full.report ? "Four-phase chart audit" : full.setupType ?? "Legacy technical explanation"}</h2></div></div>
      {full.summary ? <p className="decision-summary">{full.summary}</p> : null}
      {full.report ? <div className="four-phase-report" data-testid="four-phase-report">
        <section><h3>01 · Broad structural architecture</h3><ReportBody text={full.report.phase1} /></section>
        <section><h3>02 · Lower technical indicators</h3><ReportBody text={full.report.phase2} /></section>
        <section><h3>03 · Three-candle micro-audit</h3><ReportBody text={full.report.phase3} /></section>
        <section className="phase-four"><h3>04 · Conflict resolution and hierarchy</h3><ReportBody text={full.report.phase4} /></section>
      </div> : <div className="deep-analysis-grid legacy-report" data-testid="legacy-report">
        <article><span>01</span><h3>Immediate read</h3><p>{full.immediateBias}</p></article>
        <article><span>02</span><h3>Visible price action</h3><p>{full.candlestickAnalysis}</p></article>
        <article><span>03</span><h3>VWAP and Keltner structure</h3><p>{full.vwapKeltnerAnalysis}</p><p>{full.broaderTrend}</p></article>
        <article><span>04</span><h3>Indicator context</h3><p>{full.cciAnalysis}</p></article>
        <article><span>05</span><h3>Risks and alternate scenario</h3><ul>{(full.conflictingEvidence ?? []).map((item) => <li key={item}>{item}</li>)}</ul><p>{full.deeperScenario}</p></article>
      </div>}
    </section>
    {capturedAt ? <AnalysisChat analysisId={initial.analysisId} capturedAt={capturedAt} /> : null}
    </>
  );
}
