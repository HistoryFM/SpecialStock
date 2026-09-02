import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { runScheduledBatch } from "@/scans/batch";
import { ScanNotAvailableError } from "@/scans/service";

export const maxDuration = 180;

const bodySchema = z.object({ slotKey: z.string().min(1).max(80) }).strict();
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) {
    Sentry.logger.warn("scan.batch.rejected", {
      "specialstock.scan.batch_rejection": "unauthorized",
    });
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }
  try {
    const { slotKey } = bodySchema.parse(await request.json().catch(() => null));
    return Response.json(await runScheduledBatch(slotKey), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof z.ZodError) {
      Sentry.logger.warn("scan.batch.rejected", {
        "specialstock.scan.batch_rejection": "invalid_request",
      });
      return Response.json({ error: "Invalid scheduled batch request." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ScanNotAvailableError) {
      Sentry.logger.info("scan.batch.rejected", {
        "specialstock.scan.batch_rejection": "slot_not_available",
        "error.message": error.message.slice(0, 200),
      });
      return Response.json({ error: error.message }, { status: 409, headers: PRIVATE_HEADERS });
    }
    Sentry.logger.error("scan.batch.failed", {
      "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
      "error.message": error instanceof Error ? error.message.slice(0, 500) : "The scheduled batch failed.",
    });
    Sentry.captureException(error, { tags: { route: "api.scans.batch" } });
    return Response.json(
      { error: error instanceof Error ? error.message : "The scheduled batch failed." },
      { status: 502, headers: PRIVATE_HEADERS },
    );
  }
}
