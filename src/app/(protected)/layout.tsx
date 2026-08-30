import Link from "next/link";
import type { ReactNode } from "react";

import { logoutAction } from "@/app/(protected)/actions";
import { NotificationBridge } from "@/app/(protected)/notification-bridge";
import { requireAuthorizedUser } from "@/auth/require-user";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireAuthorizedUser();

  return (
    <div className="app-frame">
      <header className="topbar">
        <Link className="brand" href="/dashboard">
          <span className="brand-mark small" aria-hidden="true">
            SS
          </span>
          <span>SpecialStock</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/alerts">Alerts</Link>
          <Link href="/evaluation">Evaluation</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <form action={logoutAction}>
          <button className="text-button" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <NotificationBridge />
      {children}
    </div>
  );
}
