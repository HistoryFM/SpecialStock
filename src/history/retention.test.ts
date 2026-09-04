import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistChartArtifact } from "@/chart/artifact-storage";
import * as schema from "@/db/schema";
import { sha256 } from "@/lib/hash";

const holder = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDatabase: async () => holder.database }));

import { purgeExpiredScanGraphs } from "@/history/retention";

let client: PGlite;
let root: string;

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle({ client, schema });
  holder.database = database;
  await migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  root = await mkdtemp(path.join(tmpdir(), "specialstock-retention-"));
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe("seven-day scan retention", () => {
  it("cascades terminal graphs, preserves ledgers/running scans, and protects shared PNGs", async () => {
    const database = holder.database as ReturnType<typeof drizzle<typeof schema>>;
    const now = new Date("2026-09-03T20:00:00.000Z");
    const old = new Date("2026-08-26T20:00:00.000Z");
    const recent = new Date("2026-09-03T19:00:00.000Z");
    const [oldSlot] = await database.insert(schema.scanSlots).values({
      idempotencyKey: "old-completed", symbol: "AAPL", scheduledFor: old, slotKind: "scheduled", status: "completed", provider: "chart-img", feed: "chart-img", completedAt: old, updatedAt: old,
    }).returning();
    const [failedSlot] = await database.insert(schema.scanSlots).values({
      idempotencyKey: "old-failed", symbol: "MSFT", scheduledFor: old, slotKind: "manual_smoke", status: "failed", provider: "chart-img", feed: "chart-img", completedAt: old, updatedAt: old,
    }).returning();
    const [recentSlot] = await database.insert(schema.scanSlots).values({
      idempotencyKey: "recent", symbol: "NVDA", scheduledFor: recent, slotKind: "scheduled", status: "completed", provider: "chart-img", feed: "chart-img", completedAt: recent,
    }).returning();
    const [runningSlot] = await database.insert(schema.scanSlots).values({
      idempotencyKey: "old-running", symbol: "AMZN", scheduledFor: old, slotKind: "scheduled", status: "running", provider: "chart-img", feed: "chart-img", startedAt: old, updatedAt: old,
    }).returning();

    const sharedBytes = Buffer.from("shared-chart");
    const uniqueBytes = Buffer.from("expired-chart");
    const sharedReference = await persistChartArtifact(sharedBytes, sha256(sharedBytes), root);
    const uniqueReference = await persistChartArtifact(uniqueBytes, sha256(uniqueBytes), root);
    await utimes(path.join(root, sharedReference), old, old);
    await utimes(path.join(root, uniqueReference), old, old);
    await writeFile(path.join(root, "not-a-chart.txt"), "leave me");

    const artifactValues = (scanSlotId: string, imageHash: string, storageReference: string) => ({
      scanSlotId, rendererVersion: "chart-img-v2", inputHash: `${scanSlotId}-input`, imageHash,
      mimeType: "image/png", width: 1600, height: 1920, byteLength: 12, storageReference, frozenInput: {},
    });
    const [oldArtifact] = await database.insert(schema.chartArtifacts).values(artifactValues(oldSlot!.id, sha256(sharedBytes), sharedReference)).returning();
    await database.insert(schema.chartArtifacts).values(artifactValues(recentSlot!.id, sha256(sharedBytes), sharedReference));
    await database.insert(schema.chartArtifacts).values(artifactValues(failedSlot!.id, sha256(uniqueBytes), uniqueReference));
    await database.insert(schema.chartArtifacts).values(artifactValues(runningSlot!.id, "c".repeat(64), `${"c".repeat(64)}.png`));

    const [run] = await database.insert(schema.modelRuns).values({
      scanSlotId: oldSlot!.id, chartArtifactId: oldArtifact!.id, runRole: "primary", phase: "compact",
      requestedModel: "google/gemini-2.5-pro", promptVersion: "chart-compact-v2", inputHash: "input", status: "valid", completedAt: old,
    }).returning();
    const [analysis] = await database.insert(schema.analyses).values({
      modelRunId: run!.id, verdict: "bullish", barStatus: "closed", conviction: "high", visualQuality: "clear",
    }).returning();
    await database.insert(schema.modelAttempts).values({ modelRunId: run!.id, attemptNumber: 1, status: "valid", latencyMs: 1 });
    await database.insert(schema.reviewLabels).values({ analysisId: analysis!.id, assessment: "accurate" });
    const [thesis] = await database.insert(schema.theses).values({ analysisId: analysis!.id, symbol: "AAPL", direction: "bullish" }).returning();
    await database.insert(schema.outcomes).values({ thesisId: thesis!.id, result: "expired", horizonEndsAt: old, evaluatedAt: old });
    await database.insert(schema.notificationEvents).values({ thesisId: thesis!.id, reason: "test" });
    await database.insert(schema.budgetReservations).values({ marketDate: "2026-08-26", model: "google/gemini-2.5-pro", runRole: "primary", modelRunId: run!.id, reservedUsd: "0.01" });
    await database.insert(schema.dailyBudgetLedger).values({ marketDate: "2026-08-26", committedUsd: "0.01" });

    await expect(purgeExpiredScanGraphs({ now, artifactRoot: root })).resolves.toEqual({
      slots: 2, artifacts: 2, filesRemoved: 1, fileFailures: 0,
    });
    expect(await database.select().from(schema.scanSlots)).toHaveLength(2);
    expect(await database.select().from(schema.modelRuns)).toHaveLength(0);
    expect(await database.select().from(schema.analyses)).toHaveLength(0);
    expect(await database.select().from(schema.modelAttempts)).toHaveLength(0);
    expect(await database.select().from(schema.reviewLabels)).toHaveLength(0);
    expect(await database.select().from(schema.theses)).toHaveLength(0);
    expect(await database.select().from(schema.outcomes)).toHaveLength(0);
    expect(await database.select().from(schema.notificationEvents)).toHaveLength(0);
    expect(await database.select().from(schema.budgetReservations)).toHaveLength(1);
    expect((await database.select().from(schema.budgetReservations))[0]?.modelRunId).toBeNull();
    expect(await database.select().from(schema.dailyBudgetLedger)).toHaveLength(1);
    expect(await stat(path.join(root, sharedReference))).toBeTruthy();
    await expect(stat(path.join(root, uniqueReference))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await stat(path.join(root, "not-a-chart.txt"))).toBeTruthy();
    expect(await database.select().from(schema.scanSlots).where(eq(schema.scanSlots.id, runningSlot!.id))).toHaveLength(1);
  });
});
