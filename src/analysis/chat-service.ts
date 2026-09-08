import "server-only";

import * as Sentry from "@sentry/nextjs";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { reserveAnalysisBudget, settleAnalysisBudget } from "@/analysis/budget";
import { CHAT_PROMPT_VERSION } from "@/analysis/prompt";
import { readChartArtifact } from "@/chart/artifact-storage";
import { getServerEnv } from "@/config/env";
import { getDatabase } from "@/db/client";
import { analyses, analysisChatConversations, analysisChatTurns, chartArtifacts, modelAttempts, modelRuns } from "@/db/schema";
import { canonicalJson, sha256 } from "@/lib/hash";
import { DEFAULT_MODEL_ID } from "@/models/catalog";

const questionSchema = z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(2_000));
const responseSchema = z.object({
  id: z.string().optional(), model: z.string().optional(), provider: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), cost: z.number().optional() }).optional(),
});
const generationSchema = z.object({
  data: z.object({
    native_tokens_prompt: z.number().optional(),
    native_tokens_completion: z.number().optional(),
    total_cost: z.number().optional(),
  }).optional(),
});
const answerSchema = z.object({ answer: z.string().min(1).max(12_000) }).strict();

export class ChatUnavailableError extends Error {}
export class ChatBusyError extends Error {}
export class ChatTurnNotFoundError extends Error {}

async function loadGrounding(analysisId: string) {
  const database = await getDatabase();
  const [row] = await database.select({ analysis: analyses, run: modelRuns, artifact: chartArtifacts })
    .from(analyses)
    .innerJoin(modelRuns, eq(modelRuns.id, analyses.modelRunId))
    .leftJoin(chartArtifacts, eq(chartArtifacts.id, modelRuns.chartArtifactId))
    .where(eq(analyses.id, analysisId)).limit(1);
  if (!row) throw new ChatTurnNotFoundError("Analysis not found.");
  if (row.analysis.fullAnalysisState !== "available") throw new ChatUnavailableError("Chat is available after full analysis completes.");
  if (!row.artifact?.storageReference || !row.artifact.imageHash) throw new ChatUnavailableError("The verified chart artifact is unavailable.");
  return row as typeof row & {
    artifact: NonNullable<typeof row.artifact> & { storageReference: string; imageHash: string };
  };
}

async function activeConversation(analysisId: string) {
  const database = await getDatabase();
  const [existing] = await database.select().from(analysisChatConversations).where(and(
    eq(analysisChatConversations.analysisId, analysisId),
    eq(analysisChatConversations.status, "active"),
  )).limit(1);
  if (existing) return existing;
  const [created] = await database.insert(analysisChatConversations).values({ analysisId }).onConflictDoNothing().returning();
  if (created) return created;
  const [raced] = await database.select().from(analysisChatConversations).where(and(eq(analysisChatConversations.analysisId, analysisId), eq(analysisChatConversations.status, "active"))).limit(1);
  if (!raced) throw new Error("The analysis conversation could not be created.");
  return raced;
}

function publicTurn(turn: typeof analysisChatTurns.$inferSelect) {
  return { id: turn.id, requestId: turn.requestId, question: turn.question, answer: turn.answer, status: turn.status, error: turn.error, createdAt: turn.createdAt.toISOString(), completedAt: turn.completedAt?.toISOString() ?? null };
}

function safeChatError(error: unknown) {
  if (!(error instanceof Error)) return "Gemini could not answer this question.";
  if (/^OpenRouter returned HTTP \d{3}\.$/.test(error.message)) return error.message;
  if (error.name === "AbortError") return "The Gemini request timed out.";
  return "Gemini returned an invalid answer. Retry this turn explicitly.";
}

export async function getAnalysisChat(analysisId: string) {
  await loadGrounding(analysisId);
  const conversation = await activeConversation(analysisId);
  const database = await getDatabase();
  const turns = await database.select().from(analysisChatTurns).where(eq(analysisChatTurns.conversationId, conversation.id)).orderBy(asc(analysisChatTurns.createdAt));
  return { analysisId, conversationId: conversation.id, contextExchangeLimit: 6, turns: turns.map(publicTurn) };
}

function chatSystemPrompt(row: Awaited<ReturnType<typeof loadGrounding>>) {
  const analysis = row.analysis;
  return `Answer a follow-up question about one immutable SpecialStock analysis using only the attached hash-verified chart, the locked signal, and the stored full analysis below.

The chart was captured at ${String(row.artifact.frozenInput.capturedAt)} for ${String(row.artifact.frozenInput.chartSymbol)} at interval ${String(row.artifact.frozenInput.interval)}. Do not claim access to current prices, news, macro data, later candles, or any other live information. If the question requires newer information, say that this captured analysis cannot answer it and recommend running a fresh manual scan.

Do not calculate or reconstruct indicator values, invent unreadable levels, provide order execution, or modify the locked signal. Treat prior chat as discussion only. Return one JSON object with only an answer string.

Locked signal:
${canonicalJson({ verdict: analysis.verdict, conviction: analysis.conviction, observedPrice: analysis.observedPrice, target: analysis.primaryTarget, invalidation: analysis.invalidationLevel, visualQuality: analysis.visualQuality })}

Stored full analysis:
${canonicalJson({ setupType: analysis.setupType, immediateBias: analysis.immediateBias, broaderTrend: analysis.broaderTrend, candlestickAnalysis: analysis.candlestickAnalysis, vwapKeltnerAnalysis: analysis.vwapKeltnerAnalysis, cciAnalysis: analysis.cciAnalysis, indicatorReadings: analysis.indicatorReadings, supportingEvidence: analysis.supportingEvidence, conflictingEvidence: analysis.conflictingEvidence, supportLevels: analysis.supportLevels, resistanceLevels: analysis.resistanceLevels, deeperScenario: analysis.deeperScenario, dataQualityFlags: analysis.dataQualityFlags, summary: analysis.summary })}`;
}

async function resolveUsage(apiKey: string, raw: z.infer<typeof responseSchema> | null) {
  let inputTokens = raw?.usage?.prompt_tokens ?? null;
  let outputTokens = raw?.usage?.completion_tokens ?? null;
  let costUsd = raw?.usage?.cost ?? null;
  if (raw?.id && (inputTokens === null || outputTokens === null || costUsd === null)) {
    try {
      const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(raw.id)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) {
        const usage = generationSchema.parse(await response.json()).data;
        inputTokens ??= usage?.native_tokens_prompt ?? null;
        outputTokens ??= usage?.native_tokens_completion ?? null;
        costUsd ??= usage?.total_cost ?? null;
      }
    } catch {
      // The retained estimate accounts for a generation when reconciliation is unavailable.
    }
  }
  return { inputTokens, outputTokens, costUsd };
}

async function executeTurnUnsafe(input: { analysisId: string; turnId: string }) {
  const grounding = await loadGrounding(input.analysisId);
  const database = await getDatabase();
  const conversation = await activeConversation(input.analysisId);
  const [turn] = await database.select().from(analysisChatTurns).where(and(eq(analysisChatTurns.id, input.turnId), eq(analysisChatTurns.conversationId, conversation.id))).limit(1);
  if (!turn) throw new ChatTurnNotFoundError("Chat turn not found.");
  const recent = (await database.select().from(analysisChatTurns).where(and(eq(analysisChatTurns.conversationId, conversation.id), eq(analysisChatTurns.status, "completed"))).orderBy(desc(analysisChatTurns.createdAt)).limit(6)).reverse();
  const systemPrompt = chatSystemPrompt(grounding);
  const textMessages = [
    { role: "system", content: systemPrompt },
    ...recent.flatMap((item) => [{ role: "user", content: item.question }, { role: "assistant", content: item.answer ?? "" }]),
    { role: "user", content: turn.question },
  ];
  const png = await readChartArtifact(grounding.artifact.storageReference, grounding.artifact.imageHash);
  const inputSnapshot = canonicalJson({ messages: textMessages, image: { sha256: grounding.artifact.imageHash, mimeType: "image/png", byteLength: png.byteLength } });
  const inputHash = sha256(inputSnapshot);
  const [run] = await database.insert(modelRuns).values({
    scanSlotId: grounding.run.scanSlotId, chartArtifactId: grounding.artifact.id, runRole: "primary", phase: "chat", operationKey: turn.id,
    requestedModel: DEFAULT_MODEL_ID, promptVersion: CHAT_PROMPT_VERSION, inputHash, status: "pending",
  }).onConflictDoUpdate({
    target: [modelRuns.scanSlotId, modelRuns.runRole, modelRuns.requestedModel, modelRuns.phase, modelRuns.operationKey],
    set: { status: "pending", startedAt: new Date(), completedAt: null, validationErrors: [] },
  }).returning();
  if (!run) throw new Error("The chat model run could not be created.");
  await database.update(analysisChatTurns).set({ modelRunId: run.id, contextTurnIds: recent.map((item) => item.id), updatedAt: new Date() }).where(eq(analysisChatTurns.id, turn.id));
  const env = getServerEnv();
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  const apiKey = env.OPENROUTER_API_KEY;
  const [latestAttempt] = await database.select({ attemptNumber: modelAttempts.attemptNumber }).from(modelAttempts)
    .where(eq(modelAttempts.modelRunId, run.id)).orderBy(desc(modelAttempts.attemptNumber)).limit(1);
  const attemptOffset = latestAttempt?.attemptNumber ?? 0;
  const reservation = await reserveAnalysisBudget({ model: DEFAULT_MODEL_ID, runRole: "primary", usageClass: "chat_followup", modelRunId: run.id, now: new Date() });
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let estimatedUsage = false;
  let lastError: unknown;
  Sentry.logger.info("chat.turn.started", {
    "specialstock.telemetry.origin": "server",
    "specialstock.analysis.id": input.analysisId,
    "specialstock.chat.conversation_id": conversation.id,
    "specialstock.chat.turn_id": turn.id,
    "specialstock.chat.request_id": turn.requestId,
    "specialstock.chat.question_length": turn.question.length,
    "specialstock.chat.context_count": recent.length,
    "specialstock.chat.input_hash": inputHash,
    "specialstock.chart.image_hash": grounding.artifact.imageHash,
  });
  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    const attempt = attemptOffset + attemptNumber;
    const outcome = await Sentry.startSpan({
      name: `chat ${DEFAULT_MODEL_ID}`,
      op: "gen_ai.chat",
      attributes: {
        "specialstock.telemetry.origin": "server",
        "specialstock.analysis.id": input.analysisId,
        "specialstock.analysis.phase": "chat",
        "specialstock.analysis.usage_class": "chat_followup",
        "specialstock.analysis.attempt": attempt,
        "specialstock.chat.conversation_id": conversation.id,
        "specialstock.chat.turn_id": turn.id,
        "specialstock.chat.request_id": turn.requestId,
        "specialstock.chat.question_length": turn.question.length,
        "specialstock.chat.context_count": recent.length,
        "specialstock.prompt.template_version": CHAT_PROMPT_VERSION,
        "specialstock.prompt.sha256": inputHash,
        "specialstock.prompt.byte_length": Buffer.byteLength(inputSnapshot),
        "specialstock.chart.image_hash": grounding.artifact.imageHash,
        "gen_ai.operation.name": "chat",
        "gen_ai.operation.type": "ai_client",
        "gen_ai.provider.name": "openrouter",
        "gen_ai.request.model": DEFAULT_MODEL_ID,
        "gen_ai.request.temperature": 0.1,
        "gen_ai.request.max_tokens": 1_200,
        "gen_ai.request.reasoning.level": "low",
        "gen_ai.response.streaming": false,
        "gen_ai.conversation.id": conversation.id,
        "gen_ai.prompt.name": "specialstock.analysis-chat",
        "gen_ai.function_id": "specialstock.ask-analysis",
        "gen_ai.pipeline.name": "specialstock.grounded-analysis-chat",
        "gen_ai.input.messages": JSON.stringify([{ role: "user", parts: [
          { type: "text", content: JSON.stringify({ template: CHAT_PROMPT_VERSION, sha256: inputHash, byte_length: Buffer.byteLength(inputSnapshot), question_length: turn.question.length, context_count: recent.length }) },
          { type: "image", content: JSON.stringify({ mime_type: "image/png", byte_length: png.byteLength, sha256: grounding.artifact.imageHash }) },
        ] }]),
      },
    }, async (span) => {
      const started = performance.now();
      let raw: z.infer<typeof responseSchema> | null = null;
      let response: Response | null = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45_000);
        try {
          response = await fetch(env.OPENROUTER_API_URL, {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:3000", "X-Title": "SpecialStock" },
            body: JSON.stringify({ model: DEFAULT_MODEL_ID, temperature: 0.1, max_tokens: 1_200, reasoning: { effort: "low" }, response_format: { type: "json_schema", json_schema: { name: "analysis_chat_answer", strict: true, schema: { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } } } }, messages: [
              ...textMessages.slice(0, -1),
              { role: "user", content: [{ type: "text", text: turn.question }, { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] },
            ] }),
          });
        } finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
        raw = responseSchema.parse(await response.json());
        const content = raw.choices[0]!.message.content;
        if (!content) throw new Error("OpenRouter returned an empty chat response.");
        const parsed = answerSchema.parse(JSON.parse(content));
        const usage = await resolveUsage(apiKey, raw);
        totalInputTokens += usage.inputTokens ?? 0;
        totalOutputTokens += usage.outputTokens ?? 0;
        totalCostUsd += usage.costUsd ?? 0.08;
        estimatedUsage ||= usage.costUsd === null;
        const latencyMs = Math.round(performance.now() - started);
        await database.insert(modelAttempts).values({ modelRunId: run.id, attemptNumber: attempt, responseId: raw.id ?? null, status: "valid", latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd == null ? null : String(usage.costUsd), estimatedCostUsd: usage.costUsd == null ? "0.08" : null, rawResponse: raw, promptSnapshot: inputSnapshot, promptHash: inputHash });
        span.setAttributes({
          "specialstock.analysis.status": "valid",
          "specialstock.analysis.will_retry": false,
          "gen_ai.response.id": raw.id ?? "unavailable",
          "gen_ai.response.model": raw.model ?? DEFAULT_MODEL_ID,
          "gen_ai.usage.input_tokens": usage.inputTokens ?? 0,
          "gen_ai.usage.output_tokens": usage.outputTokens ?? 0,
          "gen_ai.usage.total_tokens": (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          "gen_ai.cost.total_tokens": usage.costUsd ?? 0.08,
          "specialstock.cost.estimated": usage.costUsd === null,
          "gen_ai.output.messages": JSON.stringify([{ role: "assistant", parts: [{ type: "text", content: JSON.stringify({ schema: "analysis_chat_answer", byte_length: content.length }) }] }]),
        });
        span.setStatus({ code: 1 });
        Sentry.logger.info("chat.model.attempt", {
          "specialstock.telemetry.origin": "server",
          "specialstock.analysis.id": input.analysisId,
          "specialstock.analysis.phase": "chat",
          "specialstock.analysis.status": "valid",
          "specialstock.analysis.usage_class": "chat_followup",
          "specialstock.analysis.attempt": attempt,
          "specialstock.analysis.will_retry": false,
          "specialstock.chat.conversation_id": conversation.id,
          "specialstock.chat.turn_id": turn.id,
          "specialstock.chat.request_id": turn.requestId,
          "specialstock.prompt.template_version": CHAT_PROMPT_VERSION,
          "specialstock.prompt.sha256": inputHash,
          "specialstock.prompt.byte_length": Buffer.byteLength(inputSnapshot),
          "specialstock.chart.image_hash": grounding.artifact.imageHash,
          "gen_ai.request.model": DEFAULT_MODEL_ID,
          "gen_ai.usage.input_tokens": usage.inputTokens ?? 0,
          "gen_ai.usage.output_tokens": usage.outputTokens ?? 0,
          "gen_ai.cost.total_tokens": usage.costUsd ?? 0.08,
          "specialstock.cost.estimated": usage.costUsd === null,
        });
        await settleAnalysisBudget(reservation, totalCostUsd, estimatedUsage ? "estimated" : "settled");
        await database.update(modelRuns).set({ actualModel: raw.model ?? DEFAULT_MODEL_ID, actualProvider: raw.provider ?? "openrouter", status: "valid", latencyMs, inputTokens: totalInputTokens || null, outputTokens: totalOutputTokens || null, costUsd: String(totalCostUsd), rawResponse: raw, completedAt: new Date() }).where(eq(modelRuns.id, run.id));
        const [saved] = await database.update(analysisChatTurns).set({ answer: parsed.answer, status: "completed", error: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(analysisChatTurns.id, turn.id)).returning();
        Sentry.logger.info("chat.turn.completed", {
          "specialstock.telemetry.origin": "server",
          "specialstock.analysis.id": input.analysisId,
          "specialstock.chat.conversation_id": conversation.id,
          "specialstock.chat.turn_id": turn.id,
          "specialstock.chat.request_id": turn.requestId,
          "specialstock.chat.input_hash": inputHash,
          "specialstock.chart.image_hash": grounding.artifact.imageHash,
          "specialstock.chat.context_count": recent.length,
          "specialstock.model.input_tokens": totalInputTokens,
          "specialstock.model.output_tokens": totalOutputTokens,
          "specialstock.model.cost_usd": totalCostUsd,
          "specialstock.model.cost_estimated": estimatedUsage,
        });
        return { ok: true as const, turn: publicTurn(saved!) };
      } catch (error) {
        const latencyMs = Math.round(performance.now() - started);
        const retryable = !response || response.ok || [408, 409, 429].includes(response.status) || response.status >= 500;
        const usage = await resolveUsage(apiKey, raw);
        const billed = Boolean(response?.ok || raw);
        totalInputTokens += usage.inputTokens ?? 0;
        totalOutputTokens += usage.outputTokens ?? 0;
        if (billed) {
          totalCostUsd += usage.costUsd ?? 0.08;
          estimatedUsage ||= usage.costUsd === null;
        }
        const status = error instanceof Error && error.name === "AbortError" ? "timed_out" : raw ? "invalid" : "failed";
        const willRetry = retryable && attemptNumber < 2;
        await database.insert(modelAttempts).values({ modelRunId: run.id, attemptNumber: attempt, responseId: raw?.id ?? null, status, latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd == null ? null : String(usage.costUsd), errorCode: error instanceof Error ? error.message.slice(0, 180) : "chat_failed", estimatedCostUsd: billed && usage.costUsd === null ? "0.08" : null, rawResponse: raw, promptSnapshot: inputSnapshot, promptHash: inputHash }).onConflictDoNothing();
        span.setAttributes({
          "specialstock.analysis.status": status,
          "specialstock.analysis.will_retry": willRetry,
          "gen_ai.usage.input_tokens": usage.inputTokens ?? 0,
          "gen_ai.usage.output_tokens": usage.outputTokens ?? 0,
          "gen_ai.usage.total_tokens": (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          "gen_ai.cost.total_tokens": billed ? usage.costUsd ?? 0.08 : 0,
          "specialstock.cost.estimated": billed && usage.costUsd === null,
          "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
        });
        span.setStatus({ code: 2, message: status });
        Sentry.logger.warn("chat.model.attempt", {
          "specialstock.telemetry.origin": "server",
          "specialstock.analysis.id": input.analysisId,
          "specialstock.analysis.phase": "chat",
          "specialstock.analysis.status": status,
          "specialstock.analysis.usage_class": "chat_followup",
          "specialstock.analysis.attempt": attempt,
          "specialstock.analysis.will_retry": willRetry,
          "specialstock.chat.conversation_id": conversation.id,
          "specialstock.chat.turn_id": turn.id,
          "specialstock.chat.request_id": turn.requestId,
          "specialstock.prompt.template_version": CHAT_PROMPT_VERSION,
          "specialstock.prompt.sha256": inputHash,
          "specialstock.prompt.byte_length": Buffer.byteLength(inputSnapshot),
          "specialstock.chart.image_hash": grounding.artifact.imageHash,
          "gen_ai.request.model": DEFAULT_MODEL_ID,
          "gen_ai.usage.input_tokens": usage.inputTokens ?? 0,
          "gen_ai.usage.output_tokens": usage.outputTokens ?? 0,
          "gen_ai.cost.total_tokens": billed ? usage.costUsd ?? 0.08 : 0,
          "specialstock.cost.estimated": billed && usage.costUsd === null,
          "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
        });
        return { ok: false as const, error, retryable };
      }
    });
    if (outcome.ok) return outcome.turn;
    lastError = outcome.error;
    if (!outcome.retryable || attemptNumber === 2) break;
  }
  await settleAnalysisBudget(reservation, totalCostUsd || null, totalCostUsd ? (estimatedUsage ? "estimated" : "settled") : "released");
  const message = safeChatError(lastError);
  await database.update(modelRuns).set({ status: "failed", inputTokens: totalInputTokens || null, outputTokens: totalOutputTokens || null, costUsd: totalCostUsd ? String(totalCostUsd) : null, validationErrors: [message], completedAt: new Date() }).where(eq(modelRuns.id, run.id));
  const [failed] = await database.update(analysisChatTurns).set({ status: "failed", error: message, completedAt: new Date(), updatedAt: new Date() }).where(eq(analysisChatTurns.id, turn.id)).returning();
  Sentry.logger.warn("chat.turn.failed", { "specialstock.telemetry.origin": "server", "specialstock.analysis.id": input.analysisId, "specialstock.chat.conversation_id": conversation.id, "specialstock.chat.turn_id": turn.id, "specialstock.chat.request_id": turn.requestId, "specialstock.chat.input_hash": inputHash, "error.type": lastError instanceof Error ? lastError.constructor.name : "UnknownError" });
  return publicTurn(failed!);
}

async function executeTurn(input: { analysisId: string; turnId: string }) {
  return Sentry.startSpan({
    name: "Run grounded analysis chat",
    op: "specialstock.analysis.chat",
    attributes: {
      "specialstock.telemetry.origin": "server",
      "specialstock.analysis.id": input.analysisId,
      "specialstock.chat.turn_id": input.turnId,
    },
  }, async (span) => {
    try {
      const result = await executeTurnUnsafe(input);
      span.setAttribute("specialstock.chat.status", result.status);
      span.setStatus({ code: result.status === "completed" ? 1 : 2, message: result.status });
      return result;
    } catch (error) {
      span.setAttribute("error.type", error instanceof Error ? error.constructor.name : "UnknownError");
      span.setStatus({ code: 2, message: "chat_workflow_failed" });
      const database = await getDatabase();
      await database.update(analysisChatTurns).set({
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "Chat request failed.",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(analysisChatTurns.id, input.turnId), eq(analysisChatTurns.status, "pending")));
      throw error;
    }
  });
}

export async function submitAnalysisChat(input: { analysisId: string; requestId: string; question: string }) {
  await loadGrounding(input.analysisId);
  const conversation = await activeConversation(input.analysisId);
  const database = await getDatabase();
  const [existing] = await database.select().from(analysisChatTurns).where(eq(analysisChatTurns.requestId, input.requestId)).limit(1);
  if (existing) return publicTurn(existing);
  const question = questionSchema.parse(input.question);
  const [pending] = await database.select({ id: analysisChatTurns.id }).from(analysisChatTurns).where(and(eq(analysisChatTurns.conversationId, conversation.id), eq(analysisChatTurns.status, "pending"))).limit(1);
  if (pending) throw new ChatBusyError("Wait for the current chat response to finish.");
  try {
    const [turn] = await database.insert(analysisChatTurns).values({ conversationId: conversation.id, requestId: input.requestId, question }).returning();
    return executeTurn({ analysisId: input.analysisId, turnId: turn!.id });
  } catch (error) {
    if (error instanceof Error && error.message.includes("analysis_chat_one_pending_unique")) throw new ChatBusyError("Wait for the current chat response to finish.");
    throw error;
  }
}

export async function retryAnalysisChat(input: { analysisId: string; turnId: string }) {
  const conversation = await activeConversation(input.analysisId);
  const database = await getDatabase();
  const [pending] = await database.select({ id: analysisChatTurns.id }).from(analysisChatTurns).where(and(eq(analysisChatTurns.conversationId, conversation.id), eq(analysisChatTurns.status, "pending"))).limit(1);
  if (pending) throw new ChatBusyError("Wait for the current chat response to finish.");
  const [turn] = await database.update(analysisChatTurns).set({ status: "pending", error: null, answer: null, completedAt: null, updatedAt: new Date() }).where(and(eq(analysisChatTurns.id, input.turnId), eq(analysisChatTurns.conversationId, conversation.id), eq(analysisChatTurns.status, "failed"))).returning();
  if (!turn) throw new ChatTurnNotFoundError("Failed chat turn not found.");
  return executeTurn({ analysisId: input.analysisId, turnId: turn.id });
}

export async function resetAnalysisChat(analysisId: string) {
  await loadGrounding(analysisId);
  const conversation = await activeConversation(analysisId);
  const database = await getDatabase();
  const [pending] = await database.select({ id: analysisChatTurns.id }).from(analysisChatTurns).where(and(eq(analysisChatTurns.conversationId, conversation.id), eq(analysisChatTurns.status, "pending"))).limit(1);
  if (pending) throw new ChatBusyError("Wait for the current chat response to finish.");
  const now = new Date();
  await database.update(analysisChatConversations).set({ status: "archived", archivedAt: now, updatedAt: now }).where(eq(analysisChatConversations.id, conversation.id));
  const [created] = await database.insert(analysisChatConversations).values({ analysisId }).returning();
  return { analysisId, conversationId: created!.id, contextExchangeLimit: 6, turns: [] };
}
