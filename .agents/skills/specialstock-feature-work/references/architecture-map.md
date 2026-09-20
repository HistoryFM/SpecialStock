# SpecialStock Architecture Map

Use this map to find the existing vertical slice. Verify details in the current code before changing them.

## Shared application shell

| Concern | Primary locations | Existing convention |
| --- | --- | --- |
| Authenticated pages | `src/app/(protected)/` | Server entry pages with client workbenches where interaction is substantial |
| API routes | `src/app/api/` | Node runtime where needed, Auth.js authorization, strict Zod inputs, private/no-store responses |
| Authentication | `src/auth.ts`, `src/auth/` | Credentials auth with authorization helpers; repositories and stateful routes enforce access |
| Configuration | `src/config/env.ts`, `.env.example` | Server-side validation; only the Sentry browser DSN is intentionally public |
| Persistence | `src/db/client.ts`, `src/db/schema.ts`, `drizzle/` | Embedded PGlite, Drizzle schema, ordered SQL migrations, migration regression tests |
| Observability | `sentry.*.config.ts`, `src/instrumentation.ts`, `instrumentation-client.ts` | Sanitized structured traces/logs; sensitive inputs and artifacts are excluded |

## Intraday scans

Trace this flow together:

1. Settings and symbol presentation: `src/settings/`, `src/symbols/`.
2. Browser scheduling and dashboard interaction: `src/app/(protected)/dashboard/scheduler-client.tsx` and the other protected dashboard components.
3. Batch/manual policies: `src/scans/batch.ts`, `src/scans/manual-batch.ts`, `src/scans/policy.ts`, `src/scans/progress.ts`.
4. Per-scan orchestration and persistence: `src/scans/service.ts`.
5. Frozen chart request/storage: `src/chart/chart-img-provider.ts`, `src/chart/artifact-storage.ts`, `src/chart/artifact-data.ts`.
6. Prompt, provider, validation, detailed analysis, and chat: `src/analysis/`.
7. Downstream views and state: `src/dashboard/`, `src/history/`, `src/alerts/`, `src/evaluation/`, `src/outcomes/`.

Re-check the README Analysis contract before touching this flow. Chart-Img's stored PNG is the sole technical evidence supplied to Gemini; do not introduce local indicator computation or numeric market context here.

## Swing Trade

`src/swing/` owns its watchlists, scheduling/run control, chart contract and artifacts, prompt history, Gemini requests, post-processing/ranking, reports, and persistence. Its API routes and UI live under `src/app/api/swing/` and `src/app/(protected)/swing-trade/`.

Read the README Swing Trade contract before changes. Swing is deliberately separate from intraday alerts, theses, evaluations, outcomes, and Backtesting. A list run is a staged batch with macro evidence before candidate work, bounded concurrency, cancellation, partial success, and full audit provenance.

## Backtesting

`src/backtesting/` owns CSV validation, strategy-plan interpretation, deterministic indicators/simulation, versioned file/run storage, report customization, and optional AI discussion. UI and routes live under the matching Backtesting paths in `src/app/`.

Local indicator calculation is valid here because uploaded historical files are the explicit input. Do not generalize this exception into intraday or Swing analysis. Preserve exact file-version references and deterministic replay of saved runs.

## Change-impact checklist

When a feature touches one item, inspect its neighbors:

- **New or changed API:** authentication, strict validation, private caching, timeout/runtime, sanitized errors, route tests, client retry behavior.
- **Provider call:** exact evidence, model/profile lock, timeout/retry classification, concurrency limit, cancellation, attempt persistence, usage/cost, telemetry redaction, mocked test.
- **Stored artifact:** content hash, authenticated retrieval, integrity verification, retention/cascade behavior, backup implications.
- **Prompt or model output:** immutable guardrails, versioned editable instructions, snapshot timing, rendered prompt hash, strict schema validation, legacy record rendering.
- **Batch or schedule:** leader behavior, request idempotency, per-item exclusion, due-slot identity, partial failure, progress recovery, multi-tab behavior.
- **Schema:** backward-compatible read path where needed, ordered migration, fresh-database behavior, existing-data migration test, cascade/retention effects.
- **User-visible feature:** loading/empty/error/stale states, accessibility, narrow viewport behavior, README contract, mocked E2E path.
- **Secret or sensitive field:** `.env.example`, server-only access, repository secret scan, browser-bundle scan, log/Sentry/Replay exclusion.

## Validation routing

- Domain logic: nearest co-located Vitest file.
- Route contracts: co-located route test when present or add one using existing mocks.
- Migration: `pnpm db:check` plus the relevant `src/db/migration-*.test.ts` pattern.
- Full repository: `pnpm validate`.
- User workflow or browser-driven behavior: `pnpm test:e2e` after `pnpm validate`.

Tests must not spend provider quota. The Playwright server uses local Chart-Img/OpenRouter mocks through `scripts/run-e2e-server.mjs`.
