CREATE TABLE "gex_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"source_filename" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gex_settings_singleton" CHECK ("gex_settings"."id" = 1),
	CONSTRAINT "gex_settings_symbols_size" CHECK (jsonb_array_length("gex_settings"."symbols") <= 100)
);
