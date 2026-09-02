import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterAnalysisModelProvider } from "@/analysis/openrouter-provider";
import type { ChartAnalysisInput } from "@/analysis/types";

const frozen: ChartAnalysisInput = {
  version: "chart-img-input-v1",
  symbol: "AAPL",
  chartSymbol: "NASDAQ:AAPL",
  capturedAt: "2026-08-28T20:00:10Z",
  interval: "5m",
  session: "regular",
  barStatus: "closed",
  range: { from: "2026-08-28T13:30:00Z", to: "2026-08-28T20:00:00Z" },
  width: 1600,
  height: 1920,
  studies: [
    "VWAP", "Keltner Channels", "Volume", "Average Directional Index",
    "Relative Strength Index", "MACD", "Commodity Channel Index", "Chaikin Money Flow",
  ],
  inputHash: "input-hash",
};
const wireAnalysis = { p: 100, v: "bullish", c: "high", t: 104, i: 97, q: "clear" };
const analysis = { observed_price: 100, verdict: "bullish", conviction: "high", primary_target: 104, invalidation_level: 97, visual_quality: "clear" };

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a-secure-test-secret-that-is-at-least-32-characters");
  vi.stubEnv("APP_PASSWORD_HASH", "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

describe("OpenRouterAnalysisModelProvider", () => {
  it("sends one image, minimal metadata, and only Gemini 2.5 Pro", async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        model: "google/gemini-2.5-pro",
        provider: "google",
        choices: [{ message: { content: JSON.stringify(wireAnalysis) }, finish_reason: "stop" }],
      });
    }));

    await new OpenRouterAnalysisModelProvider().analyze({
      frozen,
      png: Buffer.from("exact-png"),
      model: "google/gemini-2.5-pro",
      maxAttempts: 1,
    });

    expect(requestBody.model).toBe("google/gemini-2.5-pro");
    const serialized = JSON.stringify(requestBody);
    expect(serialized).toContain("data:image/png;base64");
    expect(serialized).toContain("chart is the sole source");
    expect(serialized).not.toContain("latestPrice");
    expect(serialized).not.toContain("relativeVelocity");
    expect(serialized).not.toContain("fiveMinute");
    const messages = requestBody.messages as Array<{ content: Array<{ type: string }> }>;
    expect(messages[0]?.content.filter((part) => part.type === "image_url")).toHaveLength(1);
  });

  it("reports token-limit truncation without retrying a manual attempt", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      model: "google/gemini-2.5-pro",
      provider: "google",
      choices: [{ message: { content: "{" }, finish_reason: "length" }],
      usage: { prompt_tokens: 1_200, completion_tokens: 700, cost: 0.00123 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenRouterAnalysisModelProvider().analyze({
      frozen,
      png: Buffer.from("png"),
      model: "google/gemini-2.5-pro",
      maxAttempts: 1,
    })).rejects.toMatchObject({
      message: expect.stringMatching(/token budget/),
      metadata: { status: "invalid", requestedModel: "google/gemini-2.5-pro" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("recovers when an automatic attempt returns an empty response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({
        model: "google/gemini-2.5-pro",
        provider: "google",
        choices: [{ message: { content: null }, finish_reason: "stop" }],
      }))
      .mockResolvedValueOnce(Response.json({
        model: "google/gemini-2.5-pro",
        provider: "google",
        choices: [{ message: { content: JSON.stringify(wireAnalysis) }, finish_reason: "stop" }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenRouterAnalysisModelProvider().analyze({
      frozen,
      png: Buffer.from("png"),
      model: "google/gemini-2.5-pro",
      maxAttempts: 2,
    })).resolves.toMatchObject({ analysis, costUsd: 0.03, attempts: [{ status: "invalid" }, { status: "valid" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry or estimate spend for authentication failures", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro", maxAttempts: 2,
    })).rejects.toMatchObject({
      metadata: { costUsd: 0, attempts: [{ estimatedCostUsd: null }] },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
