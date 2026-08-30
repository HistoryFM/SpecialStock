import { describe, expect, it } from "vitest";

import { isAuthorizedSession } from "@/auth/authorization";
import { SINGLE_USER_ID } from "@/auth/constants";

describe("isAuthorizedSession", () => {
  it("requires the exact configured user id", () => {
    expect(
      isAuthorizedSession({
        user: { id: SINGLE_USER_ID, name: "Owner", email: null, image: null },
        expires: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(true);
  });

  it("fails closed for missing, malformed, and error-shaped sessions", () => {
    expect(isAuthorizedSession(null)).toBe(false);
    expect(isAuthorizedSession({ user: undefined })).toBe(false);
    expect(
      isAuthorizedSession({
        user: { id: "other", name: "Other", email: null, image: null },
        expires: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(false);
    expect(isAuthorizedSession({ message: "configuration error" } as never)).toBe(
      false,
    );
  });
});
