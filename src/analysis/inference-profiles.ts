export type InferenceRequestSettings = {
  temperature: number;
  maxTokens: number;
  providerTimeoutMs: number;
  reasoning:
    | { mode: "max_tokens"; maxTokens: number; exclude: true }
    | { mode: "effort"; effort: "low" };
};

export const COMPACT_INFERENCE_PROFILE = {
  id: "compact-quality-v1",
  settings: {
    temperature: 0.1,
    maxTokens: 4_608,
    providerTimeoutMs: 90_000,
    reasoning: { mode: "max_tokens", maxTokens: 4_096, exclude: true },
  } satisfies InferenceRequestSettings,
  estimatedCostUsd: 0.06,
  concurrencyLimit: 10,
} as const;

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
