import { describe, expect, it } from "vitest";

import type { ChartAnalysisInput } from "@/analysis/types";
import {
  ArtifactInputHashMismatchError,
  toChartArtifactData,
  type ChartArtifactRecord,
} from "@/chart/artifact-data";
import { hashObject } from "@/lib/hash";

const metadata = {
  version: "chart-img-input-v1" as const,
  symbol: "AAPL",
  chartSymbol: "NASDAQ:AAPL",
  capturedAt: "2026-08-28T20:00:10.000Z",
  interval: "5m" as const,
  session: "regular" as const,
  barStatus: "closed" as const,
  range: { from: "2026-08-28T13:30:00.000Z", to: "2026-08-28T20:00:00.000Z" },
  width: 1600,
  height: 1920,
  studies: [
    "VWAP", "Keltner Channels", "Volume", "Average Directional Index",
    "Relative Strength Index", "MACD", "Commodity Channel Index", "Chaikin Money Flow",
  ] as ChartAnalysisInput["studies"],
};
const input: ChartAnalysisInput = { ...metadata, inputHash: hashObject(metadata) };

function artifact(overrides: Partial<ChartArtifactRecord> = {}): ChartArtifactRecord {
  return {
    id: "artifact-id",
    rendererVersion: "chart-img-v2",
    inputHash: input.inputHash,
    imageHash: "image-hash",
    mimeType: "image/png",
    width: 1600,
    height: 1920,
    byteLength: 42,
    frozenInput: input as unknown as Record<string, unknown>,
    createdAt: new Date("2026-08-28T20:01:00.000Z"),
    ...overrides,
  };
}

describe("toChartArtifactData", () => {
  it("returns capture metadata without model output", () => {
    const result = toChartArtifactData(artifact());
    expect(result.input.chartSymbol).toBe("NASDAQ:AAPL");
    expect(result.input).not.toHaveProperty("rawResponse");
  });

  it("rejects a stored input hash mismatch", () => {
    expect(() => toChartArtifactData(artifact({ inputHash: "different" }))).toThrow(
      ArtifactInputHashMismatchError,
    );
  });
});
