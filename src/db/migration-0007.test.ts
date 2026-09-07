import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];
const priorMigrations = [
  "0000_colorful_ronan.sql",
  "0001_groovy_korg.sql",
  "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql",
  "0004_enable_automatic_scans.sql",
  "0005_colossal_morgan_stark.sql",
  "0006_groovy_expediter.sql",
] as const;

async function apply(client: PGlite, migration: string) {
  const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
  await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
}

async function legacyClient() {
  const client = new PGlite();
  clients.push(client);
  for (const migration of priorMigrations) await apply(client, migration);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("prompt, interval, and chat migration", () => {
  it("preserves history, seeds prompts, and backfills manual intervals", async () => {
    const client = await legacyClient();
    await client.exec(`
      insert into scan_slots (id,idempotency_key,symbol,scheduled_for,slot_kind,status,provider,feed)
      values
        ('00000000-0000-4000-8000-000000000101','AAPL:manual:1m:first','AAPL',now(),'manual_smoke','completed','chart-img','tradingview'),
        ('00000000-0000-4000-8000-000000000102','AAPL:legacy-second','AAPL',now(),'manual_smoke','completed','chart-img','tradingview');
      insert into chart_artifacts (scan_slot_id,renderer_version,input_hash,image_hash,mime_type,width,height,byte_length,storage_reference,frozen_input)
      values ('00000000-0000-4000-8000-000000000102','chart-img-v2','input','image','image/png',1600,1920,1,'image.png','{"interval":"10m"}'::jsonb);
    `);

    await apply(client, "0007_tough_swarm.sql");

    const slots = await client.query<{ id: string; scan_interval: string }>("select id,scan_interval from scan_slots order by id");
    expect(slots.rows).toEqual([
      { id: "00000000-0000-4000-8000-000000000101", scan_interval: "1m" },
      { id: "00000000-0000-4000-8000-000000000102", scan_interval: "10m" },
    ]);
    const prompts = await client.query<{ phase: string; revision_number: number }>("select phase,revision_number from prompt_revisions order by phase");
    expect(prompts.rows).toEqual([
      { phase: "compact", revision_number: 1 },
      { phase: "full", revision_number: 1 },
    ]);
    expect((await client.query("select phase from active_prompt_revisions")).rows).toHaveLength(2);
  });

  it("allows different running intervals but rejects duplicate symbol-interval work", async () => {
    const client = await legacyClient();
    await apply(client, "0007_tough_swarm.sql");
    await client.exec(`
      insert into scan_slots (idempotency_key,symbol,scan_interval,scheduled_for,slot_kind,status,provider,feed)
      values
        ('AAPL:manual:1m:a','AAPL','1m',now(),'manual_smoke','running','chart-img','tradingview'),
        ('AAPL:manual:5m:b','AAPL','5m',now(),'manual_smoke','running','chart-img','tradingview'),
        ('AAPL:manual:10m:c','AAPL','10m',now(),'manual_smoke','running','chart-img','tradingview');
    `);
    await expect(client.exec(`insert into scan_slots (idempotency_key,symbol,scan_interval,scheduled_for,slot_kind,status,provider,feed) values ('AAPL:manual:5m:d','AAPL','5m',now(),'manual_smoke','running','chart-img','tradingview')`)).rejects.toThrow();
    expect((await client.query("select id from scan_slots where symbol = 'AAPL' and status = 'running'")).rows).toHaveLength(3);
  });
});
