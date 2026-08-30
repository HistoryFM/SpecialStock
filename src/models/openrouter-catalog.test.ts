import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL_ID } from "@/models/catalog";
import {
  mapOpenRouterAvailability,
  unknownModelAvailability,
} from "@/models/openrouter-catalog";

describe("OpenRouter model catalog mapping", () => {
  it("marks vision models as available and captures structured output support", () => {
    const result = mapOpenRouterAvailability([
      {
        id: DEFAULT_MODEL_ID,
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: ["response_format"],
      },
    ]);

    expect(result[0]).toMatchObject({
      id: DEFAULT_MODEL_ID,
      status: "available",
      supportsImageInput: true,
      supportsStructuredOutput: true,
    });
  });

  it("distinguishes incompatible models from missing models", () => {
    const result = mapOpenRouterAvailability([
      {
        id: DEFAULT_MODEL_ID,
        architecture: { input_modalities: ["text"] },
      },
    ]);

    expect(result[0].status).toBe("incompatible");
    expect(result.slice(1).every((entry) => entry.status === "unavailable")).toBe(
      true,
    );
  });

  it("fails closed when the remote catalog cannot be checked", () => {
    expect(
      unknownModelAvailability("network unavailable").every(
        (entry) => entry.status === "unknown",
      ),
    ).toBe(true);
  });
});
