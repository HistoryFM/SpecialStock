ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "previous_completed_candle_close" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "gex_gate" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "gex_dataset_run_at" timestamp with time zone;
