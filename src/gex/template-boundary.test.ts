import { describe, expect, it } from "vitest";

import { findGexTemplateBoundary } from "@/gex/template-boundary";

describe("GEX template boundary", () => {
  it("accepts Windows Step 2 master-engine headings", () => {
    expect(findGexTemplateBoundary("# STEP 1\r\n# =================\r\n# STEP 2: controller\r\ndef state = 1;")).toBeGreaterThan(-1);
  });

  it("accepts the numbered scanner convention", () => {
    expect(findGexTemplateBoundary("# 1. values\r\n# 2. STATE CHECK CALCULATIONS\r\ndef state = 1;")).toBeGreaterThan(-1);
  });

  it("rejects a template without a Step 2 boundary", () => {
    expect(findGexTemplateBoundary("# 1. values\r\ndef state = 1;")).toBe(-1);
  });
});
