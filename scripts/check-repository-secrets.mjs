import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const allowedEnvironmentFiles = new Set([".env.example"]);
const forbiddenPaths = [
  /(^|\/)\.data(?:\/|$)/,
  /(^|\/)\.next(?:\/|$)/,
  /(^|\/)node_modules(?:\/|$)/,
  /(^|\/)coverage(?:\/|$)/,
  /(^|\/)test-results(?:\/|$)/,
  /(^|\/)playwright-report(?:\/|$)/,
  /(^|\/)Windows-Handoff(?:\/|$)/,
];
const configuredSecretNames = new Set([
  "AUTH_SECRET",
  "APP_PASSWORD_HASH",
  "OPENROUTER_API_KEY",
  "CHART_IMG_API_KEY",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "DATABASE_URL",
]);
const knownSecretPatterns = [
  { name: "OpenRouter credential", pattern: /sk-or-v1-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub credential", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: "public client secret",
    pattern: new RegExp(`${["NEXT", "PUBLIC"].join("_")}_(?:.*KEY|.*SECRET|.*TOKEN|.*PASSWORD)`),
  },
];

function candidateFiles() {
  try {
    return execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    ).split("\0").filter(Boolean);
  } catch {
    throw new Error("Repository secret scanning requires Git and a Git working tree.");
  }
}

function configuredSecrets() {
  if (!existsSync(".env.local")) return [];
  return readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replaceAll("\\$", "$")];
    })
    .filter(([name, value]) => configuredSecretNames.has(name) && value.length >= 8);
}

const failures = [];
const files = candidateFiles();
const secrets = configuredSecrets();

for (const path of files) {
  const basename = path.split("/").at(-1) ?? path;
  if (
    (!allowedEnvironmentFiles.has(path) && (basename === ".env" || basename.startsWith(".env."))) ||
    forbiddenPaths.some((pattern) => pattern.test(path))
  ) {
    failures.push(`${path}: private or generated path must not be committed`);
    continue;
  }

  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    continue;
  }
  if (bytes.includes(0)) continue;
  const content = bytes.toString("utf8");

  for (const [name, value] of secrets) {
    if (bytes.includes(Buffer.from(value))) {
      failures.push(`${path}: contains the configured value for ${name}`);
    }
  }
  for (const rule of knownSecretPatterns) {
    if (rule.pattern.test(content)) failures.push(`${path}: matches ${rule.name}`);
  }
}

if (failures.length) {
  console.error("Repository secret check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Checked ${files.length} commit candidates and ${secrets.length} configured secret values; no repository leak detected.`,
);
