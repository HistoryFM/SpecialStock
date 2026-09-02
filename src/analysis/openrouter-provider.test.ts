import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterAnalysisModelProvider } from "@/analysis/openrouter-provider";
import type { ChartAnalysisInput } from "@/analysis/types";

const sentry = vi.hoisted(() => {
  const spans: Array<{
    options: { name: string; op: string; attributes: Record<string, unknown> };
    attributes: Record<string, unknown>;
    statuses: Array<{ code: number; message?: string }>;
  }> = [];
  const info = vi.fn();
  const warn = vi.fn();
  const startSpan = vi.fn(async (
    options: { name: string; op: string; attributes: Record<string, unknown> },
    callback: (span: {
      setAttribute: (key: string, value: unknown) => void;
      setAttributes: (attributes: Record<string, unknown>) => void;
      setStatus: (status: { code: number; message?: string }) => void;
    }) => unknown,
  ) => {
    const recorded = {
      options,
      attributes: { ...options.attributes },
      statuses: [] as Array<{ code: number; message?: string }>,
    };
    spans.push(recorded);
    return callback({
      setAttribute: (key, value) => { recorded.attributes[key] = value; },
      setAttributes: (attributes) => { Object.assign(recorded.attributes, attributes); },
      setStatus: (status) => { recorded.statuses.push(status); },
    });
  });
  return { spans, info, warn, startSpan };
});

vi.mock("@sentry/nextjs", () => ({
  startSpan: sentry.startSpan,
  logger: { info: sentry.info, warn: sentry.warn },
}));

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
const fullAnalysis = {
  setup_type: "Breakout",
  immediate_bias: "Momentum remains constructive.",
  broader_trend: "The visible trend points higher.",
  candlestick_analysis: "Recent candles show higher closes.",
  vwap_keltner_analysis: "Price is holding above VWAP.",
  cci_analysis: "CCI remains positive.",
  indicator_readings: Object.fromEntries(
    ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"]
      .map((key) => [key, { stance: "bullish", readability: "clear", observation: `${key} is legible.` }]),
  ),
  supporting_evidence: ["Higher lows support continuation."],
  conflicting_evidence: ["Resistance remains nearby."],
  support_levels: [98],
  resistance_levels: [104],
  deeper_scenario: "Continuation depends on support holding.",
  data_quality_flags: [],
  summary: "Bullish visual structure.",
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a-secure-test-secret-that-is-at-least-32-characters");
  vi.stubEnv("APP_PASSWORD_HASH", "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  sentry.spans.length = 0;
  sentry.startSpan.mockClear();
  sentry.info.mockClear();
  sentry.warn.mockClear();
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
      phase: "compact",
      usageClass: "manual_compact",
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
    const compactSchema = (requestBody.response_format as {
      json_schema: { schema: { anyOf: Array<{ properties: Record<string, { type?: string; enum?: string[] }> }> } };
    }).json_schema.schema;
    expect(compactSchema.anyOf).toHaveLength(3);
    expect(compactSchema.anyOf[0]?.properties.p.type).toBe("number");
    expect(compactSchema.anyOf[2]?.properties.t.type).toBe("null");

    expect(sentry.spans).toHaveLength(1);
    const span = sentry.spans[0]!;
    expect(span.options).toMatchObject({
      name: "chat google/gemini-2.5-pro",
      op: "gen_ai.chat",
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "google/gemini-2.5-pro",
        "specialstock.analysis.phase": "compact",
        "specialstock.analysis.usage_class": "manual_compact",
      },
    });
    const telemetryInput = String(span.attributes["gen_ai.input.messages"]);
    expect(telemetryInput).toContain("chart is the sole source");
    const telemetryMessages = JSON.parse(telemetryInput) as Array<{
      parts: Array<{ type: string; content: string }>;
    }>;
    const imageMetadata = JSON.parse(telemetryMessages[0]!.parts[1]!.content) as {
      byte_length: number;
    };
    expect(imageMetadata.byte_length).toBe(9);
    expect(telemetryInput).not.toContain("data:image/png;base64");
    expect(telemetryInput).not.toContain("test-openrouter-key");
    expect(String(span.attributes["gen_ai.output.messages"])).toContain("bullish");
    expect(span.attributes["specialstock.cost.estimated"]).toBe(true);
    expect(span.attributes["specialstock.cost.source"]).toBe("estimated");
    expect(span.statuses).toEqual([{ code: 1 }]);
    expect(sentry.info).toHaveBeenCalledWith(
      "Gemini visual analysis completed",
      expect.objectContaining({ phase: "compact", usage_class: "manual_compact" }),
    );
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
      phase: "compact",
      usageClass: "manual_compact",
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
      phase: "compact",
      usageClass: "routine_compact",
      maxAttempts: 2,
    })).resolves.toMatchObject({ analysis, costUsd: 0.03, attempts: [{ status: "invalid" }, { status: "valid" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentry.spans).toHaveLength(2);
    expect(sentry.spans[0]?.attributes).toMatchObject({
      "specialstock.analysis.status": "invalid",
      "specialstock.analysis.will_retry": true,
      "specialstock.analysis.retry_outcome": "retrying",
      "specialstock.cost.estimated": true,
      "specialstock.cost.source": "estimated",
    });
    expect(sentry.spans[0]?.statuses[0]).toMatchObject({ code: 2 });
    expect(sentry.spans[1]?.attributes).toMatchObject({
      "specialstock.analysis.status": "valid",
      "specialstock.analysis.will_retry": false,
      "specialstock.analysis.retry_outcome": "terminal",
    });
    expect(sentry.warn).toHaveBeenCalledWith(
      "Gemini visual analysis failed",
      expect.objectContaining({ usage_class: "routine_compact", will_retry: true }),
    );
    expect(sentry.info).toHaveBeenCalledWith(
      "Gemini visual analysis completed",
      expect.objectContaining({ usage_class: "routine_compact", attempt: 2 }),
    );
  });

  it("adds safe corrective instructions after a directional validation failure", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      const content = requestBodies.length === 1
        ? { p: null, v: "bullish", c: "high", t: null, i: null, q: "clear" }
        : wireAnalysis;
      return Response.json({
        model: "google/gemini-2.5-pro",
        provider: "google",
        choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenRouterAnalysisModelProvider().analyze({
      frozen,
      png: Buffer.from("png"),
      model: "google/gemini-2.5-pro",
      phase: "compact",
      usageClass: "routine_compact",
      maxAttempts: 2,
    })).resolves.toMatchObject({ analysis, attempts: [{ status: "invalid" }, { status: "valid" }] });

    const secondMessages = requestBodies[1]!.messages as Array<{
      content: Array<{ type: string; text?: string }>;
    }>;
    expect(secondMessages[0]?.content[0]?.text).toContain("Retry correction:");
    expect(secondMessages[0]?.content[0]?.text).toContain("directional analysis requires observed price");
    expect(String(sentry.spans[1]?.attributes["gen_ai.input.messages"])).toContain("Retry correction:");
    expect(sentry.spans[0]?.attributes["gen_ai.output.messages"]).toBeUndefined();
    expect(JSON.stringify(sentry.spans)).not.toContain("test-openrouter-key");
    expect(JSON.stringify(sentry.spans)).not.toContain("data:image/png;base64");
  });

  it("attaches reconciled usage and cost to the originating attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({
        id: "generation-id",
        model: "google/gemini-2.5-pro",
        provider: "google",
        choices: [{ message: { content: JSON.stringify(wireAnalysis) }, finish_reason: "stop" }],
      }))
      .mockResolvedValueOnce(Response.json({
        data: { native_tokens_prompt: 321, native_tokens_completion: 123, total_cost: 0.00456 },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro",
      phase: "compact", usageClass: "manual_compact", maxAttempts: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentry.spans[0]?.attributes).toMatchObject({
      "gen_ai.response.id": "generation-id",
      "gen_ai.usage.input_tokens": 321,
      "gen_ai.usage.output_tokens": 123,
      "gen_ai.usage.total_tokens": 444,
      "gen_ai.cost.total_tokens": 0.00456,
      "specialstock.cost.estimated": false,
      "specialstock.cost.source": "exact",
    });
    expect(sentry.info).toHaveBeenCalledWith(
      "Gemini visual analysis completed",
      expect.objectContaining({
        input_tokens: 321, output_tokens: 123, cost_usd: 0.00456, cost_is_estimate: false,
      }),
    );
  });

  it("labels stored-chart full analysis without placing chart bytes in telemetry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "full-generation-id",
      model: "google/gemini-2.5-pro",
      provider: "google",
      choices: [{ message: { content: JSON.stringify(fullAnalysis) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1_200, completion_tokens: 700, cost: 0.02 },
    })));

    await new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("full-png"), model: "google/gemini-2.5-pro",
      phase: "full", usageClass: "full_analysis", maxAttempts: 1,
      lockedSignal: {
        observedPrice: 100, verdict: "bullish", conviction: "high", target: 104, invalidation: 97,
      },
    });

    const span = sentry.spans[0]!;
    expect(span.options.attributes).toMatchObject({
      "specialstock.analysis.phase": "full",
      "specialstock.analysis.usage_class": "full_analysis",
      "gen_ai.request.max_tokens": 3_200,
      "gen_ai.request.reasoning.level": "low",
    });
    expect(String(span.attributes["gen_ai.input.messages"])).toContain("Locked compact signal");
    expect(String(span.attributes["gen_ai.input.messages"])).not.toContain("data:image/png;base64");
    expect(String(span.attributes["gen_ai.output.messages"])).toContain("Bullish visual structure");
    expect(span.attributes["gen_ai.cost.total_tokens"]).toBe(0.02);
  });

  it("does not retry or estimate spend for authentication failures", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro",
      phase: "compact", usageClass: "manual_compact", maxAttempts: 2,
    })).rejects.toMatchObject({
      metadata: { costUsd: 0, attempts: [{ estimatedCostUsd: null }] },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
