import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_WATCHLIST } from "@/models/catalog";
import { watchlistEntrySchema } from "@/settings/schema";

describe("automatic-scan defaults", () => {
  it("enables every stock in a fresh default watchlist", () => {
    expect(DEFAULT_WATCHLIST.every((entry) => entry.automaticScanEnabled)).toBe(true);
  });

  it("keeps newly added stocks off unless explicitly enabled", () => {
    expect(watchlistEntrySchema.parse({ symbol: "IBM", exchange: "NYSE" }))
      .toMatchObject({ automaticScanEnabled: false });
  });

  it("enables every existing watchlist entry exactly once in migration 0004", async () => {
    const database = new PGlite();
    await database.exec(`
      CREATE TABLE app_settings (
        id integer PRIMARY KEY,
        watchlist jsonb NOT NULL
      );
      INSERT INTO app_settings (id, watchlist) VALUES (
        1,
        '[{"symbol":"AAPL","exchange":"NASDAQ","automaticScanEnabled":false},{"symbol":"IBM","exchange":"NYSE","automaticScanEnabled":true}]'::jsonb
      );
    `);
    const migration = await readFile(
      resolve(process.cwd(), "drizzle/0004_enable_automatic_scans.sql"),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
    const result = await database.query<{ watchlist: Array<{ automaticScanEnabled: boolean }> }>(
      "SELECT watchlist FROM app_settings WHERE id = 1",
    );
    expect(result.rows[0]?.watchlist.every((entry) => entry.automaticScanEnabled)).toBe(true);
    await database.close();
  });
});
