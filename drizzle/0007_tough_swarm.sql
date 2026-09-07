CREATE TYPE "public"."chat_conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."chat_turn_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."prompt_phase" AS ENUM('compact', 'full');--> statement-breakpoint
CREATE TYPE "public"."scan_interval" AS ENUM('1m', '5m', '10m');--> statement-breakpoint
ALTER TYPE "public"."model_run_phase" ADD VALUE 'chat';--> statement-breakpoint
ALTER TYPE "public"."usage_class" ADD VALUE 'chat_followup';--> statement-breakpoint
CREATE TABLE "active_prompt_revisions" (
	"phase" "prompt_phase" PRIMARY KEY NOT NULL,
	"active_revision_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"status" "chat_conversation_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_chat_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"status" "chat_turn_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"context_turn_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_run_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_scan_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"requested_intervals" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase" "prompt_phase" NOT NULL,
	"revision_number" integer NOT NULL,
	"instructions" text NOT NULL,
	"instructions_hash" text NOT NULL,
	"template_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "prompt_revisions" ("id", "phase", "revision_number", "instructions", "instructions_hash", "template_version") VALUES
('00000000-0000-4000-8000-000000000001', 'compact', 1, $prompt$To prevent generic trend-following bias, perform a strict structural audit on the most recent 3 candles (use fewer candles if 3 aren't yet available after market open) before giving a direction:

Candlestick Physics: Compare the specific real-body sizes of the last 3 candles. Is velocity expanding or contracting? Note any precise wick rejections against the indicator lines.

Volume Divergence: Check whether the volume bars under the last 3 candles are expanding, flat, or drying up relative to each other. Match the volume directly to the price action.

Line Confluence: Determine whether the last 3 candles are accepting or rejecting VWAP and the visible Keltner upper, middle, or lower lines. A directional call requires agreement between candle structure, volume behavior, and those visible line interactions; otherwise return no_trade.

Do not give a generic macro projection; state the immediate micro-move based strictly on the data.$prompt$, 'cd0a8cd8032b1441cacb4f2fe2ce0a53ae10c08a6a7ace127864675499d7cd91', 'chart-compact-v2'),
('00000000-0000-4000-8000-000000000002', 'full', 1, $prompt$Describe only visible price action, VWAP, Keltner Channels, Volume, ADX, RSI, MACD, CCI, and CMF.$prompt$, 'd105400ebdf73ebd03dbe7b9f418ebd25357e0692fa5bbceb008df9c0bf1a005', 'chart-full-v1');
--> statement-breakpoint
INSERT INTO "active_prompt_revisions" ("phase", "active_revision_id") VALUES
('compact', '00000000-0000-4000-8000-000000000001'),
('full', '00000000-0000-4000-8000-000000000002');
--> statement-breakpoint
DROP INDEX "scan_slots_one_running_per_symbol_unique";--> statement-breakpoint
DROP INDEX "model_runs_slot_role_model_unique";--> statement-breakpoint
ALTER TABLE "model_attempts" ADD COLUMN "prompt_snapshot" text;--> statement-breakpoint
ALTER TABLE "model_attempts" ADD COLUMN "prompt_hash" text;--> statement-breakpoint
ALTER TABLE "model_runs" ADD COLUMN "operation_key" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_runs" ADD COLUMN "prompt_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "scan_interval" "scan_interval" DEFAULT '5m' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD COLUMN "manual_scan_group_id" uuid;--> statement-breakpoint
UPDATE "scan_slots" SET "scan_interval" = CASE
	WHEN "idempotency_key" LIKE '%:manual:1m:%' THEN '1m'::"scan_interval"
	WHEN "idempotency_key" LIKE '%:manual:10m:%' THEN '10m'::"scan_interval"
	ELSE '5m'::"scan_interval"
END;
--> statement-breakpoint
UPDATE "scan_slots" AS slots
SET "scan_interval" = artifacts."interval"::"scan_interval"
FROM (
	SELECT DISTINCT ON ("scan_slot_id") "scan_slot_id", "frozen_input"->>'interval' AS "interval"
	FROM "chart_artifacts"
	WHERE "frozen_input"->>'interval' IN ('1m', '5m', '10m')
	ORDER BY "scan_slot_id", "created_at" DESC
) AS artifacts
WHERE slots."id" = artifacts."scan_slot_id";
--> statement-breakpoint
ALTER TABLE "active_prompt_revisions" ADD CONSTRAINT "active_prompt_revisions_active_revision_id_prompt_revisions_id_fk" FOREIGN KEY ("active_revision_id") REFERENCES "public"."prompt_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_chat_conversations" ADD CONSTRAINT "analysis_chat_conversations_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_chat_turns" ADD CONSTRAINT "analysis_chat_turns_conversation_id_analysis_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."analysis_chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_chat_turns" ADD CONSTRAINT "analysis_chat_turns_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_chat_one_active_unique" ON "analysis_chat_conversations" USING btree ("analysis_id") WHERE "analysis_chat_conversations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "analysis_chat_analysis_idx" ON "analysis_chat_conversations" USING btree ("analysis_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_chat_turns_request_unique" ON "analysis_chat_turns" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_chat_one_pending_unique" ON "analysis_chat_turns" USING btree ("conversation_id") WHERE "analysis_chat_turns"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "analysis_chat_turns_conversation_idx" ON "analysis_chat_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_scan_groups_request_symbol_unique" ON "manual_scan_groups" USING btree ("request_id","symbol");--> statement-breakpoint
CREATE INDEX "manual_scan_groups_symbol_created_idx" ON "manual_scan_groups" USING btree ("symbol","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_revisions_phase_number_unique" ON "prompt_revisions" USING btree ("phase","revision_number");--> statement-breakpoint
CREATE INDEX "prompt_revisions_phase_created_idx" ON "prompt_revisions" USING btree ("phase","created_at");--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_prompt_revision_id_prompt_revisions_id_fk" FOREIGN KEY ("prompt_revision_id") REFERENCES "public"."prompt_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_slots" ADD CONSTRAINT "scan_slots_manual_scan_group_id_manual_scan_groups_id_fk" FOREIGN KEY ("manual_scan_group_id") REFERENCES "public"."manual_scan_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_slots_one_running_per_symbol_interval_unique" ON "scan_slots" USING btree ("symbol","scan_interval") WHERE "scan_slots"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "model_runs_slot_role_model_unique" ON "model_runs" USING btree ("scan_slot_id","run_role","requested_model","phase","operation_key");
