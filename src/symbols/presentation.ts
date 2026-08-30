export const FRESH_ANALYSIS_WINDOW_MS = 10 * 60_000;

export function analysisUrl(symbol: string, analysisId: string): string {
  return `/symbols/${encodeURIComponent(symbol)}?analysis=${encodeURIComponent(analysisId)}`;
}

export function levelDistance(
  snapshotPrice: number,
  level: number | null,
): { amount: number; percent: number } | null {
  if (!Number.isFinite(snapshotPrice) || snapshotPrice <= 0 || level === null || !Number.isFinite(level)) {
    return null;
  }
  const amount = level - snapshotPrice;
  return { amount, percent: (amount / snapshotPrice) * 100 };
}

export function alertReasonText(input: {
  reason: string;
  direction: "bullish" | "bearish";
  previousDirection?: "bullish" | "bearish" | null;
}): string {
  if (input.reason === "direction_changed" && input.previousDirection) {
    return `Direction changed: ${input.previousDirection} → ${input.direction}`;
  }
  if (input.reason === "new_high_conviction_thesis") {
    return `New high-conviction ${input.direction} thesis`;
  }
  return input.reason.replaceAll("_", " ");
}

export type AnalysisFreshness = "running" | "failed" | "fresh" | "stale" | "market_closed";

export function analysisFreshness(input: {
  now: Date;
  analysisCompletedAt: Date | null;
  latestScanStatus: string | null;
  marketOpen: boolean;
}): AnalysisFreshness {
  if (input.latestScanStatus === "running" || input.latestScanStatus === "scheduled") {
    return "running";
  }
  if (input.latestScanStatus === "failed") return "failed";
  if (!input.marketOpen) return "market_closed";
  if (
    !input.analysisCompletedAt ||
    input.now.getTime() - input.analysisCompletedAt.getTime() > FRESH_ANALYSIS_WINDOW_MS
  ) {
    return "stale";
  }
  return "fresh";
}
