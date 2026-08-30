import "server-only";

import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import {
  analyses,
  chartArtifacts,
  modelRuns,
  notificationEvents,
  outcomes,
  reviewLabels,
  scanSlots,
  theses,
} from "@/db/schema";
import { createMarketDataProvider } from "@/market-data/factory";
import { marketDayBounds } from "@/market-data/time";

type SymbolAnalysisRow = {
  slot: typeof scanSlots.$inferSelect;
  run: typeof modelRuns.$inferSelect;
  analysis: typeof analyses.$inferSelect;
  artifact: typeof chartArtifacts.$inferSelect | null;
};

async function enrichAnalysisRow(
  database: Awaited<ReturnType<typeof getDatabase>>,
  row: SymbolAnalysisRow,
) {
  const [thesis] = await database
    .select()
    .from(theses)
    .where(eq(theses.analysisId, row.analysis.id))
    .limit(1);
  const [outcome] = thesis
    ? await database.select().from(outcomes).where(eq(outcomes.thesisId, thesis.id)).limit(1)
    : [];
  const reviews = await database
    .select()
    .from(reviewLabels)
    .where(eq(reviewLabels.analysisId, row.analysis.id))
    .orderBy(desc(reviewLabels.createdAt));
  return {
    ...row,
    thesis: thesis ?? null,
    outcome: outcome ?? null,
    latestReview: reviews[0] ?? null,
    reviews,
  };
}

export async function getSymbolDetail(
  symbol: string,
  options: { analysisId?: string; marketDate: string },
) {
  await requireAuthorizedUser();
  const database = await getDatabase();
  const { analysisId, marketDate } = options;
  const dayBounds = marketDayBounds(marketDate);
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
  let selected = analysisId ? rows.find((row) => row.analysis.id === analysisId) : rows[0];
  if (analysisId && !selected) {
    [selected] = await database
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
          eq(analyses.id, analysisId),
          inArray(modelRuns.runRole, ["primary", "fallback"]),
        ),
      )
      .limit(1);
  }
  const history = await Promise.all(rows.map((row) => enrichAnalysisRow(database, row)));
  const selectedHistory = selected
    ? history.find((row) => row.analysis.id === selected.analysis.id)
      ?? await enrichAnalysisRow(database, selected)
    : null;
  const dailyRows = await database
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
        eq(modelRuns.status, "valid"),
        eq(analyses.conviction, "high"),
        inArray(analyses.verdict, ["bullish", "bearish"]),
        gte(scanSlots.scheduledFor, dayBounds.start),
        lt(scanSlots.scheduledFor, dayBounds.end),
      ),
    )
    .orderBy(desc(scanSlots.scheduledFor), desc(modelRuns.completedAt));
  const dailyHighConviction = await Promise.all(
    dailyRows.map((row) => enrichAnalysisRow(database, row)),
  );
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
    requestedAnalysisMissing: Boolean(analysisId && !selected),
    alertEvent: alertEvent ?? null,
    previousThesis: previousThesis ?? null,
    marketOpen,
    now,
    history,
    dailyHighConviction,
    selectedMarketDate: marketDate,
  };
}
