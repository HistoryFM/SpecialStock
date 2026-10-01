import { describe, expect, it } from "vitest";

import { gexChartRequestBody } from "@/gex/chart-provider";

describe("GEX Chart-Img request", () => {
  it("locks the five-minute extended-hours VWAP and Keltner layout", () => {
    const body = gexChartRequestBody({ chartSymbol: "NASDAQ:AAPL", from: "2026-09-24T14:00:00.000Z", to: "2026-09-25T14:00:00.000Z" });
    expect(body).toMatchObject({ symbol: "NASDAQ:AAPL", interval: "5m", session: "extended", timezone: "America/New_York", format: "png" });
    expect(body.studies.map((study) => study.name)).toEqual(["VWAP", "Keltner Channels", "Volume"]);
    expect(body.override).toMatchObject({ showLegendValues: true, showStudyLastValue: true });
  });
});
