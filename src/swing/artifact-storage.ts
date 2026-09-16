import "server-only";

import * as Sentry from "@sentry/nextjs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getServerEnv } from "@/config/env";
import { sha256 } from "@/lib/hash";

const REFERENCE = /^[a-f0-9]{64}\.png$/;

const root = (override?: string) => path.resolve(process.cwd(), override ?? getServerEnv().SWING_CHART_ARTIFACT_DIR);

export async function persistSwingArtifact(png: Buffer, expectedHash: string, rootOverride?: string) {
  return Sentry.startSpan({ name: "Persist Swing chart artifact", op: "specialstock.swing.artifact.persist" }, async (span) => {
    if (sha256(png) !== expectedHash) throw new Error("Swing chart image hash does not match its bytes.");
    const reference = `${expectedHash}.png`;
    const directory = root(rootOverride);
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, reference);
    const temporary = path.join(directory, `.${reference}.${randomUUID()}.tmp`);
    await writeFile(temporary, png, { flag: "wx" });
    try {
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      const existing = await readFile(destination).catch(() => null);
      if (!existing || sha256(existing) !== expectedHash) throw error;
    }
    span.setAttribute("specialstock.swing.artifact_bytes", png.length);
    span.setStatus({ code: 1 });
    return reference;
  });
}

export async function readSwingArtifact(reference: string, expectedHash: string, rootOverride?: string) {
  return Sentry.startSpan({ name: "Verify Swing chart artifact", op: "specialstock.swing.artifact.verify" }, async (span) => {
    if (!REFERENCE.test(reference) || reference !== `${expectedHash}.png`) throw new Error("Swing chart artifact reference is invalid.");
    const bytes = await readFile(path.join(root(rootOverride), reference));
    if (sha256(bytes) !== expectedHash) throw new Error("Swing chart artifact hash verification failed.");
    span.setStatus({ code: 1 });
    return bytes;
  });
}
