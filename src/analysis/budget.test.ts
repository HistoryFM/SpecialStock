import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

const getDatabaseMock = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ getDatabase: getDatabaseMock }));
vi.mock("@/config/env", () => ({ isDemoMode: () => false }));

import {
  getBudgetSummary,
  reserveAnalysisBudget,
} from "@/analysis/budget";

const clients: PGlite[] = [];
const migrations = [
  "0000_colorful_ronan.sql",
  "0001_groovy_korg.sql",
  "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql",
  "0004_enable_automatic_scans.sql",
  "0005_colossal_morgan_stark.sql",
  "0006_groovy_expediter.sql",
] as const;

async function createDatabase() {
  const client = new PGlite();
  clients.push(client);
  for (const migration of migrations) {
    const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  const database = drizzle({ client, schema });
  getDatabaseMock.mockResolvedValue(database);
  return { client, database };
}

afterEach(async () => {
  getDatabaseMock.mockReset();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("analysis budget", () => {
  it("uses the configured cap for the routine projection gate and keeps the $10 benchmark", async () => {
    const { client, database } = await createDatabase();
    const slotId = "00000000-0000-4000-8000-000000000021";
    const runId = "00000000-0000-4000-8000-000000000022";
    await database.insert(schema.appSettings).values({ id: 1, dailyBudgetUsd: "12.00" });
    await client.query(
      `insert into scan_slots (id,idempotency_key,symbol,scheduled_for,slot_kind,status,provider,feed)
       values ($1,'budget:AAPL','AAPL',now(),'scheduled','completed','chart-img','tradingview')`,
      [slotId],
    );
    await client.query(
      `insert into model_runs (id,scan_slot_id,run_role,requested_model,prompt_version,input_hash,status)
       values ($1,$2,'primary','google/gemini-2.5-pro','compact-v1','hash','valid')`,
      [runId, slotId],
    );
    await client.query(
      `insert into budget_reservations (
         market_date,model,run_role,usage_class,model_run_id,reserved_usd,actual_usd,status
       )
       select '2026-08-31','google/gemini-2.5-pro','primary','routine_compact',$1,
         0.00507273,0.00507273,'settled'
       from generate_series(1,20)`,
      [runId],
    );

    const input = {
      model: "google/gemini-2.5-pro",
      runRole: "primary" as const,
      usageClass: "routine_compact" as const,
      modelRunId: runId,
      now: new Date("2026-09-01T17:00:00Z"),
    };
    expect(await reserveAnalysisBudget(input)).toEqual(expect.any(String));

    const summary = await getBudgetSummary(input.now);
    expect(summary).toMatchObject({
      capUsd: 12,
      routineProjectionSampleSize: 20,
      routineCostTargetMet: false,
    });
    expect(summary.routineProjectionUsd).toBeCloseTo(11.16, 2);

    await database.update(schema.appSettings).set({ dailyBudgetUsd: "11.00" });
    expect(await reserveAnalysisBudget(input)).toBeNull();
  });

  it("atomically prevents concurrent reservations from exceeding the daily cap", async () => {
    const { client, database } = await createDatabase();
    await database.insert(schema.appSettings).values({ id: 1, dailyBudgetUsd: "0.03" });
    const input = {
      model: "google/gemini-2.5-pro",
      runRole: "primary" as const,
      usageClass: "manual_compact" as const,
      now: new Date("2026-09-01T17:00:00Z"),
    };

    const reservations = await Promise.all([
      reserveAnalysisBudget(input),
      reserveAnalysisBudget(input),
    ]);

    expect(reservations.filter(Boolean)).toHaveLength(1);
    const ledger = await client.query<{ committed_usd: string }>(
      "select committed_usd from daily_budget_ledger",
    );
    expect(ledger.rows[0]?.committed_usd).toBe("0.02000000");
    expect((await client.query("select id from budget_reservations")).rows).toHaveLength(1);
  });
});
