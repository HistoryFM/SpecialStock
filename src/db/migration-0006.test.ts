import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_WATCHLIST } from "@/models/catalog";

const clients: PGlite[] = [];
const migrations = [
  "0000_colorful_ronan.sql",
  "0001_groovy_korg.sql",
  "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql",
  "0004_enable_automatic_scans.sql",
  "0005_colossal_morgan_stark.sql",
] as const;

async function apply(client: PGlite, migration: string) {
  const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
  await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
}

async function migratedClient() {
  const client = new PGlite();
  clients.push(client);
  for (const migration of migrations) await apply(client, migration);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("20-stock seed migration", () => {
  it("upgrades the untouched legacy seed and the default budget", async () => {
    const client = await migratedClient();
    await client.exec("insert into app_settings (id) values (1)");

    await apply(client, "0006_groovy_expediter.sql");

    const migrated = await client.query<{ watchlist: unknown; daily_budget_usd: string }>(
      "select watchlist,daily_budget_usd from app_settings where id = 1",
    );
    expect(migrated.rows[0]).toEqual({
      watchlist: DEFAULT_WATCHLIST,
      daily_budget_usd: "12.00",
    });

    await client.exec("delete from app_settings where id = 1; insert into app_settings (id) values (1)");
    const fresh = await client.query<{ watchlist: unknown; daily_budget_usd: string }>(
      "select watchlist,daily_budget_usd from app_settings where id = 1",
    );
    expect(fresh.rows[0]).toEqual({
      watchlist: DEFAULT_WATCHLIST,
      daily_budget_usd: "12.00",
    });
  });

  it("preserves a customized watchlist and non-default budget", async () => {
    const client = await migratedClient();
    const customWatchlist = [
      { symbol: "IBM", exchange: "NYSE", automaticScanEnabled: false },
      { symbol: "AAPL", exchange: "NASDAQ", automaticScanEnabled: true },
    ];
    await client.query(
      "insert into app_settings (id,watchlist,daily_budget_usd) values (1,$1,25)",
      [JSON.stringify(customWatchlist)],
    );

    await apply(client, "0006_groovy_expediter.sql");

    const result = await client.query<{ watchlist: unknown; daily_budget_usd: string }>(
      "select watchlist,daily_budget_usd from app_settings where id = 1",
    );
    expect(result.rows[0]).toEqual({
      watchlist: customWatchlist,
      daily_budget_usd: "25.00",
    });
  });
});
