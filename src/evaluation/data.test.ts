import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

const getDatabase = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ getDatabase }));
vi.mock("@/auth/require-user", () => ({ requireAuthorizedUser: vi.fn() }));

import { getEvaluationData } from "@/evaluation/data";

const clients: PGlite[] = [];
const migrations = [
  "0000_colorful_ronan.sql", "0001_groovy_korg.sql", "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql", "0004_enable_automatic_scans.sql", "0005_colossal_morgan_stark.sql",
  "0006_groovy_expediter.sql", "0007_tough_swarm.sql", "0008_fluffy_radioactive_man.sql",
] as const;

afterEach(async () => {
  getDatabase.mockReset();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("evaluation profiles", () => {
  it("groups completion, failures, coverage, outcomes, latency, cost, and reviews by profile and prompt", async () => {
    const client = new PGlite();
    clients.push(client);
    for (const migration of migrations) {
      const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
      await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
    }
    const database = drizzle({ client, schema });
    getDatabase.mockResolvedValue(database);
    const [prompt] = await database.select().from(schema.promptRevisions).where(eq(schema.promptRevisions.revisionNumber, 2));
    const [slotA, slotB] = await database.insert(schema.scanSlots).values([
      { idempotencyKey: "AAPL:eval:a", symbol: "AAPL", scheduledFor: new Date(), slotKind: "mid_bar", status: "completed", provider: "chart-img", feed: "tradingview" },
      { idempotencyKey: "MSFT:eval:b", symbol: "MSFT", scheduledFor: new Date(), slotKind: "mid_bar", status: "failed", provider: "chart-img", feed: "tradingview" },
    ]).returning();
    const [validRun, failedRun] = await database.insert(schema.modelRuns).values([
      { scanSlotId: slotA!.id, runRole: "primary", phase: "compact", requestedModel: "google/gemini-2.5-pro", actualModel: "google/gemini-2.5-pro", inferenceProfile: "compact-quality-v1", promptRevisionId: prompt!.id, promptVersion: "chart-compact-v3", inputHash: "a", status: "valid", latencyMs: 20_000, costUsd: "0.03" },
      { scanSlotId: slotB!.id, runRole: "primary", phase: "compact", requestedModel: "google/gemini-2.5-pro", inferenceProfile: "compact-quality-v1", promptRevisionId: prompt!.id, promptVersion: "chart-compact-v3", inputHash: "b", status: "timed_out", latencyMs: 90_000, costUsd: "0.06" },
    ]).returning();
    await database.insert(schema.modelAttempts).values([
      { modelRunId: validRun!.id, attemptNumber: 1, status: "invalid", latencyMs: 1_000, queueWaitMs: 4, reasoningTokens: 0, failureKind: "empty_response" },
      { modelRunId: validRun!.id, attemptNumber: 2, status: "valid", latencyMs: 19_000, queueWaitMs: 8, reasoningTokens: 3_000 },
      { modelRunId: failedRun!.id, attemptNumber: 1, status: "timed_out", latencyMs: 90_000, queueWaitMs: 12, failureKind: "timeout" },
    ]);
    const [analysis] = await database.insert(schema.analyses).values({ modelRunId: validRun!.id, verdict: "bullish", barStatus: "closed", conviction: "high", visualQuality: "clear", observedPrice: "100", primaryTarget: "104", invalidationLevel: "97" }).returning();
    const [thesis] = await database.insert(schema.theses).values({ analysisId: analysis!.id, symbol: "AAPL", direction: "bullish", target: "104", invalidation: "97" }).returning();
    await database.insert(schema.outcomes).values({ thesisId: thesis!.id, result: "target_first", horizonEndsAt: new Date(), evaluatedAt: new Date() });
    await database.insert(schema.reviewLabels).values({ analysisId: analysis!.id, assessment: "mixed", unsupportedClaims: ["claim"] });

    const data = await getEvaluationData();
    expect(data.profileMetrics).toHaveLength(1);
    expect(data.profileMetrics[0]).toMatchObject({
      profile: "compact-quality-v1", promptRevisionId: prompt!.id,
      runs: 2, completed: 1, failed: 1, completionRate: 0.5,
      directional: 1, noTrade: 0, target: 1, invalidation: 0,
      retries: 1, recoveredRetries: 1, medianReasoningTokens: 3_000,
      failures: { empty_response: 1, timeout: 1 }, reviewed: 1, unsupported: 1,
    });
    expect(data.resolvedDirectionalOutcomes).toBe(1);
  });
});
