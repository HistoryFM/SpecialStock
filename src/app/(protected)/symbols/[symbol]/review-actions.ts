"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import { analyses, reviewLabels } from "@/db/schema";

const reviewSchema = z.object({
  analysisId: z.string().uuid(),
  assessment: z.enum(["correct", "incorrect", "unclear"]),
  notes: z.string().trim().max(500).optional(),
  unsupported: z.boolean(),
});

export async function saveReviewAction(_state: { message: string }, formData: FormData) {
  await requireAuthorizedUser();
  const parsed = reviewSchema.safeParse({
    analysisId: formData.get("analysisId"),
    assessment: formData.get("assessment"),
    notes: formData.get("notes"),
    unsupported: formData.get("unsupported") === "on",
  });
  if (!parsed.success) return { message: "Review was not valid." };
  const database = await getDatabase();
  const [analysis] = await database.select().from(analyses).where(eq(analyses.id, parsed.data.analysisId));
  if (!analysis) return { message: "Analysis no longer exists." };
  await database.insert(reviewLabels).values({
    analysisId: parsed.data.analysisId,
    assessment: parsed.data.assessment,
    notes: parsed.data.notes || null,
    unsupportedClaims: parsed.data.unsupported ? ["reviewer_flagged"] : [],
  });
  revalidatePath("/evaluation");
  return { message: "Review saved." };
}
