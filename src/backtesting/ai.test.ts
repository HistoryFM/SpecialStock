import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ getServerEnv: () => ({ OPENROUTER_API_KEY: "mock-key", OPENROUTER_API_URL: "https://provider.example.test" }) }));

import { analyzeRun, interpretStrategy } from "./ai";
import type { RunResult, Strategy } from "./types";

const response = (model: string, content: unknown) => Response.json({ model, choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 50 }, cost: 0.01 } });

afterEach(() => vi.unstubAllGlobals());

describe("backtesting AI boundary", () => {
  it("requests high reasoning and safely canonicalizes a singleton rule from JSON mode", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string);
      expect(request.model).toBe("anthropic/claude-opus-5");
      expect(request.reasoning.effort).toBe("high");
      expect(request.response_format.type).toBe("json_object");
      expect(request.provider.require_parameters).toBe(true);
      return response(request.model, { clarification: null, strategy: { entry: { kind: "price_sma", period: "50-day", relation: "crosses_above" }, exit: { kind: "price_sma", period: "50", relation: "crosses_below" } } });
    });
    vi.stubGlobal("fetch", fetcher);
    const parsed = await interpretStrategy("Explicit SMA cross rules", "anthropic/claude-opus-5");
    expect(parsed.value.strategy?.entry).toEqual([{ kind: "price_sma", period: 50, relation: "crosses_above" }]);
    expect(parsed.usage.reasoningTokens).toBe(50);
    expect(parsed.usage.costUsd).toBe(0.01);
  });

  it("rejects incomplete model rules and a different model response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("openai/gpt-5.6-sol", { clarification: "", strategy: { longEntry: [] } })));
    await expect(interpretStrategy("Enter and exit explicitly", "openai/gpt-5.6-sol")).rejects.toThrow(/failed validation/);
    vi.stubGlobal("fetch", vi.fn(async () => response("google/gemini-2.5-pro", { clarification: "", strategy: null })));
    await expect(interpretStrategy("Enter and exit explicitly", "openai/gpt-5.6-sol")).rejects.toThrow(/instead of the selected model/);
  });

  it("keeps measured commentary while omitting an invalid proposed strategy", async () => {
    const strategy: Strategy = { entry: [{ kind: "price_sma", period: 50, relation: "crosses_above" }], exit: [{ kind: "price_sma", period: 50, relation: "crosses_below" }], rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, macdFast: 12, macdSlow: 26, macdSignal: 9 };
    const result: RunResult = { startDate: "2020-01-02", endDate: "2020-01-03", dates: ["2020-01-02", "2020-01-03"], series: [{ ticker: "STRATEGY", values: [1000, 990] }], annual: [], drawdowns: [], trades: [], fileIds: {}, warnings: [] };
    vi.stubGlobal("fetch", vi.fn(async () => response("openai/gpt-5.6-sol", {
      summary: "The measured balance fell to $990.", riskNotes: ["The price series lost value."],
      suggestions: [
        { title: "Invalid rule", reason: "Untested", strategy: { ...strategy, entry: [{ kind: "rsi", threshold: 40, relation: "under" }] } },
        { title: "Valid rule", reason: "Untested", strategy: { ...strategy, entry: [...strategy.entry, { kind: "rsi", threshold: 40, relation: "below" }] } },
      ],
    })));
    const commentary = await analyzeRun({ model: "openai/gpt-5.6-sol", prompt: "Trade SMA crossovers", strategy, result });
    expect(commentary.summary).toBe("The measured balance fell to $990.");
    expect(commentary.suggestions.map((suggestion) => suggestion.title)).toEqual(["Valid rule"]);
    expect(commentary.riskNotes[0]).toMatch(/1 unsupported AI suggestion was omitted/);
    expect(commentary.usage.costUsd).toBe(0.01);
  });
});
