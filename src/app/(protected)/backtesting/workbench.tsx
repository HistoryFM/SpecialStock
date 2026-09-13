"use client";

import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import * as Sentry from "@sentry/nextjs";

import { backtestModels, describePredicate, type BacktestModel, type ModelUsage, type PriceFile, type Strategy } from "@/backtesting/types";
import { defaultReportConfig, describeAllocations, describeCondition, isPlannedRun, type AnyRun, type PlannedRun, type ReportConfig, type StrategyPlan } from "@/backtesting/plan";

type RunSummary = { id: string; createdAt: string; longTicker: string; mode: string; model: string; startDate: string; endDate: string; entryRule: string; exitRule: string; engineVersion: number };
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
function activeIndicatorSettings(strategy: Strategy): string[] {
  const rules = [...strategy.entry, ...strategy.exit];
  return [
    ...(rules.some((rule) => rule.kind === "rsi") ? [`RSI period ${strategy.rsiPeriod} (${strategy.rsiOversold}/${strategy.rsiOverbought})`] : []),
    ...(rules.some((rule) => rule.kind === "macd") ? [`MACD ${strategy.macdFast}/${strategy.macdSlow}/${strategy.macdSignal}`] : []),
  ];
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

async function trackedRequest<T>(action: "import" | "interpret" | "run" | "open" | "analyze" | "report", attributes: Record<string, string | number | boolean>, request: () => Promise<T>): Promise<T> {
  const details = { "specialstock.telemetry.origin": "client", "specialstock.backtesting.action": action, ...attributes };
  return Sentry.startNewTrace(() => Sentry.startSpan({ name: `Backtesting ${action}`, op: `specialstock.backtesting.${action}.request`, forceTransaction: true, attributes: details }, async (span) => {
    const started = performance.now();
    Sentry.logger.info(`backtesting.${action}.client_requested`, details);
    try {
      const result = await request();
      const complete = { ...details, "specialstock.backtesting.duration_ms": Math.round(performance.now() - started) };
      span.setAttributes(complete);
      span.setStatus({ code: 1 });
      Sentry.logger.info(`backtesting.${action}.client_completed`, complete);
      return result;
    } catch (error) {
      const failed = { ...details, "specialstock.backtesting.duration_ms": Math.round(performance.now() - started), "error.type": error instanceof Error ? error.constructor.name : "UnknownError" };
      span.setAttributes(failed);
      span.setStatus({ code: 2 });
      Sentry.logger.warn(`backtesting.${action}.client_failed`, failed);
      throw error;
    }
  }));
}

function GrowthChart({ run, config }: { run: AnyRun; config: ReportConfig }) {
  const [hover, setHover] = useState<number | null>(null);
  const cutoff = config.range === "full" ? "" : new Date(Date.parse(run.result.endDate) - (config.range === "last_year" ? 365 : 730) * 86400000).toISOString().slice(0, 10);
  const start = Math.max(0, run.result.dates.findIndex((date) => date >= cutoff));
  const dates = run.result.dates.slice(start);
  const series = run.result.series.filter((item) => config.visibleSeries.includes(item.ticker)).map((item) => ({ ...item, values: item.values.slice(start) }));
  const width = 1000, height = 320, right = 24, padY = 24;
  let max = 1;
  for (const item of series) for (const value of item.values) max = Math.max(max, value);
  const unit = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 5, 10].map((multiple) => multiple * unit).find((value) => value >= max / 4)!;
  const top = step * 4;
  const left = Math.max(100, money(top).length * 8 + 14);
  const palette = ["#7ee4a2", "#f7bc71", "#79b7ed", "#d8a4f0", "#ff8d8d", "#9cdbd1", "#f2dc83"];
  const color = (index: number) => palette[index] ?? `hsl(${Math.round(index * 137.5) % 360} 70% 72%)`;
  const x = (index: number) => left + index / Math.max(1, dates.length - 1) * (width - left - right);
  const y = (value: number) => height - padY - value / top * (height - padY * 2);
  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(dates.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * width - left) / (width - left - right) * (dates.length - 1)))));
  };
  const at = hover ?? dates.length - 1;
  const ticks = dates.flatMap((date, index) => {
    if (index && date.slice(0, 7) === dates[index - 1].slice(0, 7)) return [];
    if (config.range === "full" ? date.slice(5, 7) !== "01" : config.range === "last_two_years" && Number(date.slice(5, 7)) % 2 === 0) return [];
    return [{ index, label: config.range === "full" ? date.slice(0, 4) : date.slice(0, 7) }];
  });
  return (
    <div className="bt-chart-wrap" data-sentry-block>
      <div className="bt-chart-legend" aria-label="Chart legend">
        <strong>{hover === null ? `Final · ${dates.at(-1)}` : dates[hover]}</strong>
        {series.map((item, index) => <span key={item.ticker} style={{ color: color(index) }}>{item.ticker} <b>{money(item.values[at])}</b></span>)}
      </div>
      <svg className="bt-chart" viewBox={`0 0 ${width} ${height + 26}`} role="img" aria-label="Compounded portfolio values over time with year and month axis labels" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((index) => <g key={index}><line x1={left} x2={width - right} y1={y(index * step)} y2={y(index * step)} stroke="#244638" strokeWidth="1" /><text x={left - 10} y={y(index * step) + 4} textAnchor="end" fill="#a7b9ad" fontSize="13">{money(index * step)}</text></g>)}
        {series.map((item, index) => <path key={item.ticker} d={item.values.map((value, point) => `${point ? "L" : "M"}${x(point).toFixed(2)},${y(value).toFixed(2)}`).join(" ")} fill="none" stroke={color(index)} strokeWidth="2.5" />)}
        {ticks.map((tick) => <g key={tick.label}><line x1={x(tick.index)} x2={x(tick.index)} y1={height - padY} y2={height - padY + 6} stroke="#a7b9ad" /><text x={x(tick.index)} y={height + 18} textAnchor="middle" fill="#a7b9ad" fontSize="12">{tick.label}</text></g>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padY} y2={height - padY} stroke="#d7e7dc" strokeDasharray="4 4" />}
      </svg>
      <div className="bt-chart-axis"><span>{dates[0]}</span><span>{dates.at(-1)}</span></div>
    </div>
  );
}

export function BacktestingWorkbench() {
  const [files, setFiles] = useState<PriceFile[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<AnyRun | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTicker, setUploadTicker] = useState("");
  const [splitConfirmed, setSplitConfirmed] = useState(false);
  const [model, setModel] = useState<BacktestModel>("openai/gpt-5.6-sol");
  const [prompt, setPrompt] = useState("Start with $1,000 and 2.5% annual interest on cash. Enter 100% long TQQQ when TQQQ daily close crosses above its 50-day SMA. Exit to cash when TQQQ daily close crosses below its 50-day SMA. Start on the first shared January trading day after indicator warm-up. Zero fees and slippage.");
  const [plan, setPlan] = useState<StrategyPlan | null>(null);
  const [interpretationUsage, setInterpretationUsage] = useState<ModelUsage | undefined>();
  const [reportPrompt, setReportPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [fileData, runData] = await Promise.all([
      jsonResponse<{ files: PriceFile[] }>(await fetch("/api/backtesting/files")),
      jsonResponse<{ runs: RunSummary[] }>(await fetch("/api/backtesting/runs")),
    ]);
    setFiles(fileData.files); setRuns(runData.runs);
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/backtesting/files").then((response) => jsonResponse<{ files: PriceFile[] }>(response)),
      fetch("/api/backtesting/runs").then((response) => jsonResponse<{ runs: RunSummary[] }>(response)),
    ]).then(([fileData, runData]) => {
      if (active) { setFiles(fileData.files); setRuns(runData.runs); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load Backtesting."); });
    return () => { active = false; };
  }, []);

  async function upload(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setBusy("Uploading CSV");
    try {
      if (!uploadFile) throw new Error("Choose a CSV file.");
      const form = new FormData(); form.set("file", uploadFile); form.set("ticker", uploadTicker.toUpperCase()); form.set("splitAdjusted", String(splitConfirmed));
      await trackedRequest("import", { "specialstock.backtesting.ticker": uploadTicker.toUpperCase(), "specialstock.backtesting.file_bytes": uploadFile.size }, async () => jsonResponse(await fetch("/api/backtesting/files", { method: "POST", body: form })));
      await refresh(); setUploadFile(null); setUploadTicker(""); setSplitConfirmed(false); setPlan(null); setNotice("CSV imported and saved locally.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed."); }
    finally { setBusy(""); }
  }

  async function interpret() {
    setError(""); setNotice(""); setBusy("Interpreting strategy"); setPlan(null);
    try {
      const answer = await trackedRequest("interpret", { "gen_ai.request.model": model, "specialstock.backtesting.prompt_length": prompt.length }, async () => jsonResponse<{ value: { clarification: string; plan: StrategyPlan | null }; usage: ModelUsage }>(await fetch("/api/backtesting/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model }) })));
      if (answer.value.clarification || !answer.value.plan) throw new Error(answer.value.clarification || "Please clarify the strategy.");
      setPlan(answer.value.plan); setInterpretationUsage(answer.usage); setNotice("Review every phase and setting before running.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Interpretation failed."); }
    finally { setBusy(""); }
  }

  async function submitRun(nextPlan: StrategyPlan, parentRunId?: string, nextPrompt = prompt) {
    setError(""); setNotice(""); setBusy(parentRunId ? "Testing suggestion" : "Running backtest");
    try {
      const input = { plan: nextPlan, prompt: nextPrompt, model, parentRunId, interpretationUsage: parentRunId ? undefined : interpretationUsage };
      const result = await trackedRequest("run", { "specialstock.backtesting.engine_version": 2, "specialstock.backtesting.is_suggestion": Boolean(parentRunId) }, async () => jsonResponse<{ run: PlannedRun }>(await fetch("/api/backtesting/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) })));
      setRun(result.run); await refresh(); setNotice(parentRunId ? "Suggestion tested. Compare the two saved runs on the same dates." : "Backtest complete.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Backtest failed."); }
    finally { setBusy(""); }
  }

  async function openRun(id: string) {
    setError(""); setBusy("Loading run");
    try { const result = await trackedRequest("open", { "specialstock.backtesting.run_id": id }, async () => jsonResponse<{ run: AnyRun }>(await fetch(`/api/backtesting/runs/${id}`))); setRun(result.run); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load run."); }
    finally { setBusy(""); }
  }

  async function analyze() {
    if (!run) return;
    setError(""); setBusy("Asking AI to analyze results");
    try { const result = await trackedRequest("analyze", { "specialstock.backtesting.run_id": run.id, "gen_ai.request.model": model }, async () => jsonResponse<{ run: AnyRun }>(await fetch(`/api/backtesting/runs/${run.id}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) }))); setRun(result.run); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Analysis failed."); }
    finally { setBusy(""); }
  }

  async function setReport(config: ReportConfig | string) {
    if (!run || !isPlannedRun(run)) return;
    setError(""); setBusy(typeof config === "string" ? "Customizing report with AI" : "Saving report view");
    try {
      const response = await trackedRequest("report", { "specialstock.backtesting.run_id": run.id, "specialstock.backtesting.ai": typeof config === "string" }, async () => jsonResponse<{ run: PlannedRun }>(await fetch(`/api/backtesting/runs/${run.id}/report`, {
        method: typeof config === "string" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(typeof config === "string" ? { prompt: config, model } : config) })));
      setRun(response.run); setReportPrompt("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Report customization failed."); }
    finally { setBusy(""); }
  }
  const latestTickers = [...new Set(files.map((file) => file.ticker))].sort();
  const config = run ? isPlannedRun(run) ? run.reportConfig : defaultReportConfig(run.result) : null;
  const latestCommentary = run?.commentaries.at(-1);
  return (
    <div className="bt-layout">
      <section className="bt-panel">
        <div className="bt-section-head"><h2>1. Price files</h2><p>Upload every signal and traded asset, plus SPY and QQQ. Daily CSVs stay on this computer.</p></div>
        <form onSubmit={upload} className="bt-upload-form">
          <label>Ticker<input value={uploadTicker} onChange={(event) => setUploadTicker(event.target.value.toUpperCase())} placeholder="TQQQ" required /></label>
          <label>Historical CSV<input type="file" accept=".csv,text/csv" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} required /></label>
          <label className="bt-checkbox"><input type="checkbox" checked={splitConfirmed} onChange={(event) => setSplitConfirmed(event.target.checked)} /> I confirm these historical closes are split-adjusted.</label>
          <button className="secondary-button" disabled={Boolean(busy)} type="submit">Import CSV</button>
        </form>
        {files.length > 0 ? <div className="bt-table-scroll" data-sentry-mask><table className="bt-table"><thead><tr><th>Ticker</th><th>Dates</th><th>Rows</th><th>File</th></tr></thead><tbody>{files.map((file) => <tr key={file.id}><th>{file.ticker}</th><td>{file.firstDate} → {file.lastDate}</td><td>{file.rows.toLocaleString()}</td><td><span>{file.name}</span>{file.warnings.map((warning) => <small key={warning}>{warning}</small>)}</td></tr>)}</tbody></table></div> : <p className="muted">No CSVs imported yet.</p>}
      </section>

      <section className="bt-panel">
        <div className="bt-section-head"><h2>2. Strategy &amp; portfolio</h2><p>Describe assets, rules, allocations, costs, dates, and optional stops in one prompt.</p></div>
        <div className="bt-grid"><label>AI model<select value={model} onChange={(event) => { setModel(event.target.value as BacktestModel); setPlan(null); }}>{backtestModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
        <label>Describe the entire strategy<textarea data-sentry-mask value={prompt} onChange={(event) => { setPrompt(event.target.value); setPlan(null); }} rows={7} maxLength={4000} /></label>
        <p className="muted">Available CSVs: {latestTickers.join(", ") || "import files first"}. AI interprets rules; the confirmed calculation runs locally.</p>
        <div className="bt-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={interpret}>Interpret rules with AI</button></div>
        {plan && <div className="bt-rule-preview" data-sentry-mask><h3>Review exact strategy plan · version 2</h3><p className="muted">Start in 100% cash. The first eligible phase transition runs at a close; stops take priority. Holdings drift between transitions.</p>
          <ol>{plan.transitions.map((transition, index) => <li key={index}><b>{transition.from} → {transition.to}</b> when {describeCondition(transition.when)}. Target: {describeAllocations(plan.states.find((state) => state.id === transition.to)?.allocations ?? [])}.</li>)}</ol>
          {plan.stops.length > 0 && <p><b>Position stops:</b> {plan.stops.map((stop) => `${stop.ticker}: ${stop.fixedPct ?? "—"}% fixed, ${stop.trailingPct ?? "—"}% trailing`).join(" · ")}</p>}
          {plan.assumptions.map((item) => <p className="muted" key={item}>{item}</p>)}
          <h4>Reviewed settings</h4><div className="bt-grid">
            {([ ["startingCapital", "Starting capital ($)"], ["cashRate", "Cash interest (% annual)"], ["borrowRate", "Short borrow (% annual)"], ["slippage", "Slippage (% per leg)"], ["fee", "Fee ($ per leg)"] ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="0.01" value={plan.settings[key]} onChange={(event) => setPlan({ ...plan, settings: { ...plan.settings, [key]: Number(event.target.value) } })} /></label>)}
            <label>Start date<select value={plan.settings.startDate === "first_january" ? "first_january" : "specific"} onChange={(event) => setPlan({ ...plan, settings: { ...plan.settings, startDate: event.target.value === "first_january" ? "first_january" : "2020-01-02" } })}><option value="first_january">First shared January session</option><option value="specific">Specific date</option></select></label>
            {plan.settings.startDate !== "first_january" && <label>Earliest start<input type="date" value={plan.settings.startDate} onChange={(event) => setPlan({ ...plan, settings: { ...plan.settings, startDate: event.target.value } })} /></label>}
          </div><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => submitRun(plan)}>Run confirmed strategy</button></div>}
      </section>

      {(busy || error || notice) && <div className="bt-feedback" role="status">{busy && <p>Working: {busy}…</p>}{error && <p className="form-error">{error}</p>}{notice && <p className="form-success">{notice}</p>}</div>}

      {runs.length > 0 && <section className="bt-panel"><div className="bt-section-head"><h2>Saved runs</h2><p>Each result keeps its rules, CSV versions, and engine version.</p></div><div className="bt-run-list" data-sentry-mask>{runs.map((item) => <button key={item.id} className="secondary-button bt-saved-run" type="button" onClick={() => openRun(item.id)}><strong>{item.longTicker} · {item.mode} · {item.startDate}–{item.endDate} · v{item.engineVersion}</strong><span>{item.engineVersion === 1 ? "Enter" : "Transitions"}: {item.entryRule}</span><span>{item.engineVersion === 1 ? "Exit" : "Targets"}: {item.exitRule}</span><small>{new Date(item.createdAt).toLocaleString()}</small></button>)}</div></section>}

      {run && config && <section className="bt-panel bt-report" aria-label="Backtest report" data-sentry-mask><div className="bt-section-head"><div><h2>Price-return report</h2><p>{run.result.startDate} to {run.result.endDate} · {backtestModels.find((item) => item.id === run.input.model)?.label} · engine v{isPlannedRun(run) ? 2 : 1}</p></div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={analyze}>Analyze with selected AI</button></div>
        <div className="bt-report-rules" data-sentry-mask><strong>Rules used for this run</strong>{isPlannedRun(run) ? <><p>{run.plan.transitions.map((item) => `${item.from} → ${item.to}: ${describeCondition(item.when)}`).join(" · ")}</p><p>{run.plan.states.map((item) => `${item.label}: ${describeAllocations(item.allocations)}`).join(" · ")}</p></> : <><p>Enter: {run.input.strategy.entry.map(describePredicate).join(" AND ")}</p><p>Exit: {run.input.strategy.exit.map(describePredicate).join(" AND ")}</p></>}</div>
        <div className="bt-warning">Same-day closing-price decisions and fills are idealized. Results exclude dividends and taxes. The last year may be partial.</div>
        {isPlannedRun(run) && <details className="bt-report-settings bt-report-block">
          <summary><span className="bt-report-settings-title">Customize report</span><span className="bt-report-settings-description">Charts, tables, prices, and date range</span><span className="bt-report-settings-action" aria-hidden="true">Edit view <span>⌄</span></span></summary>
          <div className="bt-report-settings-body">
            <p>Choose what to show. Changes are saved with this run.</p>
            <div className="bt-report-controls">
              <fieldset><legend>Report sections</legend><div className="bt-report-options">{([ ["annual", "Annual returns"], ["drawdown", "Drawdown"], ["growth", "Growth chart"], ["trades", "Trade history"] ] as const).map(([section, label]) => <label key={section} className="bt-report-option"><input type="checkbox" checked={config.sections.includes(section)} onChange={(event) => { const sections = event.target.checked ? [...config.sections, section] : config.sections.filter((item) => item !== section); if (sections.length) setReport({ ...config, sections }); }} />{label}</label>)}</div></fieldset>
              <fieldset><legend>Growth chart</legend><div className="bt-report-options">{run.result.series.map((item) => <label key={item.ticker} className="bt-report-option"><input type="checkbox" checked={config.visibleSeries.includes(item.ticker)} onChange={(event) => setReport({ ...config, visibleSeries: event.target.checked ? [...config.visibleSeries, item.ticker] : config.visibleSeries.filter((name) => name !== item.ticker) })} />{item.ticker}</label>)}</div></fieldset>
              <fieldset><legend>Trade prices</legend><div className="bt-report-options">{Object.keys(run.result.fileIds).map((ticker) => <label key={ticker} className="bt-report-option"><input type="checkbox" checked={config.closeTickers.includes(ticker)} onChange={(event) => setReport({ ...config, closeTickers: event.target.checked ? [...config.closeTickers, ticker] : config.closeTickers.filter((name) => name !== ticker) })} />{ticker} close</label>)}</div></fieldset>
              <div className="bt-report-range"><label htmlFor="bt-report-date-range">Date range</label><select id="bt-report-date-range" value={config.range} onChange={(event) => setReport({ ...config, range: event.target.value as ReportConfig["range"] })}><option value="full">Full period · year labels</option><option value="last_year">Last year · month labels</option><option value="last_two_years">Last two years · month labels</option></select></div>
            </div>
            <div className="bt-report-ai"><label htmlFor="bt-report-ai-prompt">Customize report with AI</label><div className="bt-report-ai-row"><textarea data-sentry-mask id="bt-report-ai-prompt" value={reportPrompt} onChange={(event) => setReportPrompt(event.target.value)} rows={2} placeholder="e.g. Show Strategy and QQQ for the last year, and add TQQQ close" /><button className="secondary-button" type="button" disabled={Boolean(busy) || !reportPrompt.trim()} onClick={() => setReport(reportPrompt)}>Apply AI report choices</button></div></div>
          </div>
        </details>}
        {run.comparison && <div className="bt-report-block"><h3>Suggested change vs original · same dates</h3><p>{run.comparison.startDate} to {run.comparison.endDate}</p><div className="bt-comparison-summary"><span>Original final <b>{money(run.comparison.baseline.finalBalance)}</b></span><span>Variant final <b>{money(run.comparison.variant.finalBalance)}</b></span><span>Original max drawdown <b>{pct(run.comparison.baseline.drawdowns[0].percent)}</b></span><span>Variant max drawdown <b>{pct(run.comparison.variant.drawdowns[0].percent)}</b></span></div><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Year</th><th>Original strategy</th><th>Suggested variant</th></tr></thead><tbody>{run.comparison.variant.annual.map((row, index) => <tr key={row.year}><th>{row.year}</th><td>{pct(run.comparison!.baseline.annual[index].returns.Strategy)}</td><td>{pct(row.returns.Strategy)}</td></tr>)}</tbody></table></div></div>}
        {config.sections.includes("annual") && <div className="bt-report-block"><h3>Annual returns</h3><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Year</th>{run.result.series.map((item) => <th key={item.ticker}>{item.ticker}</th>)}</tr></thead><tbody>{run.result.annual.map((row) => <tr key={row.year}><th>{row.year}</th>{run.result.series.map((item) => <td key={item.ticker} className={row.returns[item.ticker] < 0 ? "bt-negative" : ""}>{pct(row.returns[item.ticker])}</td>)}</tr>)}</tbody></table></div></div>}
        {config.sections.includes("drawdown") && <div className="bt-report-block"><h3>Maximum drawdown · full period</h3><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Series</th><th>Peak-to-trough</th><th>Peak date</th><th>Trough date</th></tr></thead><tbody>{run.result.drawdowns.map((item) => <tr key={item.ticker}><th>{item.ticker}</th><td className="bt-negative">{pct(item.percent)}</td><td>{item.peakDate}</td><td>{item.troughDate}</td></tr>)}</tbody></table></div></div>}
        {config.sections.includes("growth") && <div className="bt-report-block"><h3>Growth of {money(isPlannedRun(run) ? run.plan.settings.startingCapital : run.input.startingCapital)}</h3><p className="muted">Portfolio value in USD at each close, starting from the same amount on the same date.</p><GrowthChart key={run.id + config.range} run={run} config={config} /></div>}
        <div className="bt-report-block"><h3>Calculation assumptions</h3>{!isPlannedRun(run) && activeIndicatorSettings(run.input.strategy).length > 0 && <p>{activeIndicatorSettings(run.input.strategy).join(" · ")}</p>}<p>{isPlannedRun(run) ? `Cash ${run.plan.settings.cashRate}% · short borrow ${run.plan.settings.borrowRate}% annual · slippage ${run.plan.settings.slippage}% · fee ${money(run.plan.settings.fee)} per leg.` : `Cash ${run.input.cashRate}% annual · slippage ${run.input.slippage}% · fee ${money(run.input.fee)} per leg.`}</p>{run.result.warnings.slice(0, 2).map((warning) => <p className="muted" key={warning}>{warning}</p>)}{(isPlannedRun(run) ? run.input.interpretationUsage : run.interpretationUsage) && <p className="muted">Rule interpretation: {(isPlannedRun(run) ? run.input.interpretationUsage : run.interpretationUsage)?.actualModel}</p>}</div>
        {latestCommentary && <div className="bt-report-block" data-sentry-mask><h3>AI analysis · {backtestModels.find((item) => item.id === latestCommentary.model)?.label}</h3><p className="muted">Actual model: {latestCommentary.usage.actualModel} · {latestCommentary.usage.inputTokens ?? "?"} input tokens · {latestCommentary.usage.outputTokens ?? "?"} output tokens · {latestCommentary.usage.costUsd === null ? "cost unavailable" : money(latestCommentary.usage.costUsd)}</p><p>{latestCommentary.summary}</p>{latestCommentary.riskNotes.length > 0 && <ul>{latestCommentary.riskNotes.map((note) => <li key={note}>{note}</li>)}</ul>}{isPlannedRun(run) && run.commentaries.at(-1)?.suggestions.map((item, index) => <div className="bt-suggestion" key={`${item.title}-${index}`}><h4>{item.title} <small>Untested hypothesis</small></h4><p>{item.reason}</p><p>{item.plan.states.map((state) => `${state.label}: ${describeAllocations(state.allocations)}`).join(" · ")}</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => submitRun(item.plan, run.id, `${run.input.prompt}\nSuggested variation: ${item.title}. ${item.reason}`)}>Test suggestion</button></div>)}</div>}
        {config.sections.includes("trades") && <details className="bt-report-block" open><summary>Simulated trade history · {run.result.trades.length} executed legs</summary><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Date</th><th>Action</th><th>Asset</th><th>Traded close</th>{config.closeTickers.map((ticker) => <th key={ticker}>{ticker} close</th>)}<th>Portfolio after trade</th></tr></thead><tbody>{run.result.trades.map((trade, index) => <tr key={`${trade.date}-${index}`}><td>{trade.date}</td><td>{trade.intent?.replaceAll("_", " ") ?? trade.action}{trade.reason === "stop loss" ? " · stop" : ""}</td><td>{trade.ticker}</td><td>{trade.closePrices?.[trade.ticker]?.toFixed(2) ?? "—"}</td>{config.closeTickers.map((ticker) => <td key={ticker}>{trade.closePrices?.[ticker]?.toFixed(2) ?? "—"}</td>)}<td>{money(trade.equityAfter)}</td></tr>)}</tbody></table></div></details>}
      </section>}
    </div>
  );
}
