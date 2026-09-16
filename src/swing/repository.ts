import "server-only";

import { and, asc, desc, eq, max } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  activeSwingPromptRevision,
  swingPromptRevisions,
  swingSettings,
  swingWatchlistEntries,
  swingWatchlistVersions,
} from "@/db/schema";
import { hashObject, sha256 } from "@/lib/hash";
import { DEFAULT_SWING_INSTRUCTIONS } from "@/swing/prompt";
import { SWING_TEMPLATE_VERSION, type SwingPromptRevisionSnapshot, type SwingWatchlistEntry } from "@/swing/types";

export class SwingConflictError extends Error {}
export class SwingNotFoundError extends Error {}

function promptSnapshot(row: typeof swingPromptRevisions.$inferSelect): SwingPromptRevisionSnapshot {
  return { id: row.id, revisionNumber: row.revisionNumber, instructions: row.instructions, instructionsHash: row.instructionsHash, templateVersion: row.templateVersion };
}

export async function ensureSwingDefaults() {
  const database = await getDatabase();
  await database.transaction(async (transaction) => {
    await transaction.insert(swingSettings).values({ id: 1 }).onConflictDoNothing();
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

export async function saveSwingWatchlist(input: { entries: SwingWatchlistEntry[]; filename: string; sourceType: "csv" | "xlsx" }) {
  const database = await getDatabase();
  return database.transaction(async (transaction) => {
    await transaction.insert(swingSettings).values({ id: 1 }).onConflictDoNothing();
    const [aggregate] = await transaction.select({ number: max(swingWatchlistVersions.versionNumber) }).from(swingWatchlistVersions);
    const [version] = await transaction.insert(swingWatchlistVersions).values({
      versionNumber: (aggregate?.number ?? 0) + 1,
      sourceFilename: input.filename.slice(0, 255), sourceType: input.sourceType,
      entryCount: input.entries.length, contentHash: hashObject(input.entries),
    }).returning();
    if (!version) throw new Error("The Swing watchlist version could not be created.");
    await transaction.insert(swingWatchlistEntries).values(input.entries.map((entry) => ({ versionId: version.id, ...entry })));
    await transaction.update(swingSettings).set({ activeWatchlistVersionId: version.id, updatedAt: new Date() }).where(eq(swingSettings.id, 1));
    return { ...version, createdAt: version.createdAt.toISOString(), entries: input.entries };
  });
}

export async function activateSwingWatchlist(versionId: string) {
  const database = await getDatabase();
  const [version] = await database.select().from(swingWatchlistVersions).where(eq(swingWatchlistVersions.id, versionId)).limit(1);
  if (!version) throw new SwingNotFoundError("Swing watchlist version not found.");
  await database.insert(swingSettings).values({ id: 1, activeWatchlistVersionId: version.id }).onConflictDoUpdate({ target: swingSettings.id, set: { activeWatchlistVersionId: version.id, updatedAt: new Date() } });
  return version;
}

export async function setSwingAutomaticEnabled(enabled: boolean) {
  const database = await getDatabase();
  if (enabled) {
    const [current] = await database.select().from(swingSettings).where(eq(swingSettings.id, 1)).limit(1);
    if (!current?.activeWatchlistVersionId) throw new SwingConflictError("Import and activate a Swing watchlist before enabling automatic runs.");
  }
  const [settings] = await database.insert(swingSettings).values({ id: 1, automaticEnabled: enabled }).onConflictDoUpdate({ target: swingSettings.id, set: { automaticEnabled: enabled, updatedAt: new Date() } }).returning();
  return settings!;
}

export async function getSwingConfiguration() {
  await ensureSwingDefaults();
  const database = await getDatabase();
  const [settings] = await database.select().from(swingSettings).where(eq(swingSettings.id, 1));
  const versions = await database.select().from(swingWatchlistVersions).orderBy(desc(swingWatchlistVersions.versionNumber));
  const entries = settings?.activeWatchlistVersionId
    ? await database.select().from(swingWatchlistEntries).where(eq(swingWatchlistEntries.versionId, settings.activeWatchlistVersionId)).orderBy(asc(swingWatchlistEntries.position))
    : [];
  return {
    settings: { automaticEnabled: settings?.automaticEnabled ?? false, activeWatchlistVersionId: settings?.activeWatchlistVersionId ?? null },
    entries: entries.map((entry) => ({ position: entry.position, stockName: entry.stockName, symbol: entry.symbol, exchange: entry.exchange })),
    versions: versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString(), active: version.id === settings?.activeWatchlistVersionId })),
  };
}

export async function getSwingWatchlistVersion(versionId: string) {
  const database = await getDatabase();
  const [version] = await database.select().from(swingWatchlistVersions).where(eq(swingWatchlistVersions.id, versionId)).limit(1);
  if (!version) throw new SwingNotFoundError("Swing watchlist version not found.");
  const entries = await database.select().from(swingWatchlistEntries).where(eq(swingWatchlistEntries.versionId, versionId)).orderBy(asc(swingWatchlistEntries.position));
  return { version, entries: entries.map((entry) => ({ position: entry.position, stockName: entry.stockName, symbol: entry.symbol, exchange: entry.exchange })) };
}
