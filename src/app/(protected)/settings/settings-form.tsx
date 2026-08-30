"use client";

import { useActionState, useState } from "react";

import { saveSettingsAction } from "@/app/(protected)/settings/actions";
import { MODEL_CATALOG, type ModelId } from "@/models/catalog";
import type { ModelAvailabilityStatus } from "@/models/provider";
import type { AppSettings } from "@/settings/types";
import { WATCHLIST_EXCHANGES } from "@/settings/types";

type ModelStatusView = {
  id: ModelId;
  status: ModelAvailabilityStatus;
  reason: string;
};

type SettingsFormProps = {
  settings: AppSettings;
  modelStatuses: ModelStatusView[];
  persistenceAvailable: boolean;
};

const statusLabels: Record<ModelAvailabilityStatus, string> = {
  available: "Available",
  incompatible: "No image input",
  unavailable: "Unavailable",
  unknown: "Status unknown",
};

export function SettingsForm({
  settings,
  modelStatuses,
  persistenceAvailable,
}: SettingsFormProps) {
  const [state, action, isPending] = useActionState(saveSettingsAction, {
    status: "idle" as const,
    message: "",
  });
  const [notificationStatus, setNotificationStatus] = useState("Unavailable");
  const watchlistFields = Array.from(
    { length: 5 },
    (_, index) => settings.watchlist[index] ?? {
      symbol: "",
      exchange: "NASDAQ" as const,
      automaticScanEnabled: false,
    },
  );

  return (
    <form action={action} className="settings-stack">
      <section className="settings-card" aria-labelledby="watchlist-heading">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Universe</p>
            <h2 id="watchlist-heading">Watchlist</h2>
          </div>
          <span className="status-pill neutral">Maximum 5</span>
        </div>
        <p className="muted">
          Use one to five unique US stock symbols. Empty rows are ignored.
        </p>
        <div className="ticker-grid">
          {watchlistFields.map((entry, index) => (
            <div className="watchlist-entry" key={index}>
              <label>
                <span>Symbol {index + 1}</span>
                <input
                  aria-label={`Watchlist symbol ${index + 1}`}
                  defaultValue={entry.symbol}
                  maxLength={10}
                  name="watchlist"
                  placeholder="Ticker"
                  spellCheck={false}
                />
              </label>
              <label>
                <span>Exchange</span>
                <select defaultValue={entry.exchange} name="exchange">
                  {WATCHLIST_EXCHANGES.map((exchange) => <option key={exchange}>{exchange}</option>)}
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card" aria-labelledby="model-heading">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">OpenRouter</p>
            <h2 id="model-heading">Active analysis model</h2>
          </div>
          <span className="status-pill live">Server validated</span>
        </div>
        <p className="muted">
          Gemini 2.5 Pro is the exclusive model. Previous results retain their exact
          requested and returned metadata.
        </p>
        <div className="model-options">
          {MODEL_CATALOG.map((model) => {
            const modelStatus = modelStatuses.find((status) => status.id === model.id);
            const status = modelStatus?.status ?? "unknown";
            const disabled = status !== "available" && model.id !== settings.activeModel;

            return (
              <label className={`model-option ${disabled ? "disabled" : ""}`} key={model.id}>
                <input checked disabled readOnly type="radio" />
                <span className="model-copy">
                  <span className="model-title-row">
                    <strong>{model.displayName}</strong>
                    <span className={`catalog-status ${status}`}>{statusLabels[status]}</span>
                  </span>
                  <code>{model.id}</code>
                  <span>{model.intendedRole}</span>
                  <small>{modelStatus?.reason ?? "Catalog status was not returned."}</small>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="settings-card" aria-labelledby="comparison-heading">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Analysis controls</p>
            <h2 id="comparison-heading">Notifications and budget</h2>
          </div>
          <span className="status-pill neutral">Future scans only</span>
        </div>
        <div className="control-grid">
          <label>
            <span>Daily AI cap (USD)</span>
            <input defaultValue={settings.dailyBudgetUsd} max="100" min="1" name="dailyBudgetUsd" step="1" type="number" />
          </label>
        </div>
        <div className="toggle-list">
          <label className="toggle-row">
            <input defaultChecked={settings.notificationsEnabled} name="notificationsEnabled" type="checkbox" />
            <span><strong>Browser alert events</strong><small>Still subject to validity, freshness, conviction, bake-off, and cooldown gates.</small></span>
          </label>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Automatic scanning</p>
            <h2>Managed from the watchlist</h2>
          </div>
          <span className="status-pill neutral">
            {settings.watchlist.filter((entry) => entry.automaticScanEnabled).length} enabled
          </span>
        </div>
        <p className="muted">
          Select one or more stocks on the Watchlist and use Enable auto or Disable auto.
          Manual analysis remains available for every stock.
        </p>
      </section>

      <section className="settings-card" aria-labelledby="notifications-heading">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">This browser</p>
            <h2 id="notifications-heading">Notification permission</h2>
          </div>
          <span className="status-pill neutral">{notificationStatus}</span>
        </div>
        <p className="muted">Permission is controlled by this browser and is never requested automatically.</p>
        <button
          className="secondary-button"
          onClick={async () => {
            if (typeof Notification === "undefined") return;
            const permission = await Notification.requestPermission();
            setNotificationStatus(permission);
            if (permission === "granted") {
              new Notification("SpecialStock test", { body: "Browser notifications are ready." });
            }
          }}
          type="button"
        >
          Request permission and test
        </button>
      </section>

      <div className="save-bar">
        <div aria-live="polite">
          {state.message ? (
            <p className={state.status === "error" ? "form-error" : "form-success"}>
              {state.message}
            </p>
          ) : (
            <p className="muted">Changes are validated again on the server.</p>
          )}
        </div>
        <button
          className="primary-button"
          disabled={!persistenceAvailable || isPending}
          type="submit"
        >
          {isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
