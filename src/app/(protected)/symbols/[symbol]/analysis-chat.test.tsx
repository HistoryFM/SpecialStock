// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisChat } from "@/app/(protected)/symbols/[symbol]/analysis-chat";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    expect(screen.getByRole("button", { name: "Ask AI" })).toBeEnabled();
  });
});
