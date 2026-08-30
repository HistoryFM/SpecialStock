import { hash } from "bcryptjs";
import { describe, expect, it } from "vitest";

import { credentialsSchema, verifyPassword } from "@/auth/credentials";

describe("credentials", () => {
  it("validates bounded password input", () => {
    expect(credentialsSchema.safeParse({ password: "secret" }).success).toBe(true);
    expect(credentialsSchema.safeParse({ password: "" }).success).toBe(false);
    expect(credentialsSchema.safeParse({ password: "x".repeat(257) }).success).toBe(
      false,
    );
  });

  it("compares passwords without throwing for malformed hashes", async () => {
    const passwordHash = await hash("correct horse battery staple", 4);

    await expect(
      verifyPassword("correct horse battery staple", passwordHash),
    ).resolves.toBe(true);
    await expect(verifyPassword("incorrect", passwordHash)).resolves.toBe(false);
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
  });
});
