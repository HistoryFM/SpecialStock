import "server-only";

import { and, asc, desc, eq, max, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  activeSwingPromptRevision,
  swingLists,
  swingMarketSettings,
  swingPromptRevisions,
  swingSettings,
  swingWatchlistEntries,
  swingWatchlistVersions,
} from "@/db/schema";
import { hashObject, sha256 } from "@/lib/hash";
import { DEFAULT_SWING_INSTRUCTIONS } from "@/swing/prompt";
import { SWING_TEMPLATE_VERSION, type SwingMarket, type SwingPromptRevisionSnapshot, type SwingWatchlistEntry } from "@/swing/types";

export class SwingConflictError extends Error {}
export class SwingNotFoundError extends Error {}

function promptSnapshot(row: typeof swingPromptRevisions.$inferSelect): SwingPromptRevisionSnapshot {
  return { id: row.id, revisionNumber: row.revisionNumber, instructions: row.instructions, instructionsHash: row.instructionsHash, templateVersion: row.templateVersion };
}

export async function ensureSwingDefaults() {
  const database = await getDatabase();
  await database.transaction(async (transaction) => {
    await transaction.insert(swingSettings).values({ id: 1 }).onConflictDoNothing();
    await transaction.insert(swingMarketSettings).values([{ market: "US" }, { market: "INDIA" }]).onConflictDoNothing();
    const [active] = await transaction.select().from(activeSwingPromptRevision).where(eq(activeSwingPromptRevision.id, 1)).limit(1);
    if (active) return;
    const [existing] = await transaction.select().from(swingPromptRevisions).orderBy(asc(swingPromptRevisions.revisionNumber)).limit(1);
    const revision = existing ?? (await transaction.insert(swingPromptRevisions).values({
      revisionNumber: 1,
      instructions: DEFAULT_SWING_INSTRUCTIONS,
      instructionsHash: sha256(DEFAULT_SWING_INSTRUCTIONS),
      templateVersion: SWING_TEMPLATE_VERSION,
    }).returning())[0];
    if (!revision) throw new Error("The default Swing prompt could not be seeded.");
    await transaction.insert(activeSwingPromptRevision).values({ id: 1, activeRevisionId: revision.id }).onConflictDoNothing();
  });
}

export async function getActiveSwingPrompt() {
  await ensureSwingDefaults();
  const database = await getDatabase();
  const [row] = await database.select({ revision: swingPromptRevisions }).from(activeSwingPromptRevision)
    .innerJoin(swingPromptRevisions, eq(swingPromptRevisions.id, activeSwingPromptRevision.activeRevisionId))
    .where(eq(activeSwingPromptRevision.id, 1)).limit(1);
  if (!row) throw new SwingNotFoundError("The active Swing prompt is unavailable.");
  return promptSnapshot(row.revision);
}

export async function getSwingPromptStudioState() {
  const active = await getActiveSwingPrompt();
  const database = await getDatabase();
  const revisions = await database.select().from(swingPromptRevisions).orderBy(desc(swingPromptRevisions.revisionNumber));
  return {
    activeRevisionId: active.id,
    defaultInstructions: DEFAULT_SWING_INSTRUCTIONS,
    revisions: revisions.map((revision) => ({ ...promptSnapshot(revision), createdAt: revision.createdAt.toISOString(), active: revision.id === active.id })),
  };
}

function normalizeInstructions(value: string) {
  const normalized = value.replaceAll("\r\n", "\n").trim();
  if (normalized.length < 100 || normalized.length > 20_000) throw new Error("Swing instructions must contain 100–20,000 characters.");
  return normalized;
}

export async function createSwingPromptRevision(input: { instructions: string; expectedActiveRevisionId: string }) {
  const instructions = normalizeInstructions(input.instructions);
  const database = await getDatabase();
  return database.transaction(async (transaction) => {
    const [active] = await transaction.select().from(activeSwingPromptRevision).where(eq(activeSwingPromptRevision.id, 1)).limit(1);
    if (!active || active.activeRevisionId !== input.expectedActiveRevisionId) throw new SwingConflictError("The active Swing prompt changed in another tab.");
    const [current] = await transaction.select().from(swingPromptRevisions).where(eq(swingPromptRevisions.id, active.activeRevisionId)).limit(1);
    if (current?.instructions === instructions) throw new SwingConflictError("The Swing instructions are unchanged.");
    const [aggregate] = await transaction.select({ number: max(swingPromptRevisions.revisionNumber) }).from(swingPromptRevisions);
    const [created] = await transaction.insert(swingPromptRevisions).values({
      revisionNumber: (aggregate?.number ?? 0) + 1,
      instructions,
      instructionsHash: sha256(instructions),
      templateVersion: SWING_TEMPLATE_VERSION,
    }).returning();
    if (!created) throw new Error("The Swing prompt revision could not be created.");
    const [updated] = await transaction.update(activeSwingPromptRevision).set({ activeRevisionId: created.id, updatedAt: new Date() }).where(and(
      eq(activeSwingPromptRevision.id, 1), eq(activeSwingPromptRevision.activeRevisionId, input.expectedActiveRevisionId),
    )).returning();
    if (!updated) throw new SwingConflictError("The active Swing prompt changed in another tab.");
    return { ...promptSnapshot(created), createdAt: created.createdAt.toISOString(), active: true };
  });
}

export async function activateSwingPromptRevision(input: { revisionId: string; expectedActiveRevisionId: string }) {
  const database = await getDatabase();
  const [revision] = await database.select().from(swingPromptRevisions).where(eq(swingPromptRevisions.id, input.revisionId)).limit(1);
  if (!revision) throw new SwingNotFoundError("Swing prompt revision not found.");
  const [updated] = await database.update(activeSwingPromptRevision).set({ activeRevisionId: revision.id, updatedAt: new Date() }).where(and(
    eq(activeSwingPromptRevision.id, 1), eq(activeSwingPromptRevision.activeRevisionId, input.expectedActiveRevisionId),
  )).returning();
  if (!updated) throw new SwingConflictError("The active Swing prompt changed in another tab.");
  return { ...promptSnapshot(revision), createdAt: revision.createdAt.toISOString(), active: true };
}

function normalizeListName(name: string) {
  const normalized = name.trim();
  if (!normalized || normalized.length > 100) throw new Error("Swing list names must contain 1–100 characters.");
  return normalized;
}

export async function saveSwingWatchlist(input: {
  entries: SwingWatchlistEntry[];
  allEntries?: SwingWatchlistEntry[];
  filename: string;
  sourceType: "csv" | "xlsx";
  market?: SwingMarket;
  listName?: string;
  sublistName?: string;
}) {
  const database = await getDatabase();
  const market = input.market ?? "US";
  const masterEntries = input.allEntries ?? input.entries;
  const listName = normalizeListName(input.listName ?? input.filename.replace(/\.(csv|xlsx)$/i, ""));
  return database.transaction(async (transaction) => {
    await transaction.insert(swingMarketSettings).values({ market }).onConflictDoNothing();
    const [aggregate] = await transaction.select({ number: max(swingWatchlistVersions.versionNumber) }).from(swingWatchlistVersions);
    let nextNumber = (aggregate?.number ?? 0) + 1;
    const [master] = await transaction.insert(swingLists).values({ market, name: listName, kind: "master" }).returning();
    if (!master) throw new Error("The Swing list could not be created.");
    const [masterVersion] = await transaction.insert(swingWatchlistVersions).values({
      listId: master.id, versionNumber: nextNumber++, sourceFilename: input.filename.slice(0, 255), sourceType: input.sourceType,
      entryCount: masterEntries.length, contentHash: hashObject(masterEntries),
    }).returning();
    if (!masterVersion) throw new Error("The Swing watchlist version could not be created.");
    await transaction.insert(swingWatchlistEntries).values(masterEntries.map((entry) => ({ versionId: masterVersion.id, ...entry })));

    let activeList = master;
    let activeVersion = masterVersion;
    if (input.entries.length !== masterEntries.length || input.entries.some((entry, index) => entry.symbol !== masterEntries[index]?.symbol)) {
      const sublistName = normalizeListName(input.sublistName ?? `${listName} subset`);
      const [sublist] = await transaction.insert(swingLists).values({ market, name: sublistName, kind: "sublist", parentListId: master.id, sourceVersionId: masterVersion.id }).returning();
      if (!sublist) throw new Error("The Swing sublist could not be created.");
      const [sublistVersion] = await transaction.insert(swingWatchlistVersions).values({
        listId: sublist.id, versionNumber: nextNumber, sourceFilename: input.filename.slice(0, 255), sourceType: input.sourceType,
        entryCount: input.entries.length, contentHash: hashObject(input.entries),
      }).returning();
      if (!sublistVersion) throw new Error("The Swing sublist version could not be created.");
      await transaction.insert(swingWatchlistEntries).values(input.entries.map((entry) => ({ versionId: sublistVersion.id, ...entry })));
      activeList = sublist;
      activeVersion = sublistVersion;
    }
    await transaction.update(swingMarketSettings).set({ activeWatchlistVersionId: activeVersion.id, updatedAt: new Date() }).where(eq(swingMarketSettings.market, market));
    return { list: activeList, version: activeVersion, masterList: master, masterVersion, createdAt: activeVersion.createdAt.toISOString(), entries: input.entries };
  }).catch((error: unknown) => {
    if (error instanceof Error && /swing_lists_market_name_unique|duplicate key/i.test(error.message)) throw new SwingConflictError("A Swing list with that name already exists for this market.");
    throw error;
  });
}

export async function activateSwingWatchlist(versionId: string, input?: { market?: SwingMarket; expectedActiveVersionId?: string | null }) {
  const database = await getDatabase();
  const [row] = await database.select({ version: swingWatchlistVersions, list: swingLists }).from(swingWatchlistVersions)
    .innerJoin(swingLists, eq(swingLists.id, swingWatchlistVersions.listId)).where(eq(swingWatchlistVersions.id, versionId)).limit(1);
  if (!row) throw new SwingNotFoundError("Swing watchlist version not found.");
  const market = input?.market ?? row.list.market as SwingMarket;
  if (row.list.market !== market) throw new SwingConflictError("That Swing list belongs to a different market.");
  const condition = input && "expectedActiveVersionId" in input
    ? and(eq(swingMarketSettings.market, market), input.expectedActiveVersionId === null ? sql`${swingMarketSettings.activeWatchlistVersionId} is null` : eq(swingMarketSettings.activeWatchlistVersionId, input.expectedActiveVersionId!))
    : eq(swingMarketSettings.market, market);
  await database.insert(swingMarketSettings).values({ market }).onConflictDoNothing();
  const [updated] = await database.update(swingMarketSettings).set({ activeWatchlistVersionId: versionId, updatedAt: new Date() }).where(condition).returning();
  if (!updated) throw new SwingConflictError("The active Swing list changed in another tab. Refresh and try again.");
  return { version: row.version, list: row.list, activeWatchlistVersionId: updated.activeWatchlistVersionId };
}

export async function createSwingSublist(input: {
  sourceVersionId: string;
  market: SwingMarket;
  name: string;
  symbols: string[];
  expectedActiveVersionId: string | null;
}) {
  const database = await getDatabase();
  const name = normalizeListName(input.name);
  const source = await getSwingWatchlistVersion(input.sourceVersionId);
  if (source.list.market !== input.market) throw new SwingConflictError("That Swing list belongs to a different market.");
  const requested = new Set(input.symbols.map((symbol) => symbol.trim().toUpperCase()));
  const entries = source.entries.filter((entry) => requested.has(entry.symbol));
  if (!entries.length || entries.length !== requested.size) throw new SwingConflictError("Choose one or more stocks from the active list.");
  return database.transaction(async (transaction) => {
    const [settings] = await transaction.select().from(swingMarketSettings).where(eq(swingMarketSettings.market, input.market)).limit(1);
    if ((settings?.activeWatchlistVersionId ?? null) !== input.expectedActiveVersionId || input.sourceVersionId !== input.expectedActiveVersionId) {
      throw new SwingConflictError("The active Swing list changed in another tab. Refresh and try again.");
    }
    const [aggregate] = await transaction.select({ number: max(swingWatchlistVersions.versionNumber) }).from(swingWatchlistVersions);
    const [list] = await transaction.insert(swingLists).values({
      market: input.market,
      name,
      kind: "sublist",
      parentListId: source.list.kind === "master" ? source.list.id : source.list.parentListId,
      sourceVersionId: source.version.id,
    }).returning();
    if (!list) throw new Error("The Swing sublist could not be created.");
    const [version] = await transaction.insert(swingWatchlistVersions).values({
      listId: list.id,
      versionNumber: (aggregate?.number ?? 0) + 1,
      sourceFilename: source.version.sourceFilename,
      sourceType: source.version.sourceType,
      entryCount: entries.length,
      contentHash: hashObject(entries),
    }).returning();
    if (!version) throw new Error("The Swing sublist version could not be created.");
    await transaction.insert(swingWatchlistEntries).values(entries.map((entry, position) => ({
      versionId: version.id,
      position,
      stockName: entry.stockName,
      symbol: entry.symbol,
      exchange: entry.exchange,
      industry: entry.industry,
    })));
    await transaction.update(swingMarketSettings).set({ activeWatchlistVersionId: version.id, updatedAt: new Date() }).where(eq(swingMarketSettings.market, input.market));
    return { list, version, entries };
  }).catch((error: unknown) => {
    if (error instanceof SwingConflictError) throw error;
    if (error instanceof Error && /swing_lists_market_name_unique|duplicate key/i.test(error.message)) throw new SwingConflictError("A Swing list with that name already exists for this market.");
    throw error;
  });
}

export async function setSwingAutomaticEnabled(enabled: boolean) {
  const database = await getDatabase();
  const market = "US";
  await database.insert(swingMarketSettings).values({ market }).onConflictDoNothing();
  if (enabled) {
    const [current] = await database.select().from(swingMarketSettings).where(eq(swingMarketSettings.market, market)).limit(1);
    if (!current?.activeWatchlistVersionId) throw new SwingConflictError("Import and activate a US Swing list before enabling automatic runs.");
  }
  const [settings] = await database.update(swingMarketSettings).set({ automaticEnabled: enabled, updatedAt: new Date() }).where(eq(swingMarketSettings.market, market)).returning();
  return settings!;
}

export async function getSwingConfiguration(market: SwingMarket = "US") {
  await ensureSwingDefaults();
  const database = await getDatabase();
  const [settings] = await database.select().from(swingMarketSettings).where(eq(swingMarketSettings.market, market));
  const listRows = await database.select().from(swingLists).where(eq(swingLists.market, market)).orderBy(desc(swingLists.createdAt));
  const versions = await database.select().from(swingWatchlistVersions).orderBy(desc(swingWatchlistVersions.versionNumber));
  const versionsByList = new Map<string, typeof versions>();
  for (const version of versions) versionsByList.set(version.listId, [...(versionsByList.get(version.listId) ?? []), version]);
  const entries = settings?.activeWatchlistVersionId
    ? await database.select().from(swingWatchlistEntries).where(eq(swingWatchlistEntries.versionId, settings.activeWatchlistVersionId)).orderBy(asc(swingWatchlistEntries.position))
    : [];
  return {
    market,
    settings: { automaticEnabled: market === "US" ? settings?.automaticEnabled ?? false : false, activeWatchlistVersionId: settings?.activeWatchlistVersionId ?? null },
    entries: entries.map((entry) => ({ position: entry.position, stockName: entry.stockName, symbol: entry.symbol, exchange: entry.exchange, industry: entry.industry })),
    lists: listRows.map((list) => {
      const listVersions = versionsByList.get(list.id) ?? [];
      const latest = listVersions[0];
      return { ...list, market: list.market as SwingMarket, kind: list.kind as "master" | "sublist", createdAt: list.createdAt.toISOString(), latestVersionId: latest?.id ?? null, entryCount: latest?.entryCount ?? 0, active: listVersions.some((version) => version.id === settings?.activeWatchlistVersionId) };
    }),
    versions: versions.filter((version) => listRows.some((list) => list.id === version.listId)).map((version) => ({ ...version, createdAt: version.createdAt.toISOString(), active: version.id === settings?.activeWatchlistVersionId })),
  };
}

export async function getSwingWatchlistVersion(versionId: string) {
  const database = await getDatabase();
  const [row] = await database.select({ version: swingWatchlistVersions, list: swingLists }).from(swingWatchlistVersions)
    .innerJoin(swingLists, eq(swingLists.id, swingWatchlistVersions.listId)).where(eq(swingWatchlistVersions.id, versionId)).limit(1);
  if (!row) throw new SwingNotFoundError("Swing watchlist version not found.");
  const entries = await database.select().from(swingWatchlistEntries).where(eq(swingWatchlistEntries.versionId, versionId)).orderBy(asc(swingWatchlistEntries.position));
  return { version: row.version, list: row.list, entries: entries.map((entry) => ({ position: entry.position, stockName: entry.stockName, symbol: entry.symbol, exchange: entry.exchange, industry: entry.industry })) };
}
