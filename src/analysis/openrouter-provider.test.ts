import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterAnalysisModelProvider } from "@/analysis/openrouter-provider";
import type { AnalysisResult, ChartAnalysisInput } from "@/analysis/types";

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
const analysis: AnalysisResult = {
  observed_price: 100,
  verdict: "bullish",
  setup_type: "Breakout structure",
  immediate_bias: "Upward pressure is visible.",
  broader_trend: "The visible trend is constructive.",
  conviction: "high",
  candlestick_analysis: "Recent candles closed higher.",
  vwap_keltner_analysis: "Price is above visible VWAP.",
  cci_analysis: "CCI is visibly positive.",
  indicator_readings: Object.fromEntries(
    ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"].map(
      (key) => [key, { stance: "bullish", readability: "clear", observation: `${key} is legible.` }],
    ),
  ) as AnalysisResult["indicator_readings"],
  supporting_evidence: ["Higher lows support the thesis."],
  conflicting_evidence: ["Nearby resistance may limit follow-through."],
  support_levels: [98],
  resistance_levels: [104],
  primary_target: 104,
  deeper_scenario: "Continuation requires the structure to hold.",
  invalidation_level: 97,
  data_quality_flags: [],
  summary: "Bullish visual thesis.",
};

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
        choices: [{ message: { content: JSON.stringify(analysis) }, finish_reason: "stop" }],
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
});
