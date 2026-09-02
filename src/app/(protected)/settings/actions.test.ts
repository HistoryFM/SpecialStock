import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Settings server exports", () => {
  it("exports async functions only at runtime", () => {
    const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
    expect(source).toMatch(/export async function saveSettingsAction/);
    expect(source).not.toMatch(/export const\s+\w+\s*=/);
  });
});
