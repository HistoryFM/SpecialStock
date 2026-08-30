import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalysisRefreshControl } from "@/app/(protected)/symbols/[symbol]/analysis-refresh-control";
import { DecisionBrief } from "@/app/(protected)/symbols/[symbol]/decision-brief";
import { ReviewForm } from "@/app/(protected)/symbols/[symbol]/review-form";
import { WorkspaceTabs } from "@/app/(protected)/symbols/[symbol]/workspace-tabs";
import { tickerSchema } from "@/settings/schema";
import { getSymbolDetail } from "@/symbols/data";
import {
  alertReasonText,
  analysisFreshness,
  analysisUrl,
} from "@/symbols/presentation";

export const dynamic = "force-dynamic";

function money(value: string | number | null) {
  return value === null ? "—" : `$${Number(value).toFixed(2)}`;
}

function etTime(value: Date | string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function outcomeLabel(slotKind: string, outcome: string | undefined) {
  return slotKind === "manual_smoke" ? "excluded" : outcome ?? "pending";
}

export default async function SymbolPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ analysis?: string }>;
}) {
  const parsed = tickerSchema.safeParse((await params).symbol);
  if (!parsed.success) notFound();
  const symbol = parsed.data;
  const { analysis: selectedAnalysisId } = await searchParams;
  const data = await getSymbolDetail(symbol, selectedAnalysisId);
  if (data.requestedAnalysisMissing) notFound();

  if (!data.latest) {
    const freshness = analysisFreshness({
      now: data.now,
      analysisCompletedAt: null,
      latestScanStatus: data.latestSlot?.status ?? null,
      marketOpen: data.marketOpen,
    });
    return (
      <main className="page-shell detail-shell">
        <header className="symbol-header">
          <Link href="/dashboard">← Watchlist</Link>
          <div className="symbol-identity"><span className="eyebrow">AI analysis</span><h1>{symbol}</h1></div>
        </header>
        <AnalysisRefreshControl
          currentAnalysisId={null}
          initialFreshness={freshness}
          key={`empty:${freshness}`}
          preserveSelection={false}
          symbol={symbol}
        />
        <section className="empty-state"><h2>No completed AI analysis</h2><p>Run an analysis to create the first frozen technical brief for this symbol.</p></section>
      </main>
    );
  }

  const selected = data.latest;
  const snapshotPrice = selected.analysis.observedPrice ? Number(selected.analysis.observedPrice) : null;
  const modelName = selected.run.actualModel ?? selected.run.requestedModel;
  const isHistoricalSelection = Boolean(selectedAnalysisId);
  const hasNewerAnalysis = data.latestAnalysisId !== null && data.latestAnalysisId !== selected.analysis.id;
  const freshness = analysisFreshness({
    now: data.now,
    analysisCompletedAt: selected.slot.completedAt ?? selected.run.completedAt,
    latestScanStatus: data.latestSlot?.status ?? null,
    marketOpen: data.marketOpen,
  });
  const alertCopy = data.alertEvent && selected.thesis
    ? alertReasonText({
        reason: data.alertEvent.reason,
        direction: selected.thesis.direction,
        previousDirection: data.previousThesis?.direction,
      })
    : null;
  const historyPanel = (
    <div className="history-panel">
      <div className="section-heading"><div><p className="eyebrow">Measured history</p><h3>Prior analyses</h3></div><span className="status-pill neutral">{data.history.length} runs</span></div>
      <div className="table-wrap">
        <table className="history-table">
          <thead><tr><th>Time (ET)</th><th>Verdict</th><th>Conviction</th><th>Target</th><th>Outcome</th><th>Model</th><th></th></tr></thead>
          <tbody>{data.history.map((row) => (
            <tr className={row.analysis.id === selected.analysis.id ? "selected" : ""} key={row.analysis.id}>
              <td>{etTime(row.slot.scheduledFor)}</td>
              <td>{row.analysis.verdict.replace("_", " ")}</td>
              <td>{row.analysis.conviction}</td>
              <td>{money(row.analysis.primaryTarget)}</td>
              <td>{outcomeLabel(row.slot.slotKind, row.outcome?.result)}</td>
              <td>{row.run.actualModel ?? row.run.requestedModel}</td>
              <td><Link className="text-button" href={analysisUrl(symbol, row.analysis.id)}>{row.analysis.id === selected.analysis.id ? "Viewing" : "Load"}</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );

  const auditPanel = (
    <div className="audit-panel">
      {selected.artifact ? (
        <div className="audit-grid">
          <div className="audit-image-wrap">
            <Image
              alt={`${symbol} exact Chart-Img model input`}
              className="analysis-chart"
              height={selected.artifact.height}
              loading="eager"
              src={`/api/chart-artifacts/${selected.artifact.id}/image`}
              unoptimized
              width={selected.artifact.width}
            />
          </div>
          <aside className="audit-metadata">
            <p className="eyebrow">Immutable audit artifact</p><h3>Exact image submitted to the model</h3>
            <p>This stored Chart-Img PNG is the exact visual input sent to Gemini. No numeric indicator companion was supplied.</p>
            <dl>
              <div><dt>Input hash</dt><dd><code>{selected.artifact.inputHash}</code></dd></div>
              <div><dt>Image hash</dt><dd><code>{selected.artifact.imageHash}</code></dd></div>
              <div><dt>Renderer</dt><dd>{selected.artifact.rendererVersion}</dd></div>
              <div><dt>Prompt</dt><dd>{selected.run.promptVersion}</dd></div>
              <div><dt>Model</dt><dd>{modelName}</dd></div>
              <div><dt>Latency / cost</dt><dd>{(selected.run.latencyMs ?? 0).toLocaleString()} ms · ${Number(selected.run.costUsd ?? 0).toFixed(6)}</dd></div>
            </dl>
          </aside>
        </div>
      ) : <div className="table-empty">This historical analysis has no chart artifact.</div>}
    </div>
  );

  const reviewPanel = (
    <div className="review-panel">
      <div>
        <p className="eyebrow">Human feedback</p><h3>Review this analysis</h3>
        <p className="muted">Your assessment is stored against this immutable analysis and contributes to model evaluation.</p>
        <dl className="review-metadata">
          <div><dt>Outcome</dt><dd>{outcomeLabel(selected.slot.slotKind, selected.outcome?.result)}</dd></div>
          <div><dt>Analysis ID</dt><dd><code>{selected.analysis.id}</code></dd></div>
        </dl>
      </div>
      <ReviewForm analysisId={selected.analysis.id} />
    </div>
  );

  return (
    <main className="page-shell detail-shell">
      <header className="symbol-header">
        <Link className="back-link" href={data.alertEvent ? "/alerts" : "/dashboard"}>← {data.alertEvent ? "Alerts" : "Watchlist"}</Link>
        <div className="symbol-identity"><span className="eyebrow">AI analysis</span><h1>{symbol}</h1></div>
        <span className="snapshot-header-price"><small>At analysis</small><strong>{money(snapshotPrice)}</strong></span>
        <span className={`status-pill verdict ${selected.analysis.verdict}`}>{selected.analysis.verdict.replace("_", " ")}</span>
        <span>{selected.analysis.conviction} conviction</span>
        <span>{selected.slot.provider === "chart-img" ? "Chart-Img / TradingView" : selected.slot.provider}</span>
        <span className="tabular">{etTime(selected.slot.latestSourceAt)}</span>
        <span>{selected.analysis.barStatus} bar</span>
      </header>

      {alertCopy ? (
        <section className="alert-context" aria-label="Alert context">
          <span className="alert-context-icon" aria-hidden="true">!</span>
          <div><strong>{alertCopy}</strong><p>This frozen AI analysis generated the alert · {etTime(data.alertEvent!.createdAt)} · 15–30 minute horizon</p></div>
        </section>
      ) : null}
      {hasNewerAnalysis && data.latestAnalysisId ? (
        <div className="newer-analysis-banner"><span>You are viewing an earlier immutable analysis.</span><Link href={analysisUrl(symbol, data.latestAnalysisId)}>View newer analysis →</Link></div>
      ) : null}
      <AnalysisRefreshControl
        currentAnalysisId={selected.analysis.id}
        initialFreshness={freshness}
        key={selected.analysis.id}
        preserveSelection={isHistoricalSelection}
        symbol={symbol}
      />

      <section className="ai-first-workspace">
        <DecisionBrief analysis={selected.analysis} snapshotPrice={snapshotPrice} />

        <aside className="supporting-chart" aria-label="Supporting chart">
          <div className="supporting-chart-heading"><div><p className="eyebrow">Chart-Img / TradingView · 5-minute</p><h2>Frozen chart snapshot</h2></div><span>Exact model input</span></div>
          {selected.artifact ? (
            <Image
              alt={`${symbol} frozen five-minute chart with VWAP, Keltner Channels, Volume, ADX, RSI, MACD, CCI, and CMF`}
              className="analysis-chart"
              height={selected.artifact.height}
              priority
              src={`/api/chart-artifacts/${selected.artifact.id}/image`}
              unoptimized
              width={selected.artifact.width}
            />
          ) : <div className="chart-missing">Stored chart unavailable for this historical analysis.</div>}
        </aside>
      </section>

      <section className="deep-analysis" aria-labelledby="deep-analysis-heading">
        <div className="deep-analysis-heading"><p className="eyebrow">Full AI reasoning</p><h2 id="deep-analysis-heading">How the model reached this conclusion</h2></div>
        <div className="deep-analysis-grid">
          <article><span>01</span><h3>Visible price action</h3><p>{selected.analysis.candlestickAnalysis}</p></article>
          <article><span>02</span><h3>VWAP and Keltner structure</h3><p>{selected.analysis.vwapKeltnerAnalysis}</p><p>{selected.analysis.broaderTrend}</p></article>
          <article><span>03</span><h3>Momentum and trend strength</h3><p>{selected.analysis.indicatorReadings ? ["adx", "rsi", "macd", "cci"].map((key) => selected.analysis.indicatorReadings![key as "adx" | "rsi" | "macd" | "cci"].observation).join(" ") : selected.analysis.cciAnalysis ?? "Expanded indicator analysis was not recorded for this legacy result."}</p></article>
          <article><span>04</span><h3>Participation and money flow</h3><p>{selected.analysis.indicatorReadings ? `${selected.analysis.indicatorReadings.volume.observation} ${selected.analysis.indicatorReadings.cmf.observation}` : "Volume and CMF analysis was not recorded for this legacy result."}</p></article>
          <article><span>05</span><h3>Risks and alternate scenario</h3><ul>{selected.analysis.conflictingEvidence.map((item) => <li key={item}>{item}</li>)}</ul><p>{selected.analysis.deeperScenario}</p></article>
        </div>
      </section>

      <WorkspaceTabs audit={auditPanel} history={historyPanel} review={reviewPanel} />
    </main>
  );
}
