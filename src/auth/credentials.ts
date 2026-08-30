import { compare } from "bcryptjs";
import { z } from "zod";

export const credentialsSchema = z.object({
  password: z.string().min(1).max(256),
});

export async function verifyPassword(
  candidate: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    return await compare(candidate, expectedHash);
  } catch {
    return false;
  }
}
