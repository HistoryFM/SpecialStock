import { describe, expect, it } from "vitest";

import { chartImgRequestBodyForTest } from "@/chart/chart-img-provider";
import { hashObject } from "@/lib/hash";
import { swingChartRequestBody } from "@/swing/chart-provider";

describe("dedicated Swing Chart-Img profile", () => {
  it("locks the documented v3 daily layout without Bollinger Bands", () => {
    const body = swingChartRequestBody({ chartSymbol: "NASDAQ:AAPL", from: "2025-03-15T19:50:10.000Z", to: "2026-09-15T19:50:10.000Z" });
    expect(hashObject(body)).toBe("9071a62cd3baa3c536b8ce96c90a7abdf3dde0999187677f655a8d64af3026d9");
    expect(body).toMatchObject({
      symbol: "NASDAQ:AAPL", interval: "1D", width: 1600, height: 1920, style: "candle", theme: "dark",
      scale: "regular", session: "regular", timezone: "America/New_York", format: "png",
      override: { mainPaneHeight: 860, scalesFontSize: 16, showLegend: true, showLegendValues: true, showPriceLine: true, showSeriesLastValue: true, showSeriesOHLC: true, showVertGrid: true, showHorzGrid: true },
    });
    expect(body.override).toMatchObject({ showLegendValues: true, showStudyLastValue: true });
    expect(body.studies).toHaveLength(9);
    expect(body.studies.map((study) => study.name)).toEqual([
      "Moving Average Exponential", "Moving Average Exponential", "Moving Average", "Moving Average", "Volume", "Relative Strength Index", "MACD", "Commodity Channel Index", "Chaikin Money Flow",
    ]);
    expect(body.studies[0]).toMatchObject({ forceOverlay: true, input: { length: 8, source: "close" } });
    expect(body.studies[1]).toMatchObject({ input: { length: 20 } });
    expect(body.studies[2]).toMatchObject({ input: { length: 50 } });
    expect(body.studies[3]).toMatchObject({ input: { length: 200 } });
    expect(body.studies[5]).toMatchObject({ input: { length: 14 }, override: { "UpperLimit.value": 70, "LowerLimit.value": 30 } });
    expect(body.studies[6]).toMatchObject({ input: { in_0: 12, in_1: 26, in_2: 9, in_3: "close" } });
    expect(body.studies[7]).toMatchObject({ input: { in_0: 14 }, override: { "UpperLimit.value": 100, "LowerLimit.value": -100 } });
    expect(body.studies[8]).toMatchObject({ input: { in_0: 21 }, override: { "Zero.value": 0 } });
    expect(JSON.stringify(body)).not.toMatch(/Bollinger|VWAP|Keltner|Directional Index/);
  });

  it("does not mutate the intraday body contract", () => {
    const intraday = chartImgRequestBodyForTest({ chartSymbol: "NASDAQ:AAPL", interval: "5m", range: { from: "a", to: "b" }, width: 1600, height: 1920 });
    expect(intraday.studies.map((study) => study.name)).toEqual(["VWAP", "Keltner Channels", "Volume", "Average Directional Index", "Relative Strength Index", "MACD", "Commodity Channel Index", "Chaikin Money Flow"]);
    expect(intraday.override.mainPaneHeight).toBe(560);
  });

  it("uses the locked India timezone without changing the chart layout", () => {
    const body = swingChartRequestBody({ chartSymbol: "NSE:RELIANCE", from: "2025-03-15T19:50:10.000Z", to: "2026-09-15T19:50:10.000Z", timezone: "Asia/Kolkata" });
    expect(body).toMatchObject({ symbol: "NSE:RELIANCE", interval: "1D", session: "regular", timezone: "Asia/Kolkata", width: 1600, height: 1920 });
    expect(body.studies).toHaveLength(9);
  });
});
