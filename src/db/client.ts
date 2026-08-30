import "server-only";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { getServerEnv } from "@/config/env";
import * as schema from "@/db/schema";

type AppDatabase = PgliteDatabase<typeof schema>;

const globalDatabase = globalThis as typeof globalThis & {
  specialStockDatabase?: AppDatabase;
  specialStockMigration?: Promise<void>;
};

function resolveLocalDatabasePath(): string {
  const workspace = process.cwd();
  const databasePath = resolve(workspace, getServerEnv().LOCAL_DATABASE_PATH);
  if (databasePath !== workspace && !databasePath.startsWith(`${workspace}${sep}`)) {
    throw new Error("LOCAL_DATABASE_PATH must stay inside the SpecialStock workspace.");
  }
  return databasePath;
}

function createDatabase(): AppDatabase {
  const path = resolveLocalDatabasePath();
  mkdirSync(dirname(path), { recursive: true });
  const client = new PGlite(path);
  return drizzle({ client, schema });
}

export async function getDatabase(): Promise<AppDatabase> {
  globalDatabase.specialStockDatabase ??= createDatabase();
  globalDatabase.specialStockMigration ??= migrate(globalDatabase.specialStockDatabase, {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  });
  await globalDatabase.specialStockMigration;

  return globalDatabase.specialStockDatabase;
}

export async function checkDatabaseHealth(): Promise<{
  status: "connected" | "unavailable";
  engine: "PGlite";
  error: string | null;
}> {
  try {
    const database = await getDatabase();
    await database.execute("select 1");
    return { status: "connected", engine: "PGlite", error: null };
  } catch {
    return {
      status: "unavailable",
      engine: "PGlite",
      error: "The embedded local database could not be opened.",
    };
  }
}
