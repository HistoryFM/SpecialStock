UPDATE "app_settings"
SET "watchlist" = (
  SELECT jsonb_agg(
    entry || jsonb_build_object('automaticScanEnabled', "app_settings"."automatic_scans_enabled")
    ORDER BY ordinal
  )
  FROM jsonb_array_elements("app_settings"."watchlist") WITH ORDINALITY AS entries(entry, ordinal)
);--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "watchlist" SET DEFAULT '[{"symbol":"AAPL","exchange":"NASDAQ","automaticScanEnabled":false},{"symbol":"MSFT","exchange":"NASDAQ","automaticScanEnabled":false},{"symbol":"NVDA","exchange":"NASDAQ","automaticScanEnabled":false},{"symbol":"AMZN","exchange":"NASDAQ","automaticScanEnabled":false},{"symbol":"GOOGL","exchange":"NASDAQ","automaticScanEnabled":false}]'::jsonb;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "indicator_readings" jsonb;
