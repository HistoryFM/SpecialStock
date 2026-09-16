import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ getServerEnv: () => ({ OPENROUTER_API_KEY: "mock-key", OPENROUTER_API_URL: "https://provider.example.test" }) }));

import { analyzeRun, chatAboutPlannedRun, continuePlanConversation, interpretPlan, interpretStrategy } from "./ai";
import type { RunResult, Strategy } from "./types";

const response = (model: string, content: unknown) => Response.json({ model, choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 50 }, cost: 0.01 } });

afterEach(() => vi.unstubAllGlobals());

describe("backtesting AI boundary", () => {
  it("normalizes explicit percentage-point rates and rejects invented assets", async () => {
    const plan = { version: 2, settings: { startingCapital: 1000, cashRate: 0.025, borrowRate: 0, slippage: 0, fee: 0, startDate: "first_january" },
      states: [{ id: "long", label: "Long TQQQ", allocations: [{ ticker: "TQQQ", side: "long", percent: 100 }] }],
      transitions: [{ from: "cash", to: "long", when: { any: [[{ kind: "price_sma", ticker: "TQQQ", period: 50, bandPct: 0, relation: "crosses_above" }]] } }], stops: [], assumptions: [] };
    vi.stubGlobal("fetch", vi.fn(async () => response("google/gemini-2.5-pro", { clarification: "", plan })));
    const parsed = await interpretPlan("Start with 2.5% annual interest on cash. Buy TQQQ at the 50-day crossover.", "google/gemini-2.5-pro", ["TQQQ", "SPY", "QQQ"]);
    expect(parsed.value.plan?.settings.cashRate).toBe(2.5);
    expect(parsed.value.plan?.assumptions).toContain("Cash interest normalized to the stated 2.5%.");
    const missing = await interpretPlan("Buy TQQQ at the 50-day crossover.", "google/gemini-2.5-pro", ["SPY", "QQQ"]);
    expect(missing.value.plan).toBeNull();
    expect(missing.value.clarification).toMatch(/without an uploaded CSV/);
  });
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

  it("canonicalizes common JSON-mode plan shapes without weakening plan validation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("openai/gpt-5.6-sol", {
      reply: "The strategy is ready for review.",
      plan: {
        version: "3",
        settings: { startingCapital: "1000", cashRate: "2.5", borrowRate: "0", slippage: "0", fee: "0", timeframe: "weekly", startDate: "2024-01-05" },
        states: { id: "long_tqqq", label: "Long TQQQ", allocations: { ticker: "TQQQ", side: "long", percent: "100" } },
        transitions: [
          { from: "cash", to: "long_tqqq", when: { any: [[{ kind: "price_sma", ticker: "TQQQ", period: "50", bandPct: "0", relation: "crosses_above" }]] } },
          { from: "long_tqqq", to: "cash", when: { any: [[{ kind: "price_sma", ticker: "TQQQ", period: "50", bandPct: "0", relation: "crosses_below" }]] } },
        ],
        stops: [], assumptions: "All requested settings are explicit.",
      },
    })));
    const parsed = await continuePlanConversation({ model: "openai/gpt-5.6-sol", timeframe: "weekly", availableTickers: ["TQQQ", "SPY", "QQQ"],
      turns: [{ id: "11111111-1111-4111-8111-111111111111", role: "user", content: "Use the explicit weekly crossover plan.", at: "2026-01-01T00:00:00.000Z" }] });
    expect(parsed.value.plan).toMatchObject({ version: 3, settings: { timeframe: "weekly", cashRate: 2.5 },
      states: [{ label: "Long TQQQ", allocations: [{ percent: 100 }] }] });
  });

  it("renders a structured result-chat answer as readable text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("google/gemini-2.5-pro", { answer: { maximum_drawdown: "-27.45%", period: "2024-03-29 to 2024-06-21" } })));
    const plan = { version: 3 as const, settings: { startingCapital: 1000, cashRate: 2.5, borrowRate: 0, slippage: 0, fee: 0, timeframe: "weekly" as const, startDate: "2024-01-05" },
      states: [{ id: "long_tqqq", label: "Long TQQQ", allocations: [{ ticker: "TQQQ", side: "long" as const, percent: 100 }] }],
      transitions: [{ from: "cash", to: "long_tqqq", when: { any: [[{ kind: "price_sma" as const, ticker: "TQQQ", period: 50 as const, bandPct: 0, relation: "crosses_above" as const }]] } }], stops: [], assumptions: [] };
    const result: RunResult = { startDate: "2024-01-05", endDate: "2024-07-12", dates: ["2024-01-05", "2024-07-12"], series: [{ ticker: "Strategy", values: [1000, 1044.79] }],
      annual: [], drawdowns: [{ ticker: "Strategy", percent: -27.45, peakDate: "2024-03-29", troughDate: "2024-06-21" }], trades: [], fileIds: {}, warnings: [] };
    const parsed = await chatAboutPlannedRun({ model: "google/gemini-2.5-pro", prompt: "Weekly crossover", plan, result,
      turns: [{ id: "11111111-1111-4111-8111-111111111111", role: "user", content: "What was the drawdown?", at: "2026-01-01T00:00:00.000Z" }] });
    expect(parsed.value.answer).toContain("maximum drawdown: -27.45%");
    expect(parsed.value.answer).toContain("period: 2024-03-29 to 2024-06-21");
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
