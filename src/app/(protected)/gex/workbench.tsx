"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type { GexDemoRow } from "@/gex/demo";
import type { GexDatasetSummary } from "@/gex/repository";

type GexState = {
  symbols: string[]; revision: number; sourceFilename: string | null; updatedAt: string;
  sampleSymbols: string[]; rows: GexDemoRow[]; unavailableSymbols: string[];
  activeListId: string | null; lists: Array<{ id: string; name: string; kind: "master" | "sublist"; parentListId: string | null; symbols: string[]; entryCount: number; active: boolean; createdAt: string }>;
};
type LiveRow = {
  symbol: string; category: "daily" | "weekly" | "monthly" | "manual"; expiration: string; requestedExpiration?: string; underlyingPrice: number;
  gexFlip: number; callWall: number; putWall: number; activityCallWall: number; activityPutWall: number; netGex: number; calculatedAt: string;
  chart: { chartSymbol: string; imageHash: string; values: { readable: boolean; lastPrice: number | null; vwap: number | null; keltnerUpper: number | null; keltnerMiddle: number | null; keltnerLower: number | null } | null } | null;
  expectedMove: number | null; levels: { callEntry: number; callTarget: number; callStop: number; putEntry: number; putTarget: number; putStop: number } | null;
};
type GexUsage = { modelRuns: number; inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; totalTokens: number | null; costUsd: number | null; costComplete: boolean };

const price = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const spend = (value: number | null, complete: boolean) => value === null ? "Cost unavailable" : `$${value.toFixed(4)}${complete ? "" : "+"}`;
const runTime = (value: string) => `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value))} ET`;

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  return <div className="swing-modal-backdrop" role="presentation"><section aria-describedby="gex-modal-description" aria-labelledby="gex-modal-title" aria-modal="true" className="swing-modal wide" role="dialog"><header><div><h2 id="gex-modal-title">{title}</h2><p className="muted" id="gex-modal-description">{description}</p></div><button aria-label="Close dialog" className="swing-icon-button" onClick={onClose} type="button">×</button></header>{children}</section></div>;
}

export function GexWorkbench({ initial, initialLiveCategories, initialUsage, initialDatasets, initialDaily }: { initial: GexState; initialLiveCategories: LiveRow["category"][]; initialUsage: GexUsage; initialDatasets: GexDatasetSummary[]; initialDaily: { id: string; rows: LiveRow[]; runAt: string } | null }) {
  const [state, setState] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploadKey, setUploadKey] = useState(0);
  const [category, setCategory] = useState<LiveRow["category"]>("daily");
  const [selectedDate, setSelectedDate] = useState("");
  const [liveRows, setLiveRows] = useState<LiveRow[]>(initialDaily?.rows ?? []);
  const [datasets, setDatasets] = useState(initialDatasets);
  const [selectedDatasetId, setSelectedDatasetId] = useState(initialDaily?.id ?? initialDatasets[0]?.id ?? "");
  const [loadedDatasetId, setLoadedDatasetId] = useState(initialDaily?.id ?? "");
  const [resultError, setResultError] = useState("");
  const [liveFailures, setLiveFailures] = useState<string[]>([]);
  const [liveWarnings, setLiveWarnings] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; kind: "engine" | "scanner"; version: number; active: boolean; createdAt: string }>>([]);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateKind, setTemplateKind] = useState<"engine" | "scanner">("engine");
  const [templateUploadKey, setTemplateUploadKey] = useState(0);
  const [liveCategories, setLiveCategories] = useState(initialLiveCategories);
  const [usage, setUsage] = useState(initialUsage);
  const [flipPrompt, setFlipPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [sublistOpen, setSublistOpen] = useState(false);
  const [sublistName, setSublistName] = useState("");
  const [sublistSymbols, setSublistSymbols] = useState<string[]>([]);
  const [sublistSearch, setSublistSearch] = useState("");
  const activeGexList = state.lists.find((list) => list.active) ?? null;
  const sublistSource = activeGexList?.kind === "master" ? activeGexList : state.lists.find((list) => list.id === activeGexList?.parentListId) ?? null;
  const sublistSourceSymbols = sublistSource?.symbols ?? state.symbols;
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId);
  const displayedLiveRows = loadedDatasetId === selectedDatasetId
    ? [...liveRows].sort((left, right) => left.symbol.localeCompare(right.symbol))
    : [];
  useEffect(() => { void fetch("/api/gex/templates").then((response) => response.json()).then((data) => setTemplates(data.templates ?? [])); }, []);
  useEffect(() => { void fetch("/api/gex/flip-prompt", { cache: "no-store" }).then((response) => response.json()).then((data: { prompt?: string }) => setFlipPrompt(data.prompt ?? "")).catch(() => undefined); }, []);
  useEffect(() => {
    if (!selectedDatasetId || selectedDatasetId === loadedDatasetId) return;
    const controller = new AbortController();
    void fetch(`/api/gex/dataset?id=${encodeURIComponent(selectedDatasetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { rows?: LiveRow[]; error?: string } }))
      .then(({ response, payload }) => {
        if (controller.signal.aborted) return;
        if (!response.ok || !payload.rows) throw new Error(payload.error ?? "Saved GEX result could not be loaded.");
        setLiveRows(payload.rows);
        setLoadedDatasetId(selectedDatasetId);
        setResultError("");
      })
      .catch((cause) => { if (!controller.signal.aborted) setResultError(cause instanceof Error ? cause.message : "Saved GEX result could not be loaded."); });
    return () => controller.abort();
  }, [selectedDatasetId, loadedDatasetId]);

  async function saveSublist() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/gex/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "sublist", name: sublistName, symbols: sublistSymbols, expectedRevision: state.revision }) });
      const payload = await response.json() as { state?: GexState; error?: string };
      if (!response.ok || !payload.state) throw new Error(payload.error ?? "The GEX sublist could not be saved.");
      setState(payload.state); setSublistOpen(false); setSublistName(""); setSublistSymbols([]); setMessage("GEX sublist saved and activated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The GEX sublist could not be saved."); }
    finally { setBusy(false); }
  }
  async function activateList(id: string) { setBusy(true); setError(""); try { const response = await fetch("/api/gex/watchlist", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, expectedRevision: state.revision }) }); const payload = await response.json() as { state?: GexState; error?: string }; if (!response.ok || !payload.state) throw new Error(payload.error ?? "GEX list could not be activated."); setState(payload.state); setMessage("GEX list activated."); } catch (cause) { setError(cause instanceof Error ? cause.message : "GEX list could not be activated."); } finally { setBusy(false); } }
  async function deleteSublist(id: string) { setBusy(true); setError(""); try { const response = await fetch("/api/gex/watchlist", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, expectedRevision: state.revision }) }); const payload = await response.json() as { state?: GexState; error?: string }; if (!response.ok || !payload.state) throw new Error(payload.error ?? "GEX sublist could not be deleted."); setState(payload.state); setMessage("GEX sublist deleted."); } catch (cause) { setError(cause instanceof Error ? cause.message : "GEX sublist could not be deleted."); } finally { setBusy(false); } }

  async function runLive() {
    setBusy(true); setError(""); setMessage(""); setLiveFailures([]); setLiveWarnings([]);
    try {
      const response = await fetch("/api/gex/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, ...(category === "manual" ? { selectedDate } : {}) }) });
      const payload = await response.json().catch(() => ({ error: "The live-GEX service returned an empty response. No new result was saved." })) as { rows?: LiveRow[]; failures?: string[]; warnings?: string[]; runAt?: string; datasetId?: string; datasets?: GexDatasetSummary[]; usage?: GexUsage; error?: string };
      if (!response.ok || !payload.rows || !payload.datasetId) throw new Error(payload.error ?? "Live GEX calculation could not start.");
      setLiveRows(payload.rows); setLiveFailures(payload.failures ?? []);
      setLiveWarnings(payload.warnings ?? []);
      if (payload.datasets) setDatasets(payload.datasets);
      setSelectedDatasetId(payload.datasetId);
      setLoadedDatasetId(payload.datasetId);
      setResultError("");
      if (payload.usage) setUsage(payload.usage);
      setLiveCategories((current) => current.includes(category) ? current : [...current, category]);
      setMessage(`${payload.rows.length} live GEX calculation${payload.rows.length === 1 ? "" : "s"} completed for the ${category} expiration bucket.${category === "manual" ? ` Requested ${selectedDate}; actual expiration${payload.rows.length === 1 ? "" : "s"}: ${[...new Set(payload.rows.map((row) => row.expiration))].join(", ") || "none available"}.` : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Live GEX calculation could not start."); }
    finally { setBusy(false); }
  }

  async function uploadTemplate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!templateFile) return; setBusy(true); setError(""); setMessage(""); try { const content = await templateFile.text(); const response = await fetch("/api/gex/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: templateKind, content }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setTemplates(data.templates); setTemplateFile(null); setTemplateUploadKey((value) => value + 1); const active = data.templates.find((template: { kind: string; active: boolean }) => template.kind === templateKind && template.active); setMessage(`${templateKind === "engine" ? "GEX Master Engine" : "Gex Scanner"} version ${active?.version ?? "new"} saved and active.`); } catch (cause) { setError(cause instanceof Error ? cause.message : "Template upload failed."); } finally { setBusy(false); } }
  async function activateTemplate(kind: "engine" | "scanner", id: string) { const response = await fetch("/api/gex/templates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id }) }); const data = await response.json(); if (response.ok) setTemplates(data.templates); else setError(data.error ?? "Template activation failed."); }
  async function saveFlipPrompt(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSavingPrompt(true); setError(""); try { const response = await fetch("/api/gex/flip-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: flipPrompt }) }); const data = await response.json() as { prompt?: string; error?: string }; if (!response.ok || !data.prompt) throw new Error(data.error ?? "The GEX flip prompt could not be saved."); setFlipPrompt(data.prompt); setMessage("GEX flip prompt saved. It will be used for the next live GEX run."); } catch (cause) { setError(cause instanceof Error ? cause.message : "The GEX flip prompt could not be saved."); } finally { setSavingPrompt(false); } }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError("Choose a CSV, TXT, or XLSX file."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.set("file", file); body.set("expectedRevision", String(state.revision));
      const response = await fetch("/api/gex/watchlist", { method: "POST", body });
      const payload = await response.json() as { state?: GexState; error?: string; rejected?: string[]; duplicates?: number };
      if (!response.ok || !payload.state) throw new Error(payload.error ?? "The GEX list could not be saved.");
      setState(payload.state); setFile(null); setUploadKey((value) => value + 1);
      const details = [
        payload.duplicates ? `${payload.duplicates} duplicate${payload.duplicates === 1 ? "" : "s"} removed` : "",
        payload.rejected?.length ? `${payload.rejected.length} invalid item${payload.rejected.length === 1 ? "" : "s"} excluded` : "",
      ].filter(Boolean);
      setMessage(`${payload.state.symbols.length} symbols saved.${details.length ? ` ${details.join("; ")}.` : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The GEX list could not be saved."); }
    finally { setBusy(false); }
  }

  return <>
    <section className="gex-hero">
      <div>
        <p className="eyebrow">Standalone workspace</p>
        <h1>GEX Analysis</h1>
        <p>Upload a US options watchlist, select an expiry category, and calculate live Gamma Exposure from Schwab option-chain data.</p>
      </div>
      <div className="gex-hero-status">
        <span className="gex-stage">Live GEX workspace</span>
        <div className="gex-spend" aria-label="GEX Gemini spend tracker">
          <small>Gemini spend</small>
          <strong>{spend(usage.costUsd, usage.costComplete)}</strong>
          <span>{usage.modelRuns} Gemini call{usage.modelRuns === 1 ? "" : "s"}{usage.totalTokens === null ? "" : ` · ${usage.totalTokens.toLocaleString()} tokens`}</span>
        </div>
      </div>
    </section>

    <section className="gex-notice" role="note">
      <strong>On-demand GEX only</strong><span className="gex-stage">Server-side data only</span>
      <p>Live calculations use the selected Schwab option-expiry bucket. Daily selects the nearest expiration, weekly selects the nearest Friday, monthly selects the upcoming third Friday, and Manual uses the selected date or the next available expiry after it. GEX walls use gamma and open interest; separate activity walls rank open interest plus volume. No scan, Swing, or automatic-trading action is created.</p>
    </section>

    <div className="gex-grid">
      <section className="gex-panel" aria-labelledby="gex-list-heading">
        <div className="gex-panel-head"><div><p className="eyebrow">01 / Inputs</p><h2 id="gex-list-heading">Your GEX ticker list</h2></div><span>{state.symbols.length} / 100</span></div>
        <p className="muted">Upload US equity symbols independently of Dashboard and Swing Trade. The saved list is the input for an on-demand live GEX run.</p>
        <form className="gex-upload" onSubmit={upload}>
          <label htmlFor="gex-file">CSV, TXT, or XLSX symbol list</label>
          <input accept=".csv,.txt,.xlsx" id="gex-file" key={uploadKey} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
          <div className="gex-actions"><button className="primary-button" disabled={busy || !file} type="submit">Save list</button><button className="secondary-button" disabled={busy || !sublistSourceSymbols.length} onClick={() => { setError(""); setSublistSymbols([]); setSublistName(""); setSublistSearch(""); setSublistOpen(true); }} type="button">Create sublist</button></div>
        </form>
        {message ? <p className="gex-feedback" role="status">{message}</p> : null}
        {error ? <p className="gex-error" role="alert">{error}</p> : null}
        {state.lists.length ? <div className="gex-list-summary"><strong>Saved lists</strong><div className="swing-list-table"><div className="heading"><span>List</span><span>Type</span><span>Stocks</span><span>Status</span><span>Action</span></div>{state.lists.map((list) => <article className={list.active ? "active" : ""} key={list.id}><div><strong>{list.name}</strong>{list.parentListId ? <small>Saved sublist</small> : <small>Uploaded file</small>}</div><span>{list.kind === "master" ? "Master" : "Sublist"}</span><span className="numeric">{list.entryCount}</span><span>{list.active ? "Active" : "Inactive"}</span><div>{list.active ? <button className="secondary-button compact" disabled type="button">Active</button> : <button className="primary-button compact" disabled={busy} onClick={() => void activateList(list.id)} type="button">Activate</button>}{list.kind === "sublist" ? <button className="text-button compact" disabled={busy} onClick={() => void deleteSublist(list.id)} type="button">Delete</button> : null}</div></article>)}</div></div> : <div className="gex-empty">No GEX list saved yet. Upload a list before a live calculation.</div>}
      </section>

      <section className="gex-panel" aria-labelledby="gex-outputs-heading">
        <div className="gex-panel-head"><div><p className="eyebrow">02 / Live calculation</p><h2 id="gex-outputs-heading">Schwab option-chain GEX</h2></div><span>{state.symbols.length} symbols</span></div>
        <p className="muted">The Schwab access token remains server-only. No options-chain data is sent to Chart-Img, OpenRouter, scans, Swing Trade, or Backtesting.</p>
        <label htmlFor="gex-category">Expiration category</label>
        <select id="gex-category" value={category} onChange={(event) => setCategory(event.target.value as LiveRow["category"])}>
          <option value="daily">Daily — nearest expiration</option><option value="weekly">Weekly — nearest Friday</option><option value="monthly">Monthly - third friday</option><option value="manual">Manual — Date selected</option>
        </select>
        <div className="gex-run-controls">{category === "manual" ? <label htmlFor="gex-manual-date">Expiration date<input id="gex-manual-date" min={new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())} onChange={(event) => setSelectedDate(event.target.value)} required type="date" value={selectedDate} /></label> : null}<button className="primary-button" disabled={busy || !state.symbols.length || (category === "manual" && !selectedDate)} onClick={() => void runLive()} type="button">Calculate live GEX</button></div>
        {liveFailures.length ? <p className="gex-unavailable"><strong>Unavailable:</strong> {liveFailures.join(" ")}</p> : null}
        {liveWarnings.length ? <p className="gex-unavailable"><strong>Chart values unavailable:</strong> {liveWarnings.join(" ")}</p> : null}
        <p className="muted">Each download uses the latest saved live result for the selected expiry category and never runs another provider request.</p>
        {liveCategories.length ? <div className="gex-downloads">
          {liveCategories.includes(category) ? <a className="secondary-button" href={`/api/gex/export?format=xlsx&category=${category}`}>Gex Analysis file <span>.xlsx</span></a> : <button className="secondary-button" disabled type="button">Run live GEX to create Gex Analysis file <span>.xlsx</span></button>}
          {liveCategories.includes(category) ? <a aria-label="Download GEX Master Engine text file" className="secondary-button" href={`/api/gex/export?format=chart&category=${category}&templateVersion=${templates.find((template) => template.kind === "engine" && template.active)?.version ?? 0}`}>GEX_Master_Engine <span>.txt</span></a> : <button className="secondary-button" disabled type="button">Run live GEX to create GEX_Master_Engine <span>.txt</span></button>}
          {liveCategories.includes(category) ? <a aria-label="Download Gex Scanner text file" className="secondary-button" href={`/api/gex/export?format=watchlist&category=${category}&templateVersion=${templates.find((template) => template.kind === "scanner" && template.active)?.version ?? 0}`}>Gex Scanner <span>.txt</span></a> : <button className="secondary-button" disabled type="button">Run live GEX to create Gex Scanner <span>.txt</span></button>}
        </div> : <div className="gex-empty">Downloads appear after a live GEX calculation is saved.</div>}
        <p className="gex-footnote">The watchlist script needs a five-minute Custom Quote in thinkorswim. Both scripts require paste-and-compile verification there before use.</p>
      </section>
    </div>

    <section className="gex-panel gex-results" aria-labelledby="gex-live-results-heading">
      <div className="gex-panel-head gex-results-head"><div><p className="eyebrow">03 / Live results</p><h2 id="gex-live-results-heading">Schwab option-chain structure</h2></div>{datasets.length ? <label htmlFor="gex-saved-result">Saved result<select id="gex-saved-result" value={selectedDatasetId} onChange={(event) => { setSelectedDatasetId(event.target.value); setResultError(""); }}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{`${dataset.category[0].toUpperCase()}${dataset.category.slice(1)} - ${dataset.optionDate} - ${runTime(dataset.runAt)}`}</option>)}</select></label> : null}<time dateTime={selectedDataset?.runAt}>{selectedDataset ? runTime(selectedDataset.runAt) : "No saved run"}</time></div>
      <p className="muted">GEX walls use the highest signed dollar gamma exposure. Activity walls use open interest plus volume. A separate extended-hours five-minute Chart-Img capture supplies only visible last price, VWAP, and Keltner values; it does not create a trade recommendation.</p>
      {resultError ? <p className="gex-error" role="alert">{resultError}</p> : null}
      {displayedLiveRows.length ? <div className="gex-table-wrap"><table><thead><tr><th>Symbol</th><th>Expiry</th><th className="numeric">Schwab spot</th><th className="numeric">Chart last</th><th className="numeric">GEX flip</th><th className="numeric">Call wall</th><th className="numeric">Put wall</th><th className="numeric">VWAP</th><th className="numeric">Keltner U / M / L</th><th className="numeric">Expected move</th><th className="numeric">Call entry / target / stop</th><th className="numeric">Put entry / target / stop</th></tr></thead><tbody>{displayedLiveRows.map((row) => { const values = row.chart?.values; return <tr key={`${row.symbol}-${row.expiration}`}><th scope="row">{row.symbol}</th><td>{row.expiration}</td><td className="numeric">{price(row.underlyingPrice)}</td><td className="numeric">{values?.readable && values.lastPrice !== null ? price(values.lastPrice) : "Unavailable"}</td><td className="numeric">{price(row.gexFlip)}</td><td className="numeric">{price(row.callWall)}</td><td className="numeric">{price(row.putWall)}</td><td className="numeric">{values?.readable && values.vwap !== null ? price(values.vwap) : "Unavailable"}</td><td className="numeric">{values?.readable && values.keltnerUpper !== null && values.keltnerMiddle !== null && values.keltnerLower !== null ? `${price(values.keltnerUpper)} / ${price(values.keltnerMiddle)} / ${price(values.keltnerLower)}` : "Unavailable"}</td><td className="numeric">{row.expectedMove === null ? "Unavailable" : price(row.expectedMove)}</td><td className="numeric">{row.levels ? `${price(row.levels.callEntry)} / ${price(row.levels.callTarget)} / ${price(row.levels.callStop)}` : "Unavailable"}</td><td className="numeric">{row.levels ? `${price(row.levels.putEntry)} / ${price(row.levels.putTarget)} / ${price(row.levels.putStop)}` : "Unavailable"}</td></tr>; })}</tbody></table></div> : <div className="gex-empty">{selectedDatasetId ? resultError || "Loading saved GEX result…" : "No live GEX result has been saved yet."}</div>}
    </section>
    <section className="gex-panel" aria-labelledby="gex-template-heading"><div className="gex-panel-head"><div><p className="eyebrow">04 / Templates</p><h2 id="gex-template-heading">ThinkScript templates</h2></div><span>Active + 3 prior versions</span></div><p className="muted">Upload a .txt template. The active version supplies everything after Step 1; live runs replace only Step 1 values.</p>{message ? <p className="gex-feedback" role="status">{message}</p> : null}{error ? <p className="gex-error" role="alert">{error}</p> : null}<form className="gex-upload" onSubmit={uploadTemplate}><label htmlFor="gex-template-kind">Output</label><select id="gex-template-kind" value={templateKind} onChange={(event) => setTemplateKind(event.target.value as "engine" | "scanner")}><option value="engine">GEX Master Engine</option><option value="scanner">Gex Scanner</option></select><input accept=".txt,text/plain" key={templateUploadKey} onChange={(event) => setTemplateFile(event.target.files?.[0] ?? null)} type="file"/><button className="primary-button" disabled={busy || !templateFile} type="submit">Upload and activate</button></form>{(["engine", "scanner"] as const).map((kind) => <div key={kind}><h3>{kind === "engine" ? "GEX Master Engine" : "Gex Scanner"}</h3>{templates.filter((template) => template.kind === kind).map((template) => <span key={template.id}><a className="secondary-button" href={`/api/gex/templates?id=${template.id}&kind=${kind}`}>Download v{template.version}</a><button className="secondary-button" disabled={template.active} onClick={() => void activateTemplate(kind, template.id)} type="button">{template.active ? "Active" : "Make active"}</button></span>)}</div>)}</section>
    <section className="gex-panel gex-flip-prompt" aria-labelledby="gex-flip-prompt-heading"><div className="gex-panel-head"><div><p className="eyebrow">05 / AI prompt</p><h2 id="gex-flip-prompt-heading">GEX Flip calculation prompt</h2></div><span>Used on next live run</span></div><p className="muted">This server-side prompt receives only the selected expiry&apos;s Schwab option-chain fields. Saving it activates the new version immediately.</p><form className="gex-upload" onSubmit={saveFlipPrompt}><label htmlFor="gex-flip-prompt">Current active prompt</label><textarea id="gex-flip-prompt" value={flipPrompt} onChange={(event) => setFlipPrompt(event.target.value)} rows={16}/><button className="primary-button" disabled={savingPrompt || flipPrompt.trim().length < 100} type="submit">Save GEX flip prompt</button></form></section>
    {sublistOpen ? <Modal description={`Create a named subset from ${sublistSource?.name ?? "the uploaded master list"}.`} onClose={() => setSublistOpen(false)} title="Create sublist"><section aria-label="Choose GEX stocks" className="swing-watchlist-picker"><div className="swing-picker-head"><div><strong>Source master: {sublistSource?.name ?? "Uploaded GEX list"}</strong><span>{sublistSymbols.length} selected · {sublistSourceSymbols.length} available</span></div><label><span>Search</span><input aria-label="Search GEX stocks" onChange={(event) => setSublistSearch(event.target.value)} placeholder="Symbol" value={sublistSearch} /></label></div><label className="swing-sublist-name"><span>Sublist name</span><input aria-label="GEX sublist name" maxLength={100} onChange={(event) => setSublistName(event.target.value)} placeholder="Saved sublist name" value={sublistName} /></label><div className="swing-picker-actions"><button className="secondary-button compact" onClick={() => setSublistSymbols(sublistSourceSymbols.slice(0, 20))} type="button">Select first 20</button><button className="secondary-button compact" onClick={() => setSublistSymbols(sublistSourceSymbols)} type="button">Select all</button><button className="text-button compact" onClick={() => setSublistSymbols([])} type="button">Clear</button></div><div className="swing-picker-list gex-sublist-picker-list">{sublistSourceSymbols.filter((symbol) => symbol.toLowerCase().includes(sublistSearch.trim().toLowerCase())).map((symbol) => <label key={symbol}><input checked={sublistSymbols.includes(symbol)} onChange={() => setSublistSymbols((current) => current.includes(symbol) ? current.filter((value) => value !== symbol) : [...current, symbol])} type="checkbox" /><span>{symbol}</span></label>)}</div>{error ? <p className="gex-error" role="alert">{error}</p> : null}<footer className="swing-picker-footer"><div><strong>{sublistSymbols.length} stocks selected</strong><span>The saved sublist becomes the active GEX input.</span></div><button className="secondary-button" disabled={busy} onClick={() => setSublistOpen(false)} type="button">Cancel</button><button className="primary-button" disabled={busy || !sublistName.trim() || !sublistSymbols.length} onClick={() => void saveSublist()} type="button">Save sublist</button></footer></section></Modal> : null}
  </>;
}
