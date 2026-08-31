import { beforeEach, describe, expect, it, vi } from "vitest";

import { modelRuns } from "@/db/schema";
import { persistModelResult } from "@/scans/service";
import type { ChartAnalysisInput, ModelRunResult } from "@/analysis/types";

const { getDatabaseMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDatabase: getDatabaseMock }));
vi.mock("@sentry/nextjs", () => ({
  startSpan: vi.fn((_options, callback: () => unknown) => callback()),
}));

const frozen = {
  inputHash: "new-input-hash",
  barStatus: "closed",
} as ChartAnalysisInput;

const result = {
  requestedModel: "google/gemini-2.5-pro",
  actualModel: "google/gemini-2.5-pro",
  actualProvider: "Google",
  latencyMs: 1_000,
  inputTokens: 100,
  outputTokens: 200,
  costUsd: 0.01,
  rawResponse: { id: "synthetic-response" },
  failoverFrom: null,
  analysis: {
    observed_price: 100,
    verdict: "no_trade",
    setup_type: "No setup",
    immediate_bias: "Neutral",
    broader_trend: "Mixed",
    conviction: "low",
    candlestick_analysis: "No clear pattern.",
    vwap_keltner_analysis: "No clear edge.",
    cci_analysis: "No clear edge.",
    indicator_readings: Object.fromEntries(
      ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"]
        .map((key) => [key, {
          stance: "neutral",
          readability: "clear",
          observation: `${key} is legible.`,
        }]),
    ) as ModelRunResult["analysis"]["indicator_readings"],
    supporting_evidence: [],
    conflicting_evidence: [],
    support_levels: [],
    resistance_levels: [],
    primary_target: null,
    deeper_scenario: "Wait for confirmation.",
    invalidation_level: null,
    data_quality_flags: [],
    summary: "No trade.",
  },
} satisfies ModelRunResult;

describe("model-run retry persistence", () => {
  beforeEach(() => {
    getDatabaseMock.mockReset();
  });

  it("updates the existing slot/model row when a retry succeeds", async () => {
    const returningRun = vi.fn().mockResolvedValue([{ id: "run-id" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning: returningRun }));
    const returningAnalysis = vi.fn().mockResolvedValue([{ id: "analysis-id" }]);
    const insert = vi
      .fn()
      .mockReturnValueOnce({
        values: vi.fn(() => ({ onConflictDoUpdate })),
      })
      .mockReturnValueOnce({
        values: vi.fn(() => ({ returning: returningAnalysis })),
      });
    getDatabaseMock.mockResolvedValue({ insert });

    await expect(persistModelResult({
      slotId: "slot-id",
      chartArtifactId: "new-artifact-id",
      result,
      frozen,
    })).resolves.toMatchObject({
      run: { id: "run-id" },
      analysis: { id: "analysis-id" },
    });

    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: [modelRuns.scanSlotId, modelRuns.runRole, modelRuns.requestedModel],
      set: expect.objectContaining({
        chartArtifactId: "new-artifact-id",
        inputHash: "new-input-hash",
        status: "valid",
        validationErrors: [],
      }),
    });
  });
});
