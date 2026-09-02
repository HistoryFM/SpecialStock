import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getBudgetSummary } from "@/analysis/budget";
import { requireAuthorizedUser } from "@/auth/require-user";
import { isDemoMode } from "@/config/env";
import { checkDatabaseHealth, getDatabase } from "@/db/client";
import { analyses, appSettings, chartArtifacts, modelRuns, scanSlots } from "@/db/schema";
import { getModelDefinition } from "@/models/catalog";

export type SymbolDashboardItem = {
  symbol: string;
  exchange: string;
  automaticScanEnabled: boolean;
  slotId: string | null;
  analysisId: string | null;
  artifactId: string | null;
  status: string;
  slotKind: string | null;
  scannedAt: string | null;
  attemptStartedAt: string | null;
  attemptCompletedAt: string | null;
  attemptIsRunning: boolean;
  resultCompletedAt: string | null;
  sourceAt: string | null;
  freshnessSeconds: number | null;
  source: string;
  latestPrice: number | null;
  verdict: "bullish" | "bearish" | "no_trade" | null;
  conviction: "low" | "medium" | "high" | null;
  visualQuality?: "clear" | "partial" | "unreadable" | null;
  summary?: string | null;
  target: number | null;
  invalidation: number | null;
  model: string;
  latencyMs: number | null;
  costUsd: number | null;
  error: string | null;
  resultIsCurrent: boolean;
};

export async function getDashboardData() {
  await requireAuthorizedUser();
  const database = await getDatabase();
  await database.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!settings) throw new Error("Settings are unavailable.");

  const items: SymbolDashboardItem[] = [];
  const now = new Date();
  for (const entry of settings.watchlist) {
    const symbol = entry.symbol;
    const [slot] = await database
      .select()
      .from(scanSlots)
      .where(eq(scanSlots.symbol, symbol))
      .orderBy(desc(scanSlots.scheduledFor))
      .limit(1);
    if (!slot) {
      items.push({
        symbol,
        exchange: entry.exchange,
        automaticScanEnabled: entry.automaticScanEnabled,
        slotId: null,
        analysisId: null,
        artifactId: null,
        status: "awaiting_scan",
        slotKind: null,
        scannedAt: null,
        attemptStartedAt: null,
        attemptCompletedAt: null,
        attemptIsRunning: false,
        resultCompletedAt: null,
        sourceAt: null,
        freshnessSeconds: null,
        source: isDemoMode() ? "Analysis providers not configured" : "Chart-Img / TradingView",
        latestPrice: null,
        verdict: null,
        conviction: null,
        visualQuality: null,
        target: null,
        invalidation: null,
        model: getModelDefinition(settings.activeModel).displayName,
        latencyMs: null,
        costUsd: null,
        error: null,
        resultIsCurrent: false,
      });
      continue;
    }
    const [joined] = await database
      .select({
        run: modelRuns,
        analysis: analyses,
        artifact: chartArtifacts,
        resultSlot: scanSlots,
      })
      .from(modelRuns)
      .innerJoin(analyses, eq(analyses.modelRunId, modelRuns.id))
      .innerJoin(scanSlots, eq(scanSlots.id, modelRuns.scanSlotId))
      .leftJoin(chartArtifacts, eq(chartArtifacts.id, modelRuns.chartArtifactId))
      .where(
        and(
          eq(scanSlots.symbol, symbol),
          inArray(modelRuns.runRole, ["primary", "fallback"]),
          eq(modelRuns.status, "valid"),
        ),
      )
      .orderBy(desc(scanSlots.scheduledFor), desc(modelRuns.completedAt))
      .limit(1);
    items.push({
      symbol,
      exchange: entry.exchange,
      automaticScanEnabled: entry.automaticScanEnabled,
      slotId: slot.id,
      analysisId: joined?.analysis.id ?? null,
      artifactId: joined?.artifact?.id ?? null,
      status: slot.status,
      slotKind: slot.slotKind,
      scannedAt: slot.completedAt?.toISOString() ?? slot.startedAt?.toISOString() ?? null,
      attemptStartedAt: slot.startedAt?.toISOString() ?? null,
      attemptCompletedAt: slot.completedAt?.toISOString() ?? null,
      attemptIsRunning: Boolean(
        slot.status === "running" && slot.leaseExpiresAt && slot.leaseExpiresAt > now
      ),
      resultCompletedAt: joined?.run.completedAt?.toISOString() ?? null,
      sourceAt: joined?.resultSlot.latestSourceAt?.toISOString() ?? null,
      freshnessSeconds: joined?.resultSlot.latestSourceAt
        ? Math.max(0, Math.floor((now.getTime() - joined.resultSlot.latestSourceAt.getTime()) / 1_000))
        : null,
      source: slot.provider === "chart-img" ? "Chart-Img / TradingView" : slot.provider,
      latestPrice: joined?.analysis.observedPrice ? Number(joined.analysis.observedPrice) : null,
      verdict: joined?.analysis.verdict ?? null,
      conviction: joined?.analysis.conviction ?? null,
      visualQuality: joined?.analysis.visualQuality ?? null,
      target: joined?.analysis.primaryTarget ? Number(joined.analysis.primaryTarget) : null,
      invalidation: joined?.analysis.invalidationLevel
        ? Number(joined.analysis.invalidationLevel)
        : null,
      model: joined?.run.actualModel ?? getModelDefinition(settings.activeModel).displayName,
      latencyMs: joined?.run.latencyMs ?? null,
      costUsd: joined?.run.costUsd ? Number(joined.run.costUsd) : null,
      error: slot.errorCode,
      resultIsCurrent: joined?.resultSlot.id === slot.id,
    });
  }
  return {
    items,
    settings,
    budget: await getBudgetSummary(),
    database: await checkDatabaseHealth(),
    demoMode: isDemoMode(),
  };
}
