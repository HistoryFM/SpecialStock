import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { loginAction } from "@/app/login/actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (isAuthorizedSession(await auth())) redirect("/dashboard");

  const { error } = await searchParams;

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-heading">
        <div className="brand-mark" aria-hidden="true">
          SS
        </div>
        <p className="eyebrow">Private technical workspace</p>
        <h1 id="login-heading">Welcome to SpecialStock</h1>
        <p className="muted">
          Sign in to view the 20-stock watchlist and analysis settings.
        </p>
        <form action={loginAction} className="login-form">
          <label htmlFor="password">Shared password</label>
          <input
            autoComplete="current-password"
            data-sentry-mask
            id="password"
            name="password"
            required
            type="password"
          />
          {error ? (
            <p className="form-error" role="alert">
              The password was not recognized.
            </p>
          ) : null}
          <button className="primary-button" type="submit">
            Sign in
          </button>
        </form>
        <p className="privacy-note">Market and account secrets stay server-side.</p>
      </section>
    </main>
  );
}
