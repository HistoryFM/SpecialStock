ALTER TABLE "gex_model_runs" ADD COLUMN IF NOT EXISTS "purpose" text;
--> statement-breakpoint
UPDATE "gex_model_runs" SET "purpose" = 'chart_values' WHERE "purpose" IS NULL;
--> statement-breakpoint
ALTER TABLE "gex_model_runs" ALTER COLUMN "purpose" SET NOT NULL;
