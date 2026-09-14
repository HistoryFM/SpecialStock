import "server-only";

import { eq, inArray } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { appSettings, manualScanGroups, scanSlots } from "@/db/schema";
import type { ManualScanTimeframe } from "@/analysis/types";

export type ScanProgressItem = {
  symbol: string;
  timeframe: ManualScanTimeframe;
  status: "pending" | "running" | "completed" | "failed";
};

function progressStatus(status: string | undefined): ScanProgressItem["status"] {
  if (status === "running" || status === "completed") return status;
  if (status === "failed" || status === "skipped") return "failed";
  return "pending";
}

export async function getManualBatchProgress(requestId: string): Promise<ScanProgressItem[]> {
  const database = await getDatabase();
  const groups = await database.select().from(manualScanGroups).where(eq(manualScanGroups.requestId, requestId));
  if (!groups.length) return [];
  const slots = await database.select({
    manualScanGroupId: scanSlots.manualScanGroupId,
    scanInterval: scanSlots.scanInterval,
    status: scanSlots.status,
  }).from(scanSlots).where(inArray(scanSlots.manualScanGroupId, groups.map((group) => group.id)));
  return groups.flatMap((group) => group.requestedIntervals.map((timeframe) => ({
    symbol: group.symbol,
    timeframe,
    status: progressStatus(slots.find((slot) =>
      slot.manualScanGroupId === group.id && slot.scanInterval === timeframe)?.status),
  })));
}

export async function getScheduledBatchProgress(slotKey: string): Promise<ScanProgressItem[]> {
  const database = await getDatabase();
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  const symbols = settings?.watchlist.map((entry) => entry.symbol) ?? [];
  if (!symbols.length) return [];
  const slots = await database.select({
    symbol: scanSlots.symbol,
    status: scanSlots.status,
  }).from(scanSlots).where(inArray(scanSlots.idempotencyKey, symbols.map((symbol) => `${symbol}:${slotKey}`)));
  return symbols.map((symbol) => ({
    symbol,
    timeframe: "5m" as const,
    status: progressStatus(slots.find((slot) => slot.symbol === symbol)?.status),
  }));
}
