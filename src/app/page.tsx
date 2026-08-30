import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";

export default async function HomePage() {
  redirect(isAuthorizedSession(await auth()) ? "/dashboard" : "/login");
}
