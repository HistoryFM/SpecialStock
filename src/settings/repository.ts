import "server-only";

import { and, eq } from "drizzle-orm";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import { appSettings } from "@/db/schema";
import type { AppSettings, SettingsRepository } from "@/settings/types";

export class DrizzleSettingsRepository implements SettingsRepository {
  async get(): Promise<AppSettings> {
    await requireAuthorizedUser();
    const database = await getDatabase();
    await database.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
    const [settings] = await database
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);

    if (!settings) throw new Error("The singleton app settings row is missing.");
    return { ...settings, dailyBudgetUsd: Number(settings.dailyBudgetUsd) };
  }

  async update(input: Omit<AppSettings, "updatedAt">, expectedUpdatedAt?: Date): Promise<AppSettings> {
    await requireAuthorizedUser();
    const database = await getDatabase();
    const [settings] = await database
      .update(appSettings)
      .set({
        watchlist: input.watchlist,
        activeModel: input.activeModel,
        fallbackModel: input.fallbackModel,
        comparisonModel: input.comparisonModel,
        comparisonEnabled: input.comparisonEnabled,
        automaticScansEnabled: input.automaticScansEnabled,
        notificationsEnabled: input.notificationsEnabled,
        dailyBudgetUsd: String(input.dailyBudgetUsd),
        updatedAt: new Date(),
      })
      .where(and(
        eq(appSettings.id, 1),
        expectedUpdatedAt ? eq(appSettings.updatedAt, expectedUpdatedAt) : undefined,
      ))
      .returning();

    if (!settings && expectedUpdatedAt) throw new SettingsConflictError();
    if (!settings) throw new Error("The singleton app settings row is missing.");
    return { ...settings, dailyBudgetUsd: Number(settings.dailyBudgetUsd) };
  }
}

export class SettingsConflictError extends Error {
  constructor() {
    super("Settings changed in another tab. Reset to load the latest values before saving again.");
    this.name = "SettingsConflictError";
  }
}
