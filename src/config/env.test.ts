import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/config/env";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@example.com/specialstock",
  AUTH_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
  APP_PASSWORD_HASH:
    "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
};

describe("parseServerEnv", () => {
  it("accepts the required server-only configuration", () => {
    expect(parseServerEnv(validEnvironment)).toMatchObject({
      DATABASE_URL: validEnvironment.DATABASE_URL,
      AUTH_SECRET: validEnvironment.AUTH_SECRET,
      OPENROUTER_API_KEY: undefined,
    });
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      parseServerEnv({ ...validEnvironment, DATABASE_URL: "https://example.com" }),
    ).toThrow(/PostgreSQL/);
  });

  it("rejects weak auth secrets and plaintext passwords", () => {
    expect(() =>
      parseServerEnv({
        ...validEnvironment,
        AUTH_SECRET: "short",
        APP_PASSWORD_HASH: "plaintext",
      }),
    ).toThrow();
  });
});
