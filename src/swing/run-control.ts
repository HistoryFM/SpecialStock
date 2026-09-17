import "server-only";

const HEARTBEAT_GRACE_MS = 65_000;

type ControlledRun = { controller: AbortController; timer: ReturnType<typeof setTimeout> };
const globalRuns = globalThis as typeof globalThis & { specialStockSwingRuns?: Map<string, ControlledRun> };
const runs = globalRuns.specialStockSwingRuns ??= new Map<string, ControlledRun>();

function arm(runId: string, controlled: ControlledRun) {
  clearTimeout(controlled.timer);
  controlled.timer = setTimeout(() => {
    controlled.controller.abort(new DOMException("heartbeat_expired", "AbortError"));
  }, HEARTBEAT_GRACE_MS);
}

export function registerSwingRun(runId: string) {
  const existing = runs.get(runId);
  if (existing && !existing.controller.signal.aborted) return existing.controller;
  const controlled: ControlledRun = { controller: new AbortController(), timer: setTimeout(() => undefined, HEARTBEAT_GRACE_MS) };
  runs.set(runId, controlled);
  arm(runId, controlled);
  return controlled.controller;
}

export function heartbeatSwingRun(runId: string) {
  const controlled = runs.get(runId);
  if (!controlled || controlled.controller.signal.aborted) return false;
  arm(runId, controlled);
  return true;
}

export function abortSwingRun(runId: string, reason: "user" | "tab_closed" | "heartbeat_expired" | "server_restart") {
  const controlled = runs.get(runId);
  if (!controlled || controlled.controller.signal.aborted) return false;
  clearTimeout(controlled.timer);
  controlled.controller.abort(new DOMException(reason, "AbortError"));
  return true;
}

export function releaseSwingRun(runId: string) {
  const controlled = runs.get(runId);
  if (!controlled) return;
  clearTimeout(controlled.timer);
  runs.delete(runId);
}

export function swingAbortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "canceled");
}
