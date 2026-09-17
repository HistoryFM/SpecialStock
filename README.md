# SpecialStock

SpecialStock is a private, single-user visual technical-analysis workspace for intraday scans, isolated daily Swing Trade analysis, and historical Backtesting. Chart-Img renders frozen TradingView charts, and only `google/gemini-2.5-pro` judges scan and Swing images.

The scan pipeline does **not** calculate technical indicators for Gemini or send OHLC arrays or numeric indicator snapshots to Gemini. Backtesting calculates indicators locally from uploaded daily or weekly CSVs and simulates historical trades. The application does not place trades or provide autonomous execution.

This README is the current product and engineering source of truth. `PROJECT_PLAN.md` and `IMPLEMENTATION_PROMPT.md` are retained only as historical records of superseded designs.

## Current product behavior

- One-to-20-symbol, exchange-aware watchlist supporting NASDAQ, NYSE, and AMEX symbols.
- Fresh and untouched legacy installations seed the approved 20-stock universe with automatic scanning enabled for every stock.
- Prominent bullish, bearish, and no-trade signals based on Gemini's latest valid verdict.
- Per-stock manual analysis at any browser-remembered combination of 1-, 5-, and 10-minute intervals, defaulting to 5 minutes regardless of market state or automatic-scan setting.
- Concurrent mixed-interval manual batches of up to 20 symbol–interval jobs, including simultaneous 1m, 5m, and 10m scans for one symbol.
- Raw grouped comparison pages for multi-interval actions, without a combined signal or alignment judgment.
- Separate versioned compact/full instructions for automatic 5m and manual 1m, 5m, and 10m scans, with immutable system guardrails and exact prompt audit provenance.
- One active, grounded Gemini follow-up conversation for each completed full analysis, with cleared conversations retained as archived audit history.
- Per-stock automatic scanning with multi-select enable/disable controls.
- Browser-driven scans at approximately 9:35:10 AM, 9:40:10 AM, …, 3:55:10 PM America/New_York on regular-session days.
- A rolling 24-hour eligible-signal dashboard history with bullish/bearish filters and conviction ordering, plus frozen chart audit, model attempt/cost metadata, human review, alerts, thesis state, and evaluation support.
- Per-stock, Eastern-date History review of high-conviction bullish and bearish analyses, including manual results marked review-only.
- Last valid analysis remains visible if a newer scan fails.
- Authenticated Backtesting tab with versioned local CSV imports shared across named strategies, confirmed multi-asset AI-interpreted plans, deterministic simulations, saved customizable reports with chart zoom controls, and manually tested AI suggestions.
- An isolated authenticated Swing Trade workspace with named US and India master lists, reusable snapshot sublists, independent active lists, daily macro-first visual analysis, ranked 3–21-day candidates, cancellable run history, verified chart/model audit, and a dedicated immutable prompt history.

Automatic scanning requires an authenticated dashboard tab to remain open. It is intentionally not a background cloud service.

Automatic Swing analysis requires the local server and at least one authenticated Swing Trade tab to remain open. It runs once at 3:50:10 PM Eastern on normal sessions, or ten minutes and ten seconds before a calendar-provided early close. Swing automatic mode defaults off, applies only to the active US list, and never affects manual Swing runs. Closing the last Swing tab requests cancellation of active work; a lost browser heartbeat is given a short server grace period before cancellation.

## Swing Trade contract

Swing Trade is isolated from intraday scans and Backtesting. It never creates scan alerts, theses, evaluations, outcomes, or orders, and it never fetches structured OHLCV for analysis or calculates technical indicators locally.

Each run snapshots its market, named list/version, entries including optional Industry, and prompt revision. US runs capture and hash-verify daily SPY, QQQ, GLD, and TLT PNGs; India runs use the market-configured NIFTY 50, NIFTY Bank, India VIX, and USD/INR Chart-Img identifiers. The four exact images are sent in one Gemini macro request, and the run fails before stock analysis if any macro artifact or anchor is unusable. Candidate charts are then captured with a five-request limit and analyzed independently from their exact verified PNG plus the locked macro JSON. Candidate failures do not cancel successful siblings.

Swing charts use an 18-calendar-month daily range, America/New_York for US or Asia/Kolkata for India, dark candlesticks, a 1600×1920 PNG, and an 860-pixel main pane. The price pane contains EMA 8, EMA 20, SMA 50, SMA 200, and Bollinger Bands 20/2. Separate panes show Volume, RSI 14, MACD 12/26/9, CCI 14, and CMF 21. The official Chart-Img v2 contracts do not expose a Volume moving-average input, an RSI 50 midline override, or a CCI zero-line override; no undocumented provider fields are sent. The exact request bodies for both markets are locked by unit tests. The far-right daily candle is labeled open and provisional when the run occurs before its market close.

Gemini receives no browsing, tools, news, fundamentals, current broker quote, other timeframe, OHLC array, or locally calculated indicator snapshot. Exact values may be used only when visually legible. Unreadable execution evidence produces `NO_TRADE`; an unreadable exact volume ratio prevents HIGH conviction. Strict JSON is validated before display, then rendered as a detailed blueprint with the visible pattern, polarity zones, moving-average geometry, separate Volume/MACD/RSI/CCI/CMF observations, three-candle physics, a daily-chart trigger, and visible-evidence rationales for every directional level. `NO_TRADE` results show conditions to watch without publishing hypothetical executable levels. The server—not Gemini—calculates conservative risk-to-reward and entry proximity, downgrades directional results below 1.5 R:R, and sorts actionable candidates by proximity, conviction, R:R, visual quality, then watchlist order.

The Swing Prompt Studio stores immutable revisions independently from scan prompts. Editable methodology cannot change the sole-image evidence rule, Gemini model, runtime metadata, JSON schema, retry/timeout rules, image verification, or persistence side effects. Swing macro and candidate requests use a 6,500-token output ceiling and a 150-second OpenRouter timeout. Every attempt retains the exact rendered prompt and hash, image hashes, settings, input/output/reasoning usage, exact reported cost, response, latency, and failure classification for authenticated audit.

## Analysis contract

Every routine or manual scan follows this pipeline:

1. The server requests one Chart-Img TradingView chart for `EXCHANGE:SYMBOL`.
2. Chart-Img returns a 1600×1920 PNG covering one regular US market session. Automatic scans are always five-minute; manual scans use the selected one-, five-, or ten-minute interval.
3. The server validates the response, hashes the exact bytes, and stores the PNG under `.data/chart-artifacts/`.
4. Gemini receives that exact stored PNG plus only the symbol, interval, capture time, and completed/incomplete-bar metadata.
5. Gemini returns only observed price, verdict, conviction, target, invalidation, and visual quality. The server validates and stores that compact signal with the chart hash and audit metadata.
6. Authenticated UI routes verify the stored hash before returning the chart image.

Opening any completed result claims detailed-analysis work once when a stored chart is available. Gemini receives the already-stored, hash-verified PNG again—without a new Chart-Img request—and returns a structured four-phase report. It cannot change the compact signal's locked verdict, conviction, observed price, target, or invalidation. Previously saved detailed analyses retain their legacy presentation and are not regenerated. Opening more low-conviction and no-trade results may use additional provider credit.

Compact and full prompts each combine a locked system contract, one active versioned analysis-instructions revision, and immutable runtime metadata. Automatic scans use the automatic 5m scope; manual scans use their own 1m, 5m, or 10m scope. Each batch snapshots the applicable compact revisions before fan-out, and a detailed analysis snapshots its matching revision when claimed. Every provider attempt stores the revision, exact rendered prompt, and SHA-256 prompt hash. The Settings prompt studio can preview, save, restore the default text, inspect history, and reactivate an earlier revision without making response schemas or safety boundaries editable.

After a full analysis succeeds, follow-up chat re-verifies and resends the same stored PNG together with the locked compact signal and stored full analysis. Gemini sees at most the six most recent completed exchanges, cannot browse or access current prices/news, and cannot mutate analysis, thesis, alert, review, or evaluation state. Each client-generated request ID is idempotent, only one turn may be pending per conversation, and partial provider output is never displayed. Clearing chat archives the visible conversation until the source analysis expires.

Chat uses the same `google/gemini-2.5-pro` OpenRouter path with temperature 0.1, low reasoning, non-streaming responses, and a 1,200-token response ceiling. Chat usage is recorded separately as `chat_followup`; the retained $0.08 estimate is used only when exact provider cost cannot be reconciled and never blocks a request.

Gemini is explicitly instructed not to reconstruct or calculate technical indicators. The compact prompt requires a structural audit of the last three available candles: real-body velocity and wick rejection, directly matched volume behavior, and acceptance or rejection at VWAP/Keltner lines. A directional result requires those visible structures to agree. If evidence conflicts or chart labels are unclear, the preferred verdict is `no_trade`.

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

Detailed output adds a versioned four-phase report: broad session structure and visible levels; ADX, RSI, MACD, CCI, and CMF readings; a three-candle, volume, and line-confluence audit; and an explicit conflict-resolution hierarchy, locked-verdict rationale, and conditions to watch before a fresh scan. The report also has a concise summary. It may not invent unreadable values, imply institutional transactions from CMF, or offer order execution instructions.

The model is locked to `google/gemini-2.5-pro` through OpenRouter. Automatic compact requests use `compact-auto-medium-v1`, and manual compact requests use `compact-manual-medium-v1`. Both send `reasoning.effort: medium` with a 5,120-token total output ceiling. OpenRouter maps medium effort for Gemini 2.5 Pro to approximately half that ceiling for reasoning (about 2,560 tokens), leaving room for the compact JSON; actual reasoning use, cost, and latency can vary. Both profiles exclude reasoning text from returned content, use temperature 0.1, and keep the unchanged six-field signal schema. A process-wide FIFO limiter admits at most 20 compact OpenRouter attempts at once while chart captures and scan jobs remain concurrent. Its timed Sentry queue spans distinguish local capacity wait from provider latency. Provider-reported reasoning-token counts, queue wait, exact request settings, retries, and precise failure classifications are retained in the local authenticated audit record and emitted as sanitized low-cardinality Sentry attributes; reasoning text is never retained. Missing provider usage details remain unknown. Compact attempts have a 90-second provider timeout, usage reconciliation has a five-second timeout, and scan routes allow 240 seconds for chart capture, retries, and persistence within the existing five-minute scan lease. Full analysis and follow-up chat retain their low-reasoning settings. A timeout or token-limit truncation is terminal; one retry is allowed for transient HTTP, zero-token provider, empty, malformed JSON, structured-output, and validation failures. Authentication, payment, configuration, and unsupported-request failures remain terminal. Every billed attempt is persisted and charged to the daily ledger. Compact scans reserve $0.06, and each billed compact attempt retains a $0.06 estimate only when exact usage cannot be reconciled; this is an accounting estimate, not a price guarantee or spend limit.

## Architecture

| Area | Implementation |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript |
| Authentication | Auth.js credentials provider, bcrypt password hash, 12-hour JWT session |
| Local database | Embedded PGlite with Drizzle ORM and checked-in SQL migrations |
| Chart provider | Chart-Img v2 advanced TradingView chart endpoint |
| Scan analysis provider | OpenRouter using only `google/gemini-2.5-pro` |
| Backtesting interpretation/commentary | Separate OpenRouter allowlist: Gemini 2.5 Pro, GPT-5.6 Sol High, Claude Opus 5 High |
| Swing analysis | Isolated daily Chart-Img profile and `google/gemini-2.5-pro` macro/candidate requests |
| Chart storage | Content-addressed local PNG files with SHA-256 verification |
| Calendar/outcomes | Alpaca when configured; never used for chart indicators or Gemini numeric context |
| Scheduling | Authenticated browser leader, concurrent due-slot batch (up to 20), database idempotency and per-symbol–interval exclusion |

The application is currently designed for local execution. PGlite and chart images use the local filesystem; a serverless deployment requires deliberate migration to durable Postgres and private object storage.

### Sentry diagnostic coverage

Sentry receives 100% tracing, structured logs, and replay coverage for the local production app. The telemetry is designed to reconstruct scheduler, manual-scan, prompt, Settings, and Ask AI complaints without provider keys, chart bytes, cookies, request bodies, password fields, customized instructions, questions, or answers. Prompt editors/previews and chat inputs/transcripts are masked from Replay.

- Browser scheduler logs record leadership changes, material slot/status changes, enabled and running symbols, batch requests, retries, response outcomes, and recovery after heartbeat failures.
- Server batch spans record the settings version and enabled-symbol snapshot, one child span per symbol, each launch offset, peak in-flight work, launch spread, per-symbol outcome, and total duration. Use `span.op:specialstock.scan.batch` for the batch and `span.op:specialstock.scan.batch.item` for its concurrent children.
- Manual batches correlate client request, server workflow, and one child scan tree per symbol–interval through `specialstock.scan.request_id`. Their spans and logs retain interval counts/profile, completion counts, peak concurrency, duration, and per-item outcome without retaining request bodies.
- Prompt revision creation and activation correlate client/server traces with the phase, revision ID, instruction length/hash, prior active revision, and outcome. Instruction text and rendered prompts remain only in the authenticated audit store, not Sentry.
- Ask AI traces correlate the client request, server chat workflow, and `gen_ai.chat` attempt through analysis, conversation, turn, and request IDs. Model settings, prompt/chart hashes, latency, token usage, cost, retry state, and outcome are observable; questions, answers, rendered prompts, and PNG bytes are not.
- Quick dashboard Auto changes record the browser request and the server's authoritative before/after enabled counts, changed count, symbols, duration, and settings versions.
- Full Settings edits record local add/remove/symbol/exchange/Auto intent, client validation or submission, and the server's added, removed, reordered, exchange-changed, and Auto-changed symbols. Optimistic-concurrency failures include the expected and observed versions.
- Scan and `gen_ai.chat` spans remain correlated beneath the batch trace, including provider attempts, retries, tokens, cost, revision IDs, and prompt hashes. Customized prompts, chat text, and model response bodies are excluded from Sentry.
- Backtesting traces link browser actions to CSV import, strategy interpretation, the confirmed deterministic run, optional AI analysis, and report customization. AI calls have `gen_ai.chat` spans with model, phase, reported usage, and cost; unavailable usage remains unknown. Strategy prompts, imported prices, and AI responses stay out of Sentry, and Backtesting inputs and results are masked from Replay.
- Swing traces and logs use the `swing.` namespace for watchlist versions, prompt revisions, scheduler dispatch, run stages, provider attempts, retries, integrity checks, progress, and final outcomes. Uploaded contents, full symbol lists, charts, prompts, instructions, and candidate narratives are excluded from telemetry and masked or blocked in Replay.

Useful log searches begin with `scheduler.`, `scan.batch.`, `scan.manual_batch.`, `prompt.revision.`, `chat.`, `settings.auto.`, `settings.watchlist.`, or `backtesting.` and should be filtered to the relevant release and time window. A healthy 20-stock batch reports `specialstock.scan.batch_peak_in_flight:20`, a small `specialstock.scan.batch_launch_spread_ms`, and overlapping batch-item/scan spans.

## Requirements

- Node.js 24.x.
- pnpm 11.19.0.
- Internet access for dependency installation and real Chart-Img/OpenRouter calls.
- A Chart-Img ULTRA key for the locked 1600×1920 chart.
- An OpenRouter key with access to `google/gemini-2.5-pro`; backtesting model choices additionally require access to the selected GPT or Claude model.
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
| `SWING_CHART_ARTIFACT_DIR` | Yes | Isolated Swing PNG storage; defaults to `.data/swing-chart-artifacts` |
| `OPENROUTER_API_URL` | No | Provider endpoint override used by tests |
| `ALPACA_API_KEY` | No | Optional calendar/outcome credential |
| `ALPACA_API_SECRET` | No | Must be configured together with the Alpaca key |
| `SPECIALSTOCK_DEMO_MODE` | No | `1` forces demo calendar/outcome behavior |
| `SENTRY_DSN` | Monitoring | Server and Edge Sentry event destination; stored only in local/deployment environment configuration |
| `NEXT_PUBLIC_SENTRY_DSN` | Monitoring | Browser Sentry event destination; uses the same public DSN and is embedded into client builds by Next.js |
| `SENTRY_AUTH_TOKEN` | No | Build-only credential for production source-map uploads; never exposed to the browser |

`.env.example` documents the safe shape without real values. `.env.local` is gitignored and must be treated as confidential.

## Using the application

### Historical backtesting

Open **Backtesting** after signing in. Import daily or weekly CSVs for every signal or traded ticker, plus SPY and QQQ, and label each upload with its timeframe. Every asset in a run must use the same timeframe and exactly aligned dates; the app does not resample or mix daily and weekly data. Each upload must contain `Date` and `Close/Last` or `Close`. The import accepts the supplied `Date,Close/Last,Volume,Open,High,Low` format, sorts dates, rejects duplicates and invalid closes, and shows timeframe, date range, row count, and warnings. Confirm that close prices are split-adjusted before import. Each imported version remains under `.data/backtesting/files/` for reproducible saved runs; data is not forwarded to the scan pipeline.

Backtesting starts with the stable strategy **TQQQ-Daily**. Existing runs without strategy metadata appear there without rewriting their saved results. **Strategy Name** filters saved runs and tags each new run; the browser remembers its last valid selection. **New Strategy…** creates a required, case-insensitively unique 1–80-character name. Imported price files are global and remain available to every strategy, while runs and tested suggestions stay with their strategy. Strategy renaming and deletion are intentionally not supported.

Describe the entire portfolio in one prompt: starting capital, cash interest, short-borrow rate, fees, slippage, start date, signal assets, phase transitions, target allocations, and optional position stops. Strategy interpretation is a two-way conversation, so the selected model can ask a concrete clarification and the user can reply until a valid plan is ready. The Backtesting-only model selector offers Gemini 2.5 Pro, GPT-5.6 Sol High, and Claude Opus 5 High through the existing server-side OpenRouter key. AI returns a versioned, reviewable rule plan; it does not generate executable Python. SMA/RSI/MACD periods count bars, so a 50-period SMA uses 50 daily bars in Daily mode or 50 weekly bars in Weekly mode. Unsupported or ambiguous rules require clarification. A missed crossover is not replayed on a later bar.

The deterministic engine starts in cash on the first shared January trading date after indicator warm-up, or on the first eligible session on or after a requested date. Referenced assets and SPY/QQQ require exact daily alignment through the run. It credits each close-to-close return to the existing holdings and trades at the signal day's close. The first eligible transition executes per close; fixed or trailing position stops take priority. Target allocations use percentages of current equity with gross exposure capped at 100%, and holdings drift between transitions. Short proceeds and collateral do not earn interest; only free cash earns the configured rate, and a short position incurs its configured borrow rate. Same-close decisions and fills, including stops, are idealized.

Annual rows show strategy and asset price returns; a separate table gives one full-period maximum drawdown per series. The growth chart supports presets, exact date ranges, drag-to-zoom, and always-visible **− Zoom out**, **+ Zoom in**, and **Reset** buttons. Button zoom is centered on the visible range, stops at five bars, and clamps at the full dataset. A moving legend shows strategy value plus every asset's raw close. Trade history has sticky headers and close columns for every asset used by the run. Named saved-run cards show final strategy value and maximum drawdown and can be reopened, renamed, deleted, or reused as a new draft. The setup conversation and a separate results conversation are retained with a completed run. Report sections, growth series, and chart range remain saved with planned runs; zoom changes on older legacy reports remain session-local. AI commentary uses calculated metrics and may suggest untested plans, which run only when **Test suggestion** is clicked and are compared with the original over identical dates and CSV versions. Older saved runs keep their original calculations and explicit rules, including any 200-day SMA filter, and default to Daily when they predate timeframe metadata.

Reports based on the supplied CSVs are **price returns**, excluding dividends and taxes. Close prices still need split adjustment. Backtesting is a historical analysis tool and does not place orders.

### Manual analysis

Every watchlist row has selectable **1m**, **5m**, and **10m** chips, with **5m** selected by default. At least one remains selected, and the browser remembers each symbol's combination. **Select all stocks** selects the full configured watchlist even under a direction filter; the table header checkbox selects only visible rows. The bulk interval chips add an interval to all selected stocks, or remove it when all have it; a mixed chip indicates only some selected stocks have that interval. The last interval for any stock cannot be removed. A row can launch all of its selected intervals together; **Run selected** expands every selected stock and interval into one server batch and disables submission above 20 jobs. Different intervals for one symbol can run concurrently. The same symbol and interval cannot overlap, so scheduled and manual 5m work remain mutually exclusive while manual 1m or 10m work may coexist with scheduled 5m.

A multi-interval action becomes the symbol's latest dashboard event and links to a comparison page ordered 1m, 5m, 10m. The page shows each independent compact signal, status, levels, quality, capture time, cost, and frozen chart. The app does not calculate alignment, a combined target, or a group thesis. Bullish and Bearish filters match a group when any completed member matches. Opening a comparison never starts full analysis.

Manual scans intentionally do not create alerts, replace the active thesis, or create evaluation outcomes.

### Prompt studio and analysis chat

Settings includes Compact Scan and Full Analysis prompt tabs for automatic 5m and each manual interval. The editable method text is limited to 8,000 characters; saving creates and immediately activates an immutable revision for only the selected scope and phase. Existing prompt history remains the automatic scope; manual scopes begin as copies of the previously active instructions and can then diverge. In-flight work retains its captured revision, and prior revisions remain available for audit and reactivation.

Detail pages show chat after the saved detailed analysis is available. Questions are plain text from 1–2,000 trimmed characters. Responses are non-streaming and grounded only in that analysis's capture-time chart and stored analysis; requests for newer market state, current prices, or news are explicitly out of scope. One turn may be pending at a time, failed turns can be retried, and **Clear chat** starts a new visible conversation while retaining the archived record until normal analysis retention removes it.

### Automatic analysis

Select one or more watchlist rows, then choose **Enable auto** or **Disable auto**. Each row displays `Auto on` or `Auto off`; the dashboard status shows the enabled count.

The scheduler:

- Runs only enabled stocks.
- Always requests five-minute charts regardless of any remembered per-stock manual timeframe.
- Runs once shortly after each completed five-minute bar from 9:35 through 3:55 Eastern; it does not launch a 4:00 PM scan.
- Submits each due slot as one authenticated batch containing all enabled symbols (up to 20), and the dashboard refreshes once after settlement. Dashboard navigation or recovery can resubmit the same slot request; database idempotency returns the existing work without repeating completed Chart-Img or Gemini operations.
- Uses browser leader election and database idempotency to avoid duplicate scans across tabs.
- Carries one server-validated slot through the full symbol batch so slow symbols cannot drift into the next bar.
- Retries an idempotent scheduled slot when a manual run temporarily occupies the same symbol, without overlapping scans or repeating completed siblings.
- Retains the previous valid analysis if a new scan fails and does not cancel successful siblings when another symbol fails.

Keep the dashboard open, the laptop awake, and the internet connection active.

### Swing Trade

Open **Swing Trade** after signing in. The US and India tabs maintain independent named lists and active versions. Import a CSV or XLSX file with case-insensitive `Stock Name`, `Symbol`, and `Exchange` headers plus optional `Industry`. US accepts NASDAQ, NYSE, and AMEX; India accepts NSE/BSE aliases and numeric BSE symbols. Files with more than 20 valid rows open a searchable, initially unselected checkbox list. **Select first 20**, **Select all**, and individual choices can save up to 100 stocks while preserving workbook order. A full upload of at most 100 rows is retained as a master; activating a subset also creates a named immutable sublist. Sources above 100 rows require selecting at most 100 for the saved master. Import validation is atomic, names are case-insensitively unique within each market, and list cards provide verified activation and one-click runs. XLSX workbooks must contain exactly one populated worksheet.

Automatic US Swing analysis is off by default. Manual runs remain available in both markets; India automatic scheduling is intentionally deferred. Active work can be aborted explicitly, and completed/failed results survive cancellation while untouched candidates become canceled. The top metrics show input, output, reasoning, and total tokens; exact OpenRouter cost and completeness; provider calls; completion counts; elapsed time; and a throughput-based ETA. A list is one application batch, not one provider request: four concurrent macro charts and one macro AI request precede candidate chart and AI pools of five.

Results are consolidated by market-local report date. Later runs on the same day append successful symbols, the latest successful duplicate wins, and a later failure never erases an earlier success. Each report keeps its constituent run batches and macro regimes separate. Directional candidates downgraded by server-side R:R validation appear in a dedicated Directional No-Trade table; true model `NO_TRADE` results remain card-based. Recommended and directional tables support stable Industry sorting and authenticated two-sheet Excel export. Opening any candidate remains tied to its original run and displays the exact recomputed-hash-verified PNG, frozen Chart-Img metadata and input hash, prompt revision/hash and snapshot, locked macro context, validated JSON, rendered blueprint, inference settings, attempts, latency, usage, and cost.

Provider calls use paid Chart-Img/OpenRouter capacity and are never used by routine tests. The configured daily amount remains informational and does not block Swing runs. All prices and levels are visual interpretations of a frozen chart, not broker quotes or execution instructions. Swing output never adds current-event or announcement claims, citations, fundamentals, analyst targets, options-chain selection, position sizing, or follow-up solicitations because those inputs are outside the verified chart evidence.

The seeded universe is AAPL, MSFT, AMZN, GOOGL, META, TSLA, NVDA, AMD, AVGO, BE,
MU, SKHY, SNDK, NOW, CRM, SPCX, ORCL, GLD, SLV, and USO. The default daily provider
spend target is $12. It is informational and never stops scans. The routine
2,000-scan projection and the original under-$10 efficiency benchmark remain
visible for cost monitoring.

### Signal meaning

The watchlist signal is Gemini's latest valid compact visual verdict. It is not a locally calculated crossover or trading signal. Watchlist filters are **All**, **Bullish**, and **Bearish**; optional conviction sorting orders High→Medium→Low with missing values last while preserving configured order for ties. The dashboard's cursor-paginated history includes eligible manual and automatic signals from the rolling last 24 hours, supports the same direction filters, and can order conviction High→Low. Stale or retained results are labeled so a failed new scan cannot masquerade as fresh analysis.

## Local data and backup

Local state is stored in:

- `.env.local`: credentials, Auth.js secret, and password hash.
- `.data/specialstock/`: embedded database.
- `.data/chart-artifacts/`: exact PNGs used for analyses.
- `.data/swing-chart-artifacts/`: exact daily PNGs used for Swing macro and candidate analyses.
- `.data/backtesting/`: the local strategy registry, imported price versions shared across strategies, and saved backtests including AI usage and commentary.

Complete scan graphs in completed, failed, or skipped state are permanently removed after seven rolling days. This cascades through their analyses, chat conversations/turns, reviews, theses, outcomes, notifications, model runs, and chart-artifact records; orphaned manual comparison groups are removed with the same cleanup. Shared content-addressed PNGs are retained while any retained chart record still references them, and spend ledgers/reservations remain available for accurate cost reporting. Prompt revisions are retained indefinitely, with one persistent active pointer for each prompt phase.

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
- `src/analysis/`: versioned prompt composition, grounded chat, Gemini/OpenRouter transport, schema, budget accounting, and visual-output validation.
- `src/scans/`: manual/scheduled policy, grouped comparisons, capture-to-analysis orchestration, persistence, and symbol–interval idempotency.
- `src/settings/`: exchange-aware watchlist and per-stock automatic state.
- `src/market-data/`: Alpaca/demo calendar and outcome provider support; no indicator calculation.
- `src/backtesting/`: CSV validation, local indicator/trade engine, isolated AI transport, and versioned local storage.
- `src/swing/`: Swing watchlists, prompt revisions, daily Chart-Img contract, verified artifacts, macro/candidate Gemini transport, deterministic ranking, scheduling, persistence, and run audit.
- `src/app/`: authenticated Next.js UI and API routes.
- `src/db/` and `drizzle/`: current schema and migrations.
- `tests/e2e/` and `scripts/run-e2e-server.mjs`: fully mocked browser flow.
- `.data/`: ignored local database, chart artifacts, imported price files, and saved backtests.

## Failure behavior

The UI distinguishes invalid Chart-Img credentials, unsupported symbols, quota/rate limits, chart capture failures, Gemini failures, stale charts, and unreadable charts without leaking raw provider bodies.

Chart capture retries once only for timeouts and server errors. Configuration errors and rate limits are not retried. Gemini may retry the same model, but it cannot switch to another model. A failed latest scan preserves and labels the last valid decision.

## Development constraints

- Read `AGENTS.md` before working in the project.
- Read the relevant bundled guide under `node_modules/next/dist/docs/` before editing Next.js behavior; this Next.js version contains breaking changes.
- Do not reintroduce local indicator calculations, deterministic chart rendering, numeric companion inputs, comparison models, or Bollinger studies.
- Keep new secrets server-only and extend the browser-bundle secret scan when adding any server credential.
- Ask before adding production dependencies or triggering real paid/provider activity.
- Run `pnpm validate` after changes. Use mocked browser validation by default; live validation requires explicit approval and stated hard limits for both providers.

## Known limitations

- Automatic scans stop when the dashboard is closed, the laptop sleeps, or connectivity is lost.
- Reloading or revisiting the dashboard can produce another idempotent server request for the current scheduled slot; existing completed/running work is reused, so provider operations and analysis records are not duplicated.
- Regular US market sessions only; automatic scans run from 9:35 through 3:55 Eastern and extended hours are out of scope.
- Automatic Swing runs are browser-driven and can be missed when no authenticated Swing Trade tab is open during the ten-minute slot. Best-effort cancellation cannot guarantee that a provider will not finish or bill a request it accepted before the local connection was aborted.
- India Chart-Img macro identifiers are contract-tested but still require an explicitly approved live availability check; India automatic scheduling remains deferred pending a reliable holiday/calendar source.
- Chart-Img v2 currently documents no Volume moving-average input, RSI 50 midline override, or CCI zero-line override; Swing uses only documented provider fields and treats visually unreadable exact volume ratios conservatively.
- The intraday scan watchlist supports at most 20 stocks; the independent Swing watchlist supports at most 100. The app remains single-user.
- Dashboard history intentionally shows only the rolling last 24 hours; permanent scan-graph retention is seven rolling days.
- This tool provides visual technical-analysis assistance, not investment advice, order execution, or guarantees of outcome.
