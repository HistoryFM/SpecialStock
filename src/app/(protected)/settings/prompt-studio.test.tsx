// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromptStudio, type PromptStudioPhase } from "@/app/(protected)/settings/prompt-studio";

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

const initial: PromptStudioPhase[] = (["compact", "full"] as const).map((phase) => ({
  phase,
  activeRevisionId: `${phase}-1`,
  defaultInstructions: `${phase} instructions`,
  preview: `${phase} full prompt`,
  revisions: [{
    id: `${phase}-1`,
    phase,
    revisionNumber: 1,
    instructions: `${phase} instructions`,
    instructionsHash: "0123456789abcdef",
    templateVersion: "test-v1",
    active: true,
    createdAt: "2026-09-07T00:00:00Z",
  }],
}));

describe("prompt studio", () => {
  it("shows the full prompt immediately and keeps it synchronized with the draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ preview: "rendered changed prompt" })));
    render(<PromptStudio initial={initial} />);

    expect(screen.queryByRole("button", { name: "View full prompt" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Full prompt preview for Compact scan")).toHaveTextContent("compact full prompt");
    expect(screen.getByLabelText("Full prompt preview for Compact scan")).toHaveAttribute("data-sentry-mask");
    expect(screen.getByRole("textbox", { name: "Analysis instructions for Compact scan" })).toHaveAttribute("data-sentry-mask");
    expect(screen.getByRole("button", { name: "Save as new revision" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Analysis instructions for Compact scan" }), { target: { value: "changed instructions" } });

    await waitFor(() => expect(screen.getByLabelText("Full prompt preview for Compact scan")).toHaveTextContent("rendered changed prompt"));
    expect(screen.getByRole("button", { name: "Save as new revision" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("records privacy-safe client telemetry when a revision is created", async () => {
    vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith("/preview")) return Response.json({ preview: "rendered changed prompt" });
      return Response.json({ revision: {
        ...initial[0]!.revisions[0]!, id: "compact-2", revisionNumber: 2,
        instructions: "private changed instructions", instructionsHash: "new-hash", active: true,
      } });
    }));
    render(<PromptStudio initial={initial} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Analysis instructions for Compact scan" }), { target: { value: "private changed instructions" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save as new revision" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save as new revision" }));

    await waitFor(() => expect(screen.getByText("Compact scan revision 2 is active for future calls.")).toBeInTheDocument());
    expect(sentryMocks.startNewTrace).toHaveBeenCalledTimes(1);
    expect(sentryMocks.spans[0]?.options.op).toBe("specialstock.prompt.revision.request");
    expect(sentryMocks.info).toHaveBeenCalledWith("prompt.revision.client_completed", expect.objectContaining({
      "specialstock.telemetry.origin": "client",
      "specialstock.prompt.revision_id": "compact-2",
      "specialstock.prompt.instructions_hash": "new-hash",
    }));
    expect(JSON.stringify(sentryMocks.info.mock.calls)).not.toContain("private changed instructions");
  });
});
