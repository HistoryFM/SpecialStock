import type { Metadata } from "next";

import { GexWorkbench } from "@/app/(protected)/gex/workbench";
import { getAvailableGexDatasetCategories, getGexState, getGexUsageSummary, getLatestGexDataset, getRecentGexDatasetSummaries } from "@/gex/repository";

export const metadata: Metadata = { title: "GEX Analysis" };

export default async function GexPage() {
  const [initial, initialLiveCategories, initialUsage, initialDatasets, latestDaily] = await Promise.all([getGexState(), getAvailableGexDatasetCategories(), getGexUsageSummary(), getRecentGexDatasetSummaries(), getLatestGexDataset("daily")]);
  return <main className="page-shell gex-shell" data-sentry-mask><GexWorkbench initial={initial} initialLiveCategories={initialLiveCategories} initialUsage={initialUsage} initialDatasets={initialDatasets} initialDaily={latestDaily ? { id: latestDaily.id, rows: latestDaily.rows, runAt: latestDaily.runAt.toISOString() } : null} /></main>;
}
