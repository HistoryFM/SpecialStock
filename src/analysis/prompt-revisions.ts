import "server-only";

import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";

import {
  COMPACT_PROMPT_VERSION,
  DEFAULT_COMPACT_ANALYSIS_INSTRUCTIONS,
  DEFAULT_FULL_ANALYSIS_INSTRUCTIONS,
  FULL_PROMPT_VERSION,
  previewPrompt,
  type PromptPhase,
  type PromptScope,
  type PromptRevisionSnapshot,
} from "@/analysis/prompt";
import { getDatabase } from "@/db/client";
import { activePromptRevisions, promptRevisions } from "@/db/schema";
import { sha256 } from "@/lib/hash";

export const promptInstructionsSchema = z.string()
  .transform((value) => value.replaceAll("\r\n", "\n").trim())
  .pipe(z.string().min(1, "Analysis instructions cannot be empty.").max(8_000));

export class PromptRevisionConflictError extends Error {
  constructor() {
    super("The active prompt changed in another tab. Reload the prompt editor and try again.");
    this.name = "PromptRevisionConflictError";
  }
}

export class PromptRevisionNotFoundError extends Error {}

export function defaultPromptInstructions(phase: PromptPhase) {
  return phase === "compact"
    ? DEFAULT_COMPACT_ANALYSIS_INSTRUCTIONS
    : DEFAULT_FULL_ANALYSIS_INSTRUCTIONS;
}

export function promptTemplateVersion(phase: PromptPhase) {
  return phase === "compact" ? COMPACT_PROMPT_VERSION : FULL_PROMPT_VERSION;
}

function snapshot(row: typeof promptRevisions.$inferSelect): PromptRevisionSnapshot {
  return {
    id: row.id,
    phase: row.phase,
    scope: row.scope,
    revisionNumber: row.revisionNumber,
    instructions: row.instructions,
    instructionsHash: row.instructionsHash,
    templateVersion: row.templateVersion,
  };
}

function studioRevision(row: typeof promptRevisions.$inferSelect) {
  return {
    ...snapshot(row),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getActivePromptRevision(phase: PromptPhase, scope: PromptScope = "auto"): Promise<PromptRevisionSnapshot> {
  const database = await getDatabase();
  const [row] = await database.select({ revision: promptRevisions })
    .from(activePromptRevisions)
    .innerJoin(promptRevisions, eq(promptRevisions.id, activePromptRevisions.activeRevisionId))
    .where(and(eq(activePromptRevisions.phase, phase), eq(activePromptRevisions.scope, scope)))
    .limit(1);
  if (!row) throw new PromptRevisionNotFoundError(`The active ${scope} ${phase} prompt is unavailable.`);
  return snapshot(row.revision);
}

export async function getPromptStudioState() {
  const database = await getDatabase();
  const revisions = await database.select().from(promptRevisions)
    .orderBy(promptRevisions.phase, desc(promptRevisions.revisionNumber));
  const active = await database.select().from(activePromptRevisions);
  const activeByScopePhase = new Map(active.map((row) => [`${row.scope}:${row.phase}`, row.activeRevisionId]));
  const scopes: PromptScope[] = ["auto", "manual_1m", "manual_5m", "manual_10m"];
  return scopes.flatMap((scope) => (["compact", "full"] as const).map((phase) => {
    const phaseRevisions = revisions.filter((row) => row.phase === phase && row.scope === scope);
    const activeRevisionId = activeByScopePhase.get(`${scope}:${phase}`) ?? "";
    const activeRevision = phaseRevisions.find((row) => row.id === activeRevisionId);
    if (!activeRevision) throw new PromptRevisionNotFoundError(`The active ${phase} prompt is unavailable.`);
    return {
      phase,
      scope,
      activeRevisionId,
      defaultInstructions: defaultPromptInstructions(phase),
      preview: previewPrompt(phase, activeRevision.instructions, scope),
      revisions: phaseRevisions.map((row) => ({
        ...studioRevision(row),
        active: row.id === activeRevisionId,
      })),
    };
  }));
}

export async function createAndActivatePromptRevision(input: {
  phase: PromptPhase;
  scope?: PromptScope;
  instructions: string;
  expectedActiveRevisionId: string;
}) {
  const instructions = promptInstructionsSchema.parse(input.instructions);
  const scope = input.scope ?? "auto";
  const database = await getDatabase();
  try {
    return await database.transaction(async (transaction) => {
      const [current] = await transaction.select().from(activePromptRevisions)
        .where(and(eq(activePromptRevisions.phase, input.phase), eq(activePromptRevisions.scope, scope))).limit(1);
      if (!current || current.activeRevisionId !== input.expectedActiveRevisionId) {
        throw new PromptRevisionConflictError();
      }
      const [aggregate] = await transaction.select({ value: max(promptRevisions.revisionNumber) })
        .from(promptRevisions).where(and(eq(promptRevisions.phase, input.phase), eq(promptRevisions.scope, scope)));
      const [created] = await transaction.insert(promptRevisions).values({
        phase: input.phase,
        scope,
        revisionNumber: (aggregate?.value ?? 0) + 1,
        instructions,
        instructionsHash: sha256(instructions),
        templateVersion: promptTemplateVersion(input.phase),
      }).returning();
      if (!created) throw new Error("The prompt revision could not be created.");
      const [activated] = await transaction.update(activePromptRevisions).set({
        activeRevisionId: created.id,
        updatedAt: new Date(),
      }).where(and(
        eq(activePromptRevisions.phase, input.phase),
        eq(activePromptRevisions.scope, scope),
        eq(activePromptRevisions.activeRevisionId, input.expectedActiveRevisionId),
      )).returning();
      if (!activated) throw new PromptRevisionConflictError();
      return studioRevision(created);
    });
  } catch (error) {
    if (error instanceof PromptRevisionConflictError || (error instanceof Error && error.message.includes("prompt_revisions_scope_phase_number_unique"))) {
      throw new PromptRevisionConflictError();
    }
    throw error;
  }
}

export async function activatePromptRevision(input: {
  phase: PromptPhase;
  scope?: PromptScope;
  revisionId: string;
  expectedActiveRevisionId: string;
}) {
  const database = await getDatabase();
  const scope = input.scope ?? "auto";
  const [revision] = await database.select().from(promptRevisions).where(and(
    eq(promptRevisions.id, input.revisionId),
    eq(promptRevisions.phase, input.phase),
    eq(promptRevisions.scope, scope),
  )).limit(1);
  if (!revision) throw new PromptRevisionNotFoundError("Prompt revision not found.");
  const [activated] = await database.update(activePromptRevisions).set({
    activeRevisionId: revision.id,
    updatedAt: new Date(),
  }).where(and(
    eq(activePromptRevisions.phase, input.phase),
    eq(activePromptRevisions.scope, scope),
    eq(activePromptRevisions.activeRevisionId, input.expectedActiveRevisionId),
  )).returning();
  if (!activated) throw new PromptRevisionConflictError();
  return studioRevision(revision);
}
