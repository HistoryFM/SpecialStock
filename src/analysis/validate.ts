import {
  compactAnalysisResultSchema,
  compactAnalysisWireSchema,
  fullAnalysisResultSchema,
  type CompactAnalysisResult,
  type FullAnalysisResult,
} from "@/analysis/types";

const disallowedClaims =
  /\b(option contract|strike price|expiration|expiry|delta|gamma|theta|premium|position size|market order|limit order|stop order|buy \d|sell \d|relative velocity|institutional (?:buying|selling|activity|block orders|distribution)|mathematical impossibility|guaranteed trade)\b/i;
const unresolvedCorrection = /\b(?:is incorrect|correction:|I was wrong)\b/i;

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

export function isFullAnalysisEligible(input: {
  verdict: "bullish" | "bearish" | "no_trade";
  conviction: "low" | "medium" | "high";
}): boolean {
  void input;
  return true;
}

export function validateCompactAnalysis(raw: unknown): CompactAnalysisResult {
  const wire = compactAnalysisWireSchema.safeParse(raw);
  if (!wire.success) {
    throw new AnalysisValidationError(
      wire.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const result = compactAnalysisResultSchema.parse({
    observed_price: wire.data.p,
    verdict: wire.data.v,
    conviction: wire.data.c,
    primary_target: wire.data.t,
    invalidation_level: wire.data.i,
    visual_quality: wire.data.q,
  });
  const issues: string[] = [];
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
    result.visual_quality === "unreadable" &&
    result.verdict !== "no_trade"
  ) {
    issues.push("an unreadable price chart requires a no_trade verdict");
  }
  if (issues.length) throw new AnalysisValidationError(issues);
  return result;
}

export function validateFullAnalysis(raw: unknown): FullAnalysisResult {
  if (raw && typeof raw === "object") {
    const locked = ["observed_price", "verdict", "conviction", "primary_target", "invalidation_level"];
    const present = locked.filter((field) => Object.hasOwn(raw, field));
    if (present.length) {
      throw new AnalysisValidationError([`full analysis attempted to update locked fields: ${present.join(", ")}`]);
    }
  }
  const parsed = fullAnalysisResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalysisValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const result = parsed.data;
  const allText = Object.values(result).join(" ");
  if (disallowedClaims.test(allText)) {
    throw new AnalysisValidationError(["response claims unavailable data or trading mechanics"]);
  }
  if (unresolvedCorrection.test(allText)) {
    throw new AnalysisValidationError(["response contains an unresolved self-correction"]);
  }
  return result;
}
