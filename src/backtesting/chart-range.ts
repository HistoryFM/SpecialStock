import type { ReportConfig } from "./plan";

const presetDays: Partial<Record<ReportConfig["range"], number>> = {
  last_month: 31,
  last_quarter: 93,
  last_year: 365,
  last_two_years: 730,
};

export function chartRangeIndices(dates: string[], config: ReportConfig): { start: number; end: number; count: number } {
  if (!dates.length) return { start: 0, end: -1, count: 0 };
  const days = presetDays[config.range] ?? 0;
  const cutoff = config.range === "custom"
    ? config.startDate ?? dates[0]!
    : days ? new Date(Date.parse(dates.at(-1)!) - days * 86_400_000).toISOString().slice(0, 10) : dates[0]!;
  const finish = config.range === "custom" ? config.endDate ?? dates.at(-1)! : dates.at(-1)!;
  const firstMatch = dates.findIndex((date) => date >= cutoff);
  const lastMatch = dates.findLastIndex((date) => date <= finish);
  const start = firstMatch < 0 ? 0 : firstMatch;
  const end = Math.max(start, lastMatch < 0 ? start : lastMatch);
  return { start, end, count: end - start + 1 };
}

export function zoomChartRange(dates: string[], config: ReportConfig, direction: "in" | "out"): ReportConfig {
  const current = chartRangeIndices(dates, config);
  if (!current.count) return config;
  const targetCount = direction === "in"
    ? Math.max(5, Math.ceil(current.count / 2))
    : Math.min(dates.length, current.count * 2);
  if (targetCount === current.count) return config;
  if (targetCount === dates.length) return { ...config, range: "full", startDate: undefined, endDate: undefined };
  const center = (current.start + current.end) / 2;
  let start = Math.round(center - (targetCount - 1) / 2);
  start = Math.max(0, Math.min(start, dates.length - targetCount));
  const end = start + targetCount - 1;
  return { ...config, range: "custom", startDate: dates[start], endDate: dates[end] };
}

export function chartZoomAvailability(dates: string[], config: ReportConfig): { canZoomIn: boolean; canZoomOut: boolean } {
  const current = chartRangeIndices(dates, config);
  return { canZoomIn: current.count > 5, canZoomOut: current.count > 0 && current.count < dates.length };
}
