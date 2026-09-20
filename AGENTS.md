<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SpecialStock agent instructions

## Source of truth

- Read `README.md` before changing behavior or architecture.
- For feature iteration or new product behavior, use the repo skill at `.agents/skills/specialstock-feature-work/SKILL.md`. It contains the change workflow and architecture routing; load its reference only when the skill directs you to it.
- On Windows, also read `WINDOWS_CODEX_SETUP.md` before installing tools, configuring the app, or troubleshooting startup.
- `PROJECT_PLAN.md`, `IMPLEMENTATION_PROMPT.md`, and `SWING_TRADE_BUILD_PROMPT.md` are historical inputs. They contain superseded requirements and must not override the current README, tests, or implementation.

## Product and architecture context

- SpecialStock is a private, single-user, local-first analysis workspace. It has three intentionally distinct domains: intraday scans, Swing Trade, and Backtesting.
- The implementation is a Next.js 16 / React 19 / strict TypeScript application. Authenticated UI and routes live under `src/app`; domain logic belongs in the matching `src/*` module rather than route handlers or client components.
- PGlite plus Drizzle is the durable application store. `src/db/schema.ts` is the current schema and `drizzle/` contains ordered, checked-in migrations. Backtesting also keeps versioned local files under `.data/backtesting/`.
- Provider boundaries are server-only. Chart-Img captures evidence, OpenRouter runs model analysis, and Alpaca is limited to calendar/outcome support. Keep provider transports behind their existing domain abstractions so routine tests can use mocks.
- Treat stored image bytes, hashes, prompt revisions, model attempts, costs, and locked result fields as one audit chain. A feature that changes one link must account for the rest of that chain.
- Browser-driven scheduling is deliberate. Do not silently replace it with an in-process timer, cron job, background worker, or cloud assumption.

## Change routing

- Intraday capture or signals: `src/chart/`, `src/analysis/`, `src/scans/`, then dashboard/history/alert consumers.
- Watchlist and automatic-scan settings: `src/settings/`, `src/symbols/`, and the relevant protected UI/API routes.
- Swing Trade: `src/swing/`, `src/app/api/swing/`, `src/app/(protected)/swing-trade/`, and `src/app/(protected)/swing-scheduler.tsx`; keep it isolated from intraday scan state and Backtesting.
- Backtesting: `src/backtesting/` and `src/app/**/backtesting/**`; local indicators are valid only in this isolated domain.
- Persistence changes: `src/db/schema.ts`, a new checked-in `drizzle/` migration, and the matching migration/regression tests.
- Cross-cutting auth, secrets, or telemetry: `src/auth/`, `src/config/`, Sentry setup, and the repository/browser secret checks.

Before editing, trace the existing vertical slice from UI to route, service, repository/provider, persistence, and tests. Prefer extending the established slice over creating a parallel abstraction.

## Product invariants

- In the scan pipeline, Chart-Img creates the frozen technical chart. Do not calculate technical indicators locally for scans or send OHLC/indicator-number payloads to scan AI. The isolated Backtesting tab calculates indicators from local CSVs.
- The scan analysis model is exclusively `google/gemini-2.5-pro` through OpenRouter. Do not add comparison models or cross-model fallback to scans. The isolated Backtesting tab has its own model allowlist.
- The exact stored PNG sent to Gemini must remain hash-verifiable and available in the authenticated audit UI.
- Manual scans must remain available regardless of automatic-scan state and must not create alerts, replace theses, or create evaluations.
- Routine automatic and manual scans produce compact signals only. Full narrative analysis is generated once, on opening an eligible result, from the same verified stored PNG and must not change locked signal fields or create side effects.
- Automatic scheduling is browser-driven and regular-session only; each due slot is submitted as one server batch that runs enabled stocks concurrently (up to 20) and remains duplicate-safe. Never allow overlapping scans for the same symbol.
- The watchlist supports 1–20 stocks. Preserve ordering and per-stock automatic state through Settings edits.
- The configured daily provider amount is an informational spend target. Cost projections and target overruns must not stop scans.
- This is an analysis assistant, not an execution or autonomous-trading system.

## Secrets and local data

- `.env.local` and `.data/` are local-only and must never be committed, pushed, uploaded, or copied into a public handoff. Treat them as confidential.
- Never print, quote, summarize, upload, or include `.env.local` values in diagnostics. Verify secrets only through redacted presence/length checks.
- Never add a `NEXT_PUBLIC_*` secret or return provider credentials in a response.
- Preserve `.env.local` and `.data/` during updates. Stop the server before copying or backing up `.data/`.
- Do not trigger a live Chart-Img/OpenRouter analysis without explicit user approval because it consumes provider quota or credit. A user-authorized, bounded backtesting model validation is an exception for that task only.

## Windows first run

- Prefer the Windows-native Codex agent with PowerShell. Do not introduce WSL or Docker for this app.
- Keep the cloned project on the Windows filesystem in a normal writable folder.
- Check for Git for Windows, Node.js 24.x, and pnpm 11.19.0. If missing, explain the installation and request approval before using `winget` or `npm --global`.
- For updates, stop the app, preserve `.env.local` and `.data/`, use `git pull --ff-only`, and never resolve a pull problem by discarding those private paths.
- Run `./Setup-Windows.ps1`. If `.env.local` exists, the script must use it without displaying or rewriting it.
- If a secure prompt cannot be completed through the Codex task, tell the user to run the same command in the integrated PowerShell terminal. Never ask them to paste a provider key into chat.
- After setup, start with `Start-SpecialStock.cmd` or `pnpm start --hostname 127.0.0.1` and confirm `http://127.0.0.1:3000` responds.

## Engineering workflow

- Inspect `git status` first and keep changes focused. Preserve unrelated user changes; do not rewrite or absorb an existing migration without understanding it.
- For a substantial or unfamiliar feature, state the intended behavior, smallest coherent scope, affected areas, important risks, and validation plan before editing.
- Before editing Next.js code, read the relevant guide under `node_modules/next/dist/docs/`.
- Use `pnpm` and the committed lockfile. Ask before adding production dependencies.
- Keep route handlers thin: authenticate, validate a strict request shape, call domain code, and return sanitized/private responses. Keep secrets and provider payloads out of client components and logs.
- Add or update tests at the domain boundary where behavior changes. Cover idempotency, partial failure, concurrency, and audit provenance when the feature touches those concerns.
- Update `README.md` when product behavior, configuration, architecture, commands, storage, or operational constraints change.
- Use `pnpm validate` for the standard verification suite and `pnpm test:e2e` for the mocked browser flow.
- Do not use real provider calls as a setup or regression test.
- Report what changed, what passed, and any remaining Windows-only uncertainty.
