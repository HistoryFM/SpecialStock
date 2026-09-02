// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsForm } from "@/app/(protected)/settings/settings-form";
import { DEFAULT_MODEL_ID } from "@/models/catalog";

vi.mock("@/app/(protected)/settings/actions", () => ({
  saveSettingsAction: vi.fn(async () => ({ status: "success", message: "Saved" })),
}));

const settings = {
  watchlist: [{ symbol: "AAPL", exchange: "NASDAQ" as const, automaticScanEnabled: true }],
  activeModel: DEFAULT_MODEL_ID,
  fallbackModel: null,
  comparisonModel: null,
  comparisonEnabled: false,
  automaticScansEnabled: true,
  notificationsEnabled: false,
  dailyBudgetUsd: 10,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

describe("Settings stock editor", () => {
  it("adds/removes rows, normalizes symbols, and blocks duplicates without losing edits", async () => {
    const user = userEvent.setup();
    render(<SettingsForm settings={settings} modelStatuses={[]} persistenceAvailable />);

    await user.click(screen.getByRole("button", { name: "Add stock" }));
    const second = screen.getByLabelText("Watchlist symbol 2");
    await user.type(second, "msft");
    expect(second).toHaveValue("MSFT");
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();

    await user.clear(second);
    await user.type(second, "aapl");
    expect(screen.getByText("AAPL appears more than once.")).toBeVisible();
    expect(second).toHaveValue("AAPL");
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: "Remove AAPL" }).at(-1)!);
    expect(screen.queryByLabelText("Watchlist symbol 2")).not.toBeInTheDocument();
  });
});
