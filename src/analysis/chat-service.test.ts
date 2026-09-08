import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  readChartArtifact: vi.fn(async () => Buffer.from("verified-png")),
  reserve: vi.fn(async () => "reservation"),
  settle: vi.fn(async () => undefined),
  info: vi.fn(),
  warn: vi.fn(),
  spans: [] as Array<{ options: { op?: string; attributes?: Record<string, unknown> }; span: { setAttribute: ReturnType<typeof vi.fn>; setAttributes: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn> } }>,
}));

vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/chart/artifact-storage", () => ({ readChartArtifact: mocks.readChartArtifact }));
vi.mock("@/analysis/budget", () => ({ reserveAnalysisBudget: mocks.reserve, settleAnalysisBudget: mocks.settle }));
vi.mock("@/config/env", () => ({ getServerEnv: () => ({ OPENROUTER_API_KEY: "test-key", OPENROUTER_API_URL: "https://openrouter.test/chat" }) }));
vi.mock("@sentry/nextjs", () => ({
  logger: { info: mocks.info, warn: mocks.warn },
  startSpan: vi.fn(async (options, callback) => {
    const span = { setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() };
    mocks.spans.push({ options, span });
    return callback(span);
  }),
}));

import { getAnalysisChat, resetAnalysisChat, retryAnalysisChat, submitAnalysisChat } from "@/analysis/chat-service";

const migrations = [
  "0000_colorful_ronan.sql", "0001_groovy_korg.sql", "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql", "0004_enable_automatic_scans.sql", "0005_colossal_morgan_stark.sql",
  "0006_groovy_expediter.sql", "0007_tough_swarm.sql",
] as const;
const clients: PGlite[] = [];
const analysisId = "00000000-0000-4000-8000-000000000204";

async function setupDatabase() {
  const client = new PGlite();
  clients.push(client);
  for (const migration of migrations) {
    const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  const database = drizzle({ client, schema });
  mocks.getDatabase.mockResolvedValue(database);
  await database.insert(schema.scanSlots).values({
    id: "00000000-0000-4000-8000-000000000201", idempotencyKey: "chat:AAPL", symbol: "AAPL",
    scheduledFor: new Date("2026-09-03T14:00:00Z"), slotKind: "manual_smoke", status: "completed", provider: "chart-img", feed: "tradingview",
  });
  await database.insert(schema.chartArtifacts).values({
    id: "00000000-0000-4000-8000-000000000202", scanSlotId: "00000000-0000-4000-8000-000000000201",
    rendererVersion: "chart-img-v2", inputHash: "input-hash", imageHash: "image-hash", mimeType: "image/png",
    width: 1600, height: 1920, byteLength: 12, storageReference: "image-hash.png",
    frozenInput: { capturedAt: "2026-09-03T14:00:00Z", chartSymbol: "NASDAQ:AAPL", interval: "5m" },
  });
  await database.insert(schema.modelRuns).values({
    id: "00000000-0000-4000-8000-000000000203", scanSlotId: "00000000-0000-4000-8000-000000000201",
    chartArtifactId: "00000000-0000-4000-8000-000000000202", runRole: "primary", phase: "compact",
    requestedModel: "google/gemini-2.5-pro", promptVersion: "chart-compact-v2", inputHash: "input-hash", status: "valid",
  });
  await database.insert(schema.analyses).values({
    id: analysisId, modelRunId: "00000000-0000-4000-8000-000000000203", verdict: "bullish", barStatus: "closed",
    conviction: "high", visualQuality: "clear", fullAnalysisState: "available", observedPrice: "100", primaryTarget: "104",
    invalidationLevel: "97", setupType: "breakout", immediateBias: "constructive", summary: "Stored full analysis",
  });
  return { client, database };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spans.length = 0;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("analysis-grounded chat", () => {
  it("uses only the six latest exchanges, re-verifies the chart, and reuses request IDs", async () => {
    await setupDatabase();
    let generation = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      generation += 1;
      return Response.json({
        id: `generation-${generation}`, model: "google/gemini-2.5-pro", provider: "google",
        choices: [{ message: { content: JSON.stringify({ answer: `answer ${generation}` }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.01 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 1; index <= 8; index += 1) {
      await submitAnalysisChat({ analysisId, requestId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, question: `question ${index}` });
    }
    const callsBeforeReuse = fetchMock.mock.calls.length;
    const reused = await submitAnalysisChat({ analysisId, requestId: "00000000-0000-4000-8000-000000000008", question: "question 8" });
    expect(reused.answer).toBe("answer 8");
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeReuse);
    expect(mocks.readChartArtifact).toHaveBeenCalledTimes(8);
    expect(mocks.readChartArtifact).toHaveBeenLastCalledWith("image-hash.png", "image-hash");

    const lastBody = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body)) as { model: string; messages: unknown[] };
    const serialized = JSON.stringify(lastBody);
    expect(lastBody.model).toBe("google/gemini-2.5-pro");
    expect(lastBody.messages).toHaveLength(14);
    expect(serialized).not.toContain("question 1");
    expect(serialized).toContain("question 2");
    expect(serialized).toContain("question 8");
    expect(serialized).toContain("data:image/png;base64");
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("question 8");
    const genAiSpans = mocks.spans.filter(({ options }) => options.op === "gen_ai.chat");
    expect(genAiSpans).toHaveLength(8);
    expect(genAiSpans.at(-1)?.options.attributes).toMatchObject({
      "specialstock.telemetry.origin": "server",
      "specialstock.analysis.id": analysisId,
      "specialstock.chat.context_count": 6,
      "gen_ai.provider.name": "openrouter",
      "gen_ai.request.model": "google/gemini-2.5-pro",
      "gen_ai.response.streaming": false,
    });
    expect(mocks.spans.some(({ options }) => options.op === "specialstock.analysis.chat")).toBe(true);
    expect(JSON.stringify(genAiSpans.map(({ options }) => options.attributes))).not.toContain("question 8");
  });

  it("persists a failed turn, offsets explicit retry attempts, and archives on reset", async () => {
    const { database } = await setupDatabase();
    const fetchMock = vi.fn<(_url: string | URL | Request, _init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({
        id: "retry-generation", model: "google/gemini-2.5-pro", provider: "google",
        choices: [{ message: { content: JSON.stringify({ answer: "grounded retry" }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 90, completion_tokens: 18, cost: 0.009 },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const failed = await submitAnalysisChat({ analysisId, requestId: "00000000-0000-4000-8000-000000000099", question: "What invalidates this?" });
    expect(failed.status).toBe("failed");
    const completed = await retryAnalysisChat({ analysisId, turnId: failed.id });
    expect(completed).toMatchObject({ status: "completed", answer: "grounded retry" });
    const attempts = await database.select({ attemptNumber: schema.modelAttempts.attemptNumber }).from(schema.modelAttempts);
    expect(attempts.map(({ attemptNumber }) => attemptNumber).sort()).toEqual([1, 2]);

    const beforeReset = await getAnalysisChat(analysisId);
    expect(beforeReset.turns).toHaveLength(1);
    const reset = await resetAnalysisChat(analysisId);
    expect(reset.turns).toEqual([]);
    expect(reset.conversationId).not.toBe(beforeReset.conversationId);
  });
});
