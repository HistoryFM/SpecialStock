import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];

afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("GEX settings migration", () => {
  it("adds an isolated empty list with a 100-symbol database bound", async () => {
    const client = new PGlite(); clients.push(client);
    const migration = readFileSync(new URL("../../drizzle/0015_organic_pandemic.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
    await client.exec(migration);
    await client.exec("INSERT INTO gex_settings (id) VALUES (1)");
    const state = await client.query<{ symbols: string[]; revision: number }>("SELECT symbols,revision FROM gex_settings");
    expect(state.rows).toEqual([{ symbols: [], revision: 0 }]);
    await expect(client.exec("INSERT INTO gex_settings (id) VALUES (2)")).rejects.toThrow();
    const many = JSON.stringify(Array.from({ length: 101 }, (_, index) => `T${index}`)).replaceAll("'", "''");
    await expect(client.exec(`UPDATE gex_settings SET symbols='${many}'::jsonb WHERE id=1`)).rejects.toThrow();
  });
});
