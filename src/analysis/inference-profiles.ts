export type InferenceRequestSettings = {
  temperature: number;
  maxTokens: number;
  providerTimeoutMs: number;
  reasoning: { mode: "effort"; effort: "low" | "medium"; exclude?: true };
};

const MEDIUM_COMPACT_SETTINGS = {
  temperature: 0.1,
  maxTokens: 5_120,
  providerTimeoutMs: 90_000,
  reasoning: { mode: "effort", effort: "medium", exclude: true },
} as const satisfies InferenceRequestSettings;

export const COMPACT_INFERENCE_PROFILE = {
  id: "compact-manual-medium-v1",
  settings: MEDIUM_COMPACT_SETTINGS,
  estimatedCostUsd: 0.06,
  concurrencyLimit: 20,
} as const;

export const AUTO_COMPACT_INFERENCE_PROFILE = {
  id: "compact-auto-medium-v1",
  settings: MEDIUM_COMPACT_SETTINGS,
  estimatedCostUsd: COMPACT_INFERENCE_PROFILE.estimatedCostUsd,
} as const;

export function compactInferenceProfileFor(usageClass: "routine_compact" | "manual_compact") {
  return usageClass === "routine_compact" ? AUTO_COMPACT_INFERENCE_PROFILE : COMPACT_INFERENCE_PROFILE;
}

export const FULL_INFERENCE_PROFILE = {
  id: "full-low-v1",
  settings: {
    temperature: 0.1,
    maxTokens: 3_200,
    providerTimeoutMs: 45_000,
    reasoning: { mode: "effort", effort: "low" },
  } satisfies InferenceRequestSettings,
  estimatedCostUsd: 0.08,
} as const;

export const CHAT_INFERENCE_PROFILE_ID = "chat-low-v1";
