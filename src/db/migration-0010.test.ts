import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];
const migrations = Array.from({ length: 12 }, (_, index) => `${String(index).padStart(4, "0")}_${[
  "colorful_ronan", "groovy_korg", "past_silver_sable", "fantastic_talon", "enable_automatic_scans",
  "colossal_morgan_stark", "groovy_expediter", "tough_swarm", "fluffy_radioactive_man", "lazy_tinkerer", "jittery_trish_tilby", "happy_masque",
][index]}.sql`);

afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("Swing Trade migration", () => {
  it("creates isolated tables with automatic mode off and relational constraints", async () => {
    const client = new PGlite(); clients.push(client);
    for (const migration of migrations) {
      await client.exec(readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
    }
    await client.exec("INSERT INTO swing_settings (id) VALUES (1)");
    const settings = await client.query<{ automatic_enabled: boolean; active_watchlist_version_id: string | null }>("SELECT automatic_enabled,active_watchlist_version_id FROM swing_settings");
    expect(settings.rows).toEqual([{ automatic_enabled: false, active_watchlist_version_id: null }]);
    await expect(client.exec("INSERT INTO swing_settings (id) VALUES (2)")).rejects.toThrow();
    await client.exec("INSERT INTO swing_watchlist_versions (id,version_number,source_filename,source_type,entry_count,content_hash) VALUES ('00000000-0000-4000-8000-000000000001',1,'list.csv','csv',1,'hash')");
    await client.exec("INSERT INTO swing_watchlist_entries (version_id,position,stock_name,symbol,exchange) VALUES ('00000000-0000-4000-8000-000000000001',0,'Apple','AAPL','NASDAQ')");
    await expect(client.exec("INSERT INTO swing_watchlist_entries (version_id,position,stock_name,symbol,exchange) VALUES ('00000000-0000-4000-8000-000000000001',1,'Apple 2','AAPL','NYSE')")).rejects.toThrow();
    const queueColumns = await client.query<{ table_name: string; column_default: string }>("SELECT table_name,column_default FROM information_schema.columns WHERE column_name='queue_wait_ms' AND table_name LIKE 'swing_model_%' ORDER BY table_name");
    expect(queueColumns.rows).toEqual([
      { table_name: "swing_model_attempts", column_default: "0" },
      { table_name: "swing_model_runs", column_default: "0" },
    ]);
    const activeIndex = await client.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE indexname='swing_runs_one_active_unique'");
    expect(activeIndex.rows[0]?.indexdef).toContain("scheduled");
    expect(activeIndex.rows[0]?.indexdef).toContain("running");
  });
});
