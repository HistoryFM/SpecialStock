"use client";

import * as Sentry from "@sentry/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";

type FullPayload = {
  analysisId: string;
  state: "ineligible" | "not_requested" | "running" | "available" | "failed";
  error: string | null;
  full: null | {
    setupType: string | null; immediateBias: string | null; broaderTrend: string | null;
    candlestickAnalysis: string | null; vwapKeltnerAnalysis: string | null; cciAnalysis: string | null;
    supportingEvidence: string[] | null; conflictingEvidence: string[] | null;
    deeperScenario: string | null; summary: string | null;
  };
};

export function FullAnalysisPanel({ initial }: { initial: FullPayload }) {
  const [payload, setPayload] = useState(initial);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

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
    if (payload.state === "not_requested" && !started.current) {
      started.current = true;
      void request();
    }
  }, [payload.state, request]);

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

  if (payload.state === "ineligible") {
    return <section className="deep-analysis"><div className="table-empty">This compact signal is not eligible for full analysis. The chart and audit record remain available.</div></section>;
  }
  if (payload.state === "failed") {
    return <section className="deep-analysis"><div className="warning-banner"><strong>Full analysis failed</strong><span>{payload.error}</span><button className="secondary-button compact" disabled={pending} onClick={() => void request(true)} type="button">Retry full analysis</button></div></section>;
  }
  if (payload.state !== "available" || !payload.full) {
    return <section className="deep-analysis" aria-live="polite"><div className="table-empty">Generating full analysis from the stored, hash-verified chart…</div></section>;
  }
  const full = payload.full;
  return (
    <section className="deep-analysis" aria-labelledby="deep-analysis-heading">
      <div className="deep-analysis-heading"><div><p className="eyebrow">Full AI reasoning · cached</p><h2 id="deep-analysis-heading">{full.setupType ?? "Technical explanation"}</h2></div></div>
      {full.summary ? <p className="decision-summary">{full.summary}</p> : null}
      <div className="deep-analysis-grid">
        <article><span>01</span><h3>Immediate read</h3><p>{full.immediateBias}</p></article>
        <article><span>02</span><h3>Visible price action</h3><p>{full.candlestickAnalysis}</p></article>
        <article><span>03</span><h3>VWAP and Keltner structure</h3><p>{full.vwapKeltnerAnalysis}</p><p>{full.broaderTrend}</p></article>
        <article><span>04</span><h3>Indicator context</h3><p>{full.cciAnalysis}</p></article>
        <article><span>05</span><h3>Risks and alternate scenario</h3><ul>{(full.conflictingEvidence ?? []).map((item) => <li key={item}>{item}</li>)}</ul><p>{full.deeperScenario}</p></article>
      </div>
    </section>
  );
}
