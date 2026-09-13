"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

import type { PromptPhase, PromptScope } from "@/analysis/prompt";

export type PromptStudioPhase = {
  phase: PromptPhase;
  scope: PromptScope;
  activeRevisionId: string;
  defaultInstructions: string;
  preview: string;
  revisions: Array<{
    id: string;
    phase: PromptPhase;
    scope: PromptScope;
    revisionNumber: number;
    instructions: string;
    instructionsHash: string;
    templateVersion: string;
    active: boolean;
    createdAt: string;
  }>;
};

const scopes: Array<{ value: PromptScope; label: string; description: string }> = [
  { value: "auto", label: "Automatic · 5m", description: "Scheduled scans only" },
  { value: "manual_1m", label: "Manual · 1m", description: "Manual one-minute scans only" },
  { value: "manual_5m", label: "Manual · 5m", description: "Manual five-minute scans only" },
  { value: "manual_10m", label: "Manual · 10m", description: "Manual ten-minute scans only" },
];
const key = (scope: PromptScope, phase: PromptPhase) => `${scope}:${phase}`;
const label = (phase: PromptPhase) => phase === "compact" ? "Compact scan" : "Full analysis";

export function PromptStudio({ initial }: { initial: PromptStudioPhase[] }) {
  const [states, setStates] = useState(initial);
  const [scope, setScope] = useState<PromptScope>("auto");
  const [phase, setPhase] = useState<PromptPhase>("compact");
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((item) => [key(item.scope, item.phase), item.revisions.find((revision) => revision.active)!.instructions])));
  const [previews, setPreviews] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((item) => [key(item.scope, item.phase), item.preview])));
  const [previewSources, setPreviewSources] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((item) => [key(item.scope, item.phase), item.revisions.find((revision) => revision.active)!.instructions])));
  const [pending, setPending] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [message, setMessage] = useState("");
  const currentKey = key(scope, phase);
  const current = states.find((item) => key(item.scope, item.phase) === currentKey)!;
  const active = current.revisions.find((revision) => revision.id === current.activeRevisionId)!;
  const draft = drafts[currentKey] ?? "";
  const dirty = draft !== active.instructions;
  const anyDirty = states.some((item) => drafts[key(item.scope, item.phase)] !== item.revisions.find((revision) => revision.id === item.activeRevisionId)?.instructions);

  useEffect(() => {
    if (draft === previewSources[currentKey]) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewPending(true);
      setPreviewError("");
      try {
        const response = await fetch(`/api/prompts/${phase}/preview`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope, instructions: draft }), signal: controller.signal,
        });
        const payload = await response.json() as { preview?: string; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Prompt preview failed.");
        if (!controller.signal.aborted) {
          setPreviews((value) => ({ ...value, [currentKey]: payload.preview ?? "" }));
          setPreviewSources((value) => ({ ...value, [currentKey]: draft }));
        }
      } catch (error) {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : "Prompt preview failed.");
      } finally {
        if (!controller.signal.aborted) setPreviewPending(false);
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [currentKey, draft, phase, scope, previewSources]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (anyDirty) event.preventDefault(); };
    const click = (event: MouseEvent) => {
      if (!anyDirty) return;
      const anchor = (event.target as HTMLElement).closest("a");
      if (anchor?.href && !window.confirm("Discard unsaved prompt changes?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [anyDirty]);

  async function update(kind: "create" | "activate", revisionId?: string) {
    setPending(true);
    setMessage("");
    try {
      await Sentry.startNewTrace(() => Sentry.startSpan({
        name: `${kind === "create" ? "Create" : "Activate"} prompt revision`,
        op: "specialstock.prompt.revision.request", forceTransaction: true,
        attributes: { "specialstock.telemetry.origin": "client", "specialstock.prompt.phase": phase, "specialstock.prompt.scope": scope, "specialstock.prompt.operation": kind },
      }, async (span) => {
        try {
          const path = `/api/prompts/${phase}/${kind === "create" ? "revisions" : "activate"}`;
          const response = await fetch(path, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(kind === "create"
              ? { scope, instructions: draft, expectedActiveRevisionId: active.id }
              : { scope, revisionId, expectedActiveRevisionId: active.id }),
          });
          const payload = await response.json() as { revision?: PromptStudioPhase["revisions"][number]; error?: string };
          if (!response.ok || !payload.revision) throw new Error(payload.error ?? "Prompt update failed.");
          const revision = payload.revision;
          setStates((value) => value.map((item) => key(item.scope, item.phase) === currentKey ? {
            ...item, activeRevisionId: revision.id,
            revisions: kind === "create"
              ? [revision, ...item.revisions.map((entry) => ({ ...entry, active: false }))]
              : item.revisions.map((entry) => ({ ...entry, active: entry.id === revision.id })),
          } : item));
          setDrafts((value) => ({ ...value, [currentKey]: revision.instructions }));
          setMessage(`${label(phase)} revision ${revision.revisionNumber} is active for future calls.`);
          span.setAttributes({ "specialstock.prompt.revision_id": revision.id, "specialstock.prompt.instructions_hash": revision.instructionsHash });
          span.setStatus({ code: 1 });
          Sentry.logger.info("prompt.revision.client_completed", {
            "specialstock.telemetry.origin": "client", "specialstock.prompt.phase": phase,
            "specialstock.prompt.scope": scope, "specialstock.prompt.operation": kind,
            "specialstock.prompt.revision_id": revision.id, "specialstock.prompt.instructions_hash": revision.instructionsHash,
          });
        } catch (error) {
          span.setStatus({ code: 2, message: "prompt_revision_failed" });
          Sentry.logger.warn("prompt.revision.client_failed", { "specialstock.telemetry.origin": "client", "specialstock.prompt.phase": phase, "specialstock.prompt.scope": scope });
          setMessage(error instanceof Error ? error.message : "Prompt update failed.");
        }
      }));
    } finally { setPending(false); }
  }

  return <section className="settings-card prompt-studio" aria-labelledby="prompt-studio-heading">
    <div className="settings-card-heading"><div><p className="eyebrow">Versioned instructions</p><h2 id="prompt-studio-heading">AI prompt studio</h2></div><span className="status-pill live">Revision {active.revisionNumber} active</span></div>
    <p className="muted">Choose when the prompt applies. Automatic scans always use a 5-minute chart and only the Automatic instructions. Manual scans use the instructions for their selected chart interval.</p>
    <div className="prompt-scope-grid" role="group" aria-label="Prompt scan scope">{scopes.map((item) => <button aria-pressed={scope === item.value} className={scope === item.value ? "active" : ""} key={item.value} onClick={() => { setScope(item.value); setMessage(""); }} type="button"><strong>{item.label}</strong><small>{item.description}</small>{states.some((state) => state.scope === item.value && drafts[key(item.value, state.phase)] !== state.revisions.find((revision) => revision.id === state.activeRevisionId)?.instructions) ? <i>Unsaved</i> : null}</button>)}</div>
    <div className="filter-group prompt-tabs" aria-label="Prompt phase">{(["compact", "full"] as const).map((value) => <button aria-pressed={phase === value} className={phase === value ? "active" : ""} key={value} onClick={() => { setPhase(value); setMessage(""); }} type="button"><span>{label(value)}{drafts[key(scope, value)] !== states.find((item) => item.scope === scope && item.phase === value)?.revisions.find((revision) => revision.active)?.instructions ? <i>Unsaved</i> : null}</span><small>{value === "compact" ? "Initial signal" : "Four-phase detail"}</small></button>)}</div>
    <div className="prompt-workspace">
      <section className="prompt-editor-pane" aria-labelledby="prompt-editor-heading">
        <div className="prompt-pane-heading"><div><p className="eyebrow">Editable · {scopes.find((item) => item.value === scope)?.label}</p><h3 id="prompt-editor-heading">Analysis instructions</h3></div>{dirty ? <span className="prompt-dirty-status">Unsaved changes</span> : <span className="muted">Matches active revision</span>}</div>
        <p className="muted">Add your analysis method; chart evidence rules, output shape, and locked signal fields stay protected.</p>
        <label className="prompt-editor"><span className="sr-only">Analysis instructions for {label(phase)}</span><textarea data-sentry-mask maxLength={8000} onChange={(event) => setDrafts((value) => ({ ...value, [currentKey]: event.target.value }))} rows={16} value={draft} /></label>
        <div className="prompt-editor-footer"><span className="muted">{draft.length.toLocaleString()} / 8,000</span><div><button className="secondary-button compact" disabled={pending || !dirty} onClick={() => setDrafts((value) => ({ ...value, [currentKey]: active.instructions }))} type="button">Undo edits</button> <button className="secondary-button compact" disabled={pending || draft === current.defaultInstructions} onClick={() => setDrafts((value) => ({ ...value, [currentKey]: current.defaultInstructions }))} type="button">Use built-in default</button></div></div>
      </section>
      <section className="prompt-effective-preview" aria-labelledby="prompt-preview-heading">
        <div className="prompt-pane-heading"><div><p className="eyebrow">Read only · {scopes.find((item) => item.value === scope)?.label}</p><h3 id="prompt-preview-heading">Full prompt preview</h3></div><span className={previewError ? "prompt-preview-state error" : "prompt-preview-state"} aria-live="polite">{previewError ? "Preview unavailable" : previewPending ? "Updating…" : "Up to date"}</span></div>
        <p className="muted">Protected rules and sample runtime details for this scan interval.</p>
        {previewError ? <div className="warning-banner"><span>{previewError}</span></div> : null}
        <pre aria-label={`Full prompt preview for ${label(phase)}`} data-sentry-mask>{previews[currentKey]}</pre>
      </section>
    </div>
    <div className="prompt-save-row"><div><strong>{dirty ? "Ready to create a new revision" : `Revision ${active.revisionNumber} is active`}</strong><small>Only future {scope === "auto" ? "automatic" : scope.replace("_", " ")} {label(phase).toLowerCase()} requests use a new revision.</small></div><button className="primary-button" disabled={pending || !dirty || !draft.trim()} onClick={() => void update("create")} type="button">{pending ? "Saving…" : "Save as new revision"}</button></div>
    {message ? <p className={message.includes("failed") || message.includes("changed") ? "form-error" : "form-success"} role="status">{message}</p> : null}
    <details className="prompt-revisions"><summary><span>Revision history</span><small>{current.revisions.length} saved · previous versions remain available</small></summary><div className="prompt-history">{current.revisions.map((revision) => <article key={revision.id}><div><strong>Revision {revision.revisionNumber}</strong><small>{new Date(revision.createdAt).toLocaleString()} · {revision.templateVersion} · {revision.instructionsHash.slice(0, 12)}</small></div>{revision.id === active.id ? <span className="status-pill live">Active</span> : <button className="secondary-button compact" disabled={pending} onClick={() => void update("activate", revision.id)} type="button">Make active</button>}</article>)}</div></details>
  </section>;
}
