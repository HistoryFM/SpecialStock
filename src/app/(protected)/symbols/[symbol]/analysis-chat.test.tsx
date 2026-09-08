// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisChat } from "@/app/(protected)/symbols/[symbol]/analysis-chat";

const sentryMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  startNewTrace: vi.fn((callback: () => unknown) => callback()),
  spans: [] as Array<{ options: { op?: string }; span: { setAttribute: ReturnType<typeof vi.fn>; setAttributes: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn> } }>,
}));
vi.mock("@sentry/nextjs", () => ({
  logger: { info: sentryMocks.info, warn: sentryMocks.warn },
  startNewTrace: sentryMocks.startNewTrace,
  startSpan: vi.fn(async (options, callback) => {
    const span = { setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() };
    sentryMocks.spans.push({ options, span });
    return callback(span);
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sentryMocks.spans.length = 0;
});

describe("analysis chat", () => {
  it("makes a grounded starter question ready to ask", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      analysisId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      contextExchangeLimit: 6,
      turns: [],
    })));

    render(<AnalysisChat analysisId="11111111-1111-4111-8111-111111111111" capturedAt="2026-09-07T21:27:17.425Z" />);

    fireEvent.click(await screen.findByRole("button", { name: "Strongest evidence" }));

    expect(screen.getByRole("textbox", { name: "Question about this analysis" })).toHaveValue("What is the strongest evidence supporting this setup?");
    expect(screen.getByRole("textbox", { name: "Question about this analysis" })).toHaveAttribute("data-sentry-mask");
    expect(screen.getByRole("button", { name: "Ask AI" })).toBeEnabled();
  });

  it("records a correlated client trace without logging the question", async () => {
    const privateQuestion = "Describe the private chart evidence.";
    vi.stubGlobal("crypto", { randomUUID: () => "33333333-3333-4333-8333-333333333333" });
    vi.stubGlobal("fetch", vi.fn(async (_request: string | URL | Request, init?: RequestInit) => {
      if (!init?.method) return Response.json({
        analysisId: "11111111-1111-4111-8111-111111111111",
        conversationId: "22222222-2222-4222-8222-222222222222",
        contextExchangeLimit: 6,
        turns: [],
      });
      return Response.json({
        id: "44444444-4444-4444-8444-444444444444",
        requestId: "33333333-3333-4333-8333-333333333333",
        question: privateQuestion,
        answer: "Grounded answer",
        status: "completed",
        error: null,
        createdAt: "2026-09-08T16:00:00.000Z",
        completedAt: "2026-09-08T16:00:01.000Z",
      });
    }));
    render(<AnalysisChat analysisId="11111111-1111-4111-8111-111111111111" capturedAt="2026-09-07T21:27:17.425Z" />);

    const textbox = await screen.findByRole("textbox", { name: "Question about this analysis" });
    fireEvent.change(textbox, { target: { value: privateQuestion } });
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));

    await screen.findByText("Grounded answer");
    expect(screen.getByLabelText("Conversation history")).toHaveAttribute("data-sentry-mask");
    expect(sentryMocks.startNewTrace).toHaveBeenCalledTimes(1);
    expect(sentryMocks.spans[0]?.options.op).toBe("specialstock.analysis.chat.request");
    expect(sentryMocks.info).toHaveBeenCalledWith("chat.client.completed", expect.objectContaining({
      "specialstock.telemetry.origin": "client",
      "specialstock.chat.request_id": "33333333-3333-4333-8333-333333333333",
      "specialstock.chat.turn_id": "44444444-4444-4444-8444-444444444444",
    }));
    expect(JSON.stringify(sentryMocks.info.mock.calls)).not.toContain(privateQuestion);
  });
});
