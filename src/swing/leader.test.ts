import { describe, expect, it } from "vitest";

import { canClaimSwingScheduler } from "@/swing/leader";

describe("Swing scheduler leader election", () => {
  it("keeps one live owner and permits renewal or expired takeover", () => {
    expect(canClaimSwingScheduler(null, "tab-a", 100)).toBe(true);
    expect(canClaimSwingScheduler({ tabId: "tab-a", expiresAt: 130 }, "tab-a", 110)).toBe(true);
    expect(canClaimSwingScheduler({ tabId: "tab-a", expiresAt: 130 }, "tab-b", 110)).toBe(false);
    expect(canClaimSwingScheduler({ tabId: "tab-a", expiresAt: 130 }, "tab-b", 130)).toBe(true);
  });
});
