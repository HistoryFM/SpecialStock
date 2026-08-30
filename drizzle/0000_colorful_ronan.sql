CREATE TYPE "public"."bar_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."conviction" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."model_run_status" AS ENUM('pending', 'valid', 'invalid', 'failed', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_state" AS ENUM('pending', 'delivered', 'suppressed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outcome_result" AS ENUM('target_first', 'invalidation_first', 'expired', 'ambiguous', 'stale', 'missing_data');--> statement-breakpoint
CREATE TYPE "public"."run_role" AS ENUM('primary', 'comparison', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('scheduled', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."thesis_direction" AS ENUM('bullish', 'bearish');--> statement-breakpoint
CREATE TYPE "public"."thesis_state" AS ENUM('active', 'target_reached', 'invalidated', 'expired');--> statement-breakpoint
CREATE TYPE "public"."timeframe" AS ENUM('1m', '5m', '15m', '1d');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('bullish', 'bearish', 'no_trade');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_run_id" uuid NOT NULL,
	"verdict" "verdict" NOT NULL,
	"bar_status" "bar_status" NOT NULL,
	"setup_type" text NOT NULL,
	"immediate_bias" text NOT NULL,
	"broader_trend" text NOT NULL,
	"conviction" "conviction" NOT NULL,
	"candlestick_analysis" text NOT NULL,
	"volume_analysis" text NOT NULL,
	"vwap_keltner_analysis" text NOT NULL,
	"momentum_analysis" text NOT NULL,
	"relative_velocity_analysis" text NOT NULL,
	"supporting_evidence" jsonb NOT NULL,
	"conflicting_evidence" jsonb NOT NULL,
	"support_levels" jsonb NOT NULL,
	"resistance_levels" jsonb NOT NULL,
	"primary_target" numeric(20, 8),
	"deeper_scenario" text NOT NULL,
	"invalidation_level" numeric(20, 8),
	"data_quality_flags" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyses_model_run_id_unique" UNIQUE("model_run_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"watchlist" jsonb DEFAULT '["AAPL","MSFT","NVDA","AMZN","GOOGL"]'::jsonb NOT NULL,
	"active_model" text DEFAULT 'openai/gpt-5.6-luna' NOT NULL,
	"fallback_model" text,
	"comparison_model" text,
	"comparison_enabled" boolean DEFAULT false NOT NULL,
	"notifications_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id" = 1),
	CONSTRAINT "app_settings_watchlist_size" CHECK (jsonb_array_length("app_settings"."watchlist") between 1 and 5),
	CONSTRAINT "app_settings_active_model_allowlist" CHECK ("app_settings"."active_model" in ('openai/gpt-5.6-luna', 'google/gemini-3.7-flash', 'xiaomi/mimo-v2.5', 'google/gemini-3.1-flash-lite')),
	CONSTRAINT "app_settings_fallback_model_allowlist" CHECK ("app_settings"."fallback_model" is null or "app_settings"."fallback_model" in ('openai/gpt-5.6-luna', 'google/gemini-3.7-flash', 'xiaomi/mimo-v2.5', 'google/gemini-3.1-flash-lite')),
	CONSTRAINT "app_settings_comparison_model_allowlist" CHECK ("app_settings"."comparison_model" is null or "app_settings"."comparison_model" in ('openai/gpt-5.6-luna', 'google/gemini-3.7-flash', 'xiaomi/mimo-v2.5', 'google/gemini-3.1-flash-lite'))
);
--> statement-breakpoint
CREATE TABLE "chart_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_slot_id" uuid NOT NULL,
	"renderer_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"image_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"storage_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicator_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_slot_id" uuid NOT NULL,
	"timeframe" timeframe NOT NULL,
	"calculation_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"bar_status" "bar_status" NOT NULL,
	"values" jsonb NOT NULL,
	"slopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_bars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" timeframe NOT NULL,
	"provider" text NOT NULL,
	"feed" text NOT NULL,
	"session_date" text NOT NULL,
	"bar_start" timestamp with time zone NOT NULL,
	"bar_end" timestamp with time zone NOT NULL,
	"open" numeric(20, 8) NOT NULL,
	"high" numeric(20, 8) NOT NULL,
	"low" numeric(20, 8) NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"volume" bigint NOT NULL,
	"trade_count" integer,
	"source_vwap" numeric(20, 8),
	"is_complete" boolean NOT NULL,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_slot_id" uuid NOT NULL,
	"chart_artifact_id" uuid,
	"run_role" "run_role" NOT NULL,
	"requested_model" text NOT NULL,
	"actual_model" text,
	"actual_provider" text,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" "model_run_status" DEFAULT 'pending' NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(16, 8),
	"raw_response" jsonb,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_over_from_model" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"delivery_state" "notification_delivery_state" DEFAULT 'pending' NOT NULL,
	"suppressed_by_event_id" uuid,
	"cooldown_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"result" "outcome_result" NOT NULL,
	"target_touched_at" timestamp with time zone,
	"invalidation_touched_at" timestamp with time zone,
	"horizon_ends_at" timestamp with time zone NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_thesis_id_unique" UNIQUE("thesis_id")
);
--> statement-breakpoint
CREATE TABLE "review_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"assessment" text NOT NULL,
	"unsupported_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"symbol" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"slot_kind" text NOT NULL,
	"status" "scan_status" DEFAULT 'scheduled' NOT NULL,
	"provider" text NOT NULL,
	"feed" text NOT NULL,
	"latest_source_at" timestamp with time zone,
	"freshness_seconds" integer,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"direction" "thesis_direction" NOT NULL,
	"target" numeric(20, 8),
	"invalidation" numeric(20, 8),
	"state" "thesis_state" DEFAULT 'active' NOT NULL,
	"supersedes_thesis_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_artifacts" ADD CONSTRAINT "chart_artifacts_scan_slot_id_scan_slots_id_fk" FOREIGN KEY ("scan_slot_id") REFERENCES "public"."scan_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_snapshots" ADD CONSTRAINT "indicator_snapshots_scan_slot_id_scan_slots_id_fk" FOREIGN KEY ("scan_slot_id") REFERENCES "public"."scan_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_scan_slot_id_scan_slots_id_fk" FOREIGN KEY ("scan_slot_id") REFERENCES "public"."scan_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_chart_artifact_id_chart_artifacts_id_fk" FOREIGN KEY ("chart_artifact_id") REFERENCES "public"."chart_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_suppressed_by_event_id_notification_events_id_fk" FOREIGN KEY ("suppressed_by_event_id") REFERENCES "public"."notification_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_labels" ADD CONSTRAINT "review_labels_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_supersedes_thesis_id_theses_id_fk" FOREIGN KEY ("supersedes_thesis_id") REFERENCES "public"."theses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chart_artifacts_image_hash_unique" ON "chart_artifacts" USING btree ("image_hash");--> statement-breakpoint
CREATE INDEX "chart_artifacts_scan_slot_idx" ON "chart_artifacts" USING btree ("scan_slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "indicator_snapshots_slot_timeframe_unique" ON "indicator_snapshots" USING btree ("scan_slot_id","timeframe");--> statement-breakpoint
CREATE UNIQUE INDEX "market_bars_source_bar_unique" ON "market_bars" USING btree ("provider","feed","symbol","timeframe","bar_start");--> statement-breakpoint
CREATE INDEX "market_bars_symbol_time_idx" ON "market_bars" USING btree ("symbol","timeframe","bar_start");--> statement-breakpoint
CREATE UNIQUE INDEX "model_runs_slot_role_model_unique" ON "model_runs" USING btree ("scan_slot_id","run_role","requested_model");--> statement-breakpoint
CREATE INDEX "notification_events_thesis_idx" ON "notification_events" USING btree ("thesis_id","created_at");--> statement-breakpoint
CREATE INDEX "review_labels_analysis_idx" ON "review_labels" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_slots_idempotency_key_unique" ON "scan_slots" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "scan_slots_symbol_scheduled_idx" ON "scan_slots" USING btree ("symbol","scheduled_for");--> statement-breakpoint
CREATE INDEX "theses_symbol_state_idx" ON "theses" USING btree ("symbol","state");