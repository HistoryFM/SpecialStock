import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { gexDatasets, gexLists, gexModelRuns, gexSettings, gexTemplates } from "@/db/schema";
import { GEX_DEMO_SYMBOLS, gexDemoSelection } from "@/gex/demo";
import type { GexCategory, GexLiveRow } from "@/gex/live";
import type { GexModelUsage } from "@/gex/chart-reader";

export class GexListConflictError extends Error {}

async function retainFiveGexLists() {
  const database = await getDatabase();
  const lists = await database.select({ id: gexLists.id, active: gexLists.active }).from(gexLists).orderBy(desc(gexLists.createdAt));
  const stale = lists.slice(5).filter((list) => !list.active).map((list) => list.id);
  if (stale.length) await database.delete(gexLists).where(inArray(gexLists.id, stale));
}

export async function getGexState() {
  const database = await getDatabase();
  await database.insert(gexSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await database.select().from(gexSettings).where(eq(gexSettings.id, 1)).limit(1);
  if (!settings) throw new Error("GEX settings could not be loaded.");
  let lists = await database.select().from(gexLists).orderBy(desc(gexLists.createdAt));
  if (!lists.length && settings.symbols.length) {
    await database.insert(gexLists).values({ name: settings.sourceFilename ?? "Imported GEX list", kind: "master", symbols: settings.symbols, sourceFilename: settings.sourceFilename, active: true });
    lists = await database.select().from(gexLists).orderBy(desc(gexLists.createdAt));
  }
  return {
    symbols: settings.symbols,
    revision: settings.revision,
    sourceFilename: settings.sourceFilename,
    updatedAt: settings.updatedAt.toISOString(),
    sampleSymbols: GEX_DEMO_SYMBOLS,
    activeListId: lists.find((list) => list.active)?.id ?? null,
    lists: lists.map((list) => ({ id: list.id, name: list.name, kind: list.kind as "master" | "sublist", parentListId: list.parentListId, symbols: list.symbols, entryCount: list.symbols.length, active: list.active, createdAt: list.createdAt.toISOString() })),
    ...gexDemoSelection(settings.symbols),
  };
}

export async function saveGexSymbols(input: { symbols: string[]; sourceFilename: string; expectedRevision: number }) {
  const database = await getDatabase();
  await database.insert(gexSettings).values({ id: 1 }).onConflictDoNothing();
  const [updated] = await database.update(gexSettings).set({
    symbols: input.symbols,
    sourceFilename: input.sourceFilename.slice(0, 255),
    revision: input.expectedRevision + 1,
    updatedAt: new Date(),
  }).where(and(eq(gexSettings.id, 1), eq(gexSettings.revision, input.expectedRevision))).returning();
  if (!updated) throw new GexListConflictError("The GEX list changed in another tab. Refresh and try again.");
  await database.update(gexLists).set({ active: false }).where(eq(gexLists.active, true));
  await database.insert(gexLists).values({ name: input.sourceFilename, kind: "master", symbols: input.symbols, sourceFilename: input.sourceFilename, active: true });
  await retainFiveGexLists();
  return getGexState();
}

export async function saveGexSublist(input: { name: string; symbols: string[]; expectedRevision: number }) {
  const database = await getDatabase();
  const state = await getGexState();
  if (state.revision !== input.expectedRevision) throw new GexListConflictError("The GEX list changed in another tab. Refresh and try again.");
  const active = state.lists.find((list) => list.active);
  const parent = active?.kind === "master" ? active : state.lists.find((list) => list.id === active?.parentListId);
  if (!parent || input.symbols.some((symbol) => !parent.symbols.includes(symbol))) throw new Error("A GEX sublist must use the uploaded master list's symbols.");
  const [updated] = await database.update(gexSettings).set({ symbols: input.symbols, sourceFilename: `Sublist: ${input.name}`, revision: input.expectedRevision + 1, updatedAt: new Date() }).where(and(eq(gexSettings.id, 1), eq(gexSettings.revision, input.expectedRevision))).returning();
  if (!updated) throw new GexListConflictError("The GEX list changed in another tab. Refresh and try again.");
  await database.update(gexLists).set({ active: false }).where(eq(gexLists.active, true));
  await database.insert(gexLists).values({ name: input.name, kind: "sublist", parentListId: parent.id, symbols: input.symbols, sourceFilename: null, active: true });
  await retainFiveGexLists();
  return getGexState();
}

export async function activateGexList(input: { id: string; expectedRevision: number }) {
  const database = await getDatabase(); const [list] = await database.select().from(gexLists).where(eq(gexLists.id, input.id)).limit(1);
  if (!list) throw new Error("GEX list not found.");
  const [updated] = await database.update(gexSettings).set({ symbols: list.symbols, sourceFilename: list.kind === "sublist" ? `Sublist: ${list.name}` : list.sourceFilename ?? list.name, revision: input.expectedRevision + 1, updatedAt: new Date() }).where(and(eq(gexSettings.id, 1), eq(gexSettings.revision, input.expectedRevision))).returning();
  if (!updated) throw new GexListConflictError("The GEX list changed in another tab. Refresh and try again.");
  await database.update(gexLists).set({ active: false }).where(eq(gexLists.active, true)); await database.update(gexLists).set({ active: true }).where(eq(gexLists.id, input.id)); return getGexState();
}

export async function deleteGexSublist(input: { id: string; expectedRevision: number }) {
  const database = await getDatabase(); const [list] = await database.select().from(gexLists).where(eq(gexLists.id, input.id)).limit(1);
  if (!list || list.kind !== "sublist") throw new Error("Only saved GEX sublists can be deleted.");
  const state = await getGexState(); if (state.revision !== input.expectedRevision) throw new GexListConflictError("The GEX list changed in another tab. Refresh and try again.");
  if (list.active) { const parent = state.lists.find((candidate) => candidate.id === list.parentListId); if (!parent) throw new Error("Activate another GEX list before deleting this sublist."); await activateGexList({ id: parent.id, expectedRevision: input.expectedRevision }); }
  await database.delete(gexLists).where(eq(gexLists.id, input.id)); return getGexState();
}


export async function saveGexDataset(category: string, rows: unknown[]) {
  const database = await getDatabase();
  const runAt = new Date();
  const runLabel = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(runAt).replace(", ", " ");
  const titledRows = rows.map((row) => {
    const value = row as { symbol?: unknown; expiration?: unknown };
    const symbol = typeof value.symbol === "string" ? value.symbol : "UNKNOWN";
    const expiration = typeof value.expiration === "string" ? value.expiration : "unknown-expiry";
    return { ...value, datasetTitle: `${symbol}-${expiration}-${category}-${runLabel} ET` };
  });
  const [saved] = await database.insert(gexDatasets).values({ category, runAt, rows: titledRows }).returning({ id: gexDatasets.id });
  const old = await database.select({ id: gexDatasets.id }).from(gexDatasets).where(eq(gexDatasets.category, category)).orderBy(desc(gexDatasets.runAt)).offset(3);
  if (old.length) await database.delete(gexDatasets).where(inArray(gexDatasets.id, old.map((row) => row.id)));
  return { id: saved.id, runAt };
}

export async function getLatestGexDataset(category: GexCategory) {
  const database = await getDatabase();
  const [dataset] = await database.select({ id: gexDatasets.id, rows: gexDatasets.rows, runAt: gexDatasets.runAt })
    .from(gexDatasets).where(eq(gexDatasets.category, category)).orderBy(desc(gexDatasets.runAt)).limit(1);
  return dataset ? { ...dataset, rows: dataset.rows as GexLiveRow[] } : null;
}

export async function getGexDatasetById(id: string) {
  const database = await getDatabase();
  const [dataset] = await database.select({ id: gexDatasets.id, category: gexDatasets.category, rows: gexDatasets.rows, runAt: gexDatasets.runAt })
    .from(gexDatasets).where(eq(gexDatasets.id, id)).limit(1);
  return dataset ? { ...dataset, rows: dataset.rows as GexLiveRow[] } : null;
}

export type GexDatasetSummary = { id: string; category: GexCategory; optionDate: string; runAt: string };

export async function getRecentGexDatasetSummaries(): Promise<GexDatasetSummary[]> {
  const database = await getDatabase();
  const datasets = await database.select({ id: gexDatasets.id, category: gexDatasets.category, rows: gexDatasets.rows, runAt: gexDatasets.runAt })
    .from(gexDatasets).orderBy(desc(gexDatasets.runAt));
  const order = ["manual", "daily", "weekly", "monthly"] as const;
  return order.flatMap((category) => datasets.filter((dataset) => dataset.category === category).slice(0, 3).map((dataset) => {
    const first = (dataset.rows as GexLiveRow[])[0];
    return {
      id: dataset.id,
      category,
      optionDate: category === "manual" ? first?.requestedExpiration ?? first?.expiration ?? "Unknown expiry" : first?.expiration ?? "Unknown expiry",
      runAt: dataset.runAt.toISOString(),
    };
  }));
}

export async function getAvailableGexDatasetCategories(): Promise<GexCategory[]> {
  const database = await getDatabase();
  const datasets = await database.select({ category: gexDatasets.category }).from(gexDatasets);
  return (["daily", "weekly", "monthly", "manual"] as const).filter((category) => datasets.some((dataset) => dataset.category === category));
}

export type GexUsageSummary = {
  modelRuns: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  costComplete: boolean;
};

export async function saveGexModelUsage(records: Array<GexModelUsage & { symbol: string; category: GexCategory }>) {
  if (!records.length) return;
  const database = await getDatabase();
  await database.insert(gexModelRuns).values(records.map((record) => ({
    symbol: record.symbol, category: record.category,
    purpose: record.purpose,
    requestedModel: record.requestedModel, actualModel: record.actualModel, actualProvider: record.actualProvider, responseId: record.responseId,
    inputTokens: record.inputTokens, outputTokens: record.outputTokens, reasoningTokens: record.reasoningTokens,
    costUsd: record.costUsd === null ? null : String(record.costUsd),
  })));
}

export async function getGexUsageSummary(): Promise<GexUsageSummary> {
  const database = await getDatabase();
  const [usage] = await database.select({
    modelRuns: sql<number>`count(*)::int`,
    inputTokens: sql<number | null>`sum(${gexModelRuns.inputTokens})::int`,
    outputTokens: sql<number | null>`sum(${gexModelRuns.outputTokens})::int`,
    reasoningTokens: sql<number | null>`sum(${gexModelRuns.reasoningTokens})::int`,
    costUsd: sql<string | null>`sum(${gexModelRuns.costUsd})`,
    missingCost: sql<number>`count(*) filter (where ${gexModelRuns.costUsd} is null)::int`,
  }).from(gexModelRuns);
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  return {
    modelRuns: usage?.modelRuns ?? 0, inputTokens, outputTokens, reasoningTokens: usage?.reasoningTokens ?? null,
    totalTokens: inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0),
    costUsd: usage?.costUsd === null || usage?.costUsd === undefined ? null : Number(usage.costUsd),
    costComplete: Boolean(usage?.modelRuns) && usage?.missingCost === 0,
  };
}

export async function saveGexTemplate(kind: "engine" | "scanner" | "flip_prompt", content: string) {
  const database = await getDatabase();
  const latest = await database.select({ version: gexTemplates.version }).from(gexTemplates).where(eq(gexTemplates.kind, kind)).orderBy(desc(gexTemplates.version)).limit(1);
  await database.update(gexTemplates).set({ active: false }).where(eq(gexTemplates.kind, kind));
  await database.insert(gexTemplates).values({ kind, content, version: (latest[0]?.version ?? 0) + 1, active: true });
  // Retain the active template plus up to three prior versions.
  const old = await database.select({ id: gexTemplates.id }).from(gexTemplates).where(eq(gexTemplates.kind, kind)).orderBy(desc(gexTemplates.createdAt)).offset(4);
  if (old.length) await database.delete(gexTemplates).where(inArray(gexTemplates.id, old.map((row) => row.id)));
}


export async function getGexTemplates() {
  const database = await getDatabase();
  return database.select({ id: gexTemplates.id, kind: gexTemplates.kind, version: gexTemplates.version, active: gexTemplates.active, createdAt: gexTemplates.createdAt }).from(gexTemplates).orderBy(desc(gexTemplates.createdAt));
}

export async function getGexTemplateContent(kind: "engine" | "scanner" | "flip_prompt", id: string) {
  const database = await getDatabase();
  const [template] = await database.select({ content: gexTemplates.content, version: gexTemplates.version }).from(gexTemplates).where(and(eq(gexTemplates.id, id), eq(gexTemplates.kind, kind))).limit(1);
  return template ?? null;
}

export async function activateGexTemplate(kind: "engine" | "scanner" | "flip_prompt", id: string) {
  const database = await getDatabase();
  const [selected] = await database.select({ id: gexTemplates.id }).from(gexTemplates).where(and(eq(gexTemplates.id, id), eq(gexTemplates.kind, kind))).limit(1);
  if (!selected) throw new Error("The selected template is not available.");
  await database.update(gexTemplates).set({ active: false }).where(eq(gexTemplates.kind, kind));
  await database.update(gexTemplates).set({ active: true }).where(and(eq(gexTemplates.id, id), eq(gexTemplates.kind, kind)));
}

export async function getActiveGexTemplate(kind: "engine" | "scanner" | "flip_prompt") {
  const database = await getDatabase();
  const [template] = await database.select({ content: gexTemplates.content }).from(gexTemplates).where(and(eq(gexTemplates.kind, kind), eq(gexTemplates.active, true))).limit(1);
  return template?.content ?? null;
}

export async function getActiveGexTemplateWithVersion(kind: "engine" | "scanner") {
  const database = await getDatabase();
  const [template] = await database.select({ content: gexTemplates.content, version: gexTemplates.version }).from(gexTemplates).where(and(eq(gexTemplates.kind, kind), eq(gexTemplates.active, true))).limit(1);
  return template ?? null;
}
