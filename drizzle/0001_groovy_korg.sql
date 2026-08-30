ALTER TYPE "public"."model_run_status" ADD VALUE 'budget_skipped';--> statement-breakpoint
ALTER TYPE "public"."thesis_state" ADD VALUE 'superseded';--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_date" text NOT NULL,
	"model" text NOT NULL,
	"run_role" "run_role" NOT NULL,
	"reserved_usd" numeric(16, 8) NOT NULL,
	"actual_usd" numeric(16, 8),
	"status" text DEFAULT 'reserved' NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tab_id" text NOT NULL,
	"market_date" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_leader" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DROP INDEX "market_bars_source_bar_unique";--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "fallback_model" SET DEFAULT 'google/gemini-3.7-flash';--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "comparison_model" SET DEFAULT 'google/gemini-3.7-flash';--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "comparison_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "daily_budget_usd" numeric(8, 2) DEFAULT '10.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "chart_artifacts" ADD COLUMN "frozen_input" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "market_bars" ADD COLUMN "content_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "market_bars" ADD COLUMN "observed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "input_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "budget_reservations_date_idx" ON "budget_reservations" USING btree ("market_date","status");--> statement-breakpoint
CREATE INDEX "scheduler_heartbeats_date_idx" ON "scheduler_heartbeats" USING btree ("market_date","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_thesis_reason_unique" ON "notification_events" USING btree ("thesis_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "market_bars_source_bar_unique" ON "market_bars" USING btree ("provider","feed","symbol","timeframe","bar_start","content_hash");