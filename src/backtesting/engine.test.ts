import { describe, expect, it } from "vitest";

import { calculateIndicators, runBacktest } from "./engine";
import type { PriceRow, RunInput, Strategy } from "./types";

const dates = Array.from({ length: 60 }, (_, index) => new Date(Date.UTC(2021, 10, 2 + index)).toISOString().slice(0, 10));
const allDates = [...dates, "2022-01-03", "2022-01-04", "2022-01-05", "2022-01-06"];
function rows(last: number[]): PriceRow[] {
  return allDates.map((date, index) => ({ date, close: index < 60 ? 100 : last[index - 60], open: null, high: null, low: null, volume: null }));
}
const files = {
  LONG: { id: "long", rows: rows([110, 121, 90, 80]) },
  INV: { id: "inverse", rows: rows([50, 49, 48, 52]) },
  SPY: { id: "spy", rows: rows([100, 101, 102, 103]) },
  QQQ: { id: "qqq", rows: rows([100, 102, 101, 104]) },
};
const strategy: Strategy = { entry: [{ kind: "price_sma", period: 50, relation: "crosses_above" }], exit: [{ kind: "price_sma", period: 50, relation: "crosses_below" }], rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, macdFast: 12, macdSlow: 26, macdSignal: 9 };
const base: RunInput = { longTicker: "LONG", comparisons: [], mode: "cash", startingCapital: 1000, cashRate: 0, slippage: 0, fee: 0, prompt: "Enter above SMA50, exit below SMA50", model: "google/gemini-2.5-pro", strategy };

describe("historical backtesting", () => {
  it("warms SMA, RSI, and MACD using only prior and current closes", () => {
    const closes = Array.from({ length: 210 }, (_, index) => index + 1);
    const indicators = calculateIndicators(closes, strategy);
    expect(indicators.sma50[48]).toBeNull();
    expect(indicators.sma50[49]).toBeCloseTo(25.5);
    expect(indicators.sma200[198]).toBeNull();
    expect(indicators.sma200[199]).toBeCloseTo(100.5);
    expect(indicators.rsi[13]).toBeNull();
    expect(indicators.rsi[14]).toBe(100);
    expect(indicators.macd[24]).toBeNull();
    expect(indicators.signal[33]).not.toBeNull();
    const flat = calculateIndicators(Array(210).fill(100), strategy);
    expect(flat.rsi[14]).toBe(50);
    expect(flat.macd[50]).toBeCloseTo(0);
    expect(flat.signal[50]).toBeCloseTo(0);
  });

  it("credits the previous holding before a same-close switch and compares full-period drawdown", () => {
    const result = runBacktest(base, files);
    expect(result.startDate).toBe("2022-01-03");
    expect(result.trades.map((trade) => [trade.date, trade.action])).toEqual([["2022-01-03", "buy"], ["2022-01-05", "sell"]]);
    expect(result.series[0].values).toEqual([1000, 1100, 1100 * 90 / 121, 1100 * 90 / 121]);
    expect(result.series.map((series) => series.ticker)).toEqual(["Strategy", "SPY", "QQQ"]);
    expect(result.annual).toHaveLength(1);
    expect(result.annual[0].returns.SPY).toBeCloseTo(3);
    expect(result.drawdowns[0].peakDate).toBe("2022-01-04");
    expect(result.drawdowns[0].troughDate).toBe("2022-01-05");
    expect(result.drawdowns[0].percent).toBeCloseTo((90 / 121 - 1) * 100);
  });

  it("does not invent a late crossover when an AND filter fails on the crossover day", () => {
    const filtered = { ...base, strategy: { ...strategy, entry: [...strategy.entry, { kind: "rsi" as const, relation: "below" as const, threshold: 30 }] } };
    const result = runBacktest(filtered, files);
    expect(result.trades).toHaveLength(0);
    expect(result.series[0].values).toEqual([1000, 1000, 1000, 1000]);
  });

  it("charges both legs and earns inverse returns only after the exit close", () => {
    const result = runBacktest({ ...base, mode: "inverse", inverseTicker: "INV", fee: 1 }, files);
    expect(result.trades.map((trade) => `${trade.action} ${trade.ticker}`)).toEqual(["buy LONG", "sell LONG", "buy INV"]);
    expect(result.series[0].values[2]).toBeCloseTo(999 * 90 / 110 - 2);
    expect(result.series[0].values[3]).toBeCloseTo((999 * 90 / 110 - 2) * 52 / 48);
  });

  it("charges slippage on each execution and compounds cash over elapsed calendar days", () => {
    const slipped = runBacktest({ ...base, slippage: 1 }, files);
    expect(slipped.series[0].values[0]).toBeCloseTo(1000 / 1.01);
    expect(slipped.series[0].values[2]).toBeCloseTo((1000 / 1.01) * 90 / 110 * 0.99);
    const filtered = { ...base, cashRate: 10, strategy: { ...strategy, entry: [...strategy.entry, { kind: "rsi" as const, relation: "below" as const, threshold: 30 }] } };
    const cash = runBacktest(filtered, files);
    expect(cash.trades).toHaveLength(0);
    expect(cash.series[0].values.at(-1)).toBeCloseTo(1000 * Math.pow(1.1, 3 / 365));
  });

  it("uses the prior year close for annual returns and one full-period drawdown", () => {
    const extendedDates = [...allDates, "2022-12-30", "2023-01-03", "2023-01-04"];
    const extend = (file: PriceRow[], closes: number[]) => [...file, ...closes.map((close, index) => ({ ...file.at(-1)!, date: extendedDates[allDates.length + index], close }))];
    const extended = {
      ...files,
      LONG: { ...files.LONG, rows: extend(files.LONG.rows, [80, 80, 80]) },
      SPY: { ...files.SPY, rows: extend(files.SPY.rows, [110, 90, 99]) },
      QQQ: { ...files.QQQ, rows: extend(files.QQQ.rows, [104, 104, 104]) },
    };
    const result = runBacktest(base, extended);
    expect(result.annual.map((row) => row.year)).toEqual(["2022", "2023 YTD"]);
    expect(result.annual[0].returns.SPY).toBeCloseTo(10);
    expect(result.annual[1].returns.SPY).toBeCloseTo(-10);
    expect(result.drawdowns.find((item) => item.ticker === "SPY")?.percent).toBeCloseTo((90 / 110 - 1) * 100);
  });

  it("requires the chosen comparison window to have exact matching dates", () => {
    const missing = { ...files, QQQ: { ...files.QQQ, rows: files.QQQ.rows.filter((row) => row.date !== "2022-01-04") } };
    expect(() => runBacktest(base, missing)).toThrow(/missing or unaligned trading dates/);
  });

  it("starts on the first shared January session even if one file lacks an earlier January date", () => {
    const lateSpy = { ...files, SPY: { ...files.SPY, rows: files.SPY.rows.filter((row) => row.date !== "2022-01-03") } };
    expect(runBacktest(base, lateSpy).startDate).toBe("2022-01-04");
  });
});
