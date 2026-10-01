CREATE TABLE IF NOT EXISTS "gex_model_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "symbol" text NOT NULL,
  "category" text NOT NULL,
  "purpose" text NOT NULL,
  "requested_model" text NOT NULL,
  "actual_model" text,
  "actual_provider" text,
  "response_id" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "reasoning_tokens" integer,
  "cost_usd" numeric(16, 8),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gex_model_runs_created_idx" ON "gex_model_runs" USING btree ("created_at");
