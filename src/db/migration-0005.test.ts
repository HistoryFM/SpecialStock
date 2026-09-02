import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const clients: PGlite[] = [];

async function apply(client: PGlite, migration: string) {
  const sql = readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
  await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("compact/full scale migration", () => {
  it("backfills historical eligibility and preserves a 20-stock watchlist", async () => {
    const client = new PGlite();
    clients.push(client);
    for (const migration of [
      "0000_colorful_ronan.sql", "0001_groovy_korg.sql", "0002_past_silver_sable.sql",
      "0003_fantastic_talon.sql", "0004_enable_automatic_scans.sql",
    ]) await apply(client, migration);

    const slotId = "00000000-0000-4000-8000-000000000001";
    await client.query(
      `insert into scan_slots (id,idempotency_key,symbol,scheduled_for,slot_kind,status,provider,feed)
       values ($1,'legacy:AAPL','AAPL',now(),'scheduled','completed','chart-img','tradingview')`,
      [slotId],
    );
    const verbose = {
      setup_type: "Legacy setup", immediate_bias: "Up", broader_trend: "Up",
      candlestick_analysis: "Higher lows", vwap_keltner_analysis: "Above VWAP",
      supporting_evidence: ["support"], conflicting_evidence: [], support_levels: [99], resistance_levels: [105],
      deeper_scenario: "Breakdown", data_quality_flags: [], summary: "Legacy narrative",
      indicator_readings: { price_action: { stance: "bullish", readability: "clear", observation: "clear" } },
    };
    for (const [index, signal] of [
      { verdict: "bullish", conviction: "high" },
      { verdict: "no_trade", conviction: "low" },
    ].entries()) {
      const runId = `00000000-0000-4000-8000-00000000001${index}`;
      await client.query(
        `insert into model_runs (id,scan_slot_id,run_role,requested_model,prompt_version,input_hash,status,latency_ms,input_tokens,output_tokens,cost_usd,raw_response)
         values ($1,$2,'primary',$3,'legacy','hash','valid',100,10,20,0.01,$4)`,
        [runId, slotId, `google/gemini-2.5-pro-${index}`, JSON.stringify({ id: `legacy-${index}` })],
      );
      await client.query(
        `insert into analyses (
          model_run_id,verdict,bar_status,setup_type,immediate_bias,broader_trend,conviction,
          candlestick_analysis,vwap_keltner_analysis,supporting_evidence,conflicting_evidence,
          support_levels,resistance_levels,deeper_scenario,data_quality_flags,summary,indicator_readings
        ) values ($1,$2,'closed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [runId, signal.verdict, verbose.setup_type, verbose.immediate_bias, verbose.broader_trend,
          signal.conviction, verbose.candlestick_analysis, verbose.vwap_keltner_analysis,
          JSON.stringify(verbose.supporting_evidence), JSON.stringify(verbose.conflicting_evidence),
          JSON.stringify(verbose.support_levels), JSON.stringify(verbose.resistance_levels),
          verbose.deeper_scenario, JSON.stringify(verbose.data_quality_flags), verbose.summary,
          JSON.stringify(verbose.indicator_readings)],
      );
    }
    await client.exec("insert into budget_reservations (market_date,model,run_role,reserved_usd,actual_usd,status) values ('2026-09-01','google/gemini-2.5-pro','primary',0.08,0.03,'settled')");

    await apply(client, "0005_colossal_morgan_stark.sql");
    const states = await client.query<{ verdict: string; full_analysis_state: string; summary: string }>(
      "select verdict,full_analysis_state,summary from analyses order by verdict",
    );
    expect(states.rows).toEqual([
      expect.objectContaining({ verdict: "bullish", full_analysis_state: "available", summary: "Legacy narrative" }),
      expect.objectContaining({ verdict: "no_trade", full_analysis_state: "ineligible", summary: "Legacy narrative" }),
    ]);
    expect((await client.query("select * from model_attempts")).rows).toHaveLength(2);
    expect((await client.query<{ committed_usd: string }>("select committed_usd from daily_budget_ledger")).rows[0]?.committed_usd).toBe("0.03000000");

    const watchlist = Array.from({ length: 20 }, (_, index) => ({
      symbol: `S${index + 1}`, exchange: "NASDAQ", automaticScanEnabled: index % 2 === 0,
    }));
    await client.query("insert into app_settings (id,watchlist) values (1,$1)", [JSON.stringify(watchlist)]);
    expect((await client.query<{ count: number }>("select jsonb_array_length(watchlist) as count from app_settings")).rows[0]?.count).toBe(20);
  });
});
