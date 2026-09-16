"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Revision = { id: string; revisionNumber: number; instructions: string; instructionsHash: string; templateVersion: string; createdAt: string; active: boolean };
type Version = { id: string; versionNumber: number; sourceFilename: string; sourceType: string; entryCount: number; createdAt: string; active: boolean };
type RunSummary = { id: string; mode: string; status: string; sessionDate: string; stage: string; completedCandidates: number; failedCandidates: number; totalCandidates: number; providerCalls: number; costUsd: number | null; createdAt: string; completedAt: string | null };
type Candidate = { id: string; status: string; stockName: string; symbol: string; exchange: string; direction: "LONG" | "SHORT" | "NO_TRADE" | null; observedPrice: number | null; entryZoneLow: number | null; entryZoneHigh: number | null; stopLoss: number | null; profitTarget1: number | null; profitTarget2: number | null; conviction: string | null; riskReward: number | null; proximityPercent: number | null; visualQuality: string | null; errorMessage: string | null; rejectionReason: string | null; completedAt: string | null };
type RunDetail = RunSummary & { macroResult: null | { regime: string; summary: string; anchors: Record<string, { stance: string; observation: string; visual_quality: string }> }; candidates: Candidate[]; actionableIds: string[]; errorMessage?: string | null };
type Initial = {
  configuration: { settings: { automaticEnabled: boolean; activeWatchlistVersionId: string | null }; entries: Array<{ stockName: string; symbol: string; exchange: string; position: number }>; versions: Version[] };
  prompt: { activeRevisionId: string; defaultInstructions: string; revisions: Revision[] };
  runs: RunSummary[]; latest: RunDetail | null;
  availability: { chartImg: boolean; openRouter: boolean };
  schedule: { nextEligibleAt: string | null; sessionDate: string; regularSession: boolean };
};

const money = (value: number | null) => value === null ? "—" : `$${value.toFixed(2)}`;
const price = (value: number | null) => value === null ? "—" : `$${value.toFixed(2)}`;

export function SwingTradeWorkbench({ initial }: { initial: Initial }) {
  const [configuration, setConfiguration] = useState(initial.configuration);
  const [prompt, setPrompt] = useState(initial.prompt);
  const active = prompt.revisions.find((revision) => revision.id === prompt.activeRevisionId)!;
  const [draft, setDraft] = useState(active.instructions);
  const [phase, setPhase] = useState<"macro" | "stock">("stock");
  const [preview, setPreview] = useState("");
  const [runs, setRuns] = useState(initial.runs);
  const [selected, setSelected] = useState<RunDetail | null>(initial.latest);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = draft !== active.instructions;
  const running = selected?.status === "running" || selected?.status === "scheduled";
  const selectedId = selected?.id;

  const ranked = useMemo(() => selected ? selected.actionableIds.flatMap((id) => {
    const candidate = selected.candidates.find((item) => item.id === id);
    return candidate ? [candidate] : [];
  }) : [], [selected]);
  const noTrade = selected?.candidates.filter((candidate) => candidate.status === "completed" && candidate.direction === "NO_TRADE") ?? [];
  const failed = selected?.candidates.filter((candidate) => candidate.status === "failed") ?? [];

  async function refreshState() {
    const response = await fetch("/api/swing/state", { cache: "no-store" });
    if (!response.ok) return;
    const state = await response.json() as { configuration: Initial["configuration"]; prompt: Initial["prompt"]; runs: RunSummary[] };
    setConfiguration(state.configuration); setPrompt(state.prompt); setRuns(state.runs);
  }

  async function loadRun(id: string) {
    const response = await fetch(`/api/swing/runs/${id}`, { cache: "no-store" });
    const payload = await response.json() as { run?: RunDetail; error?: string };
    if (!response.ok || !payload.run) throw new Error(payload.error ?? "Swing run could not be loaded.");
    setSelected(payload.run);
  }

  useEffect(() => {
    if (!running || !selectedId) return;
    const interval = window.setInterval(() => void loadRun(selectedId).then(() => refreshState()), 1200);
    return () => window.clearInterval(interval);
  }, [running, selectedId]);

  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const click = (event: MouseEvent) => {
      if (!dirty) return;
      const anchor = (event.target as HTMLElement).closest("a");
      if (anchor?.href && !window.confirm("Discard unsaved Swing prompt changes?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", before); document.removeEventListener("click", click, true); };
  }, [dirty]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (draft.trim().length < 100) { setPreview(""); return; }
      const response = await fetch("/api/swing/prompts/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instructions: draft, phase }), signal: controller.signal });
      const payload = await response.json() as { preview?: string };
      if (response.ok && !controller.signal.aborted) setPreview(payload.preview ?? "");
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft, phase]);

  async function importWatchlist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/swing/watchlists", { method: "POST", body: form });
      const payload = await response.json() as { error?: string; issues?: string[] };
      if (!response.ok) throw new Error(payload.issues?.join(" ") ?? payload.error ?? "Watchlist import failed.");
      await refreshState(); setMessage("Swing watchlist imported and activated."); formElement.reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Watchlist import failed."); }
    finally { setPending(false); }
  }

  async function toggleAutomatic(enabled: boolean) {
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/swing/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ automaticEnabled: enabled }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Setting update failed.");
      setConfiguration((value) => ({ ...value, settings: { ...value.settings, automaticEnabled: enabled } }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Setting update failed."); }
    finally { setPending(false); }
  }

  async function restoreWatchlist(versionId: string) {
    setPending(true);
    try {
      const response = await fetch("/api/swing/watchlists/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId }) });
      if (!response.ok) throw new Error("Watchlist restore failed.");
      await refreshState(); setMessage("Previous Swing watchlist version restored.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Watchlist restore failed."); }
    finally { setPending(false); }
  }

  async function startRun() {
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/swing/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "manual", requestId: crypto.randomUUID() }) });
      const payload = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) throw new Error(payload.error ?? "Swing run could not start.");
      await loadRun(payload.runId); await refreshState();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Swing run could not start."); }
    finally { setPending(false); }
  }

  async function updatePrompt(kind: "save" | "activate", revisionId?: string, instructions = draft) {
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/swing/prompts/${kind === "save" ? "revisions" : "activate"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "save" ? { instructions, expectedActiveRevisionId: active.id } : { revisionId, expectedActiveRevisionId: active.id }) });
      const payload = await response.json() as { revision?: Revision; error?: string };
      if (!response.ok || !payload.revision) throw new Error(payload.error ?? "Prompt update failed.");
      await refreshState(); setDraft(payload.revision.instructions); setMessage(`Swing prompt revision ${payload.revision.revisionNumber} is active.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Prompt update failed."); }
    finally { setPending(false); }
  }

  return <div className="swing-stack">
    {message ? <div className={/failed|error|pending approval/i.test(message) ? "warning-banner" : "notice-card"} role="status"><span>{message}</span></div> : null}
    {!initial.availability.chartImg || !initial.availability.openRouter ? <div className="warning-banner" role="status"><strong>Provider setup required</strong><span>Add the missing server-only Chart-Img and OpenRouter keys before a run. No values are exposed here.</span></div> : null}

    <section className="swing-control-grid">
      <article className="settings-card">
        <p className="eyebrow">Independent universe</p><h2>Swing watchlist</h2>
        <p className="muted">{configuration.entries.length ? `${configuration.entries.length} stocks · version ${configuration.versions.find((version) => version.active)?.versionNumber}` : "No active watchlist. Automatic runs are disabled until one is imported."}</p>
        <form className="swing-upload" onSubmit={importWatchlist} data-sentry-mask><label><span>Watchlist CSV or XLSX</span><input accept=".csv,.xlsx" name="file" required type="file" /></label><button className="primary-button compact" disabled={pending} type="submit">Import and activate</button></form>
        {configuration.entries.length ? <ol className="swing-symbol-list">{configuration.entries.map((entry) => <li key={entry.symbol}><span>{entry.stockName}</span><strong>{entry.exchange}:{entry.symbol}</strong></li>)}</ol> : null}
        <details><summary>Watchlist version history</summary><div className="swing-history-list">{configuration.versions.map((version) => <div key={version.id}><span>v{version.versionNumber} · {version.entryCount} rows · {version.sourceFilename}</span>{version.active ? <span className="status-pill live">Active</span> : <button className="secondary-button compact" disabled={pending} onClick={() => void restoreWatchlist(version.id)} type="button">Restore</button>}</div>)}</div></details>
      </article>

      <article className="settings-card">
        <p className="eyebrow">Browser-driven schedule</p><h2>Automatic daily run</h2>
        <label className="swing-auto"><input checked={configuration.settings.automaticEnabled} disabled={pending || !configuration.entries.length} onChange={(event) => void toggleAutomatic(event.target.checked)} type="checkbox" /><span>{configuration.settings.automaticEnabled ? "Enabled" : "Off by default"}</span></label>
        <p className="muted">Next eligible time: {initial.schedule.nextEligibleAt ? new Date(initial.schedule.nextEligibleAt).toLocaleString() : "No regular session available"}.</p>
        <p className="muted">The local server and at least one authenticated SpecialStock tab must remain open. Early closes run ten minutes before the calendar close; expired slots are not backfilled.</p>
        <button className="primary-button" disabled={pending || running || !configuration.entries.length || !initial.availability.chartImg || !initial.availability.openRouter} onClick={() => void startRun()} type="button">{running ? "Run in progress…" : "Run now"}</button>
      </article>
    </section>

    <section className="settings-card swing-results" aria-live="polite">
      <div className="settings-card-heading"><div><p className="eyebrow">Saved analysis</p><h2>{selected ? `${selected.mode === "automatic" ? "Automatic" : "Manual"} run · ${selected.sessionDate}` : "No Swing runs yet"}</h2></div>{selected ? <span className={`status-pill ${selected.status === "completed" ? "live" : selected.status === "failed" ? "warning" : "neutral"}`}>{selected.status}</span> : null}</div>
      {selected ? <>
        <div className="swing-progress"><strong>{selected.stage.replaceAll("_", " ")}</strong><span>{selected.completedCandidates}/{selected.totalCandidates} analyzed · {selected.failedCandidates} failed · {selected.providerCalls} provider calls · {money(selected.costUsd)}</span><progress max={Math.max(1, selected.totalCandidates)} value={selected.completedCandidates + selected.failedCandidates} /></div>
        {selected.errorMessage ? <div className="warning-banner"><span>{selected.errorMessage}</span></div> : null}
        {selected.macroResult ? <section className="swing-macro"><div><p className="eyebrow">Macro regime</p><h3>{selected.macroResult.regime.replaceAll("_", " ")}</h3><p>{selected.macroResult.summary}</p></div><div className="swing-anchor-grid">{Object.entries(selected.macroResult.anchors).map(([symbol, anchor]) => <article key={symbol}><strong>{symbol} · {anchor.stance}</strong><p>{anchor.observation}</p><small>{anchor.visual_quality}</small></article>)}</div></section> : null}
        {ranked.length ? <><h3>Ranked actionable candidates</h3><div className="swing-table-wrap"><table><thead><tr><th>Rank / stock</th><th>Direction</th><th>Observed</th><th>Entry zone</th><th>Stop</th><th>T1 / T2</th><th>Conviction</th><th>R:R</th><th>Proximity</th><th>Quality</th></tr></thead><tbody>{ranked.map((candidate, index) => <tr key={candidate.id}><td><Link href={`/swing-trade/candidates/${candidate.id}`}><strong>#{index + 1} {candidate.symbol}</strong><small>{candidate.stockName} · {candidate.exchange}</small></Link></td><td>{candidate.direction}</td><td>{price(candidate.observedPrice)}</td><td>{price(candidate.entryZoneLow)}–{price(candidate.entryZoneHigh)}</td><td>{price(candidate.stopLoss)}</td><td>{price(candidate.profitTarget1)} / {price(candidate.profitTarget2)}</td><td>{candidate.conviction}</td><td>{candidate.riskReward?.toFixed(2) ?? "—"}</td><td>{candidate.proximityPercent?.toFixed(2) ?? "—"}%</td><td>{candidate.visualQuality}</td></tr>)}</tbody></table></div></> : null}
        {noTrade.length ? <section><h3>NO_TRADE</h3><div className="swing-card-list">{noTrade.map((candidate) => <Link href={`/swing-trade/candidates/${candidate.id}`} key={candidate.id}><strong>{candidate.symbol} · {candidate.conviction}</strong><span>{candidate.rejectionReason ?? "Open validated blueprint and chart audit"}</span></Link>)}</div></section> : null}
        {failed.length ? <section><h3>Failed symbols</h3><div className="swing-card-list">{failed.map((candidate) => <article key={candidate.id}><strong>{candidate.symbol}</strong><span>{candidate.errorMessage}</span></article>)}</div></section> : null}
      </> : <p className="muted">Import a watchlist, configure providers, and start a mocked or approved live run.</p>}
      {runs.length ? <details><summary>Saved automatic and manual run history</summary><div className="swing-history-list">{runs.map((run) => <button className={selected?.id === run.id ? "active" : ""} key={run.id} onClick={() => void loadRun(run.id)} type="button"><span>{run.sessionDate} · {run.mode}</span><small>{run.status} · {run.completedCandidates}/{run.totalCandidates} completed</small></button>)}</div></details> : null}
    </section>

    <section className="settings-card prompt-studio swing-prompt" data-sentry-mask>
      <div className="settings-card-heading"><div><p className="eyebrow">Swing only · immutable history</p><h2>Swing Prompt Studio</h2></div><span className="status-pill live">Revision {active.revisionNumber} active</span></div>
      <p className="muted">Editable methodology cannot change the model, image source, runtime metadata, strict JSON transport, validation, retries, or persistence. Markdown intent is rendered by the app from validated JSON.</p>
      <div className="prompt-tabs filter-group"><button aria-pressed={phase === "macro"} className={phase === "macro" ? "active" : ""} onClick={() => setPhase("macro")} type="button">Macro prompt</button><button aria-pressed={phase === "stock"} className={phase === "stock" ? "active" : ""} onClick={() => setPhase("stock")} type="button">Stock prompt</button></div>
      <div className="prompt-workspace"><section className="prompt-editor-pane"><textarea aria-label="Swing analysis instructions" maxLength={20000} onChange={(event) => setDraft(event.target.value)} rows={22} value={draft} /><div className="prompt-editor-footer"><span>{draft.length.toLocaleString()} / 20,000</span><div><button className="secondary-button compact" disabled={pending || active.instructions === prompt.defaultInstructions} onClick={() => void updatePrompt("save", undefined, prompt.defaultInstructions)} type="button">Restore default</button> <button className="primary-button compact" disabled={pending || !dirty || draft.trim().length < 100} onClick={() => void updatePrompt("save")} type="button">Save revision</button></div></div></section><section className="prompt-effective-preview"><pre aria-label="Swing assembled prompt preview">{preview}</pre></section></div>
      <details><summary>Prompt revision history</summary><div className="swing-history-list">{prompt.revisions.map((revision) => <div key={revision.id}><span>Revision {revision.revisionNumber} · {new Date(revision.createdAt).toLocaleString()} · {revision.instructionsHash.slice(0, 12)}</span>{revision.active ? <span className="status-pill live">Active</span> : <button className="secondary-button compact" disabled={pending} onClick={() => void updatePrompt("activate", revision.id)} type="button">Reactivate</button>}</div>)}</div></details>
    </section>
  </div>;
}
