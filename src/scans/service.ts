import "server-only";

import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { reserveAnalysisBudget, settleAnalysisBudget } from "@/analysis/budget";
import { createAnalysisModelProvider } from "@/analysis/factory";
import { COMPACT_PROMPT_VERSION } from "@/analysis/prompt";
import { AnalysisModelError } from "@/analysis/provider";
import type { ChartAnalysisInput, CompactModelRunResult, ModelAttemptResult } from "@/analysis/types";
import { isFullAnalysisEligible } from "@/analysis/validate";
import { persistChartArtifact, readChartArtifact } from "@/chart/artifact-storage";
import { ChartImgProvider } from "@/chart/chart-img-provider";
import { isDemoMode } from "@/config/env";
import { getDatabase } from "@/db/client";
import {
  analyses,
  appSettings,
  chartArtifacts,
  modelAttempts,
  modelRuns,
  notificationEvents,
  scanSlots,
  theses,
} from "@/db/schema";
import { createMarketDataProvider } from "@/market-data/factory";
import {
  canonicalScanSlot,
  dateFromMarketParts,
  previousWeekday,
  requestedScanSlot,
} from "@/market-data/time";
import { evaluatePendingOutcomes } from "@/outcomes/evaluate";
import {
  getScanExecutionPolicy,
  MANUAL_SMOKE_SLOT_KIND,
  type ScanMode,
} from "@/scans/policy";
import type { WatchlistEntry } from "@/settings/types";

export class ScanNotAvailableError extends Error {}
export class UnknownWatchlistSymbolError extends Error {}
export class AutomaticScansDisabledError extends Error {}
export class ScanAlreadyRunningError extends Error {}

function chartRange(
  now: Date,
  session: { date: string; opensAt: Date; closesAt: Date; isRegularSession: boolean },
  completedThrough?: Date,
) {
  const currentSession =
    session.isRegularSession && now >= session.opensAt && now <= session.closesAt;
  const completedCurrentSession = session.isRegularSession && now > session.closesAt;
  const latestDate = currentSession || completedCurrentSession
    ? session.date
    : previousWeekday(now);
  const closesAt = dateFromMarketParts(latestDate, 16, 0);
  return {
    from: dateFromMarketParts(latestDate, 9, 30),
    to: completedThrough ?? (
      currentSession ? new Date(Math.min(now.getTime(), session.closesAt.getTime())) : closesAt
    ),
  };
}

export const chartRangeForTest = chartRange;

async function createOrClaimSlot(input: {
  entry: WatchlistEntry;
  mode: ScanMode;
  now: Date;
  session: { opensAt: Date; closesAt: Date; isRegularSession: boolean };
  requestedSlotKey?: string;
}) {
  const database = await getDatabase();
  const canonical = input.mode === "scheduled"
    ? input.requestedSlotKey
      ? requestedScanSlot(input.requestedSlotKey, input.now, input.session)
      : canonicalScanSlot(input.now, input.session)
    : null;
  if (input.mode === "scheduled" && !canonical) {
    throw new ScanNotAvailableError("There is no eligible completed five-minute bar right now.");
  }
  const scheduledFor = canonical?.scheduledFor ?? input.now;
  const slotKind = canonical?.kind ?? MANUAL_SMOKE_SLOT_KIND;
  const idempotencyKey =
    input.mode === "scheduled"
      ? `${input.entry.symbol}:${canonical!.idempotencyPart}`
      : `${input.entry.symbol}:manual:${input.now.toISOString().slice(0, 16)}`;
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(input.now.getTime() + 5 * 60_000);
  const [inserted] = await database
    .insert(scanSlots)
    .values({
      idempotencyKey,
      symbol: input.entry.symbol,
      scheduledFor,
      slotKind,
      status: "running",
      provider: "chart-img",
      feed: "tradingview",
      leaseToken,
      leaseExpiresAt,
      startedAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  const completedThrough = canonical
    ? new Date(canonical.candleStartsAt.getTime() + 5 * 60_000)
    : null;
  if (inserted) return { slot: inserted, claimed: true, completedThrough };

  const [existing] = await database
    .select()
    .from(scanSlots)
    .where(eq(scanSlots.idempotencyKey, idempotencyKey));
  if (!existing) {
    const [active] = await database.select().from(scanSlots).where(and(
      eq(scanSlots.symbol, input.entry.symbol), eq(scanSlots.status, "running"),
    )).limit(1);
    if (active) throw new ScanAlreadyRunningError(`${input.entry.symbol} already has a scan in progress.`);
    throw new Error("The scan slot could not be loaded after claiming.");
  }
  if (existing.status === "completed") {
    return { slot: existing, claimed: false, completedThrough };
  }
  if (existing.status === "running" && existing.leaseExpiresAt && existing.leaseExpiresAt > input.now) {
    return { slot: existing, claimed: false, completedThrough };
  }
  if (input.mode === "scheduled" && ["failed", "skipped"].includes(existing.status)) {
    return { slot: existing, claimed: false, completedThrough };
  }
  const [reclaimed] = await database
    .update(scanSlots)
    .set({
      status: "running",
      leaseToken,
      leaseExpiresAt,
      startedAt: input.now,
      errorCode: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(scanSlots.id, existing.id),
        inArray(scanSlots.status, ["failed", "scheduled", "running"]),
        existing.leaseExpiresAt ? lt(scanSlots.leaseExpiresAt, input.now) : undefined,
      ),
    )
    .returning();
  return { slot: reclaimed ?? existing, claimed: Boolean(reclaimed), completedThrough };
}

async function persistAttempts(runId: string, attempts: ModelAttemptResult[]) {
  if (!attempts.length) return;
  const database = await getDatabase();
  await database.insert(modelAttempts).values(attempts.map((attempt) => ({
    modelRunId: runId,
    attemptNumber: attempt.attemptNumber,
    responseId: attempt.responseId,
    status: attempt.status,
    latencyMs: attempt.latencyMs,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    costUsd: attempt.costUsd === null ? null : String(attempt.costUsd),
    estimatedCostUsd: attempt.estimatedCostUsd === null ? null : String(attempt.estimatedCostUsd),
    errorCode: attempt.errorCode,
    rawResponse: attempt.rawResponse,
  }))).onConflictDoNothing();
}

export async function persistModelResult(input: {
  slotId: string;
  chartArtifactId: string;
  runId?: string;
  result: CompactModelRunResult;
  frozen: ChartAnalysisInput;
}) {
  return Sentry.startSpan(
    {
      name: "Persist validated analysis",
      op: "specialstock.analysis.persist",
      attributes: {
        "specialstock.scan.slot_id": input.slotId,
        "specialstock.chart.artifact_id": input.chartArtifactId,
      },
    },
    async () => {
      const database = await getDatabase();
      const completedAt = new Date();
      let run;
      if (input.runId) {
        [run] = await database.update(modelRuns).set({
          actualModel: input.result.actualModel,
          actualProvider: input.result.actualProvider,
          promptVersion: COMPACT_PROMPT_VERSION,
          inputHash: input.frozen.inputHash,
          status: "valid",
          latencyMs: input.result.latencyMs,
          inputTokens: input.result.inputTokens,
          outputTokens: input.result.outputTokens,
          costUsd: input.result.costUsd === null ? null : String(input.result.costUsd),
          rawResponse: input.result.rawResponse,
          validationErrors: [],
          completedAt,
        }).where(eq(modelRuns.id, input.runId)).returning();
      } else {
        [run] = await database.insert(modelRuns).values({
          scanSlotId: input.slotId, chartArtifactId: input.chartArtifactId, runRole: "primary",
          phase: "compact", requestedModel: input.result.requestedModel,
          actualModel: input.result.actualModel, actualProvider: input.result.actualProvider,
          promptVersion: COMPACT_PROMPT_VERSION, inputHash: input.frozen.inputHash, status: "valid",
          latencyMs: input.result.latencyMs, inputTokens: input.result.inputTokens,
          outputTokens: input.result.outputTokens,
          costUsd: input.result.costUsd === null ? null : String(input.result.costUsd),
          rawResponse: input.result.rawResponse, validationErrors: [], completedAt,
        })
        .onConflictDoUpdate({
          target: [modelRuns.scanSlotId, modelRuns.runRole, modelRuns.requestedModel, modelRuns.phase],
          set: {
            chartArtifactId: input.chartArtifactId,
            actualModel: input.result.actualModel,
            actualProvider: input.result.actualProvider,
            promptVersion: COMPACT_PROMPT_VERSION,
            inputHash: input.frozen.inputHash,
            status: "valid",
            latencyMs: input.result.latencyMs,
            inputTokens: input.result.inputTokens,
            outputTokens: input.result.outputTokens,
            costUsd: input.result.costUsd === null ? null : String(input.result.costUsd),
            rawResponse: input.result.rawResponse,
            validationErrors: [],
            failedOverFromModel: null,
            completedAt,
          },
        })
        .returning();
      }
      if (!run) throw new Error("The model run could not be persisted.");
      await persistAttempts(run.id, input.result.attempts);
      const result = input.result.analysis;
      const [saved] = await database
        .insert(analyses)
        .values({
          modelRunId: run.id,
          verdict: result.verdict,
          barStatus: input.frozen.barStatus,
          conviction: result.conviction,
          visualQuality: result.visual_quality,
          fullAnalysisState: isFullAnalysisEligible(result) ? "not_requested" : "ineligible",
          observedPrice: result.observed_price === null ? null : String(result.observed_price),
          primaryTarget: result.primary_target === null ? null : String(result.primary_target),
          invalidationLevel:
            result.invalidation_level === null ? null : String(result.invalidation_level),
        })
        .returning();
      if (!saved) throw new Error("The validated analysis could not be persisted.");
      return { run, analysis: saved };
    },
  );
}

async function runModel(input: {
  slotId: string;
  chartArtifactId: string;
  model: string;
  maxAttempts: 1 | 2;
  frozen: ChartAnalysisInput;
  png: Buffer;
  usageClass: "routine_compact" | "manual_compact";
}) {
  const database = await getDatabase();
  const [pendingRun] = await database.insert(modelRuns).values({
    scanSlotId: input.slotId, chartArtifactId: input.chartArtifactId, runRole: "primary",
    phase: "compact", requestedModel: input.model, promptVersion: COMPACT_PROMPT_VERSION,
    inputHash: input.frozen.inputHash, status: "pending",
  }).onConflictDoUpdate({
    target: [modelRuns.scanSlotId, modelRuns.runRole, modelRuns.requestedModel, modelRuns.phase],
    set: { chartArtifactId: input.chartArtifactId, status: "pending", startedAt: new Date(), completedAt: null },
  }).returning();
  if (!pendingRun) throw new Error("The model run could not be claimed.");
  const reservation = await reserveAnalysisBudget({
    model: input.model,
    runRole: "primary",
    usageClass: input.usageClass,
    modelRunId: pendingRun.id,
    now: new Date(input.frozen.capturedAt),
  });
  if (!reservation) {
    await database.update(modelRuns).set({ status: "budget_skipped", completedAt: new Date() })
      .where(eq(modelRuns.id, pendingRun.id));
    return null;
  }
  try {
    const result = await createAnalysisModelProvider().analyze({ ...input, phase: "compact" });
    if (result.phase !== "compact") throw new Error("Compact scan returned the wrong model phase.");
    await settleAnalysisBudget(reservation, result.costUsd, "settled");
    return persistModelResult({ ...input, runId: pendingRun.id, result });
  } catch (error) {
    const failure =
      error instanceof AnalysisModelError
        ? error
        : new AnalysisModelError(error instanceof Error ? error.message : "Analysis model failed.", {
            status: "failed",
            requestedModel: input.model,
            actualModel: null,
            actualProvider: "openrouter",
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            rawResponse: null,
            attempts: [],
          });
    await settleAnalysisBudget(
      reservation,
      failure.metadata.costUsd,
      failure.metadata.attempts.length === 0
        ? "released"
        : failure.metadata.costUsd === null ? "estimated" : "settled",
    );
    await persistAttempts(pendingRun.id, failure.metadata.attempts);
    await database.update(modelRuns).set({
      actualModel: failure.metadata.actualModel,
      actualProvider: failure.metadata.actualProvider,
      status: failure.metadata.status,
      latencyMs: failure.metadata.latencyMs,
      inputTokens: failure.metadata.inputTokens,
      outputTokens: failure.metadata.outputTokens,
      costUsd: failure.metadata.costUsd === null ? null : String(failure.metadata.costUsd),
      rawResponse: failure.metadata.rawResponse,
      validationErrors: [failure.message.slice(0, 500)],
      completedAt: new Date(),
    }).where(eq(modelRuns.id, pendingRun.id));
    throw error;
  }
}

async function updateThesisAndNotification(input: {
  symbol: string;
  analysis: Awaited<ReturnType<typeof persistModelResult>>["analysis"];
  demo: boolean;
  now: Date;
}) {
  if (
    input.analysis.verdict === "no_trade" ||
    input.analysis.primaryTarget === null ||
    input.analysis.invalidationLevel === null
  ) return;
  const database = await getDatabase();
  const previous = await database
    .select()
    .from(theses)
    .where(and(eq(theses.symbol, input.symbol), eq(theses.state, "active")))
    .orderBy(desc(theses.openedAt))
    .limit(1);
  const [thesis] = await database.insert(theses).values({
    analysisId: input.analysis.id,
    symbol: input.symbol,
    direction: input.analysis.verdict,
    target: input.analysis.primaryTarget,
    invalidation: input.analysis.invalidationLevel,
    supersedesThesisId: previous[0]?.id ?? null,
    openedAt: input.now,
  }).returning();
  if (!thesis) return;
  if (previous[0]) {
    await database.update(theses)
      .set({ state: "superseded", closedAt: input.now, updatedAt: input.now })
      .where(eq(theses.id, previous[0].id));
  }
  if (input.demo || input.analysis.conviction !== "high") return;
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!settings?.notificationsEnabled) return;
  await database.insert(notificationEvents).values({
    thesisId: thesis.id,
    reason: previous[0]?.direction !== thesis.direction ? "direction_changed" : "new_high_conviction_thesis",
    cooldownUntil: new Date(input.now.getTime() + 30 * 60_000),
  }).onConflictDoNothing();
}

export async function runScan(input: {
  symbol: string;
  mode: ScanMode;
  now?: Date;
  requestedSlotKey?: string;
}) {
  return Sentry.startSpan(
    {
      name: `scan ${input.symbol}`,
      op: "specialstock.scan",
      attributes: {
        "specialstock.symbol": input.symbol,
        "specialstock.scan.mode": input.mode,
      },
    },
    async (span) => {
      const started = performance.now();
      const now = input.now ?? new Date();
      let stage = "initialize";
      let claimedSlotId: string | null = null;
      Sentry.logger.info("scan.started", {
        "specialstock.symbol": input.symbol,
        "specialstock.scan.mode": input.mode,
        "specialstock.scan.requested_slot": input.requestedSlotKey ?? "none",
      });

      try {
        const policy = getScanExecutionPolicy(input.mode);
        const database = await getDatabase();
        await database.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
        const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
        const entry = settings?.watchlist.find((candidate) => candidate.symbol === input.symbol);
        if (!entry) throw new UnknownWatchlistSymbolError(`${input.symbol} is not in the watchlist.`);
        if (input.mode === "scheduled" && !entry.automaticScanEnabled) {
          throw new AutomaticScansDisabledError(`Automatic scans are disabled for ${input.symbol}.`);
        }

        stage = "market_session";
        const marketProvider = createMarketDataProvider();
        const session = await marketProvider.getSession(now);
        stage = "claim_slot";
        const claim = await createOrClaimSlot({
          entry,
          mode: input.mode,
          now,
          session,
          requestedSlotKey: input.requestedSlotKey,
        });
        span.setAttributes({
          "specialstock.scan.slot_id": claim.slot.id,
          "specialstock.scan.slot_kind": claim.slot.slotKind,
        });
        if (!claim.claimed) {
          span.setAttribute("specialstock.scan.reused", true);
          span.setStatus({ code: 1 });
          Sentry.logger.info("scan.reused", {
            "specialstock.symbol": input.symbol,
            "specialstock.scan.mode": input.mode,
            "specialstock.scan.slot_id": claim.slot.id,
            "specialstock.scan.status": claim.slot.status,
            "specialstock.scan.duration_ms": Math.round(performance.now() - started),
          });
          return { slotId: claim.slot.id, status: claim.slot.status, reused: true };
        }
        claimedSlotId = claim.slot.id;

        stage = "chart_capture";
        const capture = await Sentry.startSpan(
          {
            name: "Capture Chart-Img chart",
            op: "specialstock.chart.capture",
            attributes: {
              "specialstock.symbol": input.symbol,
              "specialstock.scan.slot_id": claim.slot.id,
            },
          },
          () => new ChartImgProvider().capture({
            entry,
            capturedAt: now,
            range: chartRange(now, session, claim.completedThrough ?? undefined),
            barStatus: input.mode === "scheduled" ? "closed" : (
              session.isRegularSession && now >= session.opensAt && now < session.closesAt ? "open" : "closed"
            ),
          }),
        );

        stage = "artifact_persist";
        const { storageReference, artifact } = await Sentry.startSpan(
          {
            name: "Persist chart artifact",
            op: "specialstock.chart.persist",
            attributes: {
              "specialstock.scan.slot_id": claim.slot.id,
              "specialstock.chart.image_hash": capture.imageHash,
            },
          },
          async () => {
            const storageReference = await persistChartArtifact(capture.png, capture.imageHash);
            const [artifact] = await database.insert(chartArtifacts).values({
              scanSlotId: claim.slot.id,
              rendererVersion: "chart-img-v2",
              inputHash: capture.input.inputHash,
              imageHash: capture.imageHash,
              mimeType: "image/png",
              width: capture.input.width,
              height: capture.input.height,
              byteLength: capture.png.byteLength,
              storageReference,
              frozenInput: capture.input as unknown as Record<string, unknown>,
            }).returning();
            if (!artifact) throw new Error("Chart metadata could not be persisted.");
            return { storageReference, artifact };
          },
        );

        stage = "artifact_verify";
        const storedPng = await Sentry.startSpan(
          {
            name: "Verify stored chart artifact",
            op: "specialstock.chart.verify",
            attributes: {
              "specialstock.scan.slot_id": claim.slot.id,
              "specialstock.chart.artifact_id": artifact.id,
            },
          },
          () => readChartArtifact(storageReference, capture.imageHash),
        );

        stage = "analysis";
        const primary = await Sentry.startSpan(
          {
            name: "Run Gemini visual analysis",
            op: "specialstock.analysis",
            attributes: {
              "specialstock.symbol": input.symbol,
              "specialstock.scan.slot_id": claim.slot.id,
              "gen_ai.request.model": settings.activeModel,
            },
          },
          () => runModel({
            slotId: claim.slot.id,
            chartArtifactId: artifact.id,
            model: settings.activeModel,
            maxAttempts: policy.modelAttempts,
            frozen: capture.input,
            png: storedPng,
            usageClass: input.mode === "scheduled" ? "routine_compact" : "manual_compact",
          }),
        );
        if (!primary) throw new Error("Daily AI budget is exhausted.");

        stage = "thesis_and_outcomes";
        await Sentry.startSpan(
          {
            name: "Update thesis and outcomes",
            op: "specialstock.thesis.update",
            attributes: {
              "specialstock.symbol": input.symbol,
              "specialstock.scan.slot_id": claim.slot.id,
              "specialstock.analysis.id": primary.analysis.id,
              "specialstock.analysis.evaluation_eligible": policy.includeInEvaluation,
            },
          },
          async () => {
            if (policy.includeInEvaluation) await evaluatePendingOutcomes(input.symbol, now);
            if (policy.createThesis) {
              await updateThesisAndNotification({
                symbol: input.symbol,
                analysis: primary.analysis,
                demo: isDemoMode(),
                now,
              });
            }
          },
        );

        stage = "complete_slot";
        const inputAsOf = claim.completedThrough ?? now;
        await Sentry.startSpan(
          {
            name: "Complete scan slot",
            op: "specialstock.scan.persist",
            attributes: { "specialstock.scan.slot_id": claim.slot.id },
          },
          () => database.update(scanSlots).set({
            status: "completed",
            latestSourceAt: inputAsOf,
            freshnessSeconds: Math.max(0, Math.floor((now.getTime() - inputAsOf.getTime()) / 1_000)),
            qualityFlags: primary.analysis.visualQuality === "clear"
              ? []
              : [`visual_${primary.analysis.visualQuality}`],
            inputAsOf,
            inputHash: capture.input.inputHash,
            completedAt: new Date(),
            leaseExpiresAt: null,
            updatedAt: new Date(),
          }).where(eq(scanSlots.id, claim.slot.id)),
        );

        const durationMs = Math.round(performance.now() - started);
        span.setAttributes({
          "specialstock.analysis.id": primary.analysis.id,
          "specialstock.analysis.verdict": primary.analysis.verdict,
          "specialstock.analysis.conviction": primary.analysis.conviction,
          "specialstock.scan.duration_ms": durationMs,
          "specialstock.scan.reused": false,
        });
        span.setStatus({ code: 1 });
        const completedAttributes: Record<string, string | number | boolean> = {
          "specialstock.symbol": input.symbol,
          "specialstock.scan.mode": input.mode,
          "specialstock.scan.slot_id": claim.slot.id,
          "specialstock.scan.slot_kind": claim.slot.slotKind,
          "specialstock.scan.duration_ms": durationMs,
          "specialstock.analysis.id": primary.analysis.id,
          "specialstock.analysis.verdict": primary.analysis.verdict,
          "specialstock.analysis.conviction": primary.analysis.conviction,
          "specialstock.analysis.bar_status": primary.analysis.barStatus,
          "specialstock.analysis.evaluation_eligible": policy.includeInEvaluation,
          "specialstock.chart.input_hash": capture.input.inputHash,
          "specialstock.chart.image_hash": capture.imageHash,
          "specialstock.model.requested": primary.run.requestedModel,
          "specialstock.model.actual": primary.run.actualModel ?? primary.run.requestedModel,
          "specialstock.model.provider": primary.run.actualProvider ?? "openrouter",
          "specialstock.model.latency_ms": primary.run.latencyMs ?? 0,
        };
        if (primary.run.inputTokens !== null) {
          completedAttributes["specialstock.model.input_tokens"] = primary.run.inputTokens;
        }
        if (primary.run.outputTokens !== null) {
          completedAttributes["specialstock.model.output_tokens"] = primary.run.outputTokens;
        }
        if (primary.run.costUsd !== null) {
          completedAttributes["specialstock.model.cost_usd"] = Number(primary.run.costUsd);
        }
        Sentry.logger.info("scan.completed", completedAttributes);
        return {
          slotId: claim.slot.id,
          analysisId: primary.analysis.id,
          status: "completed" as const,
          reused: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The scan failed.";
        const errorType = error instanceof Error ? error.constructor.name : "UnknownError";
        const durationMs = Math.round(performance.now() - started);
        span.setAttributes({
          "error.type": errorType,
          "specialstock.scan.stage": stage,
          "specialstock.scan.duration_ms": durationMs,
        });
        span.setStatus({ code: 2, message: message.slice(0, 200) });
        Sentry.logger.error("scan.failed", {
          "specialstock.symbol": input.symbol,
          "specialstock.scan.mode": input.mode,
          "specialstock.scan.slot_id": claimedSlotId ?? "none",
          "specialstock.scan.stage": stage,
          "specialstock.scan.duration_ms": durationMs,
          "specialstock.scan.retry_state": error instanceof AnalysisModelError
            ? "model_retries_exhausted"
            : "not_retried",
          "error.type": errorType,
          "error.message": message.slice(0, 500),
        });
        if (claimedSlotId) {
          const database = await getDatabase();
          await database.update(scanSlots).set({
            status: "failed",
            errorCode: message.slice(0, 180),
            completedAt: new Date(),
            leaseExpiresAt: null,
            updatedAt: new Date(),
          }).where(eq(scanSlots.id, claimedSlotId));
        }
        throw error;
      }
    },
  );
}
