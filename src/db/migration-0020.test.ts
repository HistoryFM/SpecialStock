import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];

afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("scan GEX gate migration", () => {
  it("adds the scan-time gate audit fields without changing existing rows", async () => {
    const client = new PGlite(); clients.push(client);
    await client.exec("CREATE TABLE analyses (id uuid PRIMARY KEY, observed_price numeric(20, 8));");
    const migration = readFileSync(new URL("../../drizzle/0020_scan_gex_gate.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
    await client.exec(migration);
    const columns = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'analyses'");
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual(expect.arrayContaining([
      "previous_completed_candle_close", "gex_gate", "gex_dataset_run_at",
    ]));
  });
});
