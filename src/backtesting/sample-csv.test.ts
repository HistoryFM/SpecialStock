import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { runBacktest } from "./engine";
import { parsePriceCsv } from "./csv";
import type { PriceRow, RunInput, Strategy } from "./types";

it.skipIf(!process.env.SPECIALSTOCK_SAMPLE_CSV_DIR)("parses and computes the user-supplied long/cash sample", async () => {
  const directory = process.env.SPECIALSTOCK_SAMPLE_CSV_DIR!;
  const files: Record<string, { id: string; rows: PriceRow[] }> = {};
  for (const [ticker, name] of [
    ["TQQQ", "TQQQHistoricalData_1789238131084.csv"],
    ["SPY", "SPYHistoricalData_1789240095809.csv"],
    ["QQQ", "QQQHistoricalData_1789240256829.csv"],
  ]) {
    const content = await readFile(join(directory, name), "utf8");
    const parsed = parsePriceCsv(content);
    files[ticker] = { id: ticker.toLowerCase(), rows: parsed.rows };
    expect(parsed.rows).toHaveLength(2514);
    expect(parsed.rows[0].date).toBe("2016-09-12");
    expect(parsed.rows.at(-1)?.date).toBe("2026-09-11");
  }
  const strategy: Strategy = { entry: [{ kind: "price_sma", period: 50, relation: "crosses_above" }], exit: [{ kind: "price_sma", period: 50, relation: "crosses_below" }], rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, macdFast: 12, macdSlow: 26, macdSignal: 9 };
  const input: RunInput = { longTicker: "TQQQ", comparisons: [], mode: "cash", startingCapital: 1000, cashRate: 0, slippage: 0, fee: 0, prompt: "Enter on price crossing above SMA50 and exit on price crossing below SMA50", model: "google/gemini-2.5-pro", strategy };
  for (const period of [50, 200] as const) {
    const result = runBacktest({ ...input, strategy: { ...strategy, entry: [{ kind: "price_sma", period, relation: "crosses_above" }], exit: [{ kind: "price_sma", period, relation: "crosses_below" }] } }, files);
    expect(result.startDate).toBe(period === 50 ? "2017-01-03" : "2018-01-02");
    expect(result.endDate).toBe("2026-09-11");
    expect(result.series.map((item) => item.ticker)).toEqual(["Strategy", "SPY", "QQQ"]);
    console.log(JSON.stringify({ period, start: result.startDate, end: result.endDate, trades: result.trades.length, firstTrades: result.trades.slice(0, 4), finalBalances: result.series.map((item) => [item.ticker, item.values.at(-1)]), drawdowns: result.drawdowns, annual: result.annual }));
  }
  // Independently hand-calculated from the uploaded closes using a 50-day-only rule and 2.5% cash yield.
  const corrected = runBacktest({ ...input, cashRate: 2.5 }, files);
  expect(corrected.trades).toHaveLength(158);
  expect(corrected.trades[0]).toMatchObject({ date: "2017-06-28", action: "buy", ticker: "TQQQ" });
  expect(corrected.trades.at(-1)).toMatchObject({ date: "2026-09-10", action: "sell", ticker: "TQQQ" });
  expect(corrected.series.map((series) => series.values.at(-1))).toEqual([expect.closeTo(10_468.67, 2), expect.closeTo(3_393.23, 2), expect.closeTo(5_980.26, 2)]);
  expect(corrected.drawdowns[0]).toMatchObject({ percent: expect.closeTo(-56.05, 2), peakDate: "2021-11-19", troughDate: "2023-01-18" });
  expect(corrected.annual.find((row) => row.year === "2022")?.returns.Strategy).toBeCloseTo(-49.04, 2);
}, 30_000);
