import { describe, expect, it } from "vitest";

import {
  getScanExecutionPolicy,
  isEvaluationEligibleSlotKind,
} from "@/scans/policy";

describe("scan execution policy", () => {
  it("allows one same-model retry for an isolated manual scan", () => {
    expect(getScanExecutionPolicy("manual")).toEqual({
      modelAttempts: 2,
      allowFallback: false,
      allowComparison: false,
      includeInEvaluation: false,
      createThesis: false,
    });
  });

  it("keeps same-model retry and evaluation without fallback or comparison", () => {
    expect(getScanExecutionPolicy("scheduled")).toEqual({
      modelAttempts: 2,
      allowFallback: false,
      allowComparison: false,
      includeInEvaluation: true,
      createThesis: true,
    });
  });

  it("excludes manual smoke slots from evaluation coverage", () => {
    expect(isEvaluationEligibleSlotKind("manual_smoke")).toBe(false);
    expect(isEvaluationEligibleSlotKind("mid_bar")).toBe(true);
    expect(isEvaluationEligibleSlotKind("post_close")).toBe(true);
  });
});
