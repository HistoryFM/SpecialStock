import type { Metadata } from "next";

import { SettingsForm } from "@/app/(protected)/settings/settings-form";
import { isDemoMode } from "@/config/env";
import { OpenRouterModelCatalogProvider } from "@/models/openrouter-catalog";
import { DrizzleSettingsRepository } from "@/settings/repository";
import { getSettingsSnapshot } from "@/settings/service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [snapshot, modelStatuses] = await Promise.all([
    getSettingsSnapshot(new DrizzleSettingsRepository()),
    new OpenRouterModelCatalogProvider().getAvailability(),
  ]);
  const demoMode = isDemoMode();

  return (
    <main className="page-shell narrow">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Workspace controls</p>
          <h1>Settings</h1>
          <p className="muted">
            Configure exchange-aware symbols, manual-first automation, and analysis budget.
          </p>
        </div>
        <span
          className={`status-pill ${
            snapshot.persistence === "connected" ? "live" : "warning"
          }`}
        >
          Database {snapshot.persistence}
        </span>
      </section>

      {snapshot.error ? (
        <div className="warning-banner" role="status">
          <strong>Persistence unavailable</strong>
          <span>{snapshot.error}</span>
        </div>
      ) : null}

      <SettingsForm
        modelStatuses={modelStatuses.map(({ id, status, reason }) => ({
          id,
          status,
          reason,
        }))}
        persistenceAvailable={snapshot.persistence === "connected"}
        settings={snapshot.settings}
      />

      <section className="settings-card provider-card">
        <div>
          <p className="eyebrow">Visual analysis pipeline</p>
          <h2>Chart-Img + Gemini 2.5 Pro</h2>
          <p className="muted">
            {demoMode
              ? "Add rotated Chart-Img and OpenRouter keys to .env.local before running a manual scan."
              : "Chart capture and Gemini credentials remain server-side. Alpaca is optional for live calendar and outcome data."}
          </p>
        </div>
        <span className={`status-pill ${demoMode ? "warning" : "live"}`}>
          {demoMode ? "Not configured" : "Configured"}
        </span>
      </section>
    </main>
  );
}
