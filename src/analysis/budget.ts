import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { isDemoMode } from "@/config/env";
import { getDatabase } from "@/db/client";
import { appSettings, budgetReservations } from "@/db/schema";
import { marketDate } from "@/market-data/time";

const RESERVED_COST_USD = 0.08;

export async function reserveAnalysisBudget(input: {
  model: string;
  runRole: "primary" | "comparison" | "fallback";
  now: Date;
}): Promise<string | null> {
  if (isDemoMode()) return "demo";
  const database = await getDatabase();
  const date = marketDate(input.now);
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  const cap = Number(settings?.dailyBudgetUsd ?? 10);
  const [spend] = await database
    .select({
      total: sql<string>`coalesce(sum(coalesce(${budgetReservations.actualUsd}, ${budgetReservations.reservedUsd})), 0)`,
    })
    .from(budgetReservations)
    .where(eq(budgetReservations.marketDate, date));
  if (Number(spend?.total ?? 0) + RESERVED_COST_USD > cap) return null;
  const [reservation] = await database
    .insert(budgetReservations)
    .values({
      marketDate: date,
      model: input.model,
      runRole: input.runRole,
      reservedUsd: String(RESERVED_COST_USD),
    })
    .returning({ id: budgetReservations.id });
  return reservation?.id ?? null;
}

export async function settleAnalysisBudget(
  id: string,
  actualUsd: number | null,
  status: "settled" | "released",
) {
  if (id === "demo") return;
  const database = await getDatabase();
  await database
    .update(budgetReservations)
    .set({
      actualUsd: actualUsd === null ? null : String(actualUsd),
      status,
      settledAt: new Date(),
    })
    .where(and(eq(budgetReservations.id, id), eq(budgetReservations.status, "reserved")));
}

export async function getBudgetSummary(now = new Date()) {
  const database = await getDatabase();
  const date = marketDate(now);
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  const [daily] = await database
    .select({ total: sql<string>`coalesce(sum(${budgetReservations.actualUsd}), 0)` })
    .from(budgetReservations)
    .where(eq(budgetReservations.marketDate, date));
  const [monthly] = await database
    .select({ total: sql<string>`coalesce(sum(${budgetReservations.actualUsd}), 0)` })
    .from(budgetReservations)
    .where(sql`${budgetReservations.marketDate} like ${`${date.slice(0, 7)}%`}`);
  return {
    capUsd: Number(settings?.dailyBudgetUsd ?? 10),
    todayUsd: Number(daily?.total ?? 0),
    monthUsd: Number(monthly?.total ?? 0),
  };
}
