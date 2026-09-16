DROP INDEX "swing_runs_one_active_unique";--> statement-breakpoint
ALTER TABLE "swing_model_attempts" ADD COLUMN "queue_wait_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "swing_model_runs" ADD COLUMN "queue_wait_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "swing_runs_one_active_unique" ON "swing_runs" USING btree ((1)) WHERE "swing_runs"."status" in ('scheduled', 'running');