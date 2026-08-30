ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_active_model_allowlist";--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_fallback_model_allowlist";--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_comparison_model_allowlist";--> statement-breakpoint
DROP INDEX "chart_artifacts_image_hash_unique";--> statement-breakpoint
UPDATE "app_settings"
SET
  "watchlist" = (
    SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'exchange', 'NASDAQ') ORDER BY ordinal)
    FROM jsonb_array_elements_text("app_settings"."watchlist") WITH ORDINALITY AS entries(symbol, ordinal)
  ),
  "active_model" = 'google/gemini-2.5-pro',
  "fallback_model" = NULL,
  "comparison_model" = NULL,
  "comparison_enabled" = false;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "volume_analysis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "momentum_analysis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "relative_velocity_analysis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "watchlist" SET DEFAULT '[{"symbol":"AAPL","exchange":"NASDAQ"},{"symbol":"MSFT","exchange":"NASDAQ"},{"symbol":"NVDA","exchange":"NASDAQ"},{"symbol":"AMZN","exchange":"NASDAQ"},{"symbol":"GOOGL","exchange":"NASDAQ"}]'::jsonb;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "active_model" SET DEFAULT 'google/gemini-2.5-pro';--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "fallback_model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "comparison_model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "comparison_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "observed_price" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "cci_analysis" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "automatic_scans_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "chart_artifacts_image_hash_idx" ON "chart_artifacts" USING btree ("image_hash");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_active_model_allowlist" CHECK ("app_settings"."active_model" in ('google/gemini-2.5-pro'));--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_fallback_model_allowlist" CHECK ("app_settings"."fallback_model" is null or "app_settings"."fallback_model" in ('google/gemini-2.5-pro'));--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_comparison_model_allowlist" CHECK ("app_settings"."comparison_model" is null or "app_settings"."comparison_model" in ('google/gemini-2.5-pro'));
