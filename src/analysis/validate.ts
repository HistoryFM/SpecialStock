import { analysisResultSchema, type AnalysisResult } from "@/analysis/types";

const disallowedClaims =
  /\b(option contract|strike price|expiration|expiry|delta|gamma|theta|premium|position size|market order|limit order|stop order|buy \d|sell \d|relative velocity|institutional (?:buying|selling|activity))\b/i;

export class AnalysisValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "AnalysisValidationError";
  }
}

export function parseJsonResponse(value: string): unknown {
  const trimmed = value.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(withoutFence);
}

export function validateAnalysis(raw: unknown): AnalysisResult {
  const parsed = analysisResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalysisValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const result = parsed.data;
  const issues: string[] = [];
  const allText = [
    result.setup_type,
    result.immediate_bias,
    result.broader_trend,
    result.candlestick_analysis,
    result.vwap_keltner_analysis,
    result.cci_analysis,
    ...Object.values(result.indicator_readings).map((reading) => reading.observation),
    result.deeper_scenario,
    result.summary,
    ...result.supporting_evidence,
    ...result.conflicting_evidence,
  ].join(" ");
  if (disallowedClaims.test(allText)) issues.push("response claims unavailable data or trading mechanics");

  if (result.verdict === "no_trade") {
    if (result.primary_target !== null || result.invalidation_level !== null) {
      issues.push("no_trade must not include target or invalidation levels");
    }
  } else if (
    result.observed_price === null ||
    result.primary_target === null ||
    result.invalidation_level === null
  ) {
    issues.push("directional analysis requires observed price, target, and invalidation");
  } else if (
    result.verdict === "bullish" &&
    !(result.primary_target > result.observed_price && result.observed_price > result.invalidation_level)
  ) {
    issues.push("bullish price levels are directionally contradictory");
  } else if (
    result.verdict === "bearish" &&
    !(result.primary_target < result.observed_price && result.observed_price < result.invalidation_level)
  ) {
    issues.push("bearish price levels are directionally contradictory");
  }
  if (
    result.indicator_readings.price_action.readability === "unreadable" &&
    result.verdict !== "no_trade"
  ) {
    issues.push("an unreadable price chart requires a no_trade verdict");
  }
  if (issues.length) throw new AnalysisValidationError(issues);
  return result;
}
