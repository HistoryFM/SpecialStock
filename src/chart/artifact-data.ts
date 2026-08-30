import type { ChartAnalysisInput } from "@/analysis/types";
import { hashObject } from "@/lib/hash";

export type ChartArtifactRecord = {
  id: string;
  rendererVersion: string;
  inputHash: string;
  imageHash: string;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  frozenInput: Record<string, unknown>;
  createdAt: Date;
};

export class ArtifactInputHashMismatchError extends Error {
  constructor() {
    super("Artifact input hash does not match its capture metadata");
    this.name = "ArtifactInputHashMismatchError";
  }
}

export function toChartArtifactData(artifact: ChartArtifactRecord) {
  const input = artifact.frozenInput as unknown as ChartAnalysisInput;
  const hashable = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "inputHash"),
  );
  if (hashObject(hashable) !== artifact.inputHash || input.inputHash !== artifact.inputHash) {
    throw new ArtifactInputHashMismatchError();
  }
  return {
    artifact: {
      id: artifact.id,
      rendererVersion: artifact.rendererVersion,
      inputHash: artifact.inputHash,
      imageHash: artifact.imageHash,
      mimeType: artifact.mimeType,
      width: artifact.width,
      height: artifact.height,
      byteLength: artifact.byteLength,
      createdAt: artifact.createdAt.toISOString(),
    },
    input,
  };
}
