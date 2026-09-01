"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { OpenRouterModelCatalogProvider } from "@/models/openrouter-catalog";
import { DEFAULT_MODEL_ID } from "@/models/catalog";
import { DrizzleSettingsRepository } from "@/settings/repository";
import {
  parseWatchlistFields,
  settingsInputSchema,
} from "@/settings/schema";
import { ModelUnavailableError, SettingsService } from "@/settings/service";

export type SaveSettingsState = {
  status: "idle" | "success" | "error";
  message: string;
};

const INITIAL_SAVE_SETTINGS_STATE: SaveSettingsState = {
  status: "idle",
  message: "",
};

export async function saveSettingsAction(
  _previousState: SaveSettingsState,
  formData: FormData,
): Promise<SaveSettingsState> {
  if (!isAuthorizedSession(await auth())) redirect("/login");

  const rawInput = {
    watchlist: parseWatchlistFields(
      formData.getAll("watchlist"),
      formData.getAll("exchange"),
    ),
    activeModel: DEFAULT_MODEL_ID,
    fallbackModel: null,
    comparisonModel: null,
    comparisonEnabled: false,
    notificationsEnabled: formData.get("notificationsEnabled") === "on",
    dailyBudgetUsd: Number(formData.get("dailyBudgetUsd")),
  };

  try {
    const input = settingsInputSchema.parse(rawInput);
    const service = new SettingsService(
      new DrizzleSettingsRepository(),
      new OpenRouterModelCatalogProvider(),
    );
    await service.update(input);
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return {
      status: "success",
      message: "Settings saved. Changes apply to subsequent scans only.",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        status: "error",
        message: error.issues[0]?.message ?? "Review the settings and try again.",
      };
    }
    if (error instanceof ModelUnavailableError) {
      return {
        status: "error",
        message: "That model is not currently confirmed for image input on OpenRouter.",
      };
    }
    return {
      status: "error",
      message: "Settings could not be saved because persistence is unavailable.",
    };
  }
}
