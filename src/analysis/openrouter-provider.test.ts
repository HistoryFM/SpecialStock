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
  it.each(["manual_compact", "routine_compact"] as const)("sends one image and the versioned quality profile for %s", async (usageClass) => {
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
      usageClass,
      maxAttempts: 1,
    });

    expect(requestBody.model).toBe("google/gemini-2.5-pro");
    expect(requestBody.max_tokens).toBe(2_560);
    expect(requestBody.reasoning).toEqual({ max_tokens: 2_048, exclude: true });
    expect(requestBody.reasoning).not.toHaveProperty("effort");
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
        "specialstock.analysis.usage_class": usageClass,
        "specialstock.inference.profile": "compact-quality-v2",
        "specialstock.request.thinking_budget_tokens": 2_048,
        "specialstock.request.reasoning_excluded": true,
        "specialstock.provider.timeout_ms": 90_000,
        "gen_ai.request.max_tokens": 2_560,
      },
    });
    const telemetryInput = String(span.attributes["gen_ai.input.messages"]);
    expect(telemetryInput).not.toContain("chart is the sole source");
    const telemetryMessages = JSON.parse(telemetryInput) as Array<{
      parts: Array<{ type: string; content: string }>;
    }>;
    const imageMetadata = JSON.parse(telemetryMessages[0]!.parts[1]!.content) as {
      byte_length: number;
    };
    expect(imageMetadata.byte_length).toBe(9);
    expect(telemetryInput).not.toContain("data:image/png;base64");
    expect(telemetryInput).not.toContain("test-openrouter-key");
    expect(String(span.attributes["gen_ai.output.messages"])).toContain("compact_signal");
    expect(String(span.attributes["gen_ai.output.messages"])).not.toContain("bullish");
    expect(span.attributes["specialstock.cost.estimated"]).toBe(true);
    expect(span.attributes["specialstock.cost.source"]).toBe("estimated");
    expect(span.attributes["gen_ai.usage.reasoning_tokens"]).toBeUndefined();
    expect(span.statuses).toEqual([{ code: 1 }]);
    expect(sentry.info).toHaveBeenCalledWith(
      "Gemini visual analysis completed",
      expect.objectContaining({ phase: "compact", usage_class: usageClass }),
    );
  });

  it("limits overlapping scheduled and manual compact provider attempts to ten", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      resolvers.push((response) => {
        active -= 1;
        resolve(response);
      });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = () => Response.json({
      model: "google/gemini-2.5-pro",
      provider: "google",
      choices: [{ message: { content: JSON.stringify(wireAnalysis) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.01 },
    });
    const calls = Array.from({ length: 12 }, (_, index) =>
      new OpenRouterAnalysisModelProvider().analyze({
        frozen, png: Buffer.from(`png-${index}`), model: "google/gemini-2.5-pro",
        phase: "compact", usageClass: index % 2 ? "manual_compact" : "routine_compact", maxAttempts: 1,
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(10));
    expect(peak).toBe(10);
    resolvers.shift()?.(response());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(11));
    resolvers.shift()?.(response());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(12));
    resolvers.splice(0).forEach((resolve) => resolve(response()));
    const results = await Promise.all(calls);
    expect(results.every((result) => result.inferenceProfile === "compact-quality-v2")).toBe(true);
    expect(peak).toBe(10);
  });

  it.each([0, 1_800])("retains %i reasoning tokens in audit usage and telemetry without retaining reasoning text", async (reasoningTokens) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      model: "google/gemini-2.5-pro",
      choices: [{ message: { content: JSON.stringify(wireAnalysis), reasoning: "private thinking" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1_200, completion_tokens: reasoningTokens + 80, cost: 0.025,
        completion_tokens_details: { reasoning_tokens: reasoningTokens },
      },
    })));

    const result = await new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro",
      phase: "compact", usageClass: "manual_compact", maxAttempts: 1,
    });

    expect(result.analysis).toEqual(analysis);
    expect(result.rawResponse).toMatchObject({ usage: { completion_tokens_details: { reasoning_tokens: reasoningTokens } } });
    expect(result.attempts[0]?.rawResponse).toEqual(result.rawResponse);
    expect(result.attempts[0]).toMatchObject({
      reasoningTokens,
      failureKind: null,
      requestSettings: {
        inferenceProfile: "compact-quality-v2",
        max_tokens: 2_560,
        provider_timeout_ms: 90_000,
        reasoning: { max_tokens: 2_048, exclude: true },
      },
    });
    expect(result.outputTokens).toBe(reasoningTokens + 80);
    expect(result.costUsd).toBe(0.025);
    expect(sentry.spans[0]?.attributes["gen_ai.usage.reasoning_tokens"]).toBe(reasoningTokens);
    expect(sentry.info).toHaveBeenCalledWith("Gemini visual analysis completed", expect.objectContaining({ reasoning_tokens: reasoningTokens }));
    expect(JSON.stringify([result.rawResponse, sentry.spans, sentry.info.mock.calls])).not.toContain("private thinking");
  });

  it("allows compact thinking beyond 45 seconds, aborts at 90 seconds, and does not retry", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.stubGlobal("fetch", vi.fn((_url, init?: RequestInit) => new Promise((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })));
      const pending = new OpenRouterAnalysisModelProvider().analyze({
        frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro",
        phase: "compact", usageClass: "manual_compact", maxAttempts: 2,
      });
      const rejected = expect(pending).rejects.toMatchObject({ metadata: { status: "timed_out", costUsd: 0.06, attempts: [{ failureKind: "timeout" }] } });
      await vi.advanceTimersByTimeAsync(45_001);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(44_999);
      await rejected;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports token-limit truncation without retrying a manual attempt", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      model: "google/gemini-2.5-pro",
      provider: "google",
      choices: [{ message: { content: "{" }, finish_reason: "length" }],
      usage: { prompt_tokens: 1_200, completion_tokens: 2_560, cost: 0.05, completion_tokens_details: { reasoning_tokens: 2_048 } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenRouterAnalysisModelProvider().analyze({
      frozen,
      png: Buffer.from("png"),
      model: "google/gemini-2.5-pro",
      phase: "compact",
      usageClass: "manual_compact",
      maxAttempts: 2,
    })).rejects.toMatchObject({
      message: expect.stringMatching(/token budget/),
      metadata: { status: "invalid", requestedModel: "google/gemini-2.5-pro", attempts: [{ failureKind: "token_limit" }] },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sentry.spans[0]?.attributes["gen_ai.usage.reasoning_tokens"]).toBe(2_048);
    expect(sentry.warn).toHaveBeenCalledWith("Gemini visual analysis failed", expect.objectContaining({ reasoning_tokens: 2_048, failure_kind: "token_limit" }));
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
    })).resolves.toMatchObject({ analysis, costUsd: 0.12, attempts: [{ status: "invalid", failureKind: "empty_response" }, { status: "valid", failureKind: null }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 2_560, reasoning: { max_tokens: 2_048, exclude: true } });
    }
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

  it("retries a zero-token provider finish error with a precise classification", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        model: "google/gemini-2.5-pro", provider: "google",
        choices: [{ message: { content: null }, finish_reason: "error" }],
        usage: { prompt_tokens: 1_000, completion_tokens: 0, completion_tokens_details: { reasoning_tokens: 0 } },
      }))
      .mockResolvedValueOnce(Response.json({
        model: "google/gemini-2.5-pro", provider: "google",
        choices: [{ message: { content: JSON.stringify(wireAnalysis) }, finish_reason: "stop" }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro",
      phase: "compact", usageClass: "routine_compact", maxAttempts: 2,
    });
    expect(result.attempts).toMatchObject([
      { outputTokens: 0, reasoningTokens: 0, failureKind: "provider_finish_error" },
      { status: "valid" },
    ]);
  });

  it("strips reasoning text even when the provider response has an invalid structure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      model: "google/gemini-2.5-pro",
      reasoning: "top-level private thinking",
      choices: [{ message: { reasoning: "nested private thinking" } }],
    })));
    const error = await new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro",
      phase: "compact", usageClass: "manual_compact", maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    const stored = (error as { metadata: { attempts: Array<{ rawResponse: unknown; failureKind: string }> } }).metadata.attempts[0]!;
    expect(stored.failureKind).toBe("invalid_structure");
    expect(JSON.stringify(stored.rawResponse)).not.toContain("private thinking");
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
    expect(String(sentry.spans[1]?.attributes["gen_ai.input.messages"])).not.toContain("Retry correction:");
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
    expect(String(span.attributes["gen_ai.input.messages"])).not.toContain("Locked compact signal");
    expect(String(span.attributes["gen_ai.input.messages"])).not.toContain("data:image/png;base64");
    expect(String(span.attributes["gen_ai.output.messages"])).toContain("full_analysis");
    expect(String(span.attributes["gen_ai.output.messages"])).not.toContain("Bullish visual structure");
    expect(span.attributes["gen_ai.cost.total_tokens"]).toBe(0.02);
  });

  it("does not retry or estimate spend for authentication failures", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OpenRouterAnalysisModelProvider().analyze({
      frozen, png: Buffer.from("png"), model: "google/gemini-2.5-pro",
      phase: "compact", usageClass: "manual_compact", maxAttempts: 2,
    })).rejects.toMatchObject({
      metadata: { costUsd: 0, attempts: [{ estimatedCostUsd: null, failureKind: "http_terminal" }] },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
