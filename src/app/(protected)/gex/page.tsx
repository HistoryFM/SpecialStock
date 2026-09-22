import type { Metadata } from "next";

import { GexWorkbench } from "@/app/(protected)/gex/workbench";
import { getGexState } from "@/gex/repository";

export const metadata: Metadata = { title: "GEX Analysis" };

export default async function GexPage() {
  return <main className="page-shell gex-shell" data-sentry-mask><GexWorkbench initial={await getGexState()} /></main>;
}
