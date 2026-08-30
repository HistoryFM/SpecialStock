import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import {
  ArtifactInputHashMismatchError,
  toChartArtifactData,
} from "@/chart/artifact-data";
import { getDatabase } from "@/db/client";
import { chartArtifacts } from "@/db/schema";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const { id } = await context.params;
  const database = await getDatabase();
  const [artifact] = await database.select().from(chartArtifacts).where(eq(chartArtifacts.id, id));

  if (!artifact) {
    return Response.json({ error: "Chart not found" }, { status: 404, headers: PRIVATE_HEADERS });
  }
  if (artifact.rendererVersion !== "chart-img-v2") {
    return Response.json(
      { error: "Historical renderer is unavailable" },
      { status: 410, headers: PRIVATE_HEADERS },
    );
  }

  try {
    return Response.json(toChartArtifactData(artifact), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ArtifactInputHashMismatchError) {
      return Response.json(
        { error: "Chart input hash verification failed" },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
