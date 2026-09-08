"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

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
  const [previewSource, setPreviewSource] = useState<Record<PromptPhase, string>>({
    compact: initial.find((item) => item.phase === "compact")!.revisions.find((revision) => revision.active)!.instructions,
    full: initial.find((item) => item.phase === "full")!.revisions.find((revision) => revision.active)!.instructions,
  });
  const [previewRequest, setPreviewRequest] = useState<{ phase: PromptPhase; instructions: string; pending: boolean; error: string } | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [message, setMessage] = useState("");
  const draft = drafts[phase];
  const dirty = draft !== active.instructions;
  const dirtyByPhase = {
    compact: drafts.compact !== phases.find((item) => item.phase === "compact")!.revisions.find((revision) => revision.id === phases.find((item) => item.phase === "compact")!.activeRevisionId)!.instructions,
    full: drafts.full !== phases.find((item) => item.phase === "full")!.revisions.find((revision) => revision.id === phases.find((item) => item.phase === "full")!.activeRevisionId)!.instructions,
  };
  const hasUnsavedChanges = dirtyByPhase.compact || dirtyByPhase.full;
  const currentPreviewRequest = previewRequest?.phase === phase && previewRequest.instructions === draft ? previewRequest : null;
  const previewPending = currentPreviewRequest?.pending ?? false;
  const previewError = currentPreviewRequest?.error ?? "";

  async function request(path: string, body: object) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { error?: string; preview?: string; revision?: PromptStudioPhase["revisions"][number] };
    if (!response.ok) throw new Error(payload.error ?? "Prompt update failed.");
    return payload;
  }

  useEffect(() => {
    if (draft === previewSource[phase]) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewRequest({ phase, instructions: draft, pending: true, error: "" });
      try {
        const response = await fetch(`/api/prompts/${phase}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instructions: draft }),
          signal: controller.signal,
        });
        const payload = await response.json() as { error?: string; preview?: string };
        if (!response.ok) throw new Error(payload.error ?? "Prompt preview failed.");
        setPreview((value) => ({ ...value, [phase]: payload.preview ?? "" }));
        setPreviewSource((value) => ({ ...value, [phase]: draft }));
      } catch (error) {
        if (!controller.signal.aborted) setPreviewRequest({ phase, instructions: draft, pending: false, error: error instanceof Error ? error.message : "Prompt preview failed." });
      } finally {
        if (!controller.signal.aborted) setPreviewRequest((value) => value?.phase === phase && value.instructions === draft ? { ...value, pending: false } : value);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft, phase, previewSource]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (!hasUnsavedChanges) return;
      const anchor = (event.target as HTMLElement).closest("a");
      if (anchor?.href && !window.confirm("Discard unsaved prompt changes?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [hasUnsavedChanges]);

  async function save() {
    setMutationPending(true); setMessage("");
    try {
      const result = await request(`/api/prompts/${phase}/revisions`, { instructions: draft, expectedActiveRevisionId: current.activeRevisionId });
      const revision = result.revision!;
      setPhases((value) => value.map((item) => item.phase === phase ? {
        ...item, activeRevisionId: revision.id,
        revisions: [{ ...revision, active: true }, ...item.revisions.map((entry) => ({ ...entry, active: false }))],
      } : item));
      setMessage(`${label(phase)} revision ${revision.revisionNumber} is active for future calls.`);
      Sentry.logger.info("prompt.revision.activated", { "specialstock.prompt.phase": phase, "specialstock.prompt.revision_id": revision.id, "specialstock.prompt.instructions_length": draft.length });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Prompt save failed."); }
    finally { setMutationPending(false); }
  }

  async function activate(revisionId: string) {
    setMutationPending(true); setMessage("");
    try {
      const result = await request(`/api/prompts/${phase}/activate`, { revisionId, expectedActiveRevisionId: current.activeRevisionId });
      const revision = result.revision!;
      setPhases((value) => value.map((item) => item.phase === phase ? { ...item, activeRevisionId: revision.id, revisions: item.revisions.map((entry) => ({ ...entry, active: entry.id === revision.id })) } : item));
      setDrafts((value) => ({ ...value, [phase]: revision.instructions }));
      setMessage(`${label(phase)} revision ${revision.revisionNumber} is active.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Prompt activation failed."); }
    finally { setMutationPending(false); }
  }

  return (
    <section className="settings-card prompt-studio" aria-labelledby="prompt-studio-heading">
      <div className="settings-card-heading"><div><p className="eyebrow">Versioned instructions</p><h2 id="prompt-studio-heading">AI prompt studio</h2></div><span className="status-pill live">Revision {active.revisionNumber} active</span></div>
      <p className="muted">Change how Gemini analyzes a chart without changing its required output, evidence boundaries, locked signal fields, or safety rules.</p>
      <div className="filter-group prompt-tabs" aria-label="Prompt phase">
        {(["compact", "full"] as const).map((value) => <button aria-pressed={phase === value} className={phase === value ? "active" : ""} key={value} onClick={() => { setPhase(value); setMessage(""); }} type="button"><span>{label(value)}{dirtyByPhase[value] ? <i>Unsaved</i> : null}</span><small>{value === "compact" ? "Routine and manual signals" : "On-demand narrative analysis"}</small></button>)}
      </div>
      <div className="prompt-workspace">
        <section className="prompt-editor-pane" aria-labelledby="prompt-editor-heading">
          <div className="prompt-pane-heading"><div><p className="eyebrow">Editable</p><h3 id="prompt-editor-heading">Analysis instructions</h3></div>{dirty ? <span className="prompt-dirty-status">Unsaved changes</span> : <span className="muted">Matches active revision</span>}</div>
          <p className="muted">Use this space for the market context and analysis method you want Gemini to follow.</p>
          <label className="prompt-editor"><span className="sr-only">Analysis instructions for {label(phase)}</span><textarea maxLength={8000} onChange={(event) => setDrafts((value) => ({ ...value, [phase]: event.target.value }))} rows={16} value={draft} /></label>
          <div className="prompt-editor-footer"><span className="muted">{draft.length.toLocaleString()} / 8,000</span><div><button className="secondary-button compact" disabled={mutationPending || !dirty} onClick={() => setDrafts((value) => ({ ...value, [phase]: active.instructions }))} type="button">Undo edits</button> <button className="secondary-button compact" disabled={mutationPending || draft === current.defaultInstructions} onClick={() => setDrafts((value) => ({ ...value, [phase]: current.defaultInstructions }))} type="button">Use built-in default</button></div></div>
        </section>
        <section className="prompt-effective-preview" aria-labelledby="prompt-preview-heading">
          <div className="prompt-pane-heading"><div><p className="eyebrow">Read only</p><h3 id="prompt-preview-heading">Full prompt preview</h3></div><span className={previewError ? "prompt-preview-state error" : "prompt-preview-state"} aria-live="polite">{previewError ? "Preview unavailable" : previewPending ? "Updating…" : "Up to date"}</span></div>
          <p className="muted">Your instructions combined with protected rules and sample runtime placeholders.</p>
          {previewError ? <div className="warning-banner"><span>{previewError}</span></div> : null}
          <pre aria-label={`Full prompt preview for ${label(phase)}`}>{preview[phase]}</pre>
        </section>
      </div>
      <div className="prompt-save-row"><div><strong>{dirty ? "Ready to create a new revision" : `Revision ${active.revisionNumber} is active`}</strong><small>{dirty ? `Saving will activate these instructions for future ${label(phase).toLowerCase()} requests.` : "In-flight requests keep the revision they started with."}</small></div><button className="primary-button" disabled={mutationPending || !dirty || !draft.trim()} onClick={() => void save()} type="button">{mutationPending ? "Saving…" : "Save as new revision"}</button></div>
      {message ? <p className={message.includes("failed") || message.includes("changed") ? "form-error" : "form-success"} role="status">{message}</p> : null}
      <details className="prompt-revisions"><summary><span>Revision history</span><small>{current.revisions.length} saved · previous versions remain available</small></summary><div className="prompt-history">{current.revisions.map((revision) => <article key={revision.id}><div><strong>Revision {revision.revisionNumber}</strong><small>{new Date(revision.createdAt).toLocaleString()} · {revision.templateVersion} · {revision.instructionsHash.slice(0, 12)}</small></div>{revision.active ? <span className="status-pill live">Active</span> : <button className="secondary-button compact" disabled={mutationPending} onClick={() => void activate(revision.id)} type="button">Make active</button>}</article>)}</div></details>
    </section>
  );
}
