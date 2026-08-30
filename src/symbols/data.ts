import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import {
  analyses,
  chartArtifacts,
  modelRuns,
  notificationEvents,
  outcomes,
  scanSlots,
  theses,
} from "@/db/schema";
import { createMarketDataProvider } from "@/market-data/factory";

export async function getSymbolDetail(symbol: string, analysisId?: string) {
  await requireAuthorizedUser();
  const database = await getDatabase();
  const [latestSlot] = await database
    .select()
    .from(scanSlots)
    .where(eq(scanSlots.symbol, symbol))
    .orderBy(desc(scanSlots.scheduledFor))
    .limit(1);
  const rows = await database
    .select({
      slot: scanSlots,
      run: modelRuns,
      analysis: analyses,
      artifact: chartArtifacts,
    })
    .from(scanSlots)
    .innerJoin(modelRuns, eq(modelRuns.scanSlotId, scanSlots.id))
    .innerJoin(analyses, eq(analyses.modelRunId, modelRuns.id))
    .leftJoin(chartArtifacts, eq(chartArtifacts.id, modelRuns.chartArtifactId))
    .where(
      and(
        eq(scanSlots.symbol, symbol),
        inArray(modelRuns.runRole, ["primary", "fallback"]),
      ),
    )
    .orderBy(desc(scanSlots.scheduledFor))
    .limit(30);
  const exactSelection = analysisId ? rows.find((row) => row.analysis.id === analysisId) : undefined;
  const selected = analysisId ? exactSelection : rows[0];
  const history = await Promise.all(
    rows.map(async (row) => {
      const [thesis] = await database
        .select()
        .from(theses)
        .where(eq(theses.analysisId, row.analysis.id))
        .limit(1);
      const [outcome] = thesis
        ? await database.select().from(outcomes).where(eq(outcomes.thesisId, thesis.id)).limit(1)
        : [];
      return { ...row, thesis: thesis ?? null, outcome: outcome ?? null };
    }),
  );
  const selectedHistory = history.find((row) => row.analysis.id === selected?.analysis.id) ?? null;
  const [alertEvent] = selectedHistory?.thesis
    ? await database
        .select()
        .from(notificationEvents)
        .where(eq(notificationEvents.thesisId, selectedHistory.thesis.id))
        .orderBy(desc(notificationEvents.createdAt))
        .limit(1)
    : [];
  const [previousThesis] = selectedHistory?.thesis?.supersedesThesisId
    ? await database
        .select()
        .from(theses)
        .where(eq(theses.id, selectedHistory.thesis.supersedesThesisId))
        .limit(1)
    : [];
  const now = new Date();
  let marketOpen = false;
  try {
    const session = await createMarketDataProvider().getSession(now);
    marketOpen =
      session.isRegularSession && now >= session.opensAt && now <= session.closesAt;
  } catch {
    // Analysis remains available even when the calendar provider is temporarily unavailable.
  }
  return {
    latest: selectedHistory,
    latestAnalysisId: rows[0]?.analysis.id ?? null,
    latestSlot: latestSlot ?? null,
    requestedAnalysisMissing: Boolean(analysisId && !exactSelection),
    alertEvent: alertEvent ?? null,
    previousThesis: previousThesis ?? null,
    marketOpen,
    now,
    history,
  };
}
