CREATE TABLE IF NOT EXISTS "gex_templates" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "kind" text NOT NULL, "version" integer NOT NULL, "content" text NOT NULL, "active" boolean DEFAULT false NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, CONSTRAINT "gex_templates_kind_version_unique" UNIQUE("kind","version"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gex_templates_kind_created_idx" ON "gex_templates" USING btree ("kind","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gex_datasets" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "category" text NOT NULL, "run_at" timestamp with time zone NOT NULL, "rows" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gex_datasets_category_run_idx" ON "gex_datasets" USING btree ("category","run_at");
