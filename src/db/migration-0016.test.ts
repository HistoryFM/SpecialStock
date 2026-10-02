import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];

afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("GEX history and template migration", () => {
  it("adds independent template and category-run storage", async () => {
    const client = new PGlite(); clients.push(client);
    const migration = readFileSync(new URL("../../drizzle/0016_gex_history_templates.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
    await client.exec(migration);
    await client.exec("INSERT INTO gex_templates (kind, version, content, active) VALUES ('engine', 1, 'template', true)");
    await client.exec("INSERT INTO gex_datasets (category, run_at, rows) VALUES ('daily', now(), '[]'::jsonb), ('weekly', now(), '[]'::jsonb), ('monthly', now(), '[]'::jsonb), ('manual', now(), '[{\"requestedExpiration\":\"2026-10-16\"}]'::jsonb)");
    const templates = await client.query<{ kind: string; version: number }>("SELECT kind, version FROM gex_templates");
    const datasets = await client.query<{ category: string }>("SELECT category FROM gex_datasets ORDER BY category");
    expect(templates.rows).toEqual([{ kind: "engine", version: 1 }]);
    expect(datasets.rows).toEqual([{ category: "daily" }, { category: "manual" }, { category: "monthly" }, { category: "weekly" }]);
  });
});
