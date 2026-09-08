// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromptStudio, type PromptStudioPhase } from "@/app/(protected)/settings/prompt-studio";

const sentryMocks = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ logger: { info: sentryMocks.info } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    expect(screen.getByRole("button", { name: "Save as new revision" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Analysis instructions for Compact scan" }), { target: { value: "changed instructions" } });

    await waitFor(() => expect(screen.getByLabelText("Full prompt preview for Compact scan")).toHaveTextContent("rendered changed prompt"));
    expect(screen.getByRole("button", { name: "Save as new revision" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
