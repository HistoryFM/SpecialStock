"use server";

import * as Sentry from "@sentry/nextjs";
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
  const requestedSymbols = symbols
    .map((value) => typeof value === "string" ? value.trim().toUpperCase().slice(0, 10) : "invalid")
    .join(",")
    .slice(0, 240);
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

  return Sentry.startSpan(
    {
      name: "Save watchlist settings",
      op: "specialstock.settings.save",
      forceTransaction: true,
      attributes: {
        "specialstock.settings.requested_count": symbols.length,
        "specialstock.settings.requested_symbols": requestedSymbols,
        "specialstock.settings.requested_auto_count": automaticStates.filter((value) => value === "true").length,
      },
    },
    async (span) => {
      const started = performance.now();
      let observedVersion = "unknown";
      try {
        const input = settingsInputSchema.parse(rawInput);
        const updatedAtValue = formData.get("updatedAt");
        const expectedUpdatedAt = typeof updatedAtValue === "string" ? new Date(updatedAtValue) : undefined;
        if (!expectedUpdatedAt || !Number.isFinite(expectedUpdatedAt.getTime())) {
          span.setAttributes({
            "specialstock.settings.outcome": "rejected",
            "specialstock.settings.rejection": "invalid_version",
          });
          span.setStatus({ code: 2, message: "invalid_version" });
          Sentry.logger.warn("settings.watchlist.save_failed", {
            "specialstock.settings.rejection": "invalid_version",
            "specialstock.settings.requested_count": input.watchlist.length,
            "specialstock.settings.requested_symbols": requestedSymbols,
          });
          return { ...previousState, status: "error", message: "Settings version is invalid. Reload and try again." };
        }

        const repository = new DrizzleSettingsRepository();
        const current = await repository.get();
        observedVersion = current.updatedAt.toISOString();
        const service = new SettingsService(
          repository,
          new OpenRouterModelCatalogProvider(),
        );
        const saved = await service.update(input, expectedUpdatedAt);
        const currentBySymbol = new Map(current.watchlist.map((entry) => [entry.symbol, entry]));
        const inputBySymbol = new Map(input.watchlist.map((entry) => [entry.symbol, entry]));
        const addedSymbols = input.watchlist.filter((entry) => !currentBySymbol.has(entry.symbol)).map((entry) => entry.symbol);
        const removedSymbols = current.watchlist.filter((entry) => !inputBySymbol.has(entry.symbol)).map((entry) => entry.symbol);
        const exchangeChangedSymbols = input.watchlist.filter((entry) => {
          const previous = currentBySymbol.get(entry.symbol);
          return previous && previous.exchange !== entry.exchange;
        }).map((entry) => entry.symbol);
        const autoChangedSymbols = input.watchlist.filter((entry) => {
          const previous = currentBySymbol.get(entry.symbol);
          return previous && previous.automaticScanEnabled !== entry.automaticScanEnabled;
        }).map((entry) => entry.symbol);
        const reordered = current.watchlist.map((entry) => entry.symbol).join(",") !==
          input.watchlist.map((entry) => entry.symbol).join(",");
        const durationMs = Math.round(performance.now() - started);
        const updatedVersion = saved.updatedAt.toISOString();
        const changeAttributes = {
          "specialstock.settings.outcome": "saved",
          "specialstock.settings.previous_count": current.watchlist.length,
          "specialstock.settings.updated_count": saved.watchlist.length,
          "specialstock.settings.enabled_count": saved.watchlist.filter((entry) => entry.automaticScanEnabled).length,
          "specialstock.settings.added_symbols": addedSymbols.join(",") || "none",
          "specialstock.settings.removed_symbols": removedSymbols.join(",") || "none",
          "specialstock.settings.exchange_changed_symbols": exchangeChangedSymbols.join(",") || "none",
          "specialstock.settings.auto_changed_symbols": autoChangedSymbols.join(",") || "none",
          "specialstock.settings.reordered": reordered,
          "specialstock.settings.expected_version": expectedUpdatedAt.toISOString(),
          "specialstock.settings.previous_version": observedVersion,
          "specialstock.settings.updated_version": updatedVersion,
          "specialstock.settings.duration_ms": durationMs,
        };
        span.setAttributes(changeAttributes);
        span.setStatus({ code: 1 });
        Sentry.logger.info("settings.watchlist.saved", changeAttributes);
        revalidatePath("/dashboard");
        revalidatePath("/settings");
        return {
          status: "success",
          message: "Settings saved. Changes apply to subsequent scans only.",
          updatedAt: updatedVersion,
          fingerprint: JSON.stringify({
            rows: input.watchlist,
            dailyBudgetUsd: input.dailyBudgetUsd,
            notificationsEnabled: input.notificationsEnabled,
          }),
        };
      } catch (error) {
        const durationMs = Math.round(performance.now() - started);
        const errorType = error instanceof Error ? error.constructor.name : "UnknownError";
        const errorMessage = error instanceof Error ? error.message : "Settings could not be saved.";
        const rejection = error instanceof z.ZodError
          ? "validation"
          : error instanceof ModelUnavailableError
            ? "model_unavailable"
            : error instanceof SettingsConflictError
              ? "stale_version"
              : "persistence_failure";
        span.setAttributes({
          "specialstock.settings.outcome": "failed",
          "specialstock.settings.rejection": rejection,
          "specialstock.settings.observed_version": observedVersion,
          "specialstock.settings.duration_ms": durationMs,
          "error.type": errorType,
        });
        span.setStatus({ code: 2, message: errorMessage.slice(0, 200) });
        Sentry.logger.warn("settings.watchlist.save_failed", {
          "specialstock.settings.rejection": rejection,
          "specialstock.settings.requested_count": symbols.length,
          "specialstock.settings.requested_symbols": requestedSymbols,
          "specialstock.settings.observed_version": observedVersion,
          "specialstock.settings.duration_ms": durationMs,
          "error.type": errorType,
          "error.message": errorMessage.slice(0, 500),
        });

        if (!(error instanceof z.ZodError) &&
          !(error instanceof ModelUnavailableError) &&
          !(error instanceof SettingsConflictError)) {
          Sentry.captureException(error, {
            tags: { operation: "settings.watchlist.save" },
            extra: { requestedCount: symbols.length, requestedSymbols },
          });
        }

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
    },
  );
}
