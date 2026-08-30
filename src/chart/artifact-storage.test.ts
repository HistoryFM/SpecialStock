import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { persistChartArtifact, readChartArtifact } from "@/chart/artifact-storage";
import { sha256 } from "@/lib/hash";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("chart artifact storage", () => {
  it("persists and verifies exact image bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "specialstock-charts-"));
    roots.push(root);
    const png = Buffer.from("exact-chart-bytes");
    const hash = sha256(png);
    const reference = await persistChartArtifact(png, hash, root);
    expect(reference).toBe(`${hash}.png`);
    expect((await readChartArtifact(reference, hash, root)).equals(png)).toBe(true);
  });

  it("rejects path traversal and hash mismatches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "specialstock-charts-"));
    roots.push(root);
    await expect(readChartArtifact("../secret", "a".repeat(64), root)).rejects.toThrow(/reference/);
    await expect(persistChartArtifact(Buffer.from("bytes"), "a".repeat(64), root)).rejects.toThrow(/hash/);
  });
});
