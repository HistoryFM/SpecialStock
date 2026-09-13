CREATE TYPE "public"."prompt_scope" AS ENUM('auto', 'manual_1m', 'manual_5m', 'manual_10m');--> statement-breakpoint
ALTER TABLE "active_prompt_revisions" ADD COLUMN "scope" "prompt_scope" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_revisions" ADD COLUMN "scope" "prompt_scope" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "active_prompt_revisions" DROP CONSTRAINT "active_prompt_revisions_pkey";--> statement-breakpoint
ALTER TABLE "active_prompt_revisions" ADD CONSTRAINT "active_prompt_revisions_scope_phase_pk" PRIMARY KEY("scope","phase");--> statement-breakpoint
DROP INDEX "prompt_revisions_phase_number_unique";--> statement-breakpoint
DROP INDEX "prompt_revisions_phase_created_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_revisions_scope_phase_number_unique" ON "prompt_revisions" USING btree ("scope","phase","revision_number");--> statement-breakpoint
CREATE INDEX "prompt_revisions_scope_phase_created_idx" ON "prompt_revisions" USING btree ("scope","phase","created_at");--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "four_phase_report" jsonb;--> statement-breakpoint
WITH created AS (
  INSERT INTO "prompt_revisions" ("phase", "scope", "revision_number", "instructions", "instructions_hash", "template_version")
  SELECT source."phase", scopes."scope"::prompt_scope, 1, source."instructions", source."instructions_hash", source."template_version"
  FROM "active_prompt_revisions" active
  JOIN "prompt_revisions" source ON source."id" = active."active_revision_id"
  CROSS JOIN (VALUES ('manual_1m'), ('manual_5m'), ('manual_10m')) AS scopes("scope")
  WHERE active."scope" = 'auto'
  RETURNING "id", "phase", "scope"
)
INSERT INTO "active_prompt_revisions" ("phase", "scope", "active_revision_id")
SELECT "phase", "scope", "id" FROM created;--> statement-breakpoint
UPDATE "analyses" analysis SET "full_analysis_state" = 'available'
WHERE analysis."full_analysis_state" = 'ineligible'
  AND analysis."summary" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "model_runs" run JOIN "chart_artifacts" artifact ON artifact."id" = run."chart_artifact_id"
    WHERE run."id" = analysis."model_run_id" AND artifact."storage_reference" IS NOT NULL
  );--> statement-breakpoint
UPDATE "analyses" analysis SET "full_analysis_state" = 'not_requested'
WHERE analysis."full_analysis_state" = 'ineligible'
  AND EXISTS (
    SELECT 1 FROM "model_runs" run JOIN "chart_artifacts" artifact ON artifact."id" = run."chart_artifact_id"
    WHERE run."id" = analysis."model_run_id" AND artifact."storage_reference" IS NOT NULL
  );
