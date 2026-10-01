CREATE TABLE IF NOT EXISTS "gex_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "parent_list_id" uuid,
  "symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_filename" text,
  "active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gex_lists_active_idx" ON "gex_lists" USING btree ("active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gex_lists_parent_idx" ON "gex_lists" USING btree ("parent_list_id");
