import type { Metadata } from "next";

import { GexWorkbench } from "@/app/(protected)/gex/workbench";
import { getAvailableGexDatasetCategories, getGexState, getGexUsageSummary } from "@/gex/repository";

export const metadata: Metadata = { title: "GEX Analysis" };

export default async function GexPage() {
  const [initial, initialLiveCategories, initialUsage] = await Promise.all([getGexState(), getAvailableGexDatasetCategories(), getGexUsageSummary()]);
  return <main className="page-shell gex-shell" data-sentry-mask><GexWorkbench initial={initial} initialLiveCategories={initialLiveCategories} initialUsage={initialUsage} /></main>;
}
