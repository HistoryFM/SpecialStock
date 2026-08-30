import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const staticDirectory = ".next/static";
if (!existsSync(staticDirectory)) {
  throw new Error("Run the production build before checking client bundles.");
}

const names = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "APP_PASSWORD_HASH",
  "OPENROUTER_API_KEY",
  "CHART_IMG_API_KEY",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
];
const secrets = names
  .map((name) => [name, process.env[name]])
  .filter((entry) => typeof entry[1] === "string" && entry[1].length >= 8);

const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else files.push(path);
  }
};
visit(staticDirectory);

for (const file of files) {
  const content = readFileSync(file);
  for (const [name, value] of secrets) {
    if (content.includes(Buffer.from(value))) {
      throw new Error(`${name} was found in browser asset ${file}`);
    }
  }
}
console.log(`Checked ${files.length} browser assets; no configured server secret was present.`);
