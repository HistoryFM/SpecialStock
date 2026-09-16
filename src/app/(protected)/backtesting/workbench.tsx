"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import * as Sentry from "@sentry/nextjs";

import { backtestModels, describePredicate, type BacktestModel, type BacktestTimeframe, type ConversationTurn, type ModelUsage, type PriceFile, type Strategy } from "@/backtesting/types";
import { defaultReportConfig, describeAllocations, describeCondition, isPlannedRun, type AnyRun, type PlannedRun, type ReportConfig, type StrategyPlan } from "@/backtesting/plan";

type RunSummary = { id: string; name: string; createdAt: string; longTicker: string; mode: string; model: string; timeframe: BacktestTimeframe; startDate: string; endDate: string; entryRule: string; exitRule: string; engineVersion: number; finalValue: number; maxDrawdown: number };
type SavedRunAction = { id: string; kind: "rename" | "delete" };
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

async function trackedRequest<T>(action: "import" | "interpret" | "run" | "open" | "analyze" | "report" | "chat" | "delete" | "rename", attributes: Record<string, string | number | boolean>, request: () => Promise<T>): Promise<T> {
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

function GrowthChart({ run, config, onRange }: { run: AnyRun; config: ReportConfig; onRange: (startDate: string, endDate: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const dragRef = useRef<{ start: number; end: number } | null>(null);
  const days = config.range === "last_month" ? 31 : config.range === "last_quarter" ? 93 : config.range === "last_year" ? 365 : config.range === "last_two_years" ? 730 : 0;
  const cutoff = config.range === "custom" ? config.startDate ?? run.result.startDate : days ? new Date(Date.parse(run.result.endDate) - days * 86400000).toISOString().slice(0, 10) : run.result.startDate;
  const finish = config.range === "custom" ? config.endDate ?? run.result.endDate : run.result.endDate;
  const start = Math.max(0, run.result.dates.findIndex((date) => date >= cutoff));
  const end = Math.max(start, run.result.dates.findLastIndex((date) => date <= finish));
  const dates = run.result.dates.slice(start, end + 1);
  const series = run.result.series.filter((item) => config.visibleSeries.includes(item.ticker)).map((item) => ({ ...item, values: item.values.slice(start, end + 1) }));
  const closeSeries = (run.result.closeSeries ?? []).map((item) => ({ ...item, values: item.values.slice(start, end + 1) }));
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
  const point = (event: ReactMouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(dates.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * width - left) / (width - left - right) * (dates.length - 1))));
  };
  const onMove = (event: ReactMouseEvent<SVGSVGElement>) => { const index = point(event); setHover(index); if (dragRef.current) { dragRef.current = { ...dragRef.current, end: index }; setDrag(dragRef.current); } };
  const at = hover ?? dates.length - 1;
  const ticks = dates.flatMap((date, index) => {
    if (index && date.slice(0, 7) === dates[index - 1].slice(0, 7)) return [];
    if (dates.length > 500 ? date.slice(5, 7) !== "01" : dates.length > 150 && Number(date.slice(5, 7)) % 2 === 0) return [];
    return [{ index, label: dates.length > 500 ? date.slice(0, 4) : date.slice(0, 7) }];
  });
  if (!dates.length) return <p className="muted">No values fall inside this chart range.</p>;
  return (
    <div className="bt-chart-wrap" data-sentry-block>
      <div className="bt-chart-legend" aria-label="Chart legend">
        <strong>{hover === null ? `Final · ${dates.at(-1)}` : dates[hover]}</strong>
        {series.map((item, index) => <span key={item.ticker} style={{ color: color(index) }}>{item.ticker} <b>{money(item.values[at])}</b></span>)}
        {closeSeries.map((item) => <span key={`close-${item.ticker}`}>{item.ticker} close <b>{money(item.values[at])}</b></span>)}
      </div>
      {hover !== null && <div className="bt-chart-hover" style={{ left: `${Math.max(8, Math.min(78, x(hover) / width * 100))}%` }}><strong>{dates[hover]}</strong>{series.map((item, index) => <span key={item.ticker} style={{ color: color(index) }}>{item.ticker} <b>{money(item.values[hover])}</b></span>)}{closeSeries.map((item) => <span key={`hover-${item.ticker}`}>{item.ticker} close <b>{money(item.values[hover])}</b></span>)}</div>}
      <svg className="bt-chart" viewBox={`0 0 ${width} ${height + 26}`} role="img" aria-label="Compounded portfolio values over time; drag to zoom" onMouseMove={onMove} onMouseLeave={() => { if (!dragRef.current) setHover(null); }} onMouseDown={(event) => { const index = point(event); dragRef.current = { start: index, end: index }; setDrag(dragRef.current); }} onMouseUp={() => { const selected = dragRef.current; if (!selected) return; const first = Math.min(selected.start, selected.end), last = Math.max(selected.start, selected.end); if (last > first) onRange(dates[first], dates[last]); dragRef.current = null; setDrag(null); }}>
        {[0, 1, 2, 3, 4].map((index) => <g key={index}><line x1={left} x2={width - right} y1={y(index * step)} y2={y(index * step)} stroke="#244638" strokeWidth="1" /><text x={left - 10} y={y(index * step) + 4} textAnchor="end" fill="#a7b9ad" fontSize="13">{money(index * step)}</text></g>)}
        {series.map((item, index) => <path key={item.ticker} d={item.values.map((value, point) => `${point ? "L" : "M"}${x(point).toFixed(2)},${y(value).toFixed(2)}`).join(" ")} fill="none" stroke={color(index)} strokeWidth="2.5" />)}
        {ticks.map((tick) => <g key={tick.label}><line x1={x(tick.index)} x2={x(tick.index)} y1={height - padY} y2={height - padY + 6} stroke="#a7b9ad" /><text x={x(tick.index)} y={height + 18} textAnchor="middle" fill="#a7b9ad" fontSize="12">{tick.label}</text></g>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padY} y2={height - padY} stroke="#d7e7dc" strokeDasharray="4 4" />}
        {drag && <rect x={x(Math.min(drag.start, drag.end))} y={padY} width={Math.max(1, x(Math.max(drag.start, drag.end)) - x(Math.min(drag.start, drag.end)))} height={height - padY * 2} fill="#7ee4a2" opacity=".12" />}
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
  const [uploadTimeframe, setUploadTimeframe] = useState<BacktestTimeframe>("daily");
  const [splitConfirmed, setSplitConfirmed] = useState(false);
  const [model, setModel] = useState<BacktestModel>("openai/gpt-5.6-sol");
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>("daily");
  const [prompt, setPrompt] = useState("Start with $1,000 and 2.5% annual interest on cash. Enter 100% long TQQQ when TQQQ daily close crosses above its 50-day SMA. Exit to cash when TQQQ daily close crosses below its 50-day SMA. Start on the first shared January trading day after indicator warm-up. Zero fees and slippage.");
  const [plan, setPlan] = useState<StrategyPlan | null>(null);
  const [interpretationUsage, setInterpretationUsage] = useState<ModelUsage | undefined>();
  const [setupConversation, setSetupConversation] = useState<ConversationTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [resultChatInput, setResultChatInput] = useState("");
  const [reportPrompt, setReportPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedRunAction, setSavedRunAction] = useState<SavedRunAction | null>(null);
  const [savedRunName, setSavedRunName] = useState("");
  const reportRef = useRef<HTMLElement>(null);
  const strategyRef = useRef<HTMLElement>(null);

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
      const form = new FormData(); form.set("file", uploadFile); form.set("ticker", uploadTicker.toUpperCase()); form.set("timeframe", uploadTimeframe); form.set("splitAdjusted", String(splitConfirmed));
      await trackedRequest("import", { "specialstock.backtesting.ticker": uploadTicker.toUpperCase(), "specialstock.backtesting.file_bytes": uploadFile.size }, async () => jsonResponse(await fetch("/api/backtesting/files", { method: "POST", body: form })));
      await refresh(); setUploadFile(null); setUploadTicker(""); setSplitConfirmed(false); setPlan(null); setNotice("CSV imported and saved locally.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed."); }
    finally { setBusy(""); }
  }

  async function requestStrategy(nextTurns: ConversationTurn[]) {
    setError(""); setNotice(""); setBusy("Continuing strategy conversation"); setPlan(null);
    try {
      const answer = await trackedRequest("interpret", { "gen_ai.request.model": model, "specialstock.backtesting.prompt_length": nextTurns.reduce((sum, turn) => sum + turn.content.length, 0) }, async () => jsonResponse<{ plan: StrategyPlan | null; turn: ConversationTurn }>(await fetch("/api/backtesting/strategy-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, timeframe, turns: nextTurns }) })));
      setSetupConversation([...nextTurns, answer.turn]); setPlan(answer.plan); setInterpretationUsage(answer.turn.usage);
      setNotice(answer.plan ? "The strategy plan is ready for review." : "Answer the AI's question to continue.");
    } catch (cause) { setSetupConversation(nextTurns); setError(cause instanceof Error ? `${cause.message} You can retry without losing the conversation.` : "Interpretation failed."); }
    finally { setBusy(""); }
  }

  async function sendStrategy(message: string) {
    const content = message.trim(); if (!content) return;
    const user: ConversationTurn = { id: crypto.randomUUID(), role: "user", content, at: new Date().toISOString() };
    setChatInput(""); await requestStrategy([...setupConversation, user]);
  }

  async function submitRun(nextPlan: StrategyPlan, parentRunId?: string, nextPrompt = prompt) {
    setError(""); setNotice(""); setBusy(parentRunId ? "Testing suggestion" : "Running backtest");
    try {
      const runTimeframe = parentRunId && run && isPlannedRun(run) ? run.plan.settings.timeframe ?? "daily" : timeframe;
      const input = { plan: { ...nextPlan, version: 3 as const, settings: { ...nextPlan.settings, timeframe: runTimeframe } }, prompt: nextPrompt, model, parentRunId, interpretationUsage: parentRunId ? undefined : interpretationUsage, setupConversation: parentRunId ? undefined : setupConversation };
      const result = await trackedRequest("run", { "specialstock.backtesting.engine_version": 3, "specialstock.backtesting.is_suggestion": Boolean(parentRunId) }, async () => jsonResponse<{ run: PlannedRun }>(await fetch("/api/backtesting/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) })));
      setRun(result.run); await refresh(); setNotice(parentRunId ? "Suggestion tested. Compare the two saved runs on the same dates." : "Backtest complete.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Backtest failed."); }
    finally { setBusy(""); }
  }

  async function openRun(id: string) {
    setError(""); setBusy("Loading run");
    try { const result = await trackedRequest("open", { "specialstock.backtesting.run_id": id }, async () => jsonResponse<{ run: AnyRun }>(await fetch(`/api/backtesting/runs/${id}`))); setRun(result.run); setNotice("Saved results loaded."); requestAnimationFrame(() => { reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); reportRef.current?.focus({ preventScroll: true }); }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load run."); }
    finally { setBusy(""); }
  }

  async function reuseRun(id: string) {
    setError(""); setBusy("Loading saved strategy");
    try {
      const { run: saved } = await jsonResponse<{ run: AnyRun }>(await fetch(`/api/backtesting/runs/${id}`));
      if (!isPlannedRun(saved)) throw new Error("Legacy version 1 strategies cannot be loaded into the current editor.");
      const nextTimeframe = saved.plan.settings.timeframe ?? "daily";
      setPrompt(saved.input.prompt); setModel(saved.input.model); setTimeframe(nextTimeframe);
      setPlan({ ...saved.plan, version: 3, settings: { ...saved.plan.settings, timeframe: nextTimeframe } });
      setSetupConversation(saved.setupConversation ?? saved.input.setupConversation ?? []); setNotice("Saved strategy loaded as a new draft. The original run is unchanged.");
      requestAnimationFrame(() => strategyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reuse strategy."); }
    finally { setBusy(""); }
  }

  async function renameSaved(item: RunSummary) {
    const name = savedRunName.trim(); if (!name || name === item.name) { setSavedRunAction(null); return; }
    setError(""); setNotice(""); setBusy("Renaming saved run");
    try { await trackedRequest("rename", { "specialstock.backtesting.run_id": item.id }, async () => jsonResponse(await fetch(`/api/backtesting/runs/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }))); await refresh(); if (run?.id === item.id) setRun({ ...run, name }); setSavedRunAction(null); setNotice("Saved run renamed."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not rename run."); }
    finally { setBusy(""); }
  }

  async function removeSaved(item: RunSummary) {
    setError(""); setNotice(""); setBusy("Deleting saved run");
    try { await trackedRequest("delete", { "specialstock.backtesting.run_id": item.id }, async () => { const response = await fetch(`/api/backtesting/runs/${item.id}`, { method: "DELETE" }); if (!response.ok) await jsonResponse(response); }); if (run?.id === item.id) setRun(null); await refresh(); setSavedRunAction(null); setNotice("Saved run deleted. Imported CSV files were kept."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete run."); }
    finally { setBusy(""); }
  }

  async function sendResultChat() {
    if (!run || !isPlannedRun(run) || !resultChatInput.trim()) return;
    const message = resultChatInput.trim(); setResultChatInput(""); setError(""); setBusy("Asking about this run");
    try { const result = await trackedRequest("chat", { "specialstock.backtesting.run_id": run.id, "gen_ai.request.model": model }, async () => jsonResponse<{ run: PlannedRun }>(await fetch(`/api/backtesting/runs/${run.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, requestId: crypto.randomUUID(), message }) }))); setRun(result.run); }
    catch (cause) { setResultChatInput(message); setError(cause instanceof Error ? cause.message : "The AI could not answer."); }
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
  const latestTickers = [...new Set(files.filter((file) => file.timeframe === timeframe).map((file) => file.ticker))].sort();
  const config = run ? isPlannedRun(run) ? run.reportConfig : defaultReportConfig(run.result) : null;
  const latestCommentary = run?.commentaries.at(-1);
  return (
    <div className="bt-layout">
      <section className="bt-panel">
        <div className="bt-section-head"><h2>1. Price files</h2><p>Upload every signal and traded asset, plus SPY and QQQ. Daily and weekly CSVs stay on this computer.</p></div>
        <form onSubmit={upload} className="bt-upload-form">
          <label>Ticker<input value={uploadTicker} onChange={(event) => setUploadTicker(event.target.value.toUpperCase())} placeholder="TQQQ" required /></label>
          <label>Data timeframe<select value={uploadTimeframe} onChange={(event) => setUploadTimeframe(event.target.value as BacktestTimeframe)}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
          <label>Historical CSV<input type="file" accept=".csv,text/csv" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} required /></label>
          <label className="bt-checkbox"><input type="checkbox" checked={splitConfirmed} onChange={(event) => setSplitConfirmed(event.target.checked)} /> I confirm these historical closes are split-adjusted.</label>
          <button className="secondary-button" disabled={Boolean(busy)} type="submit">Import CSV</button>
        </form>
        {files.length > 0 ? <div className="bt-table-scroll" data-sentry-mask><table className="bt-table"><thead><tr><th>Ticker</th><th>Timeframe</th><th>Dates</th><th>Rows</th><th>File</th></tr></thead><tbody>{files.map((file) => <tr key={file.id}><th>{file.ticker}</th><td>{file.timeframe}</td><td>{file.firstDate} → {file.lastDate}</td><td>{file.rows.toLocaleString()}</td><td><span>{file.name}</span>{file.warnings.map((warning) => <small key={warning}>{warning}</small>)}</td></tr>)}</tbody></table></div> : <p className="muted">No CSVs imported yet.</p>}
      </section>

      <section className="bt-panel" ref={strategyRef}>
        <div className="bt-section-head"><h2>2. Strategy &amp; portfolio</h2><p>Describe assets, rules, allocations, costs, dates, and optional stops in one prompt.</p></div>
        <div className="bt-grid"><label>AI model<select value={model} onChange={(event) => { setModel(event.target.value as BacktestModel); setPlan(null); }}>{backtestModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Strategy timeframe<select value={timeframe} onChange={(event) => { const next = event.target.value as BacktestTimeframe; setTimeframe(next); setPlan(null); setSetupConversation([]); setPrompt((value) => next === "weekly" ? value.replaceAll("daily", "weekly").replaceAll("day SMA", "week SMA").replaceAll("trading day", "weekly bar") : value.replaceAll("weekly", "daily").replaceAll("week SMA", "day SMA").replaceAll("weekly bar", "trading day")); }}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label></div>
        <label>Describe the entire strategy<textarea data-sentry-mask value={prompt} onChange={(event) => { setPrompt(event.target.value); setPlan(null); }} rows={7} maxLength={4000} /></label>
        <p className="muted">Available CSVs: {latestTickers.join(", ") || "import files first"}. AI interprets rules; the confirmed calculation runs locally.</p>
        <div className="bt-actions"><button className="secondary-button" type="button" disabled={Boolean(busy) || Boolean(setupConversation.length)} onClick={() => sendStrategy(prompt)}>Start strategy conversation</button><button className="secondary-button" type="button" disabled={Boolean(busy) || !setupConversation.length} onClick={() => { setSetupConversation([]); setPlan(null); setNotice("Strategy conversation cleared."); }}>Start over</button></div>
        {setupConversation.length > 0 && <div className="bt-chat" data-sentry-mask>{setupConversation.map((turn) => <div key={turn.id} className={`bt-chat-turn bt-chat-${turn.role}`}><strong>{turn.role === "user" ? "You" : "AI"}</strong><p>{turn.content}</p></div>)}<div className="bt-chat-compose"><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} rows={2} maxLength={2000} placeholder="Answer the question or ask where the AI is stuck" /><button type="button" className="secondary-button" disabled={Boolean(busy) || !chatInput.trim()} onClick={() => sendStrategy(chatInput)}>Send</button>{error && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => requestStrategy(setupConversation)}>Retry last request</button>}</div></div>}
        {plan && <div className="bt-rule-preview" data-sentry-mask><h3>Review exact strategy plan · version 3 · {timeframe}</h3><p className="muted">Start in 100% cash. The first eligible phase transition runs at a close; stops take priority. Holdings drift between transitions.</p>
          <ol>{plan.transitions.map((transition, index) => <li key={index}><b>{transition.from} → {transition.to}</b> when {describeCondition(transition.when, timeframe)}. Target: {describeAllocations(plan.states.find((state) => state.id === transition.to)?.allocations ?? [])}.</li>)}</ol>
          {plan.stops.length > 0 && <p><b>Position stops:</b> {plan.stops.map((stop) => `${stop.ticker}: ${stop.fixedPct ?? "—"}% fixed, ${stop.trailingPct ?? "—"}% trailing`).join(" · ")}</p>}
          {plan.assumptions.map((item) => <p className="muted" key={item}>{item}</p>)}
          <h4>Reviewed settings</h4><div className="bt-grid">
            {([ ["startingCapital", "Starting capital ($)"], ["cashRate", "Cash interest (% annual)"], ["borrowRate", "Short borrow (% annual)"], ["slippage", "Slippage (% per leg)"], ["fee", "Fee ($ per leg)"] ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="0.01" value={plan.settings[key]} onChange={(event) => setPlan({ ...plan, settings: { ...plan.settings, [key]: Number(event.target.value) } })} /></label>)}
            <label>Start date<select value={plan.settings.startDate === "first_january" ? "first_january" : "specific"} onChange={(event) => setPlan({ ...plan, settings: { ...plan.settings, startDate: event.target.value === "first_january" ? "first_january" : "2020-01-02" } })}><option value="first_january">First shared January session</option><option value="specific">Specific date</option></select></label>
            {plan.settings.startDate !== "first_january" && <label>Earliest start<input type="date" value={plan.settings.startDate} onChange={(event) => setPlan({ ...plan, settings: { ...plan.settings, startDate: event.target.value } })} /></label>}
          </div><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => submitRun(plan)}>Run confirmed strategy</button></div>}
      </section>

      {(busy || error || notice) && <div className="bt-feedback" role="status">{busy && <p>Working: {busy}…</p>}{error && <p className="form-error">{error}</p>}{notice && <p className="form-success">{notice}</p>}</div>}

      {runs.length > 0 && <section className="bt-panel"><div className="bt-section-head"><h2>Saved runs</h2><p>Open results, reuse a strategy, rename it, or remove an old run.</p></div><div className="bt-run-list" data-sentry-mask>{runs.map((item) => <article key={item.id} className={`bt-saved-run ${run?.id === item.id ? "bt-saved-run-selected" : ""}`}><button className="bt-saved-run-open" type="button" onClick={() => openRun(item.id)}><strong>{item.name}</strong><span>{item.longTicker} · {item.timeframe} · {item.startDate}–{item.endDate} · v{item.engineVersion}</span><span>Final strategy value: <b>{money(item.finalValue)}</b> · Max drawdown: <b className="bt-negative">{pct(item.maxDrawdown)}</b></span><small>{new Date(item.createdAt).toLocaleString()}</small></button><div className="bt-saved-run-actions"><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => reuseRun(item.id)}>Reuse strategy</button><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setSavedRunAction({ id: item.id, kind: "rename" }); setSavedRunName(item.name); setError(""); }}>Rename</button><button type="button" className="secondary-button danger-button" disabled={Boolean(busy)} onClick={() => { setSavedRunAction({ id: item.id, kind: "delete" }); setError(""); }}>Delete</button></div>
        {savedRunAction?.id === item.id && savedRunAction.kind === "rename" && <form className="bt-saved-run-dialog" role="dialog" aria-label="Rename saved run" onSubmit={(event) => { event.preventDefault(); void renameSaved(item); }}><label>Saved run name<input autoFocus value={savedRunName} onChange={(event) => setSavedRunName(event.target.value)} maxLength={80} required /></label><div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => setSavedRunAction(null)}>Cancel</button><button className="primary-button" type="submit" disabled={Boolean(busy) || !savedRunName.trim()}>Save name</button></div></form>}
        {savedRunAction?.id === item.id && savedRunAction.kind === "delete" && <div className="bt-saved-run-dialog" role="alertdialog" aria-label="Delete saved run"><strong>Delete “{item.name}”?</strong><p>Its stored results and conversations will be removed. Imported CSV files will be kept.</p><div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => setSavedRunAction(null)}>Cancel</button><button className="secondary-button danger-button" type="button" disabled={Boolean(busy)} onClick={() => void removeSaved(item)}>Delete saved run</button></div></div>}
      </article>)}</div></section>}

      {run && config && <section ref={reportRef} className="bt-panel bt-report" aria-label="Backtest report" data-sentry-mask tabIndex={-1}><div className="bt-section-head"><div><h2>{run.name ?? "Price-return report"}</h2><p>{run.result.startDate} to {run.result.endDate} · {isPlannedRun(run) ? run.plan.settings.timeframe ?? "daily" : run.input.timeframe ?? "daily"} · {backtestModels.find((item) => item.id === run.input.model)?.label} · engine v{isPlannedRun(run) ? run.engineVersion : 1}</p></div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={analyze}>Analyze with selected AI</button></div>
        <div className="bt-report-rules" data-sentry-mask><strong>Rules used for this run</strong>{isPlannedRun(run) ? <><p>{run.plan.transitions.map((item) => `${item.from} → ${item.to}: ${describeCondition(item.when, run.plan.settings.timeframe ?? "daily")}`).join(" · ")}</p><p>{run.plan.states.map((item) => `${item.label}: ${describeAllocations(item.allocations)}`).join(" · ")}</p></> : <><p>Enter: {run.input.strategy.entry.map(describePredicate).join(" AND ")}</p><p>Exit: {run.input.strategy.exit.map(describePredicate).join(" AND ")}</p></>}</div>
        <div className="bt-warning">Same-bar closing-price decisions and fills are idealized. Results exclude dividends and taxes. The last year may be partial.</div>
        {isPlannedRun(run) && <details className="bt-report-settings bt-report-block">
          <summary><span className="bt-report-settings-title">Customize report</span><span className="bt-report-settings-description">Charts, tables, prices, and date range</span><span className="bt-report-settings-action" aria-hidden="true">Edit view <span>⌄</span></span></summary>
          <div className="bt-report-settings-body">
            <p>Choose what to show. Changes are saved with this run.</p>
            <div className="bt-report-controls">
              <fieldset><legend>Report sections</legend><div className="bt-report-options">{([ ["annual", "Annual returns"], ["drawdown", "Drawdown"], ["growth", "Growth chart"], ["trades", "Trade history"] ] as const).map(([section, label]) => <label key={section} className="bt-report-option"><input type="checkbox" checked={config.sections.includes(section)} onChange={(event) => { const sections = event.target.checked ? [...config.sections, section] : config.sections.filter((item) => item !== section); if (sections.length) setReport({ ...config, sections }); }} />{label}</label>)}</div></fieldset>
              <fieldset><legend>Growth chart</legend><div className="bt-report-options">{run.result.series.map((item) => <label key={item.ticker} className="bt-report-option"><input type="checkbox" checked={config.visibleSeries.includes(item.ticker)} onChange={(event) => setReport({ ...config, visibleSeries: event.target.checked ? [...config.visibleSeries, item.ticker] : config.visibleSeries.filter((name) => name !== item.ticker) })} />{item.ticker}</label>)}</div></fieldset>
              <fieldset><legend>Trade prices</legend><p className="muted">Every run asset is shown: {Object.keys(run.result.fileIds).join(", ")}.</p></fieldset>
              <div className="bt-report-range"><label htmlFor="bt-report-date-range">Date range</label><select id="bt-report-date-range" value={config.range} onChange={(event) => { const range = event.target.value as ReportConfig["range"]; setReport({ ...config, range, startDate: range === "custom" ? run.result.startDate : undefined, endDate: range === "custom" ? run.result.endDate : undefined }); }}><option value="full">Full period</option><option value="last_month">Last month</option><option value="last_quarter">Last quarter</option><option value="last_year">Last year</option><option value="last_two_years">Last two years</option><option value="custom">Custom dates</option></select>{config.range === "custom" && <div className="bt-date-range"><input aria-label="Chart start date" type="date" min={run.result.startDate} max={config.endDate ?? run.result.endDate} value={config.startDate ?? run.result.startDate} onChange={(event) => setReport({ ...config, startDate: event.target.value, endDate: config.endDate ?? run.result.endDate })} /><input aria-label="Chart end date" type="date" min={config.startDate ?? run.result.startDate} max={run.result.endDate} value={config.endDate ?? run.result.endDate} onChange={(event) => setReport({ ...config, startDate: config.startDate ?? run.result.startDate, endDate: event.target.value })} /></div>}<button type="button" className="secondary-button" onClick={() => setReport({ ...config, range: "full", startDate: undefined, endDate: undefined })}>Reset zoom</button></div>
            </div>
            <div className="bt-report-ai"><label htmlFor="bt-report-ai-prompt">Customize report with AI</label><div className="bt-report-ai-row"><textarea data-sentry-mask id="bt-report-ai-prompt" value={reportPrompt} onChange={(event) => setReportPrompt(event.target.value)} rows={2} placeholder="e.g. Show Strategy and QQQ for the last year, and add TQQQ close" /><button className="secondary-button" type="button" disabled={Boolean(busy) || !reportPrompt.trim()} onClick={() => setReport(reportPrompt)}>Apply AI report choices</button></div></div>
          </div>
        </details>}
        {run.comparison && <div className="bt-report-block"><h3>Suggested change vs original · same dates</h3><p>{run.comparison.startDate} to {run.comparison.endDate}</p><div className="bt-comparison-summary"><span>Original final <b>{money(run.comparison.baseline.finalBalance)}</b></span><span>Variant final <b>{money(run.comparison.variant.finalBalance)}</b></span><span>Original max drawdown <b>{pct(run.comparison.baseline.drawdowns[0].percent)}</b></span><span>Variant max drawdown <b>{pct(run.comparison.variant.drawdowns[0].percent)}</b></span></div><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Year</th><th>Original strategy</th><th>Suggested variant</th></tr></thead><tbody>{run.comparison.variant.annual.map((row, index) => <tr key={row.year}><th>{row.year}</th><td>{pct(run.comparison!.baseline.annual[index].returns.Strategy)}</td><td>{pct(row.returns.Strategy)}</td></tr>)}</tbody></table></div></div>}
        {config.sections.includes("annual") && <div className="bt-report-block"><h3>Annual returns</h3><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Year</th>{run.result.series.map((item) => <th key={item.ticker}>{item.ticker}</th>)}</tr></thead><tbody>{run.result.annual.map((row) => <tr key={row.year}><th>{row.year}</th>{run.result.series.map((item) => <td key={item.ticker} className={row.returns[item.ticker] < 0 ? "bt-negative" : ""}>{pct(row.returns[item.ticker])}</td>)}</tr>)}</tbody></table></div></div>}
        {config.sections.includes("drawdown") && <div className="bt-report-block"><h3>Maximum drawdown · full period</h3><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Series</th><th>Peak-to-trough</th><th>Peak date</th><th>Trough date</th></tr></thead><tbody>{run.result.drawdowns.map((item) => <tr key={item.ticker}><th>{item.ticker}</th><td className="bt-negative">{pct(item.percent)}</td><td>{item.peakDate}</td><td>{item.troughDate}</td></tr>)}</tbody></table></div></div>}
        {config.sections.includes("growth") && <div className="bt-report-block"><h3>Growth of {money(isPlannedRun(run) ? run.plan.settings.startingCapital : run.input.startingCapital)}</h3><p className="muted">Portfolio lines are normalized for comparison. Hover for the strategy balance and every asset&apos;s actual close; drag across the chart to zoom.</p><GrowthChart key={run.id + config.range + config.startDate + config.endDate} run={run} config={config} onRange={(startDate, endDate) => setReport({ ...config, range: "custom", startDate, endDate })} /></div>}
        <div className="bt-report-block"><h3>Calculation assumptions</h3>{!isPlannedRun(run) && activeIndicatorSettings(run.input.strategy).length > 0 && <p>{activeIndicatorSettings(run.input.strategy).join(" · ")}</p>}<p>{isPlannedRun(run) ? `Cash ${run.plan.settings.cashRate}% · short borrow ${run.plan.settings.borrowRate}% annual · slippage ${run.plan.settings.slippage}% · fee ${money(run.plan.settings.fee)} per leg.` : `Cash ${run.input.cashRate}% annual · slippage ${run.input.slippage}% · fee ${money(run.input.fee)} per leg.`}</p>{run.result.warnings.slice(0, 2).map((warning) => <p className="muted" key={warning}>{warning}</p>)}{(isPlannedRun(run) ? run.input.interpretationUsage : run.interpretationUsage) && <p className="muted">Rule interpretation: {(isPlannedRun(run) ? run.input.interpretationUsage : run.interpretationUsage)?.actualModel}</p>}</div>
        {latestCommentary && <div className="bt-report-block" data-sentry-mask><h3>AI analysis · {backtestModels.find((item) => item.id === latestCommentary.model)?.label}</h3><p className="muted">Actual model: {latestCommentary.usage.actualModel} · {latestCommentary.usage.inputTokens ?? "?"} input tokens · {latestCommentary.usage.outputTokens ?? "?"} output tokens · {latestCommentary.usage.costUsd === null ? "cost unavailable" : money(latestCommentary.usage.costUsd)}</p><p>{latestCommentary.summary}</p>{latestCommentary.riskNotes.length > 0 && <ul>{latestCommentary.riskNotes.map((note) => <li key={note}>{note}</li>)}</ul>}{isPlannedRun(run) && run.commentaries.at(-1)?.suggestions.map((item, index) => <div className="bt-suggestion" key={`${item.title}-${index}`}><h4>{item.title} <small>Untested hypothesis</small></h4><p>{item.reason}</p><p>{item.plan.states.map((state) => `${state.label}: ${describeAllocations(state.allocations)}`).join(" · ")}</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => submitRun(item.plan, run.id, `${run.input.prompt}\nSuggested variation: ${item.title}. ${item.reason}`)}>Test suggestion</button></div>)}</div>}
        {isPlannedRun(run) && <div className="bt-report-block bt-chat" data-sentry-mask><h3>Ask about this run</h3><p className="muted">The AI can discuss stored metrics and rules but cannot change this result.</p>{(run.resultConversation ?? []).map((turn) => <div key={turn.id} className={`bt-chat-turn bt-chat-${turn.role}`}><strong>{turn.role === "user" ? "You" : "AI"}</strong><p>{turn.content}</p></div>)}<div className="bt-chat-compose"><textarea value={resultChatInput} onChange={(event) => setResultChatInput(event.target.value)} rows={2} maxLength={2000} placeholder="Ask about drawdown, returns, rules, or where the analysis is uncertain" /><button type="button" className="secondary-button" disabled={Boolean(busy) || !resultChatInput.trim()} onClick={sendResultChat}>Send</button></div></div>}
        {config.sections.includes("trades") && <details className="bt-report-block" open><summary>Simulated trade history · {run.result.trades.length} executed legs</summary><div className="bt-table-scroll bt-trade-scroll"><table className="bt-table"><thead><tr><th>Date</th><th>Action</th><th>Asset</th><th>Traded close</th>{Object.keys(run.result.fileIds).map((ticker) => <th key={ticker}>{ticker} close</th>)}<th>Portfolio after trade</th></tr></thead><tbody>{run.result.trades.map((trade, index) => <tr key={`${trade.date}-${index}`}><td>{trade.date}</td><td>{trade.intent?.replaceAll("_", " ") ?? trade.action}{trade.reason === "stop loss" ? " · stop" : ""}</td><td>{trade.ticker}</td><td>{trade.closePrices?.[trade.ticker]?.toFixed(2) ?? "—"}</td>{Object.keys(run.result.fileIds).map((ticker) => <td key={ticker}>{trade.closePrices?.[ticker]?.toFixed(2) ?? "—"}</td>)}<td>{money(trade.equityAfter)}</td></tr>)}</tbody></table></div></details>}
      </section>}
    </div>
  );
}
