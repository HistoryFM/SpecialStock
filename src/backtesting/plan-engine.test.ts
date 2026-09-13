import { describe, expect, it } from "vitest";

import { runPlannedBacktest } from "./plan-engine";
import { strategyPlanSchema, type StrategyPlan } from "./plan";
import type { PriceRow } from "./types";

const warmup = Array.from({ length: 55 }, (_, index) => new Date(Date.UTC(2021, 9, 1 + index)).toISOString().slice(0, 10));
const dates = [...warmup, "2022-01-03", "2022-01-04", "2022-01-05", "2022-01-06"];
const file = (ticker: string, tail: number[]) => ({ id: ticker, rows: dates.map((date, index): PriceRow => ({ date, close: index < warmup.length ? 100 : tail[index - warmup.length], open: null, high: null, low: null, volume: null })) });
const files = { TQQQ: file("TQQQ", [100, 120, 60, 70]), QQQ: file("QQQ", [110, 121, 90, 80]), SPY: file("SPY", [100, 101, 102, 103]) };
const above = { kind: "price_sma" as const, ticker: "QQQ", period: 50 as const, bandPct: 0, relation: "crosses_above" as const };
const below = { ...above, relation: "crosses_below" as const };
const plan: StrategyPlan = strategyPlanSchema.parse({ version: 2, settings: { startingCapital: 1000, cashRate: 0, borrowRate: 0, slippage: 0, fee: 0, startDate: "first_january" },
  states: [{ id: "long", label: "Long TQQQ", allocations: [{ ticker: "TQQQ", side: "long", percent: 100 }] },
    { id: "short", label: "Short QQQ", allocations: [{ ticker: "QQQ", side: "short", percent: 50 }] }],
  transitions: [{ from: "cash", to: "long", when: { any: [[above]] } }, { from: "long", to: "short", when: { any: [[below]] } }], stops: [], assumptions: [] });

describe("confirmed multi-asset plans", () => {
  it("uses QQQ signals to trade TQQQ, then marks a 50% QQQ short and free cash separately", () => {
    const result = runPlannedBacktest({ ...plan, settings: { ...plan.settings, cashRate: 2, borrowRate: 1 } }, files);
    expect(result.startDate).toBe("2022-01-03");
    expect(result.trades.map((trade) => trade.intent)).toEqual(["buy_long", "sell_long", "open_short"]);
    expect(result.series[0].values[0]).toBe(1000);
    expect(result.series[0].values[1]).toBe(1200);
    expect(result.series[0].values[2]).toBe(600);
    expect(result.series[0].values[3]).toBeCloseTo(600 + 300 * (10 / 90) + 300 * (Math.pow(1.02, 1 / 365) - 1) - 300 * .01 / 365);
    expect(result.trades[2].closePrices).toMatchObject({ QQQ: 90, TQQQ: 60, SPY: 102 });
  });

  it("uses percent bands, ordered phases, and partial allocations without daily rebalancing", () => {
    const variant = { ...plan, states: [{ id: "half", label: "Half TQQQ", allocations: [{ ticker: "TQQQ", side: "long" as const, percent: 50 }] },
      { id: "full", label: "Full TQQQ", allocations: [{ ticker: "TQQQ", side: "long" as const, percent: 100 }] }],
      transitions: [{ from: "cash", to: "half", when: { any: [[{ ...above, bandPct: 5 }]] } },
        { from: "half", to: "full", when: { any: [[{ ...above, relation: "above" as const }]] } }] };
    const result = runPlannedBacktest(strategyPlanSchema.parse(variant), files);
    expect(result.trades.map((trade) => trade.intent)).toEqual(["buy_long", "buy_long"]);
    expect(result.series[0].values[1]).toBe(1100);
    expect(result.trades[1].date).toBe("2022-01-04");
  });

  it("gives a close-based position stop priority over a simultaneous phase transition", () => {
    const result = runPlannedBacktest({ ...plan, stops: [{ ticker: "TQQQ", fixedPct: 10, trailingPct: 15 }] }, files);
    expect(result.trades.map((trade) => trade.intent)).toEqual(["buy_long", "sell_long"]);
    expect(result.trades[1]).toMatchObject({ date: "2022-01-05", reason: "stop loss" });
    expect(result.series[0].values.at(-1)).toBe(600);
  });

  it("uses a trailing peak for long stops and the entry cost for short stops", () => {
    const trailingFiles = { ...files, TQQQ: file("TQQQ", [100, 120, 108, 110]) };
    const trailing = runPlannedBacktest({ ...plan, stops: [{ ticker: "TQQQ", trailingPct: 10 }] }, trailingFiles);
    expect(trailing.trades.map((trade) => [trade.intent, trade.date])).toEqual([["buy_long", "2022-01-03"], ["sell_long", "2022-01-05"]]);
    expect(trailing.trades[1].reason).toBe("stop loss");
    const shortFiles = { ...files, QQQ: file("QQQ", [110, 121, 90, 120]) };
    const stoppedShort = runPlannedBacktest({ ...plan, stops: [{ ticker: "QQQ", fixedPct: 10 }] }, shortFiles);
    expect(stoppedShort.trades.at(-1)).toMatchObject({ intent: "cover_short", date: "2022-01-06", reason: "stop loss" });
    expect(stoppedShort.series[0].values.at(-1)).toBeCloseTo(500);
  });

  it("rejects leverage, missing or unaligned prices, and exhausted equity", () => {
    expect(() => strategyPlanSchema.parse({ ...plan, states: [{ id: "long", label: "Too much", allocations: [{ ticker: "TQQQ", side: "long", percent: 101 }] }] })).toThrow();
    expect(() => runPlannedBacktest(plan, { ...files, SPY: { ...files.SPY, rows: files.SPY.rows.filter((row) => row.date !== "2022-01-04") } })).toThrow(/unaligned/);
    expect(() => runPlannedBacktest({ ...plan, settings: { ...plan.settings, fee: 1000 } }, files)).toThrow(/exhaust/);
  });
});
