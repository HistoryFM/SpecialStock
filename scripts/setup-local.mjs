import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { hash } from "bcryptjs";

const path = ".env.local";
const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
const values = new Map(
  existing
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

async function readJsonStdin() {
  if (!process.argv.includes("--json-stdin")) return null;

  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  try {
    const payload = JSON.parse(input);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Setup input must be an object.");
    }
    return payload;
  } catch {
    console.error("Could not read the secure setup input.");
    process.exit(1);
  }
}

const secureInput = await readJsonStdin();
let password = secureInput?.password ?? process.argv[2];
if (!password && process.stdin.isTTY) {
  const prompts = createInterface({ input: process.stdin, output: process.stdout });
  password = await prompts.question("Choose a local app password (12+ characters): ");
  prompts.close();
}

if (!password || password.length < 12) {
  console.error("Provide a local password of at least 12 characters.");
  process.exitCode = 1;
} else {
  values.set("LOCAL_DATABASE_PATH", values.get("LOCAL_DATABASE_PATH") || ".data/specialstock");
  values.set("AUTH_SECRET", values.get("AUTH_SECRET") || randomBytes(48).toString("base64url"));
  values.set("APP_PASSWORD_HASH", await hash(password, 12));
  values.set(
    "OPENROUTER_API_KEY",
    secureInput?.openRouterApiKey?.trim() || values.get("OPENROUTER_API_KEY") || "",
  );
  values.set(
    "CHART_IMG_API_KEY",
    secureInput?.chartImgApiKey?.trim() || values.get("CHART_IMG_API_KEY") || "",
  );
  values.set("CHART_IMG_WIDTH", values.get("CHART_IMG_WIDTH") || "1600");
  values.set("CHART_IMG_HEIGHT", values.get("CHART_IMG_HEIGHT") || "1920");
  values.set("CHART_ARTIFACT_DIR", values.get("CHART_ARTIFACT_DIR") || ".data/chart-artifacts");
  values.set("ALPACA_API_KEY", values.get("ALPACA_API_KEY") || "");
  values.set("ALPACA_API_SECRET", values.get("ALPACA_API_SECRET") || "");

  const output = [
    "# SpecialStock local-only secrets. This file is gitignored.",
    ...Array.from(values, ([key, value]) =>
      `${key}=${key === "APP_PASSWORD_HASH" ? value.replaceAll("$", "\\$") : value}`,
    ),
    "",
  ].join("\n");
  writeFileSync(path, output, { mode: 0o600 });
  console.log("Local environment configured. Add rotated Chart-Img and OpenRouter keys when ready.");
}
