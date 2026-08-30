UPDATE "app_settings"
SET "watchlist" = (
  SELECT jsonb_agg(
    entry || jsonb_build_object('automaticScanEnabled', true)
    ORDER BY ordinal
  )
  FROM jsonb_array_elements("app_settings"."watchlist") WITH ORDINALITY AS entries(entry, ordinal)
);--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "watchlist" SET DEFAULT '[{"symbol":"AAPL","exchange":"NASDAQ","automaticScanEnabled":true},{"symbol":"MSFT","exchange":"NASDAQ","automaticScanEnabled":true},{"symbol":"NVDA","exchange":"NASDAQ","automaticScanEnabled":true},{"symbol":"AMZN","exchange":"NASDAQ","automaticScanEnabled":true},{"symbol":"GOOGL","exchange":"NASDAQ","automaticScanEnabled":true}]'::jsonb;
