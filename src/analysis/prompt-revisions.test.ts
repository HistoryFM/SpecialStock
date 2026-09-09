import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCompactAnalysisPrompt, PROMPT_PREVIEW_INPUT } from "@/analysis/prompt";
import * as schema from "@/db/schema";

const getDatabase = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ getDatabase }));

import {
  activatePromptRevision,
  createAndActivatePromptRevision,
  getActivePromptRevision,
  getPromptStudioState,
  PromptRevisionConflictError,
} from "@/analysis/prompt-revisions";

const migrations = [
  "0000_colorful_ronan.sql", "0001_groovy_korg.sql", "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql", "0004_enable_automatic_scans.sql", "0005_colossal_morgan_stark.sql",
  "0006_groovy_expediter.sql", "0007_tough_swarm.sql", "0008_fluffy_radioactive_man.sql",
] as const;
const clients: PGlite[] = [];

async function setupDatabase() {
  const client = new PGlite();
  clients.push(client);
  for (const migration of migrations) {
    const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  const database = drizzle({ client, schema });
  getDatabase.mockResolvedValue(database);
}

afterEach(async () => {
  getDatabase.mockReset();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("versioned prompt instructions", () => {
  it("previews with the execution composer and supports activation rollback", async () => {
    await setupDatabase();
    const initial = await getActivePromptRevision("compact");
    const instructions = "Prioritize visible wick rejection at VWAP.";
    const created = await createAndActivatePromptRevision({
      phase: "compact",
      instructions,
      expectedActiveRevisionId: initial.id,
    });
    expect(created).toMatchObject({ phase: "compact", revisionNumber: 3, instructions });
    expect(Date.parse(created.createdAt)).not.toBeNaN();
    expect((await getActivePromptRevision("compact")).id).toBe(created.id);

    const studio = await getPromptStudioState();
    const compact = studio.find(({ phase }) => phase === "compact")!;
    expect(compact.preview).toBe(buildCompactAnalysisPrompt(PROMPT_PREVIEW_INPUT, instructions));
    expect(compact.preview).toContain("{symbol}");
    expect(compact.preview).toContain("{interval}");

    await expect(createAndActivatePromptRevision({
      phase: "compact",
      instructions: "stale tab edit",
      expectedActiveRevisionId: initial.id,
    })).rejects.toBeInstanceOf(PromptRevisionConflictError);
    const restored = await activatePromptRevision({
      phase: "compact",
      revisionId: initial.id,
      expectedActiveRevisionId: created.id,
    });
    expect(restored.id).toBe(initial.id);
    expect(Date.parse(restored.createdAt)).not.toBeNaN();
    expect((await getActivePromptRevision("compact")).id).toBe(initial.id);
  });
});
