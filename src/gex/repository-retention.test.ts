import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { getDatabase } from "@/db/client";
import { getGexDatasetById, getLatestGexDataset, getRecentGexDatasetSummaries, saveGexDataset } from "@/gex/repository";

vi.mock("@/db/client", () => ({ getDatabase: vi.fn() }));

const clients: PGlite[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("GEX dataset retention", () => {
  it("keeps only the latest three Manual runs without pruning Daily, Weekly, or Monthly", async () => {
    const client = new PGlite(); clients.push(client);
    const migration = readFileSync(new URL("../../drizzle/0016_gex_history_templates.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
    await client.exec(migration);
    vi.mocked(getDatabase).mockResolvedValue(drizzle({ client, schema }) as Awaited<ReturnType<typeof getDatabase>>);

    for (const category of ["daily", "weekly", "monthly"]) {
      await saveGexDataset(category, [{ symbol: "AAPL", expiration: "2026-10-16" }]);
    }
    for (let version = 1; version <= 4; version += 1) {
      await saveGexDataset("manual", [{ symbol: "AAPL", expiration: "2026-10-16", requestedExpiration: "2026-10-15", version }]);
      await new Promise((resolve) => setTimeout(resolve, 3));
    }

    const counts = await client.query<{ category: string; count: number }>("SELECT category, count(*)::int AS count FROM gex_datasets GROUP BY category ORDER BY category");
    expect(counts.rows).toEqual([
      { category: "daily", count: 1 },
      { category: "manual", count: 3 },
      { category: "monthly", count: 1 },
      { category: "weekly", count: 1 },
    ]);
    const manualVersions = await client.query<{ version: number }>("SELECT (rows->0->>'version')::int AS version FROM gex_datasets WHERE category = 'manual' ORDER BY run_at");
    expect(manualVersions.rows).toEqual([{ version: 2 }, { version: 3 }, { version: 4 }]);
    const summaries = await getRecentGexDatasetSummaries();
    expect(summaries.map((item) => item.category)).toEqual(["manual", "manual", "manual", "daily", "weekly", "monthly"]);
    expect(summaries.slice(0, 3).map((item) => item.optionDate)).toEqual(["2026-10-15", "2026-10-15", "2026-10-15"]);
    expect(summaries.find((item) => item.category === "daily")?.optionDate).toBe("2026-10-16");
    expect((await getLatestGexDataset("daily"))?.id).toBe(summaries.find((item) => item.category === "daily")?.id);
    expect((await getGexDatasetById(summaries[0].id))?.rows[0].requestedExpiration).toBe("2026-10-15");
  });
});
