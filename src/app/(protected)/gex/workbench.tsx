"use client";

import { useState, type FormEvent } from "react";

import type { GexDemoRow } from "@/gex/demo";

type GexState = {
  symbols: string[]; revision: number; sourceFilename: string | null; updatedAt: string;
  sampleSymbols: string[]; rows: GexDemoRow[]; unavailableSymbols: string[];
};

const price = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function GexWorkbench({ initial }: { initial: GexState }) {
  const [state, setState] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploadKey, setUploadKey] = useState(0);

  async function saveSample() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/gex/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "sample", expectedRevision: state.revision }) });
      const payload = await response.json() as { state?: GexState; error?: string };
      if (!response.ok || !payload.state) throw new Error(payload.error ?? "The sample list could not be loaded.");
      setState(payload.state); setMessage("Sample symbols loaded into your GEX list. These levels are illustrative only.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The sample list could not be loaded."); }
    finally { setBusy(false); }
  }

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

  const exportUrl = (format: "xlsx" | "chart" | "watchlist") => `/api/gex/export?format=${format}&revision=${state.revision}`;
  return <>
    <section className="gex-hero">
      <div>
        <p className="eyebrow">Standalone workspace</p>
        <h1>GEX Analysis</h1>
        <p>Prepare a separate US options watchlist and inspect the downloadable GEX output format.</p>
      </div>
      <span className="gex-stage">Sample preview</span>
    </section>

    <section className="gex-notice" role="note">
      <strong>Illustrative data only</strong>
      <p>The supplied workbook is undated and contains finished levels, not raw option chains. No Schwab data, live calculations, daily scheduling, or scan/Swing integration is active. Generated thinkorswim scripts are disabled by default.</p>
    </section>

    <div className="gex-grid">
      <section className="gex-panel" aria-labelledby="gex-list-heading">
        <div className="gex-panel-head"><div><p className="eyebrow">01 / Inputs</p><h2 id="gex-list-heading">Your GEX ticker list</h2></div><span>{state.symbols.length} / 100</span></div>
        <p className="muted">Upload US equity symbols independently of Dashboard and Swing Trade. Preview data exists only for the {state.sampleSymbols.length} symbols in the supplied sample.</p>
        <form className="gex-upload" onSubmit={upload}>
          <label htmlFor="gex-file">CSV, TXT, or XLSX symbol list</label>
          <input accept=".csv,.txt,.xlsx" id="gex-file" key={uploadKey} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
          <div className="gex-actions"><button className="primary-button" disabled={busy || !file} type="submit">Save list</button><button className="secondary-button" disabled={busy} onClick={() => void saveSample()} type="button">Use sample tickers</button></div>
        </form>
        {message ? <p className="gex-feedback" role="status">{message}</p> : null}
        {error ? <p className="gex-error" role="alert">{error}</p> : null}
        {state.symbols.length ? <div className="gex-list-summary"><strong>Saved list</strong><small>{state.sourceFilename ?? "GEX list"}</small><div className="gex-chips">{state.symbols.map((symbol) => <span className={state.unavailableSymbols.includes(symbol) ? "unavailable" : ""} key={symbol}>{symbol}</span>)}</div></div> : <div className="gex-empty">No GEX list saved yet. Upload one or load the sample tickers to explore the preview.</div>}
      </section>

      <section className="gex-panel" aria-labelledby="gex-outputs-heading">
        <div className="gex-panel-head"><div><p className="eyebrow">02 / Outputs</p><h2 id="gex-outputs-heading">Download preview</h2></div><span>{state.rows.length} matched</span></div>
        <p className="muted">Each download uses only the sample-backed symbols in your saved list. Missing scenarios stay blank rather than being invented.</p>
        {state.rows.length ? <div className="gex-downloads">
          <a className="secondary-button" href={exportUrl("xlsx")}>Three-tab Excel workbook <span>.xlsx</span></a>
          <a className="secondary-button" href={exportUrl("chart")}>Master chart study <span>.ts</span></a>
          <a className="secondary-button" href={exportUrl("watchlist")}>Watchlist column <span>.ts</span></a>
        </div> : <div className="gex-empty">Downloads appear when your list contains at least one sample symbol.</div>}
        {state.unavailableSymbols.length ? <p className="gex-unavailable"><strong>No sample data:</strong> {state.unavailableSymbols.join(", ")}. They remain on your saved list for future live integration.</p> : null}
        <p className="gex-footnote">The watchlist script needs a five-minute Custom Quote in thinkorswim. Both scripts require paste-and-compile verification there before use.</p>
      </section>
    </div>

    {state.rows.length ? <section className="gex-panel gex-results" aria-labelledby="gex-results-heading">
      <div className="gex-panel-head"><div><p className="eyebrow">03 / Preview</p><h2 id="gex-results-heading">Sample matrix</h2></div><span>Undated</span></div>
      <div className="gex-table-wrap"><table><thead><tr><th>Symbol</th><th className="numeric">Sample flip</th><th className="numeric">Call wall</th><th>Call setup in sample</th><th className="numeric">Call entry</th><th className="numeric">Put wall</th><th className="numeric">Put bounce zone</th></tr></thead><tbody>{state.rows.map((row) => <tr key={row.symbol}><th scope="row">{row.symbol}</th><td className="numeric">{price(row.flip)}</td><td className="numeric">{price(row.callWall)}</td><td>{row.callDirection}</td><td className="numeric">{price(row.callEntryLow)}{row.callEntryHigh !== row.callEntryLow ? `–${price(row.callEntryHigh)}` : ""}</td><td className="numeric">{price(row.putWall)}</td><td className="numeric">{price(row.putEntryLow)}–{price(row.putEntryHigh)}</td></tr>)}</tbody></table></div>
    </section> : null}
  </>;
}
