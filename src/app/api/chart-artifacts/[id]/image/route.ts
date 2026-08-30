import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { readChartArtifact } from "@/chart/artifact-storage";
import { getDatabase } from "@/db/client";
import { chartArtifacts } from "@/db/schema";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const database = await getDatabase();
  const [artifact] = await database.select().from(chartArtifacts).where(eq(chartArtifacts.id, id));
  if (!artifact) return Response.json({ error: "Chart not found" }, { status: 404 });
  if (artifact.rendererVersion !== "chart-img-v2" || !artifact.storageReference) {
    return Response.json({ error: "Historical renderer is unavailable" }, { status: 410 });
  }
  const png = await readChartArtifact(artifact.storageReference, artifact.imageHash).catch(() => null);
  if (!png) return Response.json({ error: "Chart hash verification failed" }, { status: 409 });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-SpecialStock-Image-Hash": artifact.imageHash,
    },
  });
}
