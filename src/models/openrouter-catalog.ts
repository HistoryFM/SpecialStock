import "server-only";

import { z } from "zod";

import { getServerEnv, isDemoMode } from "@/config/env";
import { MODEL_CATALOG } from "@/models/catalog";
import type {
  ModelAvailability,
  ModelCatalogProvider,
} from "@/models/provider";

const openRouterModelSchema = z
  .object({
    id: z.string(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional(),
        modality: z.string().optional(),
      })
      .passthrough()
      .optional(),
    supported_parameters: z.array(z.string()).optional(),
  })
  .passthrough();

const openRouterResponseSchema = z.object({
  data: z.array(openRouterModelSchema),
});

type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

export function mapOpenRouterAvailability(
  remoteModels: OpenRouterModel[],
  checkedAt = new Date(),
): ModelAvailability[] {
  const byId = new Map(remoteModels.map((model) => [model.id, model]));

  return MODEL_CATALOG.map(({ id }) => {
    const remoteModel = byId.get(id);
    if (!remoteModel) {
      return {
        id,
        status: "unavailable" as const,
        supportsImageInput: null,
        supportsStructuredOutput: null,
        reason: "The model is not present in OpenRouter's current catalog.",
        checkedAt,
      };
    }

    const modalities = remoteModel.architecture?.input_modalities ?? [];
    const modalitySummary = remoteModel.architecture?.modality ?? "";
    const supportsImageInput =
      modalities.includes("image") || modalitySummary.toLowerCase().includes("image");
    const supportedParameters = remoteModel.supported_parameters ?? [];
    const supportsStructuredOutput =
      supportedParameters.includes("structured_outputs") ||
      supportedParameters.includes("response_format");

    return {
      id,
      status: supportsImageInput ? ("available" as const) : ("incompatible" as const),
      supportsImageInput,
      supportsStructuredOutput,
      reason: supportsImageInput
        ? supportsStructuredOutput
          ? "Available with image input and structured-output support."
          : "Available with image input; application-level JSON validation is required."
        : "Present in OpenRouter, but image input is not advertised.",
      checkedAt,
    };
  });
}

export function unknownModelAvailability(
  reason: string,
  checkedAt = new Date(),
): ModelAvailability[] {
  return MODEL_CATALOG.map(({ id }) => ({
    id,
    status: "unknown",
    supportsImageInput: null,
    supportsStructuredOutput: null,
    reason,
    checkedAt,
  }));
}

export class OpenRouterModelCatalogProvider implements ModelCatalogProvider {
  readonly id = "openrouter";

  async getAvailability(): Promise<ModelAvailability[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const checkedAt = new Date();

    if (isDemoMode()) {
      return unknownModelAvailability(
        "Configure Chart-Img and OpenRouter credentials to enable analysis.",
        checkedAt,
      );
    }

    try {
      const apiKey = getServerEnv().OPENROUTER_API_KEY;
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        cache: "no-store",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        return unknownModelAvailability(
          `OpenRouter catalog returned HTTP ${response.status}.`,
          checkedAt,
        );
      }

      const parsed = openRouterResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return unknownModelAvailability(
          "OpenRouter returned an unrecognized catalog response.",
          checkedAt,
        );
      }

      return mapOpenRouterAvailability(parsed.data.data, checkedAt);
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? "OpenRouter catalog validation timed out."
          : "OpenRouter catalog validation could not be completed.";
      return unknownModelAvailability(reason, checkedAt);
    } finally {
      clearTimeout(timeout);
    }
  }
}
