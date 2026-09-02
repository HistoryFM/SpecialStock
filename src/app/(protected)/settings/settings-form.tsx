"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { saveSettingsAction } from "@/app/(protected)/settings/actions";
import type { ModelId } from "@/models/catalog";
import type { ModelAvailabilityStatus } from "@/models/provider";
import type { AppSettings, WatchlistEntry } from "@/settings/types";
import { WATCHLIST_EXCHANGES } from "@/settings/types";

type ModelStatusView = { id: ModelId; status: ModelAvailabilityStatus; reason: string };
type EditableRow = WatchlistEntry & { key: string };
type EditableState = { rows: EditableRow[]; dailyBudgetUsd: number; notificationsEnabled: boolean };

function editable(settings: AppSettings): EditableState {
  return {
    rows: settings.watchlist.map((entry) => ({ ...entry, key: crypto.randomUUID() })),
    dailyBudgetUsd: settings.dailyBudgetUsd,
    notificationsEnabled: settings.notificationsEnabled,
  };
}

function comparable(value: EditableState) {
  return JSON.stringify({
    rows: value.rows.map((row) => ({
      symbol: row.symbol,
      exchange: row.exchange,
      automaticScanEnabled: row.automaticScanEnabled,
    })),
    dailyBudgetUsd: value.dailyBudgetUsd,
    notificationsEnabled: value.notificationsEnabled,
  });
}

export function SettingsForm({ settings, modelStatuses, persistenceAvailable }: {
  settings: AppSettings;
  modelStatuses: ModelStatusView[];
  persistenceAvailable: boolean;
}) {
  const initial = useMemo(() => editable(settings), [settings]);
  const [initialFingerprint] = useState(() => comparable(initial));
  const [value, setValue] = useState(initial);
  const [state, action, isPending] = useActionState(saveSettingsAction, { status: "idle" as const, message: "" });
  const baseline = state.fingerprint ?? initialFingerprint;
  const dirty = comparable(value) !== baseline;
  const version = state.updatedAt ?? settings.updatedAt.toISOString();
  const symbols = value.rows.map((row) => row.symbol.trim().toUpperCase());
  const duplicate = symbols.find((symbol, index) => symbol && symbols.indexOf(symbol) !== index);
  const invalid = value.rows.find((row) => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(row.symbol));
  const clientError = value.rows.length < 1 || value.rows.length > 20
    ? "Use between 1 and 20 stocks."
    : duplicate ? `${duplicate} appears more than once.`
      : invalid ? "Every row needs a valid US stock symbol." : null;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (!dirty) return;
      const anchor = (event.target as HTMLElement).closest("a");
      if (anchor?.href && !window.confirm("Discard unsaved Settings changes?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);

  function updateRow(key: string, update: Partial<WatchlistEntry>) {
    setValue((current) => ({ ...current, rows: current.rows.map((row) => row.key === key ? { ...row, ...update } : row) }));
  }

  function reset() {
    const parsed = JSON.parse(baseline) as {
      rows: WatchlistEntry[];
      dailyBudgetUsd: number;
      notificationsEnabled: boolean;
    };
    setValue({
      rows: parsed.rows.map((row) => ({ ...row, key: crypto.randomUUID() })),
      dailyBudgetUsd: parsed.dailyBudgetUsd,
      notificationsEnabled: parsed.notificationsEnabled,
    });
  }

  return (
    <form action={action} className="settings-stack" onSubmit={(event) => {
      if (clientError) event.preventDefault();
    }}>
      <input name="updatedAt" type="hidden" value={version} />
      <section className="settings-card" aria-labelledby="watchlist-heading">
        <div className="settings-card-heading">
          <div><p className="eyebrow">Universe</p><h2 id="watchlist-heading">Watchlist</h2></div>
          <span className="status-pill neutral">{value.rows.length} / 20</span>
        </div>
        <p className="muted">Edit one to 20 unique stocks. Automatic scanning stays attached to each symbol.</p>
        <div className="ticker-grid">
          {value.rows.map((row, index) => (
            <div className="watchlist-entry" key={row.key}>
              <label><span>Symbol {index + 1}</span><input aria-label={`Watchlist symbol ${index + 1}`} maxLength={10} name="watchlist" onChange={(event) => updateRow(row.key, { symbol: event.target.value.toUpperCase() })} spellCheck={false} value={row.symbol} /></label>
              <label><span>Exchange</span><select name="exchange" onChange={(event) => updateRow(row.key, { exchange: event.target.value as WatchlistEntry["exchange"] })} value={row.exchange}>{WATCHLIST_EXCHANGES.map((exchange) => <option key={exchange}>{exchange}</option>)}</select></label>
              <div className="watchlist-auto-field">
                <span>Auto scan</span>
                <button
                  aria-checked={row.automaticScanEnabled}
                  aria-label={`Automatic scanning for ${row.symbol || `stock ${index + 1}`}`}
                  className="watchlist-auto-switch"
                  onClick={() => updateRow(row.key, { automaticScanEnabled: !row.automaticScanEnabled })}
                  role="switch"
                  type="button"
                >
                  <span aria-hidden="true" className="switch-track"><span className="switch-thumb" /></span>
                  <strong>{row.automaticScanEnabled ? "On" : "Off"}</strong>
                </button>
              </div>
              <input name="automaticScanEnabled" type="hidden" value={String(row.automaticScanEnabled)} />
              <button aria-label={`Remove ${row.symbol || `row ${index + 1}`}`} className="secondary-button compact" disabled={value.rows.length === 1} onClick={() => setValue((current) => ({ ...current, rows: current.rows.filter((candidate) => candidate.key !== row.key) }))} type="button">Remove</button>
            </div>
          ))}
        </div>
        <button className="secondary-button" disabled={value.rows.length >= 20} onClick={() => setValue((current) => ({ ...current, rows: [...current.rows, { key: crypto.randomUUID(), symbol: "", exchange: "NASDAQ", automaticScanEnabled: false }] }))} type="button">Add stock</button>
        {clientError ? <p className="form-error" role="alert">{clientError}</p> : null}
      </section>

      <section className="settings-card" aria-labelledby="model-heading">
        <div className="settings-card-heading"><div><p className="eyebrow">OpenRouter</p><h2 id="model-heading">Analysis model</h2></div><span className="status-pill live">Gemini 2.5 Pro only</span></div>
        <p className="muted">Routine scans create compact signals. Eligible details generate a separate full analysis from the same stored chart.</p>
        {modelStatuses.map((model) => <div className="model-option" key={model.id}><span className="model-copy"><strong>{model.id}</strong><small>{model.reason}</small></span></div>)}
      </section>

      <section className="settings-card">
        <div className="settings-card-heading"><div><p className="eyebrow">Controls</p><h2>Notifications and budget</h2></div><span className="status-pill neutral">Informational target</span></div>
        <div className="control-grid"><label><span>Daily AI spend target (USD)</span><input max="100" min="1" name="dailyBudgetUsd" onChange={(event) => setValue((current) => ({ ...current, dailyBudgetUsd: Number(event.target.value) }))} step="1" type="number" value={value.dailyBudgetUsd} /></label></div>
        <label className="toggle-row"><input checked={value.notificationsEnabled} name="notificationsEnabled" onChange={(event) => setValue((current) => ({ ...current, notificationsEnabled: event.target.checked }))} type="checkbox" /><span><strong>Browser alert events</strong><small>Alerts still require an eligible automatic compact signal.</small></span></label>
      </section>

      <div className="save-bar">
        <div aria-live="polite">{state.message ? <p className={state.status === "error" ? "form-error" : "form-success"}>{state.message}</p> : <p className="muted">{dirty ? "Unsaved changes" : "Settings are up to date"}</p>}</div>
        <div><button className="secondary-button" disabled={!dirty || isPending} onClick={reset} type="button">Reset</button> <button className="primary-button" disabled={!persistenceAvailable || isPending || !dirty || Boolean(clientError)} type="submit">{isPending ? "Saving…" : "Save settings"}</button></div>
      </div>
    </form>
  );
}
