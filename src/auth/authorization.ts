import { SINGLE_USER_ID } from "@/auth/constants";

export function isAuthorizedSession(session: unknown): boolean {
  if (!session || typeof session !== "object" || !("user" in session)) return false;
  const user = session.user;
  return (
    !!user &&
    typeof user === "object" &&
    "id" in user &&
    user.id === SINGLE_USER_ID
  );
}
