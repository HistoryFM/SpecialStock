// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsForm } from "@/app/(protected)/settings/settings-form";
import { DEFAULT_MODEL_ID } from "@/models/catalog";

const sentryMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  logger: { info: sentryMocks.info, warn: sentryMocks.warn },
}));

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
    expect(sentryMocks.info).toHaveBeenCalledWith(
      "settings.watchlist.row_added",
      expect.objectContaining({ "specialstock.settings.updated_count": 2 }),
    );
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
    expect(sentryMocks.info).toHaveBeenCalledWith(
      "settings.watchlist.symbol_edited",
      expect.objectContaining({ "specialstock.symbol": "AAPL" }),
    );
    expect(sentryMocks.info).toHaveBeenCalledWith(
      "settings.watchlist.row_removed",
      expect.objectContaining({ "specialstock.settings.updated_count": 1 }),
    );
  });
});
