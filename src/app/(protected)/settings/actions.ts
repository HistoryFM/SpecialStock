"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { OpenRouterModelCatalogProvider } from "@/models/openrouter-catalog";
import { DEFAULT_MODEL_ID } from "@/models/catalog";
import { DrizzleSettingsRepository } from "@/settings/repository";
import { SettingsConflictError } from "@/settings/repository";
import {
  settingsInputSchema,
} from "@/settings/schema";
import { ModelUnavailableError, SettingsService } from "@/settings/service";

export type SaveSettingsState = {
  status: "idle" | "success" | "error";
  message: string;
  updatedAt?: string;
  fingerprint?: string;
};

export async function saveSettingsAction(
  previousState: SaveSettingsState,
  formData: FormData,
): Promise<SaveSettingsState> {
  if (!isAuthorizedSession(await auth())) redirect("/login");

  const symbols = formData.getAll("watchlist");
  const exchanges = formData.getAll("exchange");
  const automaticStates = formData.getAll("automaticScanEnabled");
  const rawInput = {
    watchlist: symbols.map((value, index) => ({
      symbol: typeof value === "string" ? value : "",
      exchange: exchanges[index],
      automaticScanEnabled: automaticStates[index] === "true",
    })),
    activeModel: DEFAULT_MODEL_ID,
    fallbackModel: null,
    comparisonModel: null,
    comparisonEnabled: false,
    automaticScansEnabled: automaticStates.some((value) => value === "true"),
    notificationsEnabled: formData.get("notificationsEnabled") === "on",
    dailyBudgetUsd: Number(formData.get("dailyBudgetUsd")),
  };

  try {
    const input = settingsInputSchema.parse(rawInput);
    const service = new SettingsService(
      new DrizzleSettingsRepository(),
      new OpenRouterModelCatalogProvider(),
    );
    const updatedAtValue = formData.get("updatedAt");
    const expectedUpdatedAt = typeof updatedAtValue === "string" ? new Date(updatedAtValue) : undefined;
    if (!expectedUpdatedAt || !Number.isFinite(expectedUpdatedAt.getTime())) {
      return { ...previousState, status: "error", message: "Settings version is invalid. Reload and try again." };
    }
    const saved = await service.update(input, expectedUpdatedAt);
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return {
      status: "success",
      message: "Settings saved. Changes apply to subsequent scans only.",
      updatedAt: saved.updatedAt.toISOString(),
      fingerprint: JSON.stringify({
        rows: input.watchlist,
        dailyBudgetUsd: input.dailyBudgetUsd,
        notificationsEnabled: input.notificationsEnabled,
      }),
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ...previousState,
        status: "error",
        message: error.issues[0]?.message ?? "Review the settings and try again.",
      };
    }
    if (error instanceof ModelUnavailableError) {
      return {
        ...previousState,
        status: "error",
        message: "That model is not currently confirmed for image input on OpenRouter.",
      };
    }
    if (error instanceof SettingsConflictError) {
      return { ...previousState, status: "error", message: error.message };
    }
    return {
      ...previousState,
      status: "error",
      message: "Settings could not be saved because persistence is unavailable.",
    };
  }
}
