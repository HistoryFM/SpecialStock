import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const workspace = process.cwd();
const databasePath = resolve(workspace, process.env.LOCAL_DATABASE_PATH || ".data/specialstock");
if (databasePath !== workspace && !databasePath.startsWith(`${workspace}${sep}`)) {
  throw new Error("LOCAL_DATABASE_PATH must stay inside the SpecialStock workspace.");
}
mkdirSync(dirname(databasePath), { recursive: true });
