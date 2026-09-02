# SpecialStock

SpecialStock is a private, single-user visual technical-analysis workspace for a small US-stock watchlist. Chart-Img renders a frozen TradingView chart, and only `google/gemini-2.5-pro` judges that image and fills the decision brief.

The application does **not** calculate technical indicators for Gemini, send OHLC arrays or numeric indicator snapshots to Gemini, place trades, or provide autonomous execution.

This README is the current product and engineering source of truth. `PROJECT_PLAN.md` and `IMPLEMENTATION_PROMPT.md` are retained only as historical records of superseded designs.

## Current product behavior

- One-to-20-symbol, exchange-aware watchlist supporting NASDAQ, NYSE, and AMEX symbols.
- Fresh and untouched legacy installations seed the approved 20-stock universe with automatic scanning enabled for every stock.
- Prominent bullish, bearish, and no-trade signals based on Gemini's latest valid verdict.
- Manual **Run now** analysis for every stock, regardless of market state or automatic-scan setting.
- Per-stock automatic scanning with multi-select enable/disable controls.
- Browser-driven scans at approximately 9:35:10 AM, 9:40:10 AM, …, 3:55:10 PM America/New_York on regular-session days.
- Compact-signal history across configured and removed stocks, plus frozen chart audit, model attempt/cost metadata, human review, alerts, thesis state, and evaluation support.
- Per-stock, Eastern-date History review of high-conviction bullish and bearish analyses, including manual results marked review-only.
- Last valid analysis remains visible if a newer scan fails.

Automatic scanning requires an authenticated dashboard tab to remain open. It is intentionally not a background cloud service.

## Analysis contract

Every routine or manual scan follows this pipeline:

1. The server requests one Chart-Img TradingView chart for `EXCHANGE:SYMBOL`.
2. Chart-Img returns a 1600×1920 PNG covering one regular US market session at a five-minute interval.
3. The server validates the response, hashes the exact bytes, and stores the PNG under `.data/chart-artifacts/`.
4. Gemini receives that exact stored PNG plus only the symbol, interval, capture time, and completed/incomplete-bar metadata.
5. Gemini returns only observed price, verdict, conviction, target, invalidation, and visual quality. The server validates and stores that compact signal with the chart hash and audit metadata.
6. Authenticated UI routes verify the stored hash before returning the chart image.

Opening a medium/high bullish or bearish result claims full-analysis work once. Gemini receives the already-stored, hash-verified PNG again—without a new Chart-Img request—and returns narrative/evidence fields only. It cannot change the compact signal's locked verdict, conviction, observed price, target, or invalidation. Low-conviction and no-trade results remain compact and still expose the frozen chart and audit data.

Gemini is explicitly instructed not to reconstruct or calculate technical indicators. If the chart or labels are unclear, the preferred verdict is `no_trade` with readability flags.

### Locked chart layout

The chart contains exactly these studies:

1. VWAP in gold.
2. Keltner Channels using true range, length 20, multiplier 1: solid white outer lines, dotted white midline, and no fill.
3. Volume.
4. ADX 14/14.
5. RSI 14 with SMA-14.
6. MACD 12/26/9.
7. CCI 20 with SMA-20.
8. Chaikin Money Flow 20.

Volume, ADX, RSI, MACD, CCI, and CMF appear in separate lower panes. The price pane is 560 pixels high, scale labels use 16px text, and horizontal and vertical grids remain visible.

There are no Bollinger Bands and no Bollinger crossover study.

### Gemini output

Compact scan output includes only:

- Visually observed price.
- Bullish, bearish, or no-trade verdict and qualitative conviction.
- Target, invalidation, and visual quality.

Eligible full-analysis output adds:

- Setup, immediate bias, broader trend, support, and resistance.
- Candlestick, VWAP/Keltner, and CCI analysis.
- Fixed visual readings for price action, VWAP, Keltner, Volume, ADX, RSI, MACD, CCI, and CMF.
- Stance, readability, and a concise observation for each visual reading.
- Supporting evidence, conflicting evidence, alternate/deeper scenario, data-quality flags, and summary.

The model is locked to `google/gemini-2.5-pro` through OpenRouter. Compact requests use Gemini's 128-token minimum thinking budget and a 256-token completion ceiling. Same-model retries are allowed only for transient, rate-limit, empty, malformed, and validation failures; authentication, payment, configuration, and unsupported-request failures are terminal. Every billed attempt is persisted and charged to the daily ledger, using a retained estimate when exact usage cannot be reconciled.

## Architecture

| Area | Implementation |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript |
| Authentication | Auth.js credentials provider, bcrypt password hash, 12-hour JWT session |
| Local database | Embedded PGlite with Drizzle ORM and checked-in SQL migrations |
| Chart provider | Chart-Img v2 advanced TradingView chart endpoint |
| Analysis provider | OpenRouter using only `google/gemini-2.5-pro` |
| Chart storage | Content-addressed local PNG files with SHA-256 verification |
| Calendar/outcomes | Alpaca when configured; never used for chart indicators or Gemini numeric context |
| Scheduling | Authenticated browser leader, concurrent due-slot batch (up to 20), database idempotency and per-symbol exclusion |

The application is currently designed for local execution. PGlite and chart images use the local filesystem; a serverless deployment requires deliberate migration to durable Postgres and private object storage.

## Requirements

- Node.js 24.x.
- pnpm 11.19.0.
- Internet access for dependency installation and real Chart-Img/OpenRouter calls.
- A Chart-Img ULTRA key for the locked 1600×1920 chart.
- An OpenRouter key with access to `google/gemini-2.5-pro`.
- Optional Alpaca key and secret for live calendar/outcome functionality.

No PostgreSQL server is required. PGlite runs locally inside the application.

## Windows setup and updates with Codex

See [WINDOWS_CODEX_SETUP.md](./WINDOWS_CODEX_SETUP.md). The supported trial workflow is:

1. Clone `https://github.com/HistoryFM/SpecialStock.git` into a normal Windows user folder.
2. Privately restore `.env.local` and, when preserving history, `.data/` from the previous local copy. These files never come from GitHub.
3. Install the ChatGPT/Codex Windows desktop app and open the cloned folder as a Codex project.
4. Ask Codex to read `AGENTS.md` and `WINDOWS_CODEX_SETUP.md`, run `Setup-Windows.ps1`, and validate the app without live provider calls.
5. After setup, use `Start-SpecialStock.cmd` for normal startup. For later releases, stop the app, run `git pull --ff-only`, rerun setup, and restart.

The Windows setup uses Git for updates but does not require WSL, Docker, VS Code, or a separate database.

## Manual local setup

Install the pinned dependencies:

```sh
pnpm install --frozen-lockfile
```

Create `.env.local` and a bcrypt password hash:

```sh
pnpm setup:local "choose a password of at least 12 characters"
```

Add the Chart-Img and OpenRouter keys to `.env.local`, then prepare the embedded database:

```sh
pnpm db:migrate
```

For development:

```sh
pnpm dev
```

For a production-style local run:

```sh
pnpm build
pnpm start --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`.

## Configuration

All configuration is server-only unless explicitly stated otherwise. Never rename a secret with a `NEXT_PUBLIC_` prefix.

| Variable | Required | Purpose |
| --- | --- | --- |
| `LOCAL_DATABASE_PATH` | Yes | Embedded PGlite directory; defaults to `.data/specialstock` |
| `AUTH_SECRET` | Yes | Random Auth.js signing secret, minimum 32 characters |
| `APP_PASSWORD_HASH` | Yes | Bcrypt hash of the local login password; never store plaintext |
| `OPENROUTER_API_KEY` | Real scans | Server-side OpenRouter credential |
| `CHART_IMG_API_KEY` | Real scans | Server-side Chart-Img credential |
| `CHART_IMG_API_URL` | No | Provider endpoint override used by tests |
| `CHART_IMG_WIDTH` | Yes | Locked to 1600 for the approved layout |
| `CHART_IMG_HEIGHT` | Yes | Locked to 1920 for the approved layout |
| `CHART_ARTIFACT_DIR` | Yes | Local chart storage; defaults to `.data/chart-artifacts` |
| `OPENROUTER_API_URL` | No | Provider endpoint override used by tests |
| `ALPACA_API_KEY` | No | Optional calendar/outcome credential |
| `ALPACA_API_SECRET` | No | Must be configured together with the Alpaca key |
| `SPECIALSTOCK_DEMO_MODE` | No | `1` forces demo calendar/outcome behavior |
| `SENTRY_DSN` | Monitoring | Server and Edge Sentry event destination; stored only in local/deployment environment configuration |
| `NEXT_PUBLIC_SENTRY_DSN` | Monitoring | Browser Sentry event destination; uses the same public DSN and is embedded into client builds by Next.js |
| `SENTRY_AUTH_TOKEN` | No | Build-only credential for production source-map uploads; never exposed to the browser |

`.env.example` documents the safe shape without real values. `.env.local` is gitignored and must be treated as confidential.

## Using the application

### Manual analysis

Use **Run now** on any watchlist row. Manual scans create a compact signal, work with automatic scanning on or off and while the market is open or closed, and are rejected only when that same symbol already has a scan running.

Manual scans intentionally do not create alerts, replace the active thesis, or create evaluation outcomes.

### Automatic analysis

Select one or more watchlist rows, then choose **Enable auto** or **Disable auto**. Each row displays `Auto on` or `Auto off`; the dashboard status shows the enabled count.

The scheduler:

- Runs only enabled stocks.
- Runs once shortly after each completed five-minute bar from 9:35 through 3:55 Eastern; it does not launch a 4:00 PM scan.
- Launches all enabled symbols for the due slot together (up to 20) and refreshes once after the batch settles.
- Uses browser leader election and database idempotency to avoid duplicate scans across tabs.
- Carries one server-validated slot through the full symbol batch so slow symbols cannot drift into the next bar.
- Retains the previous valid analysis if a new scan fails and does not cancel successful siblings when another symbol fails.

Keep the dashboard open, the laptop awake, and the internet connection active.

The seeded universe is AAPL, MSFT, AMZN, GOOGL, META, TSLA, NVDA, AMD, AVGO, BE,
MU, SKHY, SNDK, NOW, CRM, SPCX, ORCL, GLD, SLV, and USO. The default daily provider
budget is $12. The routine 2,000-scan projection is operationally gated by that
configured cap while the original under-$10 cost target remains visible as an
efficiency benchmark.

### Signal meaning

The watchlist signal is Gemini's latest valid compact visual verdict. It is not a locally calculated crossover or trading signal. The dashboard's cursor-paginated history includes eligible manual signals and removed stocks. Stale or retained results are labeled so a failed new scan cannot masquerade as fresh analysis.

## Local data and backup

Local state is stored in:

- `.env.local`: credentials, Auth.js secret, and password hash.
- `.data/specialstock/`: embedded database.
- `.data/chart-artifacts/`: exact PNGs used for analyses.

To back up the app:

1. Stop the server.
2. Copy `.env.local` and the entire `.data/` folder to a private location.
3. Do not inspect, upload, or attach `.env.local` to ordinary diagnostics.

To move history to another copy of the same or newer application, stop both copies, restore `.env.local` and `.data/`, run `pnpm db:migrate`, and then start the new copy.

## Security properties

- Provider keys, authentication secret, and password hash stay server-side.
- Login compares the submitted password against the bcrypt hash; plaintext is not stored.
- Authenticated chart routes verify the expected SHA-256 before returning image bytes.
- The build-time secret scan checks generated browser assets for configured server secrets.
- The repository secret scan rejects private/generated paths, configured secret values, common credentials, and `NEXT_PUBLIC_*` secret names before validation can pass.
- The public repository contains only `.env.example`; `.env.local`, `.data/`, and chart artifacts are never versioned or transferred through GitHub.
- Provider error bodies and credentials must not be returned to the browser or written to logs.
- The application binds to localhost in the documented local workflow; other devices cannot access it unless the host/network configuration is deliberately changed.

The shared password protects the local UI, but anyone with access to `.env.local` should be treated as an authorized operator because that file also contains working provider credentials.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Create a production build using webpack |
| `pnpm start` | Start the production build |
| `pnpm setup:local` | Create/update local auth configuration |
| `pnpm db:migrate` | Apply checked-in PGlite migrations |
| `pnpm db:check` | Validate migration consistency |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm test` | Run unit/component tests |
| `pnpm test:e2e` | Run the mocked Playwright browser flow |
| `pnpm secrets:check` | Scan built browser assets for configured secrets |
| `pnpm secrets:repo-check` | Scan commit candidates for private files and configured secrets |
| `pnpm validate` | Run lint, typecheck, tests, DB checks, build, and secret scan |

The end-to-end suite uses local mock providers. It verifies that the exact stored chart bytes are sent to the exact Gemini model without spending provider quota.

## Project map

- `src/chart/`: Chart-Img request construction, response validation, hashing, and artifact storage.
- `src/analysis/`: Gemini prompt, OpenRouter transport, schema, and visual-output validation.
- `src/scans/`: manual/scheduled policy, capture-to-analysis orchestration, persistence, and idempotency.
- `src/settings/`: exchange-aware watchlist and per-stock automatic state.
- `src/market-data/`: Alpaca/demo calendar and outcome provider support; no indicator calculation.
- `src/app/`: authenticated Next.js UI and API routes.
- `src/db/` and `drizzle/`: current schema and migrations.
- `tests/e2e/` and `scripts/run-e2e-server.mjs`: fully mocked browser flow.
- `.data/`: ignored local database and chart artifacts.

## Failure behavior

The UI distinguishes invalid Chart-Img credentials, unsupported symbols, quota/rate limits, chart capture failures, Gemini failures, stale charts, and unreadable charts without leaking raw provider bodies.

Chart capture retries once only for timeouts and server errors. Configuration errors and rate limits are not retried. Gemini may retry the same model, but it cannot switch to another model. A failed latest scan preserves and labels the last valid decision.

## Development constraints

- Read `AGENTS.md` before working in the project.
- Read the relevant bundled guide under `node_modules/next/dist/docs/` before editing Next.js behavior; this Next.js version contains breaking changes.
- Do not reintroduce local indicator calculations, deterministic chart rendering, numeric companion inputs, comparison models, or Bollinger studies.
- Keep new secrets server-only and extend the browser-bundle secret scan when adding any server credential.
- Ask before adding production dependencies or triggering real paid/provider activity.
- Run `pnpm validate` after changes and the mocked E2E flow when scan or UI behavior changes.

## Known limitations

- Automatic scans stop when the dashboard is closed, the laptop sleeps, or connectivity is lost.
- Regular US market sessions only; automatic scans run from 9:35 through 3:55 Eastern and extended hours are out of scope.
- The watchlist supports at most 20 stocks and remains single-user.
- Chart images and history have no automatic retention deletion.
- This tool provides visual technical-analysis assistance, not investment advice, order execution, or guarantees of outcome.
