import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getDatabase } from "@/db/client";
import { swingChartArtifacts } from "@/db/schema";
import { readSwingArtifact } from "@/swing/artifact-storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const database = await getDatabase();
  const [artifact] = await database.select().from(swingChartArtifacts).where(eq(swingChartArtifacts.id, (await context.params).id)).limit(1);
  if (!artifact) return Response.json({ error: "Swing chart not found." }, { status: 404 });
  const png = await readSwingArtifact(artifact.storageReference, artifact.imageHash).catch(() => null);
  if (!png) return Response.json({ error: "Swing chart hash verification failed." }, { status: 409 });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-SpecialStock-Image-Hash": artifact.imageHash } });
}
