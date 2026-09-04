import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getServerEnv } from "@/config/env";
import { sha256 } from "@/lib/hash";

const HASH_PATTERN = /^[a-f0-9]{64}\.png$/;

function storageRoot(override?: string): string {
  return path.resolve(process.cwd(), override ?? getServerEnv().CHART_ARTIFACT_DIR);
}

export async function persistChartArtifact(
  png: Buffer,
  imageHash: string,
  rootOverride?: string,
): Promise<string> {
  if (sha256(png) !== imageHash) throw new Error("Chart image hash does not match its bytes.");
  const reference = `${imageHash}.png`;
  const root = storageRoot(rootOverride);
  await mkdir(root, { recursive: true });
  const destination = path.join(root, reference);
  const temporary = path.join(root, `.${reference}.${randomUUID()}.tmp`);
  await writeFile(temporary, png, { flag: "wx" });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    const existing = await readFile(destination).catch(() => null);
    if (!existing || sha256(existing) !== imageHash) throw error;
  }
  return reference;
}

export async function readChartArtifact(
  reference: string,
  expectedHash: string,
  rootOverride?: string,
): Promise<Buffer> {
  if (!HASH_PATTERN.test(reference) || reference !== `${expectedHash}.png`) {
    throw new Error("Chart artifact reference is invalid.");
  }
  const png = await readFile(path.join(storageRoot(rootOverride), reference));
  if (sha256(png) !== expectedHash) throw new Error("Chart artifact hash verification failed.");
  return png;
}

export async function removeUnreferencedChartArtifacts(input: {
  referenced: Set<string>;
  olderThan: Date;
  rootOverride?: string;
}): Promise<{ removed: number; failed: number }> {
  const root = storageRoot(input.rootOverride);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: 0, failed: 0 };
    throw error;
  }

  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !HASH_PATTERN.test(entry.name) || input.referenced.has(entry.name)) continue;
    const filename = path.join(root, entry.name);
    try {
      const metadata = await stat(filename);
      if (metadata.mtime > input.olderThan) continue;
      await unlink(filename);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}
