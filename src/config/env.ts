import "server-only";

import { z } from "zod";

const optionalSecret = z.string().trim().min(1).optional();
const optionalDimension = z.coerce.number().int().min(400).max(2048).optional();
const optionalPostgresUrl = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "DATABASE_URL must be a PostgreSQL connection string",
  )
  .optional();

export const serverEnvSchema = z.object({
  LOCAL_DATABASE_PATH: z.string().trim().min(1).default(".data/specialstock"),
  DATABASE_URL: optionalPostgresUrl,
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_PASSWORD_HASH: z
    .string()
    .regex(/^\$2[aby]\$\d{2}\$.{53}$/, "APP_PASSWORD_HASH must be a bcrypt hash"),
  OPENROUTER_API_KEY: optionalSecret,
  CHART_IMG_API_KEY: optionalSecret,
  CHART_IMG_API_URL: z.string().url().default("https://api.chart-img.com/v2/tradingview/advanced-chart"),
  CHART_IMG_WIDTH: optionalDimension.default(1600),
  CHART_IMG_HEIGHT: z.coerce.number().int().min(300).max(1920).default(1920),
  CHART_ARTIFACT_DIR: z.string().trim().min(1).default(".data/chart-artifacts"),
  OPENROUTER_API_URL: z.string().url().default("https://openrouter.ai/api/v1/chat/completions"),
  ALPACA_API_KEY: optionalSecret,
  ALPACA_API_SECRET: optionalSecret,
  SPECIALSTOCK_DEMO_MODE: z.enum(["0", "1"]).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
}).superRefine((value, context) => {
  if (Boolean(value.ALPACA_API_KEY) !== Boolean(value.ALPACA_API_SECRET)) {
    context.addIssue({
      code: "custom",
      message: "ALPACA_API_KEY and ALPACA_API_SECRET must be configured together",
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function parseServerEnv(
  environment: Record<string, string | undefined>,
): ServerEnv {
  return serverEnvSchema.parse({
    LOCAL_DATABASE_PATH: environment.LOCAL_DATABASE_PATH,
    DATABASE_URL: environment.DATABASE_URL,
    AUTH_SECRET: environment.AUTH_SECRET,
    APP_PASSWORD_HASH: environment.APP_PASSWORD_HASH,
    OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY || undefined,
    CHART_IMG_API_KEY: environment.CHART_IMG_API_KEY || undefined,
    CHART_IMG_API_URL: environment.CHART_IMG_API_URL,
    CHART_IMG_WIDTH: environment.CHART_IMG_WIDTH,
    CHART_IMG_HEIGHT: environment.CHART_IMG_HEIGHT,
    CHART_ARTIFACT_DIR: environment.CHART_ARTIFACT_DIR,
    OPENROUTER_API_URL: environment.OPENROUTER_API_URL,
    ALPACA_API_KEY: environment.ALPACA_API_KEY || undefined,
    ALPACA_API_SECRET: environment.ALPACA_API_SECRET || undefined,
    SPECIALSTOCK_DEMO_MODE: environment.SPECIALSTOCK_DEMO_MODE,
    NODE_ENV: environment.NODE_ENV,
  });
}

export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}

export function isDemoMode(env = getServerEnv()): boolean {
  if (env.SPECIALSTOCK_DEMO_MODE === "1") return true;
  return !env.CHART_IMG_API_KEY || !env.OPENROUTER_API_KEY;
}
