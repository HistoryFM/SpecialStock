CREATE TYPE "public"."swing_artifact_role" AS ENUM('macro', 'candidate');--> statement-breakpoint
CREATE TYPE "public"."swing_candidate_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."swing_direction" AS ENUM('LONG', 'SHORT', 'NO_TRADE');--> statement-breakpoint
CREATE TYPE "public"."swing_run_mode" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TYPE "public"."swing_run_status" AS ENUM('scheduled', 'running', 'completed', 'partial', 'failed', 'missed');--> statement-breakpoint
CREATE TABLE "active_swing_prompt_revision" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"active_revision_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "active_swing_prompt_revision_singleton" CHECK ("active_swing_prompt_revision"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "swing_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"chart_artifact_id" uuid,
	"watchlist_position" integer NOT NULL,
	"stock_name" text NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"status" "swing_candidate_status" DEFAULT 'pending' NOT NULL,
	"direction" "swing_direction",
	"original_direction" "swing_direction",
	"observed_price" numeric(20, 8),
	"entry_zone_low" numeric(20, 8),
	"entry_zone_high" numeric(20, 8),
	"stop_loss" numeric(20, 8),
	"profit_target_1" numeric(20, 8),
	"profit_target_2" numeric(20, 8),
	"conviction" text,
	"visual_quality" text,
	"risk_reward" numeric(12, 2),
	"proximity_percent" numeric(12, 2),
	"rejection_reason" text,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swing_chart_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"role" "swing_artifact_role" NOT NULL,
	"symbol" text NOT NULL,
	"renderer_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"image_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"storage_reference" text NOT NULL,
	"frozen_input" jsonb NOT NULL,
	"provider_input" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swing_model_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"failure_kind" text,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(16, 8),
	"response_id" text,
	"actual_model" text,
	"actual_provider" text,
	"request_settings" jsonb NOT NULL,
	"raw_response" jsonb,
	"prompt_snapshot" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swing_model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_id" uuid,
	"phase" text NOT NULL,
	"requested_model" text NOT NULL,
	"actual_model" text,
	"actual_provider" text,
	"prompt_revision_id" uuid NOT NULL,
	"template_version" text NOT NULL,
	"prompt_snapshot" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"image_hashes" jsonb NOT NULL,
	"request_settings" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(16, 8),
	"raw_response" jsonb,
	"failure_kind" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swing_prompt_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_number" integer NOT NULL,
	"instructions" text NOT NULL,
	"instructions_hash" text NOT NULL,
	"template_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swing_prompt_revisions_revision_number_unique" UNIQUE("revision_number")
);
--> statement-breakpoint
CREATE TABLE "swing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" "swing_run_mode" NOT NULL,
	"status" "swing_run_status" DEFAULT 'scheduled' NOT NULL,
	"session_date" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_id" uuid,
	"watchlist_version_id" uuid NOT NULL,
	"prompt_revision_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"stage" text DEFAULT 'queued' NOT NULL,
	"completed_candidates" integer DEFAULT 0 NOT NULL,
	"failed_candidates" integer DEFAULT 0 NOT NULL,
	"total_candidates" integer DEFAULT 0 NOT NULL,
	"macro_result" jsonb,
	"provider_calls" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(16, 8),
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swing_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "swing_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"automatic_enabled" boolean DEFAULT false NOT NULL,
	"active_watchlist_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swing_settings_singleton" CHECK ("swing_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "swing_watchlist_entries" (
	"version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"stock_name" text NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	CONSTRAINT "swing_watchlist_entries_version_id_position_pk" PRIMARY KEY("version_id","position")
);
--> statement-breakpoint
CREATE TABLE "swing_watchlist_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_number" integer NOT NULL,
	"source_filename" text NOT NULL,
	"source_type" text NOT NULL,
	"entry_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swing_watchlist_versions_version_number_unique" UNIQUE("version_number")
);
--> statement-breakpoint
ALTER TABLE "active_swing_prompt_revision" ADD CONSTRAINT "active_swing_prompt_revision_active_revision_id_swing_prompt_revisions_id_fk" FOREIGN KEY ("active_revision_id") REFERENCES "public"."swing_prompt_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_candidates" ADD CONSTRAINT "swing_candidates_run_id_swing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."swing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_candidates" ADD CONSTRAINT "swing_candidates_chart_artifact_id_swing_chart_artifacts_id_fk" FOREIGN KEY ("chart_artifact_id") REFERENCES "public"."swing_chart_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_chart_artifacts" ADD CONSTRAINT "swing_chart_artifacts_run_id_swing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."swing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_model_attempts" ADD CONSTRAINT "swing_model_attempts_model_run_id_swing_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."swing_model_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_model_runs" ADD CONSTRAINT "swing_model_runs_run_id_swing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."swing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_model_runs" ADD CONSTRAINT "swing_model_runs_candidate_id_swing_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."swing_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_model_runs" ADD CONSTRAINT "swing_model_runs_prompt_revision_id_swing_prompt_revisions_id_fk" FOREIGN KEY ("prompt_revision_id") REFERENCES "public"."swing_prompt_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD CONSTRAINT "swing_runs_watchlist_version_id_swing_watchlist_versions_id_fk" FOREIGN KEY ("watchlist_version_id") REFERENCES "public"."swing_watchlist_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD CONSTRAINT "swing_runs_prompt_revision_id_swing_prompt_revisions_id_fk" FOREIGN KEY ("prompt_revision_id") REFERENCES "public"."swing_prompt_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_settings" ADD CONSTRAINT "swing_settings_active_watchlist_version_id_swing_watchlist_versions_id_fk" FOREIGN KEY ("active_watchlist_version_id") REFERENCES "public"."swing_watchlist_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swing_watchlist_entries" ADD CONSTRAINT "swing_watchlist_entries_version_id_swing_watchlist_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."swing_watchlist_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swing_candidates_run_symbol_unique" ON "swing_candidates" USING btree ("run_id","symbol");--> statement-breakpoint
CREATE INDEX "swing_candidates_run_order_idx" ON "swing_candidates" USING btree ("run_id","watchlist_position");--> statement-breakpoint
CREATE UNIQUE INDEX "swing_chart_artifacts_run_role_symbol_unique" ON "swing_chart_artifacts" USING btree ("run_id","role","symbol");--> statement-breakpoint
CREATE INDEX "swing_chart_artifacts_hash_idx" ON "swing_chart_artifacts" USING btree ("image_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "swing_model_attempts_run_number_unique" ON "swing_model_attempts" USING btree ("model_run_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "swing_model_runs_run_phase_candidate_unique" ON "swing_model_runs" USING btree ("run_id","phase","candidate_id");--> statement-breakpoint
CREATE INDEX "swing_model_runs_run_idx" ON "swing_model_runs" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "swing_prompt_revisions_created_idx" ON "swing_prompt_revisions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "swing_runs_one_active_unique" ON "swing_runs" USING btree ("status") WHERE "swing_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "swing_runs_session_mode_idx" ON "swing_runs" USING btree ("session_date","mode");--> statement-breakpoint
CREATE INDEX "swing_runs_created_idx" ON "swing_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "swing_watchlist_version_symbol_unique" ON "swing_watchlist_entries" USING btree ("version_id","symbol");--> statement-breakpoint
CREATE INDEX "swing_watchlist_versions_created_idx" ON "swing_watchlist_versions" USING btree ("created_at");