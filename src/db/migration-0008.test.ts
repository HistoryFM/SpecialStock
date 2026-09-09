import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_COMPACT_ANALYSIS_INSTRUCTIONS } from "@/analysis/prompt";

const clients: PGlite[] = [];
const through0007 = [
  "0000_colorful_ronan.sql", "0001_groovy_korg.sql", "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql", "0004_enable_automatic_scans.sql", "0005_colossal_morgan_stark.sql",
  "0006_groovy_expediter.sql", "0007_tough_swarm.sql",
] as const;

async function apply(client: PGlite, migration: string) {
  const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
  await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
}

async function databaseThrough0007() {
  const client = new PGlite();
  clients.push(client);
  for (const migration of through0007) await apply(client, migration);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("compact quality profile migration", () => {
  it("activates the new factory prompt for a fresh database", async () => {
    const client = await databaseThrough0007();
    await apply(client, "0008_fluffy_radioactive_man.sql");
    const active = await client.query<{ revision_number: number; instructions_hash: string; instructions: string }>(`
      select revision_number,instructions_hash,instructions from prompt_revisions
      join active_prompt_revisions on active_revision_id = id where active_prompt_revisions.phase = 'compact'
    `);
    expect(active.rows).toEqual([{ revision_number: 2, instructions_hash: "9f93f9b093ced2514fe37813bc48d91ee2b5e2632b6187bd3d9363abcea3ebaa", instructions: DEFAULT_COMPACT_ANALYSIS_INSTRUCTIONS }]);
  });

  it("preserves an active custom revision", async () => {
    const client = await databaseThrough0007();
    await client.exec(`
      insert into prompt_revisions (id,phase,revision_number,instructions,instructions_hash,template_version)
      values ('00000000-0000-4000-8000-000000000099','compact',2,'custom','custom-hash','chart-compact-v2');
      update active_prompt_revisions set active_revision_id = '00000000-0000-4000-8000-000000000099' where phase = 'compact';
    `);
    await apply(client, "0008_fluffy_radioactive_man.sql");
    const active = await client.query<{ active_revision_id: string }>("select active_revision_id from active_prompt_revisions where phase = 'compact'");
    expect(active.rows[0]?.active_revision_id).toBe("00000000-0000-4000-8000-000000000099");
    expect((await client.query("select id from prompt_revisions where phase = 'compact'")).rows).toHaveLength(2);
  });

  it("migrates a reactivated old factory prompt without overwriting history", async () => {
    const client = await databaseThrough0007();
    await client.exec(`
      insert into prompt_revisions (id,phase,revision_number,instructions,instructions_hash,template_version)
      values ('00000000-0000-4000-8000-000000000099','compact',2,'custom','custom-hash','chart-compact-v2');
    `);
    await apply(client, "0008_fluffy_radioactive_man.sql");
    const active = await client.query<{ revision_number: number }>(`
      select revision_number from prompt_revisions join active_prompt_revisions on active_revision_id = id
      where active_prompt_revisions.phase = 'compact'
    `);
    expect(active.rows[0]?.revision_number).toBe(3);
    expect((await client.query("select id from prompt_revisions where phase = 'compact'")).rows).toHaveLength(3);
  });
});
