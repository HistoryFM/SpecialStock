import type { Metadata } from "next";

import { SwingTradeWorkbench } from "@/app/(protected)/swing-trade/workbench";
import { SwingScheduler } from "@/app/(protected)/swing-scheduler";
import { getServerEnv } from "@/config/env";
import { createMarketDataProvider } from "@/market-data/factory";
import { getSwingConfiguration, getSwingPromptStudioState } from "@/swing/repository";
import { swingScheduledFor } from "@/swing/schedule";
import { getSwingRun, listSwingRuns } from "@/swing/service";

export const metadata: Metadata = { title: "Swing Trade" };

type SwingSection = "today" | "lists" | "history" | "advanced";

export default async function SwingTradePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string | string[]; section?: string | string[] }>;
}) {
  const now = new Date();
  const query = await searchParams;
  const [usConfiguration, indiaConfiguration, prompt, runs, session] = await Promise.all([
    getSwingConfiguration("US"), getSwingConfiguration("INDIA"), getSwingPromptStudioState(), listSwingRuns(), createMarketDataProvider().getSession(now),
  ]);
  const preferredRun = runs.find((run) => run.status === "running" || run.status === "scheduled")
    ?? runs.find((run) => run.status === "completed" || run.status === "partial")
    ?? runs[0];
  const latest = preferredRun ? await getSwingRun(preferredRun.id) : null;
  const env = getServerEnv();
  const requestedMarket = Array.isArray(query.market) ? query.market[0] : query.market;
  const requestedSection = Array.isArray(query.section) ? query.section[0] : query.section;
  const initialMarket = requestedMarket === "INDIA" || requestedMarket === "US"
    ? requestedMarket
    : latest?.market ?? "US";
  const initialSection: SwingSection = requestedSection === "lists" || requestedSection === "history" || requestedSection === "advanced"
    ? requestedSection
    : "today";
  return <main className="page-shell swing-shell" data-sentry-mask>
    <SwingScheduler />
    <SwingTradeWorkbench initialMarket={initialMarket} initialSection={initialSection} initial={{
      configurations: { US: usConfiguration, INDIA: indiaConfiguration },
      prompt,
      runs,
      latest,
      availability: { chartImg: Boolean(env.CHART_IMG_API_KEY), openRouter: Boolean(env.OPENROUTER_API_KEY) },
      schedule: { nextEligibleAt: swingScheduledFor(session)?.toISOString() ?? null, sessionDate: session.date, regularSession: session.isRegularSession },
    }} />
  </main>;
}
