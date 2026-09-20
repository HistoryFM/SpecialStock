ALTER TABLE "swing_prompt_revisions" DROP CONSTRAINT "swing_prompt_revisions_revision_number_unique";--> statement-breakpoint
ALTER TABLE "active_swing_prompt_revision" DROP CONSTRAINT "active_swing_prompt_revision_singleton";--> statement-breakpoint
DROP INDEX "swing_prompt_revisions_created_idx";--> statement-breakpoint
ALTER TABLE "active_swing_prompt_revision" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "active_swing_prompt_revision" ADD COLUMN "market" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "active_swing_prompt_revision" ALTER COLUMN "market" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "swing_prompt_revisions" ADD COLUMN "market" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "swing_prompt_revisions_market_number_unique" ON "swing_prompt_revisions" USING btree ("market","revision_number");--> statement-breakpoint
CREATE INDEX "swing_prompt_revisions_market_created_idx" ON "swing_prompt_revisions" USING btree ("market","created_at");--> statement-breakpoint
ALTER TABLE "active_swing_prompt_revision" ADD CONSTRAINT "active_swing_prompt_revision_market_unique" UNIQUE("market");--> statement-breakpoint
ALTER TABLE "active_swing_prompt_revision" ADD CONSTRAINT "active_swing_prompt_revision_market_id" CHECK (("active_swing_prompt_revision"."market" = 'US' AND "active_swing_prompt_revision"."id" = 1) OR ("active_swing_prompt_revision"."market" = 'INDIA' AND "active_swing_prompt_revision"."id" = 2));
