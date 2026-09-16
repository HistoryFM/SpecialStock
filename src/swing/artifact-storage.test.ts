import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { sha256 } from "@/lib/hash";
import { persistSwingArtifact, readSwingArtifact } from "@/swing/artifact-storage";

describe("Swing artifact storage", () => {
  it("stores content-addressably and rejects tampering", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "swing-artifacts-"));
    const bytes = Buffer.from("png-like-test-bytes");
    const hash = sha256(bytes);
    const reference = await persistSwingArtifact(bytes, hash, root);
    expect(await readSwingArtifact(reference, hash, root)).toEqual(bytes);
    await writeFile(path.join(root, reference), Buffer.from("tampered"));
    await expect(readSwingArtifact(reference, hash, root)).rejects.toThrow("hash verification failed");
    expect(await readFile(path.join(root, reference))).toEqual(Buffer.from("tampered"));
  });
});
