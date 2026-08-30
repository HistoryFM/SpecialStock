import type { ModelId } from "@/models/catalog";

export type ModelAvailabilityStatus =
  | "available"
  | "unavailable"
  | "incompatible"
  | "unknown";

export type ModelAvailability = {
  id: ModelId;
  status: ModelAvailabilityStatus;
  supportsImageInput: boolean | null;
  supportsStructuredOutput: boolean | null;
  reason: string;
  checkedAt: Date;
};

export interface ModelCatalogProvider {
  readonly id: string;
  getAvailability(): Promise<ModelAvailability[]>;
}
