import { z } from "zod";

import { generateFullAnalysis, getFullAnalysisStatus, AnalysisNotFoundError, FullAnalysisRetryRequiredError } from "@/analysis/full-service";
import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const bodySchema = z.object({ retry: z.boolean().optional().default(false) });
export const maxDuration = 120;

export async function GET(_request: Request, context: { params: Promise<{ analysisId: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await getFullAnalysisStatus((await context.params).analysisId), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof AnalysisNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request, context: { params: Promise<{ analysisId: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await generateFullAnalysis((await context.params).analysisId, body);
    return Response.json(result.status, {
      status: result.status.state === "running" && !result.claimed ? 202 : 200,
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    if (error instanceof AnalysisNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof FullAnalysisRetryRequiredError) return Response.json({ error: error.message, retryRequired: true }, { status: 409 });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid request." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Full analysis failed." }, { status: 502 });
  }
}
