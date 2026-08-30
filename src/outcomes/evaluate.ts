import "server-only";

import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { marketBars, outcomes, theses } from "@/db/schema";

export type OutcomeBar = { startsAt: Date; high: number; low: number };

export function evaluateDirectionalOutcome(input: {
  direction: "bullish" | "bearish";
  target: number;
  invalidation: number;
  bars: OutcomeBar[];
  expectedBars?: number;
}): "target_first" | "invalidation_first" | "ambiguous" | "expired" | "missing_data" {
  const bars = [...input.bars].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const bar of bars) {
    const targetTouched = input.direction === "bullish" ? bar.high >= input.target : bar.low <= input.target;
    const invalidationTouched = input.direction === "bullish" ? bar.low <= input.invalidation : bar.high >= input.invalidation;
    if (targetTouched && invalidationTouched) return "ambiguous";
    if (targetTouched) return "target_first";
    if (invalidationTouched) return "invalidation_first";
  }
  if (bars.length < (input.expectedBars ?? 30) * 0.8) return "missing_data";
  return "expired";
}

export async function evaluatePendingOutcomes(symbol: string, now = new Date()) {
  const database = await getDatabase();
  const pending = await database
    .select({ thesis: theses })
    .from(theses)
    .leftJoin(outcomes, eq(outcomes.thesisId, theses.id))
    .where(and(eq(theses.symbol, symbol), isNull(outcomes.id)));
  for (const { thesis } of pending) {
    const horizonEndsAt = new Date(thesis.openedAt.getTime() + 30 * 60_000);
    if (horizonEndsAt > now || thesis.target === null || thesis.invalidation === null) continue;
    const rows = await database
      .select()
      .from(marketBars)
      .where(
        and(
          eq(marketBars.symbol, symbol),
          eq(marketBars.timeframe, "1m"),
          gt(marketBars.barStart, thesis.openedAt),
          lte(marketBars.barEnd, horizonEndsAt),
        ),
      )
      .orderBy(asc(marketBars.barStart), asc(marketBars.observedAt));
    const byStart = new Map<number, (typeof rows)[number]>();
    rows.forEach((row) => byStart.set(row.barStart.getTime(), row));
    const bars = [...byStart.values()].map((row) => ({
      startsAt: row.barStart,
      high: Number(row.high),
      low: Number(row.low),
    }));
    const result = evaluateDirectionalOutcome({
      direction: thesis.direction,
      target: Number(thesis.target),
      invalidation: Number(thesis.invalidation),
      bars,
    });
    await database.insert(outcomes).values({
      thesisId: thesis.id,
      result,
      horizonEndsAt,
      evaluatedAt: now,
      qualityFlags: result === "missing_data" ? ["insufficient_1m_coverage"] : [],
    }).onConflictDoNothing();
    await database.update(theses).set({
      state:
        result === "target_first"
          ? "target_reached"
          : result === "invalidation_first"
            ? "invalidated"
            : result === "expired"
              ? "expired"
              : thesis.state,
      closedAt: now,
      updatedAt: now,
    }).where(eq(theses.id, thesis.id));
  }
}
