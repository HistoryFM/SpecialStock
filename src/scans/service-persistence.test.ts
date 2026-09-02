import { beforeEach, describe, expect, it, vi } from "vitest";

import { modelRuns } from "@/db/schema";
import { persistModelResult } from "@/scans/service";
import type { ChartAnalysisInput, CompactModelRunResult } from "@/analysis/types";

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
  phase: "compact",
  requestedModel: "google/gemini-2.5-pro",
  actualModel: "google/gemini-2.5-pro",
  actualProvider: "Google",
  latencyMs: 1_000,
  inputTokens: 100,
  outputTokens: 200,
  costUsd: 0.01,
  rawResponse: { id: "synthetic-response" },
  failoverFrom: null,
  attempts: [],
  analysis: {
    observed_price: 100,
    verdict: "no_trade",
    conviction: "low",
    primary_target: null,
    invalidation_level: null,
    visual_quality: "clear",
  },
} satisfies CompactModelRunResult;

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
      target: [modelRuns.scanSlotId, modelRuns.runRole, modelRuns.requestedModel, modelRuns.phase],
      set: expect.objectContaining({
        chartArtifactId: "new-artifact-id",
        inputHash: "new-input-hash",
        status: "valid",
        validationErrors: [],
      }),
    });
  });
});
