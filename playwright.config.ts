import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node scripts/run-e2e-server.mjs",
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      AUTH_SECRET: "test-only-auth-secret-that-is-at-least-32-characters",
      APP_PASSWORD_HASH:
        "\\$2b\\$12\\$RWywSVu0sRx1bTjTK7FDBeVXNyyJAC/q3gDqpvKGxQsvIgsNE5fw.",
      LOCAL_DATABASE_PATH: ".data/e2e",
      CHART_IMG_API_KEY: "e2e-chart-img-key",
      OPENROUTER_API_KEY: "e2e-openrouter-key",
      CHART_IMG_API_URL: "http://127.0.0.1:3199/chart",
      CHART_IMG_WIDTH: "1600",
      CHART_IMG_HEIGHT: "1920",
      OPENROUTER_API_URL: "http://127.0.0.1:3199/openrouter",
      CHART_ARTIFACT_DIR: ".data/e2e-charts",
    },
  },
});
