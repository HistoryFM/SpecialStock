ALTER TYPE "public"."swing_candidate_status" ADD VALUE 'canceled';--> statement-breakpoint
ALTER TYPE "public"."swing_run_status" ADD VALUE 'canceled';--> statement-breakpoint
CREATE TABLE "swing_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_list_id" uuid,
	"source_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swing_market_settings" (
	"market" text PRIMARY KEY NOT NULL,
	"automatic_enabled" boolean DEFAULT false NOT NULL,
	"active_watchlist_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swing_candidates" ADD COLUMN "industry" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "swing_model_attempts" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "swing_model_runs" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD COLUMN "market" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD COLUMN "report_date" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "swing_runs" SET "report_date" = "session_date" WHERE "report_date" = '';--> statement-breakpoint
ALTER TABLE "swing_runs" ALTER COLUMN "report_date" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD COLUMN "canceled_candidates" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD COLUMN "stock_analysis_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swing_runs" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "swing_watchlist_entries" ADD COLUMN "industry" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "swing_watchlist_versions" ADD COLUMN "list_id" uuid;--> statement-breakpoint
INSERT INTO "swing_lists" ("id", "market", "name", "kind") VALUES ('00000000-0000-4000-8000-000000000010', 'US', 'Legacy US watchlist', 'master') ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "swing_watchlist_versions" SET "list_id" = '00000000-0000-4000-8000-000000000010' WHERE "list_id" IS NULL;--> statement-breakpoint
ALTER TABLE "swing_watchlist_versions" ALTER COLUMN "list_id" SET NOT NULL;--> statement-breakpoint
INSERT INTO "swing_market_settings" ("market", "automatic_enabled", "active_watchlist_version_id") SELECT 'US', "automatic_enabled", "active_watchlist_version_id" FROM "swing_settings" WHERE "id" = 1 ON CONFLICT ("market") DO NOTHING;--> statement-breakpoint
INSERT INTO "swing_market_settings" ("market", "automatic_enabled") VALUES ('US', false), ('INDIA', false) ON CONFLICT ("market") DO NOTHING;--> statement-breakpoint
ALTER TABLE "swing_market_settings" ADD CONSTRAINT "swing_market_settings_active_watchlist_version_id_swing_watchlist_versions_id_fk" FOREIGN KEY ("active_watchlist_version_id") REFERENCES "public"."swing_watchlist_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swing_lists_market_name_unique" ON "swing_lists" USING btree ("market",lower("name"));--> statement-breakpoint
CREATE INDEX "swing_lists_market_created_idx" ON "swing_lists" USING btree ("market","created_at");--> statement-breakpoint
ALTER TABLE "swing_watchlist_versions" ADD CONSTRAINT "swing_watchlist_versions_list_id_swing_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."swing_lists"("id") ON DELETE cascade ON UPDATE no action;
