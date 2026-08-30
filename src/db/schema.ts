import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  DEFAULT_MODEL_ID,
  DEFAULT_WATCHLIST,
  MODEL_IDS,
  type ModelId,
} from "@/models/catalog";
import type { WatchlistEntry } from "@/settings/types";
import type { IndicatorReadings } from "@/analysis/types";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const timeframeEnum = pgEnum("timeframe", ["1m", "5m", "15m", "1d"]);
export const scanStatusEnum = pgEnum("scan_status", [
  "scheduled",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export const runRoleEnum = pgEnum("run_role", ["primary", "comparison", "fallback"]);
export const modelRunStatusEnum = pgEnum("model_run_status", [
  "pending",
  "valid",
  "invalid",
  "failed",
  "timed_out",
  "budget_skipped",
]);
export const verdictEnum = pgEnum("verdict", ["bullish", "bearish", "no_trade"]);
export const thesisDirectionEnum = pgEnum("thesis_direction", ["bullish", "bearish"]);
export const convictionEnum = pgEnum("conviction", ["low", "medium", "high"]);
export const barStatusEnum = pgEnum("bar_status", ["open", "closed"]);
export const thesisStateEnum = pgEnum("thesis_state", [
  "active",
  "target_reached",
  "invalidated",
  "expired",
  "superseded",
]);
export const notificationDeliveryStateEnum = pgEnum("notification_delivery_state", [
  "pending",
  "delivered",
  "suppressed",
  "failed",
]);
export const outcomeResultEnum = pgEnum("outcome_result", [
  "target_first",
  "invalidation_first",
  "expired",
  "ambiguous",
  "stale",
  "missing_data",
]);

const modelAllowlistSql = sql.raw(
  MODEL_IDS.map((modelId) => `'${modelId.replaceAll("'", "''")}'`).join(", "),
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    watchlist: jsonb("watchlist")
      .$type<WatchlistEntry[]>()
      .default([...DEFAULT_WATCHLIST])
      .notNull(),
    activeModel: text("active_model").$type<ModelId>().default(DEFAULT_MODEL_ID).notNull(),
    fallbackModel: text("fallback_model")
      .$type<ModelId>(),
    comparisonModel: text("comparison_model")
      .$type<ModelId>(),
    comparisonEnabled: boolean("comparison_enabled").default(false).notNull(),
    automaticScansEnabled: boolean("automatic_scans_enabled").default(false).notNull(),
    notificationsEnabled: boolean("notifications_enabled").default(false).notNull(),
    dailyBudgetUsd: numeric("daily_budget_usd", { precision: 8, scale: 2 })
      .default("10.00")
      .notNull(),
    ...timestamps,
  },
  (table) => [
    check("app_settings_singleton", sql`${table.id} = 1`),
    check(
      "app_settings_watchlist_size",
      sql`jsonb_array_length(${table.watchlist}) between 1 and 5`,
    ),
    check(
      "app_settings_active_model_allowlist",
      sql`${table.activeModel} in (${modelAllowlistSql})`,
    ),
    check(
      "app_settings_fallback_model_allowlist",
      sql`${table.fallbackModel} is null or ${table.fallbackModel} in (${modelAllowlistSql})`,
    ),
    check(
      "app_settings_comparison_model_allowlist",
      sql`${table.comparisonModel} is null or ${table.comparisonModel} in (${modelAllowlistSql})`,
    ),
  ],
);

export const marketBars = pgTable(
  "market_bars",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: timeframeEnum("timeframe").notNull(),
    provider: text("provider").notNull(),
    feed: text("feed").notNull(),
    sessionDate: text("session_date").notNull(),
    barStart: timestamp("bar_start", { withTimezone: true }).notNull(),
    barEnd: timestamp("bar_end", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 20, scale: 8 }).notNull(),
    high: numeric("high", { precision: 20, scale: 8 }).notNull(),
    low: numeric("low", { precision: 20, scale: 8 }).notNull(),
    close: numeric("close", { precision: 20, scale: 8 }).notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
    tradeCount: integer("trade_count"),
    sourceVwap: numeric("source_vwap", { precision: 20, scale: 8 }),
    isComplete: boolean("is_complete").notNull(),
    qualityFlags: jsonb("quality_flags").$type<string[]>().default([]).notNull(),
    contentHash: text("content_hash").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("market_bars_source_bar_unique").on(
      table.provider,
      table.feed,
      table.symbol,
      table.timeframe,
      table.barStart,
      table.contentHash,
    ),
    index("market_bars_symbol_time_idx").on(table.symbol, table.timeframe, table.barStart),
  ],
);

export const scanSlots = pgTable(
  "scan_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    symbol: text("symbol").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    slotKind: text("slot_kind").notNull(),
    status: scanStatusEnum("status").default("scheduled").notNull(),
    provider: text("provider").notNull(),
    feed: text("feed").notNull(),
    latestSourceAt: timestamp("latest_source_at", { withTimezone: true }),
    freshnessSeconds: integer("freshness_seconds"),
    qualityFlags: jsonb("quality_flags").$type<string[]>().default([]).notNull(),
    errorCode: text("error_code"),
    inputAsOf: timestamp("input_as_of", { withTimezone: true }),
    inputHash: text("input_hash"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scan_slots_idempotency_key_unique").on(table.idempotencyKey),
    index("scan_slots_symbol_scheduled_idx").on(table.symbol, table.scheduledFor),
  ],
);

export const indicatorSnapshots = pgTable(
  "indicator_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanSlotId: uuid("scan_slot_id")
      .references(() => scanSlots.id, { onDelete: "cascade" })
      .notNull(),
    timeframe: timeframeEnum("timeframe").notNull(),
    calculationVersion: text("calculation_version").notNull(),
    inputHash: text("input_hash").notNull(),
    barStatus: barStatusEnum("bar_status").notNull(),
    values: jsonb("values").$type<Record<string, unknown>>().notNull(),
    slopes: jsonb("slopes").$type<Record<string, number | null>>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("indicator_snapshots_slot_timeframe_unique").on(
      table.scanSlotId,
      table.timeframe,
    ),
  ],
);

export const chartArtifacts = pgTable(
  "chart_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanSlotId: uuid("scan_slot_id")
      .references(() => scanSlots.id, { onDelete: "cascade" })
      .notNull(),
    rendererVersion: text("renderer_version").notNull(),
    inputHash: text("input_hash").notNull(),
    imageHash: text("image_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteLength: integer("byte_length").notNull(),
    storageReference: text("storage_reference"),
    frozenInput: jsonb("frozen_input").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("chart_artifacts_image_hash_idx").on(table.imageHash),
    index("chart_artifacts_scan_slot_idx").on(table.scanSlotId),
  ],
);

export const modelRuns = pgTable(
  "model_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanSlotId: uuid("scan_slot_id")
      .references(() => scanSlots.id, { onDelete: "cascade" })
      .notNull(),
    chartArtifactId: uuid("chart_artifact_id").references(() => chartArtifacts.id),
    runRole: runRoleEnum("run_role").notNull(),
    requestedModel: text("requested_model").notNull(),
    actualModel: text("actual_model"),
    actualProvider: text("actual_provider"),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    status: modelRunStatusEnum("status").default("pending").notNull(),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 16, scale: 8 }),
    rawResponse: jsonb("raw_response").$type<unknown>(),
    validationErrors: jsonb("validation_errors").$type<string[]>().default([]).notNull(),
    failedOverFromModel: text("failed_over_from_model"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("model_runs_slot_role_model_unique").on(
      table.scanSlotId,
      table.runRole,
      table.requestedModel,
    ),
  ],
);

export const analyses = pgTable("analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  modelRunId: uuid("model_run_id")
    .references(() => modelRuns.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  verdict: verdictEnum("verdict").notNull(),
  barStatus: barStatusEnum("bar_status").notNull(),
  setupType: text("setup_type").notNull(),
  immediateBias: text("immediate_bias").notNull(),
  broaderTrend: text("broader_trend").notNull(),
  conviction: convictionEnum("conviction").notNull(),
  observedPrice: numeric("observed_price", { precision: 20, scale: 8 }),
  candlestickAnalysis: text("candlestick_analysis").notNull(),
  volumeAnalysis: text("volume_analysis"),
  vwapKeltnerAnalysis: text("vwap_keltner_analysis").notNull(),
  cciAnalysis: text("cci_analysis"),
  indicatorReadings: jsonb("indicator_readings").$type<IndicatorReadings>(),
  momentumAnalysis: text("momentum_analysis"),
  relativeVelocityAnalysis: text("relative_velocity_analysis"),
  supportingEvidence: jsonb("supporting_evidence").$type<string[]>().notNull(),
  conflictingEvidence: jsonb("conflicting_evidence").$type<string[]>().notNull(),
  supportLevels: jsonb("support_levels").$type<number[]>().notNull(),
  resistanceLevels: jsonb("resistance_levels").$type<number[]>().notNull(),
  primaryTarget: numeric("primary_target", { precision: 20, scale: 8 }),
  deeperScenario: text("deeper_scenario").notNull(),
  invalidationLevel: numeric("invalidation_level", { precision: 20, scale: 8 }),
  dataQualityFlags: jsonb("data_quality_flags").$type<string[]>().notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamps.createdAt,
});

export const theses = pgTable(
  "theses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .references(() => analyses.id, { onDelete: "cascade" })
      .notNull(),
    symbol: text("symbol").notNull(),
    direction: thesisDirectionEnum("direction").notNull(),
    target: numeric("target", { precision: 20, scale: 8 }),
    invalidation: numeric("invalidation", { precision: 20, scale: 8 }),
    state: thesisStateEnum("state").default("active").notNull(),
    supersedesThesisId: uuid("supersedes_thesis_id").references(
      (): AnyPgColumn => theses.id,
      { onDelete: "set null" },
    ),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("theses_symbol_state_idx").on(table.symbol, table.state)],
);

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    thesisId: uuid("thesis_id")
      .references(() => theses.id, { onDelete: "cascade" })
      .notNull(),
    reason: text("reason").notNull(),
    deliveryState: notificationDeliveryStateEnum("delivery_state")
      .default("pending")
      .notNull(),
    suppressedByEventId: uuid("suppressed_by_event_id").references(
      (): AnyPgColumn => notificationEvents.id,
      { onDelete: "set null" },
    ),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("notification_events_thesis_reason_unique").on(
      table.thesisId,
      table.reason,
    ),
    index("notification_events_thesis_idx").on(table.thesisId, table.createdAt),
  ],
);

export const outcomes = pgTable("outcomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  thesisId: uuid("thesis_id")
    .references(() => theses.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  result: outcomeResultEnum("result").notNull(),
  targetTouchedAt: timestamp("target_touched_at", { withTimezone: true }),
  invalidationTouchedAt: timestamp("invalidation_touched_at", { withTimezone: true }),
  horizonEndsAt: timestamp("horizon_ends_at", { withTimezone: true }).notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
  qualityFlags: jsonb("quality_flags").$type<string[]>().default([]).notNull(),
  createdAt: timestamps.createdAt,
});

export const reviewLabels = pgTable(
  "review_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .references(() => analyses.id, { onDelete: "cascade" })
      .notNull(),
    assessment: text("assessment").notNull(),
    unsupportedClaims: jsonb("unsupported_claims").$type<string[]>().default([]).notNull(),
    notes: text("notes"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => [index("review_labels_analysis_idx").on(table.analysisId)],
);

export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    marketDate: text("market_date").notNull(),
    model: text("model").notNull(),
    runRole: runRoleEnum("run_role").notNull(),
    reservedUsd: numeric("reserved_usd", { precision: 16, scale: 8 }).notNull(),
    actualUsd: numeric("actual_usd", { precision: 16, scale: 8 }),
    status: text("status").default("reserved").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("budget_reservations_date_idx").on(table.marketDate, table.status)],
);

export const schedulerHeartbeats = pgTable(
  "scheduler_heartbeats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tabId: text("tab_id").notNull(),
    marketDate: text("market_date").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    isLeader: boolean("is_leader").default(false).notNull(),
  },
  (table) => [index("scheduler_heartbeats_date_idx").on(table.marketDate, table.observedAt)],
);

export type AppSettingsRow = typeof appSettings.$inferSelect;
export type NewAppSettingsRow = typeof appSettings.$inferInsert;
