import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const workspace = process.cwd();
const databasePath = resolve(workspace, process.env.LOCAL_DATABASE_PATH || ".data/specialstock");
const isolatedE2ePrefix = `${resolve(tmpdir())}${sep}specialstock-e2e-`;
const isIsolatedE2ePath = process.env.SPECIALSTOCK_E2E_ISOLATED === "1"
  && databasePath.startsWith(isolatedE2ePrefix);
if (databasePath !== workspace && !databasePath.startsWith(`${workspace}${sep}`) && !isIsolatedE2ePath) {
  throw new Error("LOCAL_DATABASE_PATH must stay inside the SpecialStock workspace.");
}
mkdirSync(dirname(databasePath), { recursive: true });
