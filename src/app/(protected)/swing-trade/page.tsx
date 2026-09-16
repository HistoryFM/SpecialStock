import type { Metadata } from "next";

import { SwingTradeWorkbench } from "@/app/(protected)/swing-trade/workbench";
import { getServerEnv } from "@/config/env";
import { createMarketDataProvider } from "@/market-data/factory";
import { getSwingConfiguration, getSwingPromptStudioState } from "@/swing/repository";
import { swingScheduledFor } from "@/swing/schedule";
import { getSwingRun, listSwingRuns } from "@/swing/service";

export const metadata: Metadata = { title: "Swing Trade" };

export default async function SwingTradePage() {
  const now = new Date();
  const [configuration, prompt, runs, session] = await Promise.all([
    getSwingConfiguration(), getSwingPromptStudioState(), listSwingRuns(), createMarketDataProvider().getSession(now),
  ]);
  const preferredRun = runs.find((run) => run.status === "running" || run.status === "scheduled")
    ?? runs.find((run) => run.status === "completed" || run.status === "partial")
    ?? runs[0];
  const latest = preferredRun ? await getSwingRun(preferredRun.id) : null;
  const env = getServerEnv();
  return <main className="page-shell swing-shell" data-sentry-mask>
    <section className="page-heading">
      <div><p className="eyebrow">Daily visual analysis</p><h1>Swing Trade</h1><p className="muted">Ranked 3–21 day candidates from frozen daily charts. All levels are visually interpreted—not broker quotes.</p></div>
      <span className={`status-pill ${env.CHART_IMG_API_KEY && env.OPENROUTER_API_KEY ? "live" : "warning"}`}>{env.CHART_IMG_API_KEY && env.OPENROUTER_API_KEY ? "Providers configured" : "Providers unavailable"}</span>
    </section>
    <SwingTradeWorkbench initial={{
      configuration,
      prompt,
      runs,
      latest,
      availability: { chartImg: Boolean(env.CHART_IMG_API_KEY), openRouter: Boolean(env.OPENROUTER_API_KEY) },
      schedule: { nextEligibleAt: swingScheduledFor(session)?.toISOString() ?? null, sessionDate: session.date, regularSession: session.isRegularSession },
    }} />
  </main>;
}
