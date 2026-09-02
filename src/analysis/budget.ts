import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { isDemoMode } from "@/config/env";
import { getDatabase } from "@/db/client";
import { appSettings, budgetReservations, dailyBudgetLedger } from "@/db/schema";
import { marketDate } from "@/market-data/time";

export type UsageClass = "routine_compact" | "manual_compact" | "full_analysis";

const DEFAULT_DAILY_BUDGET_USD = 12;
const ROUTINE_COST_TARGET_USD = 10;

const RESERVED_COST_USD: Record<UsageClass, number> = {
  routine_compact: 0.02,
  manual_compact: 0.02,
  full_analysis: 0.08,
};

export async function reserveAnalysisBudget(input: {
  model: string;
  runRole: "primary" | "comparison" | "fallback";
  usageClass: UsageClass;
  modelRunId?: string;
  now: Date;
}): Promise<string | null> {
  if (isDemoMode()) return "demo";
  const database = await getDatabase();
  const date = marketDate(input.now);
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  const cap = Number(settings?.dailyBudgetUsd ?? DEFAULT_DAILY_BUDGET_USD);
  if (input.usageClass === "routine_compact") {
    const [rolling] = await database.select({
      count: sql<string>`count(*)`,
      total: sql<string>`coalesce(sum(coalesce(${budgetReservations.actualUsd}, ${budgetReservations.reservedUsd})), 0)`,
    }).from(budgetReservations).where(and(
      eq(budgetReservations.usageClass, "routine_compact"),
      isNotNull(budgetReservations.modelRunId),
      sql`${budgetReservations.status} in ('settled', 'estimated')`,
    ));
    const count = Number(rolling?.count ?? 0);
    const projected = count ? Number(rolling?.total ?? 0) / count * 2_000 * 1.1 : 0;
    if (count >= 20 && projected >= cap) return null;
  }
  const reserved = RESERVED_COST_USD[input.usageClass];
  return database.transaction(async (tx) => {
    await tx.insert(dailyBudgetLedger).values({ marketDate: date }).onConflictDoNothing();
    const [claimed] = await tx.update(dailyBudgetLedger)
      .set({ committedUsd: sql`${dailyBudgetLedger.committedUsd} + ${reserved}`, updatedAt: new Date() })
      .where(and(
        eq(dailyBudgetLedger.marketDate, date),
        sql`${dailyBudgetLedger.committedUsd} + ${reserved} <= ${cap}`,
      ))
      .returning({ marketDate: dailyBudgetLedger.marketDate });
    if (!claimed) return null;
    const [reservation] = await tx.insert(budgetReservations).values({
      marketDate: date,
      model: input.model,
      runRole: input.runRole,
      usageClass: input.usageClass,
      modelRunId: input.modelRunId,
      reservedUsd: String(reserved),
    }).returning({ id: budgetReservations.id });
    return reservation?.id ?? null;
  });
}

export async function settleAnalysisBudget(
  id: string,
  actualUsd: number | null,
  status: "settled" | "estimated" | "released",
) {
  if (id === "demo") return;
  const database = await getDatabase();
  await database.transaction(async (tx) => {
    const [reservation] = await tx.select().from(budgetReservations)
      .where(and(eq(budgetReservations.id, id), eq(budgetReservations.status, "reserved")))
      .limit(1);
    if (!reservation) return;
    const reserved = Number(reservation.reservedUsd);
    const committed = status === "released" ? 0 : (actualUsd ?? reserved);
    await tx.update(dailyBudgetLedger).set({
      committedUsd: sql`greatest(0, ${dailyBudgetLedger.committedUsd} - ${reserved} + ${committed})`,
      updatedAt: new Date(),
    }).where(eq(dailyBudgetLedger.marketDate, reservation.marketDate));
    await tx.update(budgetReservations).set({
      actualUsd: actualUsd === null ? null : String(actualUsd), status, settledAt: new Date(),
    }).where(and(eq(budgetReservations.id, id), eq(budgetReservations.status, "reserved")));
  });
}

export async function getBudgetSummary(now = new Date()) {
  const database = await getDatabase();
  const date = marketDate(now);
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  const [daily] = await database.select({ total: dailyBudgetLedger.committedUsd })
    .from(dailyBudgetLedger).where(eq(dailyBudgetLedger.marketDate, date));
  const [monthly] = await database
    .select({ total: sql<string>`coalesce(sum(coalesce(${budgetReservations.actualUsd}, ${budgetReservations.reservedUsd})), 0)` })
    .from(budgetReservations)
    .where(and(
      sql`${budgetReservations.marketDate} like ${`${date.slice(0, 7)}%`}`,
      sql`${budgetReservations.status} <> 'released'`,
    ));
  const [routine] = await database.select({
    count: sql<string>`count(*)`,
    total: sql<string>`coalesce(sum(coalesce(${budgetReservations.actualUsd}, ${budgetReservations.reservedUsd})), 0)`,
  }).from(budgetReservations).where(and(
    eq(budgetReservations.usageClass, "routine_compact"),
    isNotNull(budgetReservations.modelRunId),
    sql`${budgetReservations.status} in ('settled', 'estimated')`,
  ));
  const routineCount = Number(routine?.count ?? 0);
  const routineProjectionUsd = routineCount
    ? Number(routine?.total ?? 0) / routineCount * 2_000 * 1.1
    : null;
  return {
    capUsd: Number(settings?.dailyBudgetUsd ?? DEFAULT_DAILY_BUDGET_USD),
    todayUsd: Number(daily?.total ?? 0),
    monthUsd: Number(monthly?.total ?? 0),
    routineProjectionUsd,
    routineProjectionSampleSize: routineCount,
    routineCostTargetMet:
      routineProjectionUsd === null ? null : routineProjectionUsd < ROUTINE_COST_TARGET_USD,
    byClass: Object.fromEntries(await Promise.all(
      (["routine_compact", "manual_compact", "full_analysis"] as const).map(async (usageClass) => {
        const [row] = await database.select({
          total: sql<string>`coalesce(sum(coalesce(${budgetReservations.actualUsd}, ${budgetReservations.reservedUsd})), 0)`,
        }).from(budgetReservations).where(and(
          eq(budgetReservations.marketDate, date), eq(budgetReservations.usageClass, usageClass),
          sql`${budgetReservations.status} <> 'released'`,
        ));
        return [usageClass, Number(row?.total ?? 0)];
      }),
    )),
  };
}
