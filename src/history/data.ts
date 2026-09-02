import "server-only";

import { and, desc, eq, lt, or } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { analyses, modelRuns, scanSlots } from "@/db/schema";

const PAGE_SIZE = 50;

type Cursor = { scheduledFor: string; analysisId: string };

export function encodeSignalCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeSignalCursor(value: string): Cursor {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
  if (!parsed.analysisId || !Number.isFinite(Date.parse(parsed.scheduledFor))) throw new Error("Invalid cursor");
  return parsed;
}

export async function getEligibleSignalHistory(cursorValue?: string) {
  const database = await getDatabase();
  const cursor = cursorValue ? decodeSignalCursor(cursorValue) : null;
  const rows = await database.select({ slot: scanSlots, run: modelRuns, analysis: analyses })
    .from(analyses)
    .innerJoin(modelRuns, eq(modelRuns.id, analyses.modelRunId))
    .innerJoin(scanSlots, eq(scanSlots.id, modelRuns.scanSlotId))
    .where(and(
      eq(modelRuns.phase, "compact"),
      or(eq(analyses.conviction, "medium"), eq(analyses.conviction, "high")),
      or(eq(analyses.verdict, "bullish"), eq(analyses.verdict, "bearish")),
      cursor ? or(
        lt(scanSlots.scheduledFor, new Date(cursor.scheduledFor)),
        and(eq(scanSlots.scheduledFor, new Date(cursor.scheduledFor)), lt(analyses.id, cursor.analysisId)),
      ) : undefined,
    ))
    .orderBy(desc(scanSlots.scheduledFor), desc(analyses.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map(({ slot, analysis }) => ({
      analysisId: analysis.id,
      scheduledFor: slot.scheduledFor.toISOString(),
      symbol: slot.symbol,
      verdict: analysis.verdict,
      conviction: analysis.conviction,
      price: analysis.observedPrice === null ? null : Number(analysis.observedPrice),
      target: analysis.primaryTarget === null ? null : Number(analysis.primaryTarget),
      invalidation: analysis.invalidationLevel === null ? null : Number(analysis.invalidationLevel),
      source: slot.slotKind.startsWith("manual") ? "manual" : "scheduled",
      fullAnalysisState: analysis.fullAnalysisState,
    })),
    nextCursor: rows.length > PAGE_SIZE && last
      ? encodeSignalCursor({ scheduledFor: last.slot.scheduledFor.toISOString(), analysisId: last.analysis.id })
      : null,
  };
}

export type EligibleSignalHistoryPage = Awaited<ReturnType<typeof getEligibleSignalHistory>>;
