"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

import type { PromptPhase } from "@/analysis/prompt";

export type PromptStudioPhase = {
  phase: PromptPhase;
  activeRevisionId: string;
  defaultInstructions: string;
  preview: string;
  revisions: Array<{
    id: string;
    phase: PromptPhase;
    revisionNumber: number;
    instructions: string;
    instructionsHash: string;
    templateVersion: string;
    active: boolean;
    createdAt: string;
  }>;
};

function label(phase: PromptPhase) {
  return phase === "compact" ? "Compact scan" : "Full analysis";
}

export function PromptStudio({ initial }: { initial: PromptStudioPhase[] }) {
  const [phases, setPhases] = useState(initial);
  const [phase, setPhase] = useState<PromptPhase>("compact");
  const current = phases.find((item) => item.phase === phase)!;
  const active = current.revisions.find((revision) => revision.id === current.activeRevisionId)!;
  const [drafts, setDrafts] = useState<Record<PromptPhase, string>>({
    compact: initial.find((item) => item.phase === "compact")!.revisions.find((revision) => revision.active)!.instructions,
    full: initial.find((item) => item.phase === "full")!.revisions.find((revision) => revision.active)!.instructions,
  });
  const [preview, setPreview] = useState<Record<PromptPhase, string>>({ compact: initial.find((item) => item.phase === "compact")!.preview, full: initial.find((item) => item.phase === "full")!.preview });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const draft = drafts[phase];
  const dirty = draft.trim() !== active.instructions;

  async function request(path: string, body: object) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { error?: string; preview?: string; revision?: PromptStudioPhase["revisions"][number] };
    if (!response.ok) throw new Error(payload.error ?? "Prompt update failed.");
    return payload;
  }

  async function showPreview() {
    setPending(true); setMessage("");
    try {
      const result = await request(`/api/prompts/${phase}/preview`, { instructions: draft });
      setPreview((value) => ({ ...value, [phase]: result.preview ?? "" }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Prompt preview failed."); }
    finally { setPending(false); }
  }

  async function save() {
    setPending(true); setMessage("");
    try {
      const result = await request(`/api/prompts/${phase}/revisions`, { instructions: draft, expectedActiveRevisionId: current.activeRevisionId });
      const revision = result.revision!;
      setPhases((value) => value.map((item) => item.phase === phase ? {
        ...item, activeRevisionId: revision.id,
        revisions: [{ ...revision, active: true }, ...item.revisions.map((entry) => ({ ...entry, active: false }))],
      } : item));
      setMessage(`${label(phase)} revision ${revision.revisionNumber} is active for future calls.`);
      Sentry.logger.info("prompt.revision.activated", { "specialstock.prompt.phase": phase, "specialstock.prompt.revision_id": revision.id, "specialstock.prompt.instructions_length": draft.length });
      await showPreview();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Prompt save failed."); setPending(false); }
  }

  async function activate(revisionId: string) {
    setPending(true); setMessage("");
    try {
      const result = await request(`/api/prompts/${phase}/activate`, { revisionId, expectedActiveRevisionId: current.activeRevisionId });
      const revision = result.revision!;
      setPhases((value) => value.map((item) => item.phase === phase ? { ...item, activeRevisionId: revision.id, revisions: item.revisions.map((entry) => ({ ...entry, active: entry.id === revision.id })) } : item));
      setDrafts((value) => ({ ...value, [phase]: revision.instructions }));
      setMessage(`${label(phase)} revision ${revision.revisionNumber} is active.`);
      const resultPreview = await request(`/api/prompts/${phase}/preview`, { instructions: revision.instructions });
      setPreview((value) => ({ ...value, [phase]: resultPreview.preview ?? "" }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Prompt activation failed."); }
    finally { setPending(false); }
  }

  return (
    <section className="settings-card prompt-studio" aria-labelledby="prompt-studio-heading">
      <div className="settings-card-heading"><div><p className="eyebrow">Versioned instructions</p><h2 id="prompt-studio-heading">AI prompt studio</h2></div><span className="status-pill live">Revision {active.revisionNumber} active</span></div>
      <p className="muted">Edit the analysis method. Evidence boundaries, response schema, locked signal fields, and safety rules remain protected.</p>
      <div className="filter-group prompt-tabs" aria-label="Prompt phase">
        {(["compact", "full"] as const).map((value) => <button aria-pressed={phase === value} className={phase === value ? "active" : ""} key={value} onClick={() => { setPhase(value); setMessage(""); }} type="button">{label(value)}</button>)}
      </div>
      <label className="prompt-editor"><span>Analysis instructions</span><textarea maxLength={8000} onChange={(event) => setDrafts((value) => ({ ...value, [phase]: event.target.value }))} rows={12} value={draft} /></label>
      <div className="prompt-actions"><span className="muted">{draft.length.toLocaleString()} / 8,000</span><div><button className="secondary-button compact" disabled={pending || !dirty} onClick={() => setDrafts((value) => ({ ...value, [phase]: active.instructions }))} type="button">Discard</button> <button className="secondary-button compact" disabled={pending || draft === current.defaultInstructions} onClick={() => setDrafts((value) => ({ ...value, [phase]: current.defaultInstructions }))} type="button">Restore default</button> <button className="secondary-button compact" disabled={pending || !draft.trim()} onClick={() => void showPreview()} type="button">View full prompt</button> <button className="primary-button compact" disabled={pending || !dirty || !draft.trim()} onClick={() => void save()} type="button">Save and activate</button></div></div>
      {message ? <p className={message.includes("failed") || message.includes("changed") ? "form-error" : "form-success"} role="status">{message}</p> : null}
      <details className="prompt-preview"><summary>Effective prompt preview</summary><pre>{preview[phase]}</pre></details>
      <div className="prompt-history"><h3>Revision history</h3>{current.revisions.map((revision) => <article key={revision.id}><div><strong>Revision {revision.revisionNumber}</strong><small>{new Date(revision.createdAt).toLocaleString()} · {revision.templateVersion} · {revision.instructionsHash.slice(0, 12)}</small></div>{revision.active ? <span className="status-pill live">Active</span> : <button className="secondary-button compact" disabled={pending} onClick={() => void activate(revision.id)} type="button">Reactivate</button>}</article>)}</div>
    </section>
  );
}
