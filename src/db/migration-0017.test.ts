import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];

afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("GEX model usage migration", () => {
  it("stores only aggregate OpenRouter usage metadata", async () => {
    const client = new PGlite(); clients.push(client);
    const migration = readFileSync(new URL("../../drizzle/0017_gex_model_usage.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
    await client.exec(migration);
    await client.exec("INSERT INTO gex_model_runs (symbol, category, purpose, requested_model, input_tokens, output_tokens, cost_usd) VALUES ('AAPL', 'daily', 'chart_values', 'google/gemini-2.5-pro', 100, 25, 0.001)");
    const runs = await client.query<{ symbol: string; input_tokens: number; output_tokens: number }>("SELECT symbol, input_tokens, output_tokens FROM gex_model_runs");
    expect(runs.rows).toEqual([{ symbol: "AAPL", input_tokens: 100, output_tokens: 25 }]);
  });
});
