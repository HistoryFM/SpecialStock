"use client";

import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";

import { backtestModels, describePredicate, type BacktestModel, type ModelUsage, type PriceFile, type SavedRun, type Strategy, type Suggestion } from "@/backtesting/types";

type RunSummary = { id: string; createdAt: string; longTicker: string; mode: string; model: string; startDate: string; endDate: string; entryRule: string; exitRule: string };
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

function GrowthChart({ run }: { run: SavedRun }) {
  const [hover, setHover] = useState<number | null>(null);
  const { dates, series } = run.result;
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
  return (
    <div className="bt-chart-wrap">
      <div className="bt-chart-legend" aria-label="Chart legend">
        <strong>{hover === null ? `Final · ${dates.at(-1)}` : dates[hover]}</strong>
        {series.map((item, index) => <span key={item.ticker} style={{ color: color(index) }}>{item.ticker} <b>{money(item.values[at])}</b></span>)}
      </div>
      <svg className="bt-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Compounded portfolio values over time" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((index) => <g key={index}><line x1={left} x2={width - right} y1={y(index * step)} y2={y(index * step)} stroke="#244638" strokeWidth="1" /><text x={left - 10} y={y(index * step) + 4} textAnchor="end" fill="#a7b9ad" fontSize="13">{money(index * step)}</text></g>)}
        {series.map((item, index) => <path key={item.ticker} d={item.values.map((value, point) => `${point ? "L" : "M"}${x(point).toFixed(2)},${y(value).toFixed(2)}`).join(" ")} fill="none" stroke={color(index)} strokeWidth="2.5" />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padY} y2={height - padY} stroke="#d7e7dc" strokeDasharray="4 4" />}
      </svg>
      <div className="bt-chart-axis"><span>{dates[0]}</span><span>{dates.at(-1)}</span></div>
    </div>
  );
}

export function BacktestingWorkbench() {
  const [files, setFiles] = useState<PriceFile[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<SavedRun | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTicker, setUploadTicker] = useState("");
  const [splitConfirmed, setSplitConfirmed] = useState(false);
  const [longTicker, setLongTicker] = useState("TQQQ");
  const [inverseTicker, setInverseTicker] = useState("SQQQ");
  const [mode, setMode] = useState<"cash" | "inverse">("cash");
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [capital, setCapital] = useState("1000");
  const [cashRate, setCashRate] = useState("0");
  const [slippage, setSlippage] = useState("0");
  const [fee, setFee] = useState("0");
  const [model, setModel] = useState<BacktestModel>("openai/gpt-5.6-sol");
  const [prompt, setPrompt] = useState("Enter TQQQ when price crosses above the 50-day SMA. Exit when price crosses below the 50-day SMA.");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [interpretationUsage, setInterpretationUsage] = useState<ModelUsage | undefined>();
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
      await jsonResponse(await fetch("/api/backtesting/files", { method: "POST", body: form }));
      await refresh(); setUploadFile(null); setUploadTicker(""); setSplitConfirmed(false); setNotice("CSV imported and saved locally.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed."); }
    finally { setBusy(""); }
  }

  async function interpret() {
    setError(""); setNotice(""); setBusy("Interpreting strategy"); setStrategy(null);
    try {
      const answer = await jsonResponse<{ value: { clarification: string; strategy: Strategy | null }; usage: ModelUsage }>(await fetch("/api/backtesting/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model }) }));
      if (answer.value.clarification || !answer.value.strategy) throw new Error(answer.value.clarification || "Please make entry and exit rules explicit.");
      setStrategy(answer.value.strategy); setInterpretationUsage(answer.usage); setNotice("Review the exact rules below before running.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Interpretation failed."); }
    finally { setBusy(""); }
  }

  async function submitRun(nextStrategy: Strategy, parentRunId?: string, nextPrompt = prompt) {
    setError(""); setNotice(""); setBusy(parentRunId ? "Testing suggestion" : "Running backtest");
    try {
      const input = { longTicker: longTicker.toUpperCase(), inverseTicker: mode === "inverse" ? inverseTicker.toUpperCase() : undefined,
        comparisons, mode, startingCapital: Number(capital), cashRate: Number(cashRate), slippage: Number(slippage), fee: Number(fee),
        prompt: nextPrompt, model, strategy: nextStrategy, parentRunId };
      const result = await jsonResponse<{ run: SavedRun }>(await fetch("/api/backtesting/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, interpretationUsage }) }));
      setRun(result.run); await refresh(); setNotice(parentRunId ? "Suggestion tested. Compare the two saved runs on the same dates." : "Backtest complete.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Backtest failed."); }
    finally { setBusy(""); }
  }

  async function openRun(id: string) {
    setError(""); setBusy("Loading run");
    try { const result = await jsonResponse<{ run: SavedRun }>(await fetch(`/api/backtesting/runs/${id}`)); setRun(result.run); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load run."); }
    finally { setBusy(""); }
  }

  async function analyze() {
    if (!run) return;
    setError(""); setBusy("Asking AI to analyze results");
    try { const result = await jsonResponse<{ run: SavedRun }>(await fetch(`/api/backtesting/runs/${run.id}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) })); setRun(result.run); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Analysis failed."); }
    finally { setBusy(""); }
  }

  async function testSuggestion(suggestion: Suggestion) {
    if (!run) return;
    setError(""); setNotice(""); setBusy("Testing suggested rules");
    try {
      const input = { ...run.input, prompt: `${run.input.prompt}\nSuggested variation: ${suggestion.title}. ${suggestion.reason}`,
        model, strategy: suggestion.strategy, parentRunId: run.id };
      const response = await jsonResponse<{ run: SavedRun }>(await fetch("/api/backtesting/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) }));
      setRun(response.run); await refresh(); setNotice("Suggested variant tested against the original on the same dates.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Suggestion test failed."); }
    finally { setBusy(""); }
  }

  const latestTickers = [...new Set(files.map((file) => file.ticker))].sort();
  const optionalTickers = latestTickers.filter((ticker) => !["SPY", "QQQ", longTicker.toUpperCase(), inverseTicker.toUpperCase()].includes(ticker));
  const latestCommentary = run?.commentaries.at(-1);
  return (
    <div className="bt-layout">
      <section className="bt-panel">
        <div className="bt-section-head"><h2>1. Price files</h2><p>Daily CSVs stay on this computer. SPY and QQQ are always compared.</p></div>
        <form onSubmit={upload} className="bt-upload-form">
          <label>Ticker<input value={uploadTicker} onChange={(event) => setUploadTicker(event.target.value.toUpperCase())} placeholder="TQQQ" required /></label>
          <label>Historical CSV<input type="file" accept=".csv,text/csv" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} required /></label>
          <label className="bt-checkbox"><input type="checkbox" checked={splitConfirmed} onChange={(event) => setSplitConfirmed(event.target.checked)} /> I confirm these historical closes are split-adjusted.</label>
          <button className="secondary-button" disabled={Boolean(busy)} type="submit">Import CSV</button>
        </form>
        {files.length > 0 ? <div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Ticker</th><th>Dates</th><th>Rows</th><th>File</th></tr></thead><tbody>{files.map((file) => <tr key={file.id}><th>{file.ticker}</th><td>{file.firstDate} → {file.lastDate}</td><td>{file.rows.toLocaleString()}</td><td><span>{file.name}</span>{file.warnings.map((warning) => <small key={warning}>{warning}</small>)}</td></tr>)}</tbody></table></div> : <p className="muted">No CSVs imported yet.</p>}
      </section>

      <section className="bt-panel">
        <div className="bt-section-head"><h2>2. Portfolio setup</h2><p>One long asset, with cash or an inverse ETF after a valid exit.</p></div>
        <div className="bt-grid">
          <label>Long ticker<select value={longTicker} onChange={(event) => setLongTicker(event.target.value)}>{[...new Set([longTicker, ...latestTickers])].map((ticker) => <option key={ticker}>{ticker}</option>)}</select></label>
          <label>Position mode<select value={mode} onChange={(event) => setMode(event.target.value as "cash" | "inverse")}><option value="cash">Long / interest-earning cash</option><option value="inverse">Long / inverse ETF</option></select></label>
          {mode === "inverse" && <label>Inverse ticker<select value={inverseTicker} onChange={(event) => setInverseTicker(event.target.value)}>{[...new Set([inverseTicker, ...latestTickers])].map((ticker) => <option key={ticker}>{ticker}</option>)}</select></label>}
          <label>Starting capital ($)<input type="number" min="1" step="0.01" value={capital} onChange={(event) => setCapital(event.target.value)} /></label>
          <label>Cash interest (% annual)<input type="number" min="0" max="100" step="0.01" value={cashRate} onChange={(event) => setCashRate(event.target.value)} /></label>
          <label>Slippage (% per trade)<input type="number" min="0" max="20" step="0.01" value={slippage} onChange={(event) => setSlippage(event.target.value)} /></label>
          <label>Fixed fee ($ per trade)<input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} /></label>
        </div>
        {optionalTickers.length > 0 && <fieldset className="bt-comparisons"><legend>Other comparison assets</legend>{optionalTickers.map((ticker) => <label key={ticker} className="bt-checkbox"><input type="checkbox" checked={comparisons.includes(ticker)} onChange={(event) => setComparisons(event.target.checked ? [...comparisons, ticker] : comparisons.filter((item) => item !== ticker))} /> {ticker}</label>)}</fieldset>}
      </section>

      <section className="bt-panel">
        <div className="bt-section-head"><h2>3. Strategy</h2><p>The selected AI reads the prompt. Only confirmed rules drive the calculation.</p></div>
        <div className="bt-grid"><label>AI model<select value={model} onChange={(event) => { setModel(event.target.value as BacktestModel); setStrategy(null); }}>{backtestModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
        <label>Describe both entry and exit<textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setStrategy(null); }} rows={4} maxLength={4000} /></label>
        <div className="bt-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={interpret}>Interpret rules with AI</button></div>
        {strategy && <div className="bt-rule-preview"><h3>Review exact rules</h3><p><b>Enter long only when:</b> {strategy.entry.map(describePredicate).join(" AND ")}</p><p><b>Exit long only when:</b> {strategy.exit.map(describePredicate).join(" AND ")}</p>{activeIndicatorSettings(strategy).length > 0 && <p>{activeIndicatorSettings(strategy).join(" · ")}</p>}<p className="muted">All AND filters must pass on the same close. A missed crossover does not fire later. Start in cash.</p><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => submitRun(strategy)}>Run confirmed strategy</button></div>}
      </section>

      {(busy || error || notice) && <div className="bt-feedback" role="status">{busy && <p>Working: {busy}…</p>}{error && <p className="form-error">{error}</p>}{notice && <p className="form-success">{notice}</p>}</div>}

      {runs.length > 0 && <section className="bt-panel"><div className="bt-section-head"><h2>Saved runs</h2><p>Each result keeps its rules and uploaded CSV versions.</p></div><div className="bt-run-list">{runs.map((item) => <button key={item.id} className="secondary-button bt-saved-run" type="button" onClick={() => openRun(item.id)}><strong>{item.longTicker} · {item.mode} · {item.startDate}–{item.endDate}</strong><span>Enter: {item.entryRule}</span><span>Exit: {item.exitRule}</span><small>{new Date(item.createdAt).toLocaleString()}</small></button>)}</div></section>}

      {run && <section className="bt-panel bt-report" aria-label="Backtest report"><div className="bt-section-head"><div><h2>Price-return report</h2><p>{run.input.longTicker} · {run.result.startDate} to {run.result.endDate} · {backtestModels.find((item) => item.id === run.input.model)?.label}</p></div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={analyze}>Analyze with selected AI</button></div>
        <div className="bt-report-rules"><strong>Rules used for this run</strong><p>Enter: {run.input.strategy.entry.map(describePredicate).join(" AND ")}</p><p>Exit: {run.input.strategy.exit.map(describePredicate).join(" AND ")}</p></div>
        <div className="bt-warning">Same-day closing-price decisions and fills are idealized. Results exclude dividends and taxes. The last year may be partial.</div>
        {run.comparison && <div className="bt-report-block"><h3>Suggested change vs original · same dates</h3><p>{run.comparison.startDate} to {run.comparison.endDate}</p><div className="bt-comparison-summary"><span>Original final <b>{money(run.comparison.baseline.finalBalance)}</b></span><span>Variant final <b>{money(run.comparison.variant.finalBalance)}</b></span><span>Original max drawdown <b>{pct(run.comparison.baseline.drawdowns[0].percent)}</b></span><span>Variant max drawdown <b>{pct(run.comparison.variant.drawdowns[0].percent)}</b></span></div><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Year</th><th>Original strategy</th><th>Suggested variant</th></tr></thead><tbody>{run.comparison.variant.annual.map((row, index) => <tr key={row.year}><th>{row.year}</th><td>{pct(run.comparison!.baseline.annual[index].returns.Strategy)}</td><td>{pct(row.returns.Strategy)}</td></tr>)}</tbody></table></div></div>}
        <div className="bt-report-block"><h3>Annual returns</h3><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Year</th>{run.result.series.map((item) => <th key={item.ticker}>{item.ticker}</th>)}</tr></thead><tbody>{run.result.annual.map((row) => <tr key={row.year}><th>{row.year}</th>{run.result.series.map((item) => <td key={item.ticker} className={row.returns[item.ticker] < 0 ? "bt-negative" : ""}>{pct(row.returns[item.ticker])}</td>)}</tr>)}</tbody></table></div></div>
        <div className="bt-report-block"><h3>Maximum drawdown · full period</h3><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Series</th><th>Peak-to-trough</th><th>Peak date</th><th>Trough date</th></tr></thead><tbody>{run.result.drawdowns.map((item) => <tr key={item.ticker}><th>{item.ticker}</th><td className="bt-negative">{pct(item.percent)}</td><td>{item.peakDate}</td><td>{item.troughDate}</td></tr>)}</tbody></table></div></div>
        <div className="bt-report-block"><h3>Growth of {money(run.input.startingCapital)}</h3><p className="muted">Portfolio value in USD at each close, starting from the same amount on the same date.</p><GrowthChart run={run} /></div>
        <div className="bt-report-block"><h3>Calculation assumptions</h3>{activeIndicatorSettings(run.input.strategy).length > 0 && <p>{activeIndicatorSettings(run.input.strategy).join(" · ")}</p>}<p>Cash {run.input.cashRate}% annual · slippage {run.input.slippage}% per trade · fixed fee {money(run.input.fee)} per leg.</p>{run.result.warnings.slice(0, 2).map((warning) => <p className="muted" key={warning}>{warning}</p>)}{run.interpretationUsage && <p className="muted">Rule interpretation: {run.interpretationUsage.actualModel} · {run.interpretationUsage.inputTokens ?? "?"} input tokens · {run.interpretationUsage.outputTokens ?? "?"} output tokens · {run.interpretationUsage.costUsd === null ? "cost unavailable" : money(run.interpretationUsage.costUsd)}</p>}</div>
        {latestCommentary && <div className="bt-report-block"><h3>AI analysis · {backtestModels.find((item) => item.id === latestCommentary.model)?.label}</h3><p className="muted">Actual model: {latestCommentary.usage.actualModel} · {latestCommentary.usage.inputTokens ?? "?"} input tokens · {latestCommentary.usage.outputTokens ?? "?"} output tokens · {latestCommentary.usage.costUsd === null ? "cost unavailable" : money(latestCommentary.usage.costUsd)}</p><p>{latestCommentary.summary}</p>{latestCommentary.riskNotes.length > 0 && <ul>{latestCommentary.riskNotes.map((note) => <li key={note}>{note}</li>)}</ul>}{latestCommentary.suggestions.map((item, index) => <div className="bt-suggestion" key={`${item.title}-${index}`}><h4>{item.title} <small>Untested hypothesis</small></h4><p>{item.reason}</p><p><b>Enter:</b> {item.strategy.entry.map(describePredicate).join(" AND ")}</p><p><b>Exit:</b> {item.strategy.exit.map(describePredicate).join(" AND ")}</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => testSuggestion(item)}>Test suggestion</button></div>)}</div>}
        <details className="bt-report-block"><summary>Simulated trade history · {run.result.trades.length} executed legs</summary><div className="bt-table-scroll"><table className="bt-table"><thead><tr><th>Date</th><th>Action</th><th>Asset</th><th>Portfolio after trade</th></tr></thead><tbody>{run.result.trades.map((trade, index) => <tr key={`${trade.date}-${index}`}><td>{trade.date}</td><td>{trade.action}</td><td>{trade.ticker}</td><td>{money(trade.equityAfter)}</td></tr>)}</tbody></table></div></details>
      </section>}
    </div>
  );
}
