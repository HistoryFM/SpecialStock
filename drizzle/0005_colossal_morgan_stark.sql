CREATE TYPE "public"."full_analysis_state" AS ENUM('ineligible', 'not_requested', 'running', 'available', 'failed');--> statement-breakpoint
CREATE TYPE "public"."model_run_phase" AS ENUM('compact', 'full');--> statement-breakpoint
CREATE TYPE "public"."usage_class" AS ENUM('routine_compact', 'manual_compact', 'full_analysis');--> statement-breakpoint
CREATE TYPE "public"."visual_quality" AS ENUM('clear', 'partial', 'unreadable');--> statement-breakpoint
CREATE TABLE "daily_budget_ledger" (
	"market_date" text PRIMARY KEY NOT NULL,
	"committed_usd" numeric(16, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"response_id" text,
	"status" "model_run_status" NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(16, 8),
	"estimated_cost_usd" numeric(16, 8),
	"error_code" text,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_watchlist_size";--> statement-breakpoint
DROP INDEX "model_runs_slot_role_model_unique";--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "setup_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "immediate_bias" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "broader_trend" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "candlestick_analysis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "vwap_keltner_analysis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "supporting_evidence" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "conflicting_evidence" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "support_levels" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "resistance_levels" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "deeper_scenario" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "data_quality_flags" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "summary" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "visual_quality" "visual_quality" DEFAULT 'partial' NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "full_analysis_state" "full_analysis_state" DEFAULT 'ineligible' NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "full_model_run_id" uuid;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "full_lease_token" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "full_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "full_error" text;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "usage_class" "usage_class" DEFAULT 'routine_compact' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "model_run_id" uuid;--> statement-breakpoint
ALTER TABLE "model_runs" ADD COLUMN "phase" "model_run_phase" DEFAULT 'compact' NOT NULL;--> statement-breakpoint
UPDATE "analyses"
SET
	"visual_quality" = CASE
		WHEN "indicator_readings"->'price_action'->>'readability' = 'clear' THEN 'clear'::"visual_quality"
		WHEN "indicator_readings"->'price_action'->>'readability' = 'unreadable' THEN 'unreadable'::"visual_quality"
		ELSE 'partial'::"visual_quality"
	END,
	"full_analysis_state" = CASE
		WHEN "verdict" IN ('bullish', 'bearish') AND "conviction" IN ('medium', 'high')
			THEN 'available'::"full_analysis_state"
		ELSE 'ineligible'::"full_analysis_state"
	END,
	"full_model_run_id" = CASE
		WHEN "verdict" IN ('bullish', 'bearish') AND "conviction" IN ('medium', 'high')
			THEN "model_run_id"
		ELSE NULL
	END;--> statement-breakpoint
INSERT INTO "model_attempts" (
	"model_run_id", "attempt_number", "response_id", "status", "latency_ms",
	"input_tokens", "output_tokens", "cost_usd", "raw_response"
)
SELECT "id", 1, "raw_response"->>'id', "status", COALESCE("latency_ms", 0),
	"input_tokens", "output_tokens", "cost_usd", "raw_response"
FROM "model_runs"
WHERE "status" IN ('valid', 'invalid', 'failed', 'timed_out')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "daily_budget_ledger" ("market_date", "committed_usd")
SELECT "market_date", COALESCE(SUM(COALESCE("actual_usd", "reserved_usd")), 0)
FROM "budget_reservations"
WHERE "status" <> 'released'
GROUP BY "market_date"
ON CONFLICT ("market_date") DO UPDATE SET "committed_usd" = EXCLUDED."committed_usd";--> statement-breakpoint
WITH ranked AS (
	SELECT "id", row_number() OVER (PARTITION BY "symbol" ORDER BY "started_at" DESC NULLS LAST, "created_at" DESC) AS position
	FROM "scan_slots"
	WHERE "status" = 'running'
)
UPDATE "scan_slots"
SET "status" = 'failed', "error_code" = 'Interrupted before symbol-level scan exclusion was enabled',
	"completed_at" = now(), "lease_expires_at" = NULL, "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);--> statement-breakpoint
ALTER TABLE "model_attempts" ADD CONSTRAINT "model_attempts_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_attempts_run_number_unique" ON "model_attempts" USING btree ("model_run_id","attempt_number");--> statement-breakpoint
CREATE INDEX "model_attempts_run_idx" ON "model_attempts" USING btree ("model_run_id");--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_full_model_run_id_model_runs_id_fk" FOREIGN KEY ("full_model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_slots_one_running_per_symbol_unique" ON "scan_slots" USING btree ("symbol") WHERE "scan_slots"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "model_runs_slot_role_model_unique" ON "model_runs" USING btree ("scan_slot_id","run_role","requested_model","phase");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_watchlist_size" CHECK (jsonb_array_length("app_settings"."watchlist") between 1 and 20);
