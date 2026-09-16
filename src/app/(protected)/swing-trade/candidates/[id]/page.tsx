import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

import { getSwingCandidate } from "@/swing/service";

const value = (input: string | null) => input === null ? "—" : `$${Number(input).toFixed(2)}`;

export default async function SwingCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const detail = await getSwingCandidate((await params).id);
  if (!detail) notFound();
  const { candidate, run, artifact, modelRun, attempts } = detail;
  const result = candidate.result;
  return <main className="page-shell narrow swing-detail" data-sentry-mask>
    <Link className="text-button" href="/swing-trade">← Swing Trade</Link>
    <section className="page-heading"><div><p className="eyebrow">Frozen-chart candidate audit</p><h1>{candidate.symbol}: {candidate.direction ?? candidate.status}</h1><p className="muted">{candidate.stockName} · {candidate.exchange} · {run?.mode} run · visually interpreted levels, not broker quotes.</p></div>{artifact ? <span className={`status-pill ${artifact.verified ? "live" : "warning"}`}>{artifact.verified ? "SHA-256 verified" : "Integrity failure"}</span> : null}</section>
    {artifact ? <section className="settings-card"><Image alt={`${candidate.symbol} exact frozen daily chart sent to Gemini`} className="swing-chart" data-sentry-block height={1920} src={`/api/swing/artifacts/${artifact.id}/image`} unoptimized width={1600} /><dl className="audit-grid"><div><dt>Image SHA-256</dt><dd>{artifact.imageHash}</dd></div><div><dt>Input hash</dt><dd>{artifact.inputHash}</dd></div><div><dt>Capture metadata</dt><dd>{artifact.frozenInput.capturedAt} · {artifact.frozenInput.interval} · {artifact.frozenInput.range.from} → {artifact.frozenInput.range.to} · latest candle {artifact.frozenInput.barStatus}</dd></div><div><dt>Dimensions / bytes</dt><dd>{artifact.width}×{artifact.height} · {artifact.byteLength.toLocaleString()} bytes</dd></div></dl></section> : <div className="warning-banner"><span>No verified chart artifact is available.</span></div>}
    {result ? <section className="settings-card swing-blueprint">
      <h2>📌 {candidate.symbol}: {candidate.direction}</h2>
      <hr /><h3>➡️ Macro Context Justification</h3><p>{result.macro_context}</p>
      <hr /><h3>➡️ Structural Setup & Polarity Description</h3>
      <p><strong>Pattern:</strong> {result.pattern_name}</p><p>{result.structural_setup_and_polarity}</p>
      <p><strong>Historical polarity:</strong> {result.polarity_analysis}</p><p><strong>Moving-average geometry:</strong> {result.moving_average_analysis}</p>
      <hr /><h3>➡️ Core Indicators & Volume Ratio</h3><p>{result.core_indicators_and_volume}</p>
      <ul className="swing-evidence-list">
        <li><strong>Volume ratio:</strong> {result.volume_ratio === null ? "Unreadable" : `${result.volume_ratio.toFixed(2)}x`} — {result.volume_analysis}</li>
        <li><strong>MACD (12, 26, 9):</strong> {result.macd_analysis}</li>
        <li><strong>RSI (14):</strong> {result.rsi_analysis}</li>
        <li><strong>CCI (14):</strong> {result.cci_analysis}</li>
        <li><strong>CMF (21):</strong> {result.cmf_analysis}</li>
        <li><strong>3-candle micro-audit:</strong> {result.three_candle_micro_audit}</li>
      </ul>
      <hr /><h3>➡️ Daily-Chart Trigger Rule</h3><p>{result.trigger_rule}</p>
      <hr /><h3>➡️ {candidate.direction === "NO_TRADE" ? "Execution Status" : "Precise Execution Parameters"}</h3>
      {candidate.direction === "NO_TRADE" ? <p>No executable entry, stop, targets, or R:R are published until the daily-chart trigger is satisfied and a future frozen chart produces a new directional result.</p> : <ul>
        <li><strong>Entry Zone:</strong> {value(candidate.entryZoneLow)}–{value(candidate.entryZoneHigh)} — {result.entry_rationale}</li>
        <li><strong>Stop-Loss Protection:</strong> {value(candidate.stopLoss)} daily-close invalidation — {result.stop_rationale}</li>
        <li><strong>Profit Target 1:</strong> {value(candidate.profitTarget1)} — {result.target_1_rationale}</li>
        <li><strong>Profit Target 2:</strong> {value(candidate.profitTarget2)} — {result.target_2_rationale ?? "No second target supported by the visible chart."}</li>
        <li><strong>Server-calculated R:R:</strong> {candidate.riskReward ?? "—"}</li><li><strong>Entry proximity:</strong> {candidate.proximityPercent ?? "—"}%</li>
      </ul>}
      {candidate.rejectionReason ? <div className="warning-banner"><span>{candidate.rejectionReason}</span></div> : null}
      <h3>Risk notes</h3><ul>{result.risk_notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section> : null}
    <section className="settings-card"><p className="eyebrow">Model audit</p><h2>What Gemini received</h2><dl className="audit-grid"><div><dt>Prompt revision / template</dt><dd>{modelRun?.promptRevisionId ?? "—"} · {modelRun?.templateVersion ?? "—"}</dd></div><div><dt>Prompt SHA-256</dt><dd>{modelRun?.promptHash ?? "—"}</dd></div><div><dt>Requested / actual model</dt><dd>{modelRun?.requestedModel ?? "—"} / {modelRun?.actualModel ?? "—"}</dd></div><div><dt>Provider / settings</dt><dd>{modelRun?.actualProvider ?? "—"} · {JSON.stringify(modelRun?.requestSettings ?? {})}</dd></div><div><dt>Usage / cost</dt><dd>{modelRun?.inputTokens ?? "?"} input · {modelRun?.outputTokens ?? "?"} output · {modelRun?.costUsd ? `$${modelRun.costUsd}` : "unknown"} · {modelRun?.queueWaitMs ?? 0} ms queued</dd></div><div><dt>Locked macro context</dt><dd><pre>{JSON.stringify(run?.macroResult ?? null, null, 2)}</pre></dd></div></dl><details><summary>Exact rendered prompt snapshot</summary><pre>{modelRun?.promptSnapshot ?? "Unavailable"}</pre></details><details><summary>Validated JSON</summary><pre>{JSON.stringify(result ?? null, null, 2)}</pre></details><details><summary>Provider attempts ({attempts.length})</summary><pre>{JSON.stringify(attempts.map((attempt) => ({ attempt: attempt.attemptNumber, status: attempt.status, failureKind: attempt.failureKind, queueWaitMs: attempt.queueWaitMs, latencyMs: attempt.latencyMs, inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens, costUsd: attempt.costUsd, responseId: attempt.responseId })), null, 2)}</pre></details></section>
  </main>;
}
