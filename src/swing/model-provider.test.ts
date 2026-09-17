import { beforeEach, describe, expect, it, vi } from "vitest";

import { SWING_OPENROUTER_TIMEOUT_MS, SwingModelError, SwingOpenRouterProvider } from "@/swing/model-provider";

const sentry = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  startSpan: vi.fn(async (_options: unknown, callback: () => unknown) => callback()),
  logger: { info: sentry.info },
}));

const macro = {
  regime: "CHOPPING_RANGE",
  long_bias: "NEUTRAL",
  short_bias: "NEUTRAL",
  high_beta_long_forbidden: false,
  summary: "The four daily anchors are mixed.",
  anchors: Object.fromEntries(["SPY", "QQQ", "GLD", "TLT"].map((symbol) => [symbol, {
    stance: "NEUTRAL", observation: `${symbol} is visually readable.`, visual_quality: "CLEAR",
  }])),
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a-secure-test-secret-that-is-at-least-32-characters");
  vi.stubEnv("APP_PASSWORD_HASH", "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  sentry.info.mockClear();
});

describe("Swing OpenRouter provider", () => {
  it("uses the 150-second Swing deadline", () => {
    expect(SWING_OPENROUTER_TIMEOUT_MS).toBe(150_000);
  });
  it("sends four exact images and corrects one schema-invalid macro response", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const content = bodies.length === 1 ? { ...macro, anchors: {} } : macro;
      return Response.json({
        id: `attempt-${bodies.length}`, model: "google/gemini-2.5-pro", provider: "google",
        choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.001 },
      });
    }));

    const images = ["one", "two", "three", "four"].map((value) => Buffer.from(value));
    const result = await new SwingOpenRouterProvider().analyzeMacro({ prompt: "locked prompt", images });

    expect(result.result).toEqual(macro);
    expect(result.attempts.map((attempt) => [attempt.status, attempt.failureKind])).toEqual([
      ["failed", "validation_error"], ["valid", null],
    ]);
    expect(bodies).toHaveLength(2);
    expect(result.attempts.at(-1)?.reasoningTokens).toBe(20);
    for (const body of bodies) {
      expect(body).toMatchObject({ model: "google/gemini-2.5-pro", temperature: 0.1, max_tokens: 6500, stream: false });
      const messages = body.messages as Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
      expect(messages[0]!.content.filter((part) => part.type === "image_url").map((part) => part.image_url?.url)).toEqual(
        images.map((image) => `data:image/png;base64,${image.toString("base64")}`),
      );
    }
    expect(sentry.info).toHaveBeenCalledWith("swing.model.retry", expect.objectContaining({ "specialstock.swing.failure_kind": "validation_error" }));
  });

  it("records token-limit responses as one terminal audited attempt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "limited", model: "google/gemini-2.5-pro", provider: "google",
      choices: [{ message: { content: "{}" }, finish_reason: "length" }],
      usage: { prompt_tokens: 100, completion_tokens: 3500, cost: 0.01 },
    })));

    await expect(new SwingOpenRouterProvider().analyzeMacro({ prompt: "locked prompt", images: [Buffer.from("1"), Buffer.from("2"), Buffer.from("3"), Buffer.from("4")] }))
      .rejects.toMatchObject({ failureKind: "token_limit", attempts: [expect.objectContaining({ attemptNumber: 1, failureKind: "token_limit", costUsd: 0.01 })] } satisfies Partial<SwingModelError>);
  });

  it("does not retry an external cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      controller.abort("user");
      throw new DOMException("user", "AbortError");
    }));
    await expect(new SwingOpenRouterProvider().analyzeMacro({ prompt: "locked prompt", images: [Buffer.from("1"), Buffer.from("2"), Buffer.from("3"), Buffer.from("4")], signal: controller.signal }))
      .rejects.toMatchObject({ failureKind: "canceled", attempts: [expect.objectContaining({ failureKind: "canceled" })] });
    expect(calls).toBe(1);
  });
});
