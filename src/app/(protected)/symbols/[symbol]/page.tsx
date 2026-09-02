import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalysisRefreshControl } from "@/app/(protected)/symbols/[symbol]/analysis-refresh-control";
import { FullAnalysisPanel } from "@/app/(protected)/symbols/[symbol]/full-analysis-panel";
import { ReviewForm } from "@/app/(protected)/symbols/[symbol]/review-form";
import { WorkspaceTabs } from "@/app/(protected)/symbols/[symbol]/workspace-tabs";
import { tickerSchema } from "@/settings/schema";
import { getSymbolDetail } from "@/symbols/data";
import { marketDate, normalizeMarketDate } from "@/market-data/time";
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

function dailyOutcomeLabel(input: {
  slotKind: string;
  hasThesis: boolean;
  outcome: string | undefined;
}) {
  if (input.slotKind === "manual_smoke") return "Review only";
  if (!input.hasThesis) return "Not tracked";
  return input.outcome?.replaceAll("_", " ") ?? "Pending";
}

function reviewLabel(assessment: string | undefined) {
  return assessment ? assessment[0]!.toUpperCase() + assessment.slice(1) : "Not reviewed";
}

export default async function SymbolPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ analysis?: string; date?: string; tab?: string }>;
}) {
  const parsed = tickerSchema.safeParse((await params).symbol);
  if (!parsed.success) notFound();
  const symbol = parsed.data;
  const query = await searchParams;
  const selectedAnalysisId = query.analysis;
  const selectedMarketDate = normalizeMarketDate(query.date);
  const selectedTab = query.tab === "audit" || query.tab === "review" ? query.tab : "history";
  const data = await getSymbolDetail(symbol, {
    analysisId: selectedAnalysisId,
    marketDate: selectedMarketDate,
  });
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
      <section className="daily-conviction-section" aria-labelledby="daily-conviction-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Daily review workspace</p>
            <h3 id="daily-conviction-heading">High-conviction theses</h3>
          </div>
          <span className="status-pill neutral">{data.dailyHighConviction.length} calls</span>
        </div>
        <form className="history-date-filter" method="get">
          <label htmlFor="history-date">Market date (ET)</label>
          <input
            defaultValue={data.selectedMarketDate}
            id="history-date"
            max={marketDate(data.now)}
            name="date"
            type="date"
          />
          <button className="secondary-button compact" type="submit">View day</button>
        </form>
        {data.dailyHighConviction.length === 0 ? (
          <div className="table-empty">No high-conviction bullish or bearish analyses were recorded for this date.</div>
        ) : (
          <div className="table-wrap">
            <table className="daily-conviction-table">
              <thead><tr><th>Time (ET)</th><th>Thesis</th><th>At analysis</th><th>Target</th><th>Invalidation</th><th>Source</th><th>Outcome</th><th>Review</th><th></th></tr></thead>
              <tbody>{data.dailyHighConviction.map((row) => (
                <tr key={row.analysis.id}>
                  <td>{etTime(row.slot.scheduledFor)}</td>
                  <td><strong>{row.analysis.verdict}</strong><small>{row.analysis.setupType}</small></td>
                  <td>{money(row.analysis.observedPrice)}</td>
                  <td>{money(row.analysis.primaryTarget)}</td>
                  <td>{money(row.analysis.invalidationLevel)}</td>
                  <td>{row.slot.slotKind === "manual_smoke" ? "Manual" : "Automatic"}</td>
                  <td>{dailyOutcomeLabel({
                    slotKind: row.slot.slotKind,
                    hasThesis: Boolean(row.thesis),
                    outcome: row.outcome?.result,
                  })}</td>
                  <td>{reviewLabel(row.latestReview?.assessment)}</td>
                  <td><Link
                    className="text-button"
                    href={analysisUrl(symbol, row.analysis.id, {
                      date: data.selectedMarketDate,
                      tab: "review",
                    })}
                  >Review thesis</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <div className="section-heading"><div><p className="eyebrow">Measured history</p><h3>Prior analyses</h3></div><span className="status-pill neutral">{data.history.length} runs</span></div>
      <div className="table-wrap">
        <table className="history-table">
          <thead><tr><th>Time (ET)</th><th>Verdict</th><th>Conviction</th><th>Target</th><th>Outcome</th><th>Review</th><th>Model</th><th></th></tr></thead>
          <tbody>{data.history.map((row) => (
            <tr className={row.analysis.id === selected.analysis.id ? "selected" : ""} key={row.analysis.id}>
              <td>{etTime(row.slot.scheduledFor)}</td>
              <td>{row.analysis.verdict.replace("_", " ")}</td>
              <td>{row.analysis.conviction}</td>
              <td>{money(row.analysis.primaryTarget)}</td>
              <td>{outcomeLabel(row.slot.slotKind, row.outcome?.result)}</td>
              <td>{reviewLabel(row.latestReview?.assessment)}</td>
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
      <div className="review-history">
        <p className="eyebrow">Prior reviews</p>
        {selected.reviews.length === 0 ? (
          <p className="muted">No human review has been recorded for this analysis.</p>
        ) : (
          <ul>{selected.reviews.map((review) => (
            <li key={review.id}>
              <strong>{reviewLabel(review.assessment)}</strong>
              <span>{etTime(review.createdAt)}</span>
              {review.notes ? <p>{review.notes}</p> : null}
              {review.unsupportedClaims.length > 0 ? <small>Unsupported claim flagged</small> : null}
            </li>
          ))}</ul>
        )}
      </div>
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
        <article className="decision-brief" data-testid="compact-signal">
          <div className="decision-heading"><div><p className="eyebrow">Compact signal · next 15–30 minutes</p><h2>{selected.analysis.verdict.replace("_", " ")}</h2></div><span className={`conviction-badge ${selected.analysis.conviction}`}>{selected.analysis.conviction} conviction</span></div>
          <dl className="decision-levels">
            <div><dt>Observed price</dt><dd>{money(snapshotPrice)}</dd></div>
            <div><dt>Primary target</dt><dd className="positive">{money(selected.analysis.primaryTarget)}</dd></div>
            <div><dt>Invalidation</dt><dd className="negative">{money(selected.analysis.invalidationLevel)}</dd></div>
          </dl>
          <footer className="broader-context"><strong>Visual quality</strong><span>{selected.analysis.visualQuality}</span></footer>
        </article>

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

      <FullAnalysisPanel initial={{
        analysisId: selected.analysis.id,
        state: selected.analysis.fullAnalysisState,
        error: selected.analysis.fullError,
        full: selected.analysis.fullAnalysisState === "available" ? {
          setupType: selected.analysis.setupType,
          immediateBias: selected.analysis.immediateBias,
          broaderTrend: selected.analysis.broaderTrend,
          candlestickAnalysis: selected.analysis.candlestickAnalysis,
          vwapKeltnerAnalysis: selected.analysis.vwapKeltnerAnalysis,
          cciAnalysis: selected.analysis.cciAnalysis,
          supportingEvidence: selected.analysis.supportingEvidence,
          conflictingEvidence: selected.analysis.conflictingEvidence,
          deeperScenario: selected.analysis.deeperScenario,
          summary: selected.analysis.summary,
        } : null,
      }} />

      <WorkspaceTabs
        audit={auditPanel}
        history={historyPanel}
        initialTab={selectedTab}
        key={`${selected.analysis.id}:${selectedTab}`}
        review={reviewPanel}
      />
    </main>
  );
}
