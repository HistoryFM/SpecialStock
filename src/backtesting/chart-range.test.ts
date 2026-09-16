import { describe, expect, it } from "vitest";

import { chartRangeIndices, chartZoomAvailability, zoomChartRange } from "./chart-range";
import type { ReportConfig } from "./plan";

const dates = ["2024-01-02", "2024-01-03", "2024-01-08", "2024-01-19", "2024-02-01", "2024-02-14", "2024-03-01", "2024-03-29", "2024-04-15", "2024-05-31", "2024-07-03", "2024-09-20"];
const full: ReportConfig = { visibleSeries: ["Strategy"], sections: ["growth"], closeTickers: [], range: "full" };

describe("backtesting chart range", () => {
  it("zooms into the midpoint and out to the full irregular date series", () => {
    const zoomed = zoomChartRange(dates, full, "in");
    expect(zoomed).toMatchObject({ range: "custom", startDate: dates[3], endDate: dates[8] });
    expect(chartRangeIndices(dates, zoomed).count).toBe(6);
    expect(zoomChartRange(dates, zoomed, "out").range).toBe("full");
  });

  it("stops zooming in at five bars and clamps zooming out", () => {
    const five = { ...full, range: "custom" as const, startDate: dates[2], endDate: dates[6] };
    expect(zoomChartRange(dates, five, "in")).toEqual(five);
    expect(chartZoomAvailability(dates, five)).toEqual({ canZoomIn: false, canZoomOut: true });
    expect(chartZoomAvailability(dates, full)).toEqual({ canZoomIn: true, canZoomOut: false });
  });

  it("keeps custom ranges centered when expanding without reaching full", () => {
    const five = { ...full, range: "custom" as const, startDate: dates[4], endDate: dates[8] };
    const expanded = zoomChartRange(dates, five, "out");
    expect(expanded).toMatchObject({ range: "custom", startDate: dates[2], endDate: dates[11] });
    expect(chartRangeIndices(dates, expanded).count).toBe(10);
  });
});
