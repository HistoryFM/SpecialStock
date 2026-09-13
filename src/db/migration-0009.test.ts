import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];
const migrations = [
  "0000_colorful_ronan.sql", "0001_groovy_korg.sql", "0002_past_silver_sable.sql",
  "0003_fantastic_talon.sql", "0004_enable_automatic_scans.sql", "0005_colossal_morgan_stark.sql",
  "0006_groovy_expediter.sql", "0007_tough_swarm.sql", "0008_fluffy_radioactive_man.sql",
] as const;
async function apply(client: PGlite, migration: string) {
  const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
  await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
}
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("manual prompt scopes and report migration", () => {
  it("preserves active custom automatic revisions and seeds independent manual copies", async () => {
    const client = new PGlite(); clients.push(client);
    for (const migration of migrations) await apply(client, migration);
    await client.exec(`
      INSERT INTO prompt_revisions (id,phase,revision_number,instructions,instructions_hash,template_version)
      VALUES ('00000000-0000-4000-8000-000000000099','compact',3,'custom automatic','custom-hash','chart-compact-v3');
      UPDATE active_prompt_revisions SET active_revision_id='00000000-0000-4000-8000-000000000099' WHERE phase='compact';
    `);
    await apply(client, "0009_lazy_tinkerer.sql");
    const active = await client.query<{ scope: string; phase: string; id: string; instructions: string }>(`
      SELECT active.scope,active.phase,revision.id,revision.instructions
      FROM active_prompt_revisions active JOIN prompt_revisions revision ON revision.id=active.active_revision_id
      ORDER BY active.scope,active.phase
    `);
    expect(active.rows).toHaveLength(8);
    expect(active.rows.find((row) => row.scope === "auto" && row.phase === "compact")).toMatchObject({ id: "00000000-0000-4000-8000-000000000099", instructions: "custom automatic" });
    for (const scope of ["manual_1m", "manual_5m", "manual_10m"]) {
      const manual = active.rows.find((row) => row.scope === scope && row.phase === "compact")!;
      expect(manual.instructions).toBe("custom automatic");
      expect(manual.id).not.toBe("00000000-0000-4000-8000-000000000099");
    }
  });

  it("enables stored no-trade charts while leaving saved legacy detail intact", async () => {
    const client = new PGlite(); clients.push(client);
    for (const migration of migrations) await apply(client, migration);
    await client.exec(`
      INSERT INTO scan_slots (id,idempotency_key,symbol,scan_interval,scheduled_for,slot_kind,status,provider,feed)
      VALUES ('00000000-0000-4000-8000-000000000301','migration:one','AAPL','1m',now(),'manual_smoke','completed','chart-img','tradingview'),
             ('00000000-0000-4000-8000-000000000302','migration:two','MSFT','5m',now(),'manual_smoke','completed','chart-img','tradingview');
      INSERT INTO chart_artifacts (id,scan_slot_id,renderer_version,input_hash,image_hash,mime_type,width,height,byte_length,storage_reference,frozen_input)
      VALUES ('00000000-0000-4000-8000-000000000311','00000000-0000-4000-8000-000000000301','test','one','one','image/png',1600,1920,1,'chart-one','{}'),
             ('00000000-0000-4000-8000-000000000312','00000000-0000-4000-8000-000000000302','test','two','two','image/png',1600,1920,1,'chart-two','{}');
      INSERT INTO model_runs (id,scan_slot_id,chart_artifact_id,run_role,phase,requested_model,prompt_version,input_hash,status)
      VALUES ('00000000-0000-4000-8000-000000000321','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000311','primary','compact','google/gemini-2.5-pro','old','one','valid'),
             ('00000000-0000-4000-8000-000000000322','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000312','primary','compact','google/gemini-2.5-pro','old','two','valid');
      INSERT INTO analyses (id,model_run_id,verdict,bar_status,conviction,visual_quality,full_analysis_state,summary)
      VALUES ('00000000-0000-4000-8000-000000000331','00000000-0000-4000-8000-000000000321','no_trade','closed','low','partial','ineligible',NULL),
             ('00000000-0000-4000-8000-000000000332','00000000-0000-4000-8000-000000000322','bullish','closed','low','partial','ineligible','Saved legacy report');
    `);
    await apply(client, "0009_lazy_tinkerer.sql");
    const rows = await client.query<{ verdict: string; full_analysis_state: string; summary: string | null }>("SELECT verdict,full_analysis_state,summary FROM analyses WHERE id IN ('00000000-0000-4000-8000-000000000331','00000000-0000-4000-8000-000000000332') ORDER BY verdict");
    expect(rows.rows).toEqual([
      { verdict: "bullish", full_analysis_state: "available", summary: "Saved legacy report" },
      { verdict: "no_trade", full_analysis_state: "not_requested", summary: null },
    ]);
  });
});
