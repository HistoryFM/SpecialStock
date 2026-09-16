import { randomUUID } from "node:crypto";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { continuePlanConversation } from "@/backtesting/ai";
import { listPriceFiles } from "@/backtesting/storage";
import { conversationTurnSchema, modelSchema, timeframeSchema } from "@/backtesting/types";
import type { ConversationTurn } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ model: modelSchema, timeframe: timeframeSchema, turns: z.array(conversationTurnSchema).min(1).max(40) }).strict();

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const input = schema.parse(await request.json());
    const tickers = [...new Set((await listPriceFiles()).filter((file) => file.timeframe === input.timeframe).map((file) => file.ticker))];
    const answer = await continuePlanConversation({ ...input, turns: input.turns as ConversationTurn[], availableTickers: tickers });
    return Response.json({ plan: answer.value.plan, turn: { id: randomUUID(), role: "assistant", content: answer.value.reply, at: new Date().toISOString(), usage: answer.usage } }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The selected model could not continue the strategy conversation." }, { status: error instanceof z.ZodError ? 400 : 502, headers });
  }
}
