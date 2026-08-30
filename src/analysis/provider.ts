import type { ChartAnalysisInput, ModelRunResult } from "@/analysis/types";

export type AnalysisModelFailureMetadata = {
  status: "invalid" | "failed" | "timed_out";
  requestedModel: string;
  actualModel: string | null;
  actualProvider: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  rawResponse: unknown;
};

export class AnalysisModelError extends Error {
  constructor(
    message: string,
    readonly metadata: AnalysisModelFailureMetadata,
  ) {
    super(message);
    this.name = "AnalysisModelError";
  }
}

export interface AnalysisModelProvider {
  readonly id: string;
  analyze(input: {
    frozen: ChartAnalysisInput;
    png: Buffer;
    model: string;
    maxAttempts?: 1 | 2;
  }): Promise<ModelRunResult>;
}
