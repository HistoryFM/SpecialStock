import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { SINGLE_USER_ID } from "@/auth/constants";

export const requireAuthorizedUser = cache(async () => {
  const session = await auth();
  if (!isAuthorizedSession(session)) redirect("/login");

  return { id: SINGLE_USER_ID } as const;
});
