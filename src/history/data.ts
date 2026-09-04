import "server-only";

import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { analyses, modelRuns, scanSlots } from "@/db/schema";

const PAGE_SIZE = 50;
const HISTORY_WINDOW_MS = 24 * 60 * 60_000;

export type SignalHistoryFilter = "all" | "bullish" | "bearish";
export type SignalHistorySort = "newest" | "conviction";

type Cursor = {
  cutoff: string;
  filter: SignalHistoryFilter;
  sort: SignalHistorySort;
  scheduledFor: string;
  analysisId: string;
  convictionRank?: number;
};

const convictionRank = sql<number>`case ${analyses.conviction} when 'high' then 2 when 'medium' then 1 else 0 end`;

export function encodeSignalCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeSignalCursor(value: string): Cursor {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
  if (
    !parsed.analysisId ||
    !Number.isFinite(Date.parse(parsed.scheduledFor)) ||
    !Number.isFinite(Date.parse(parsed.cutoff)) ||
    !["all", "bullish", "bearish"].includes(parsed.filter) ||
    !["newest", "conviction"].includes(parsed.sort) ||
    (parsed.sort === "conviction" && ![1, 2].includes(parsed.convictionRank ?? 0))
  ) throw new Error("Invalid cursor");
  return parsed;
}

export async function getEligibleSignalHistory(input: {
  filter?: SignalHistoryFilter;
  sort?: SignalHistorySort;
  cursor?: string;
  now?: Date;
} = {}) {
  const filter = input.filter ?? "all";
  const sort = input.sort ?? "newest";
  const cursor = input.cursor ? decodeSignalCursor(input.cursor) : null;
  if (cursor && (cursor.filter !== filter || cursor.sort !== sort)) throw new Error("Cursor context does not match.");
  const cutoff = cursor ? new Date(cursor.cutoff) : new Date((input.now ?? new Date()).getTime() - HISTORY_WINDOW_MS);
  const database = await getDatabase();
  const cursorTime = cursor ? new Date(cursor.scheduledFor) : null;
  const cursorPageCondition = cursor && cursorTime
    ? sort === "conviction"
      ? or(
          lt(convictionRank, cursor.convictionRank!),
          and(eq(convictionRank, cursor.convictionRank!), lt(scanSlots.scheduledFor, cursorTime)),
          and(eq(convictionRank, cursor.convictionRank!), eq(scanSlots.scheduledFor, cursorTime), lt(analyses.id, cursor.analysisId)),
        )
      : or(
          lt(scanSlots.scheduledFor, cursorTime),
          and(eq(scanSlots.scheduledFor, cursorTime), lt(analyses.id, cursor.analysisId)),
        )
    : undefined;
  const rows = await database.select({ slot: scanSlots, run: modelRuns, analysis: analyses })
    .from(analyses)
    .innerJoin(modelRuns, eq(modelRuns.id, analyses.modelRunId))
    .innerJoin(scanSlots, eq(scanSlots.id, modelRuns.scanSlotId))
    .where(and(
      eq(modelRuns.phase, "compact"),
      or(eq(analyses.conviction, "medium"), eq(analyses.conviction, "high")),
      or(eq(analyses.verdict, "bullish"), eq(analyses.verdict, "bearish")),
      gte(scanSlots.scheduledFor, cutoff),
      filter === "all" ? undefined : eq(analyses.verdict, filter),
      cursorPageCondition,
    ))
    .orderBy(...(sort === "conviction"
      ? [desc(convictionRank), desc(scanSlots.scheduledFor), desc(analyses.id)]
      : [desc(scanSlots.scheduledFor), desc(analyses.id)]))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    filter,
    sort,
    cutoff: cutoff.toISOString(),
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
      ? encodeSignalCursor({
          cutoff: cutoff.toISOString(),
          filter,
          sort,
          scheduledFor: last.slot.scheduledFor.toISOString(),
          analysisId: last.analysis.id,
          ...(sort === "conviction" ? { convictionRank: last.analysis.conviction === "high" ? 2 : 1 } : {}),
        })
      : null,
  };
}

export type EligibleSignalHistoryPage = Awaited<ReturnType<typeof getEligibleSignalHistory>>;
