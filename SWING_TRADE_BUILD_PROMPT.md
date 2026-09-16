# SpecialStock Swing Trade Analyzer — Build Prompt

Copy this entire document into a new Codex chat opened in the SpecialStock repository. Treat it as an implementation request, not as a replacement for `README.md` or `AGENTS.md`. Inspect the repository before editing and preserve all existing product invariants.

## Task

Build an isolated authenticated **Swing Trade** feature under a new `/swing-trade` tab in SpecialStock.

The feature must capture frozen daily Chart-Img charts at approximately 3:50 PM America/New_York, send the exact stored PNGs to `google/gemini-2.5-pro` through the existing OpenRouter path, and display a ranked list of 3-to-21-day LONG, SHORT, and NO_TRADE swing analyses.

Gemini does **not** have independent live market-data, search, or browsing access. Chart-Img is the sole technical evidence supplied to Gemini. Do not fetch structured Alpaca OHLCV for Swing analysis and do not calculate indicators locally. Alpaca may continue to supply the existing exchange calendar only.

The user must also be able to edit the Swing analysis instructions inside the app. Store the prompt below as the initial default editable revision, while keeping the system safety rules, image-only evidence contract, response schema, and runtime metadata immutable.

Implement the feature completely, including migrations, server services, APIs, UI, tests, observability, and README documentation. Do not make live Chart-Img or OpenRouter calls without asking for explicit approval after all mocked validation passes.

## Required repository workflow

1. Read `AGENTS.md` and `README.md` before changing behavior or architecture.
2. Inspect the current scan, Chart-Img artifact, OpenRouter, prompt-revision, scheduler, Settings, Backtesting, database, and E2E patterns before designing new code.
3. Before editing Next.js code, read the relevant guides under `node_modules/next/dist/docs/`.
4. Preserve unrelated user changes and keep `.env.local` and `.data/` private and untouched.
5. Keep the implementation isolated from existing intraday scans and Backtesting.
6. Use pnpm and the committed lockfile. Ask before adding the production XLSX parsing dependency.
7. Add schema changes through a checked-in Drizzle migration with migration tests.
8. Use mocked providers for all routine tests.
9. Finish by running `pnpm validate` and `pnpm test:e2e`.
10. Report what changed, what passed, and any remaining Windows-only or provider-specific uncertainty.

## Product boundaries

- SpecialStock remains private, single-user, local-first, and analysis-only.
- This feature must not place trades or connect to a broker for execution.
- Do not change the existing intraday scan chart layout, scan prompts, scan model, scan scheduler, alerts, theses, evaluations, or Backtesting behavior.
- Swing results must not create scan alerts, replace theses, or create evaluations.
- Manual Swing runs remain available regardless of automatic Swing state.
- The latest updated prompt below supersedes earlier Swing drafts:
  - Use four macro anchors: SPY, QQQ, GLD, and TLT. Do not include USO in v1.
  - Use EMA 8, EMA 20, SMA 50, and SMA 200. The earlier shorthand request for SMA 20 is superseded by the explicit EMA 20 requirement in the updated prompt.
  - Although the editable prompt calls the engine “multi-timeframe,” v1 supplies daily charts only. The model must never imply that it inspected weekly, hourly, or intraday charts.

## User experience

Add a **Swing Trade** link to the authenticated primary navigation and build `/swing-trade` with:

- A separate Swing watchlist import and active-version summary.
- Watchlist version history with restore controls.
- An automatic Swing analysis toggle, default off.
- The next eligible automatic run time and an explicit reminder that the local server and an authenticated tab must remain open.
- A manual **Run now** button.
- Live progress covering macro capture, macro analysis, stock capture, and stock analysis.
- The latest macro regime and per-anchor observations.
- A ranked actionable table.
- Separate NO_TRADE and failed-symbol sections.
- Saved automatic and manual run history.
- A candidate detail view containing the exact verified chart sent to Gemini and complete model audit metadata.
- A dedicated Swing Prompt Studio that edits only Swing instructions.

The ranked table must show:

- Stock name, symbol, and exchange.
- Direction.
- Visually observed price.
- Entry-zone bounds.
- Stop-loss/daily-close invalidation.
- Profit Target 1.
- Optional Profit Target 2.
- Conviction.
- Server-calculated risk-to-reward.
- Server-calculated entry proximity.
- Visual quality.
- Capture time and run type.

Clearly label prices and levels as visually interpreted from a frozen chart, not as broker quotes.

## Watchlist ingestion

The Swing watchlist is independent of the existing 1–20-stock scan watchlist.

Accept `.csv` and `.xlsx` files with case-insensitive required headers:

- `Stock Name`
- `Symbol`
- `Exchange`

Rules:

- Accept 1–20 rows in v1 and preserve uploaded order.
- Limit files to 5 MB.
- Normalize symbols to uppercase.
- Allow valid US ticker dots and dashes.
- Support NASDAQ, NYSE, AMEX, and normalize `NYSE American` to AMEX.
- Reject blank required values, duplicate symbols, invalid tickers, unsupported exchanges, wrong headers, oversized files, and ambiguous populated worksheets.
- Validate the entire file before activation. On any error, keep the previous active version unchanged and report row-specific errors.
- Store immutable watchlist versions and allow a previous version to be restored.
- Do not add a fake `user_id`; the application remains single-user.

Use the existing CSV parsing style where practical. Add a maintained server-only XLSX parser only after explicit dependency approval.

## Dedicated Swing Chart-Img contract

Create a separate Swing chart provider/profile. Do not broaden or mutate the existing intraday `ChartImgProvider` contract.

Every macro and stock chart must use:

- TradingView interval `1D`.
- Trailing 18 calendar months so SMA 200 is warmed and at least 60 recent daily candles are visible.
- Regular session.
- America/New_York timezone.
- Candlesticks, dark theme, regular scale.
- PNG, 1600×1920.
- Approximately 800–900 pixels for the main price pane, leaving readable lower panes.
- Visible legends, study values, latest-price line, OHLC, horizontal/vertical grids, and 16px scale labels.
- Explicit capture metadata stating that the far-right daily candle is open/incomplete for a 3:50 PM run.

The latest updated prompt requires this chart evidence:

### Price-pane overlays

- EMA 8 — distinct color and readable line.
- EMA 20 — distinct color and readable line.
- SMA 50 — distinct color and readable line.
- SMA 200 — distinct color and readable line.
- Bollinger Bands 20/2 — required for the QQQ macro audit; use the same stable layout for all charts.

### Lower panes

- Volume with a 30-session volume moving average and visible latest values if Chart-Img supports those inputs.
- RSI 14 with 30, 50, and 70 reference levels.
- MACD 12/26/9.
- CCI 14 with −100, 0, and +100 reference levels.
- Chaikin Money Flow 21 with a zero reference line.

Do not include the intraday scan’s VWAP, Keltner Channels, or ADX in Swing charts.

Before finalizing the implementation, confirm the exact Chart-Img v2 study names, inputs, and override keys from documentation. If documentation is insufficient, ask for approval for one bounded live Chart-Img configuration test. Lock the verified request body with exact unit tests so provider-layout drift is detectable.

For every capture:

- Validate HTTP status and map authentication, invalid-symbol, quota, rate-limit, transient, timeout, and invalid-image failures.
- Retry at most once for transient network/5xx failures; do not retry authentication, invalid symbol, or quota failures.
- Require `image/png`, exact configured dimensions, nonzero bytes, and a 20 MB maximum.
- Hash the exact bytes with SHA-256.
- Store content-addressably under `.data/swing-chart-artifacts/` using atomic writes.
- Store immutable capture metadata, the Chart-Img request/input hash, byte length, MIME type, dimensions, role, symbol, capture time, range, interval, session, bar status, and study list.
- Recalculate and verify the PNG hash before serving it to the authenticated UI or Gemini.

## Browser-driven scheduling

Use the existing browser-driven, regular-session scheduling philosophy.

- Run one automatic Swing batch at 3:50:10 PM America/New_York on normal sessions.
- On early-close sessions, run ten minutes and ten seconds before the calendar-provided close.
- Use the exchange calendar to skip weekends and holidays.
- Place the Swing scheduler in authenticated app scope so any signed-in SpecialStock tab can lead it.
- Use leader election to prevent multiple tabs from dispatching the same run.
- The local server and an authenticated tab must remain open.
- Permit a scheduled slot for ten minutes, then mark it missed rather than silently backfilling later.
- Snapshot the active watchlist and active prompt revision when the run is claimed.
- Enforce one idempotent automatic run per market session and prevent overlapping Swing runs.
- Use a recoverable server lease so a crashed run can eventually be retried safely.
- Manual runs use a request UUID, create separate history, and never satisfy or replace the automatic slot.

Run sequence:

1. Claim the run and snapshot watchlist/prompt versions.
2. Capture SPY, QQQ, GLD, and TLT concurrently with a maximum Chart-Img concurrency of four.
3. Verify and store all four macro PNGs.
4. Make one Gemini macro request containing all four verified images.
5. Fail the run if any macro image or the macro response is unusable.
6. Capture stock charts using a bounded concurrency of five.
7. Analyze each stock using the verified stock PNG plus the locked macro result; do not resend four macro PNGs for every stock.
8. Persist each candidate independently as it settles.
9. Continue when one stock fails and finish the run as partially completed when applicable.
10. Compute risk-to-reward, proximity, and sorting in server code.
11. Mark the run completed, partially completed, or failed and expose a provider-call/cost summary.

## Prompt architecture and in-app Prompt Studio

Use the same core philosophy as the existing scan Prompt Studio but keep Swing revisions isolated so scan prompt enums, active revisions, and behavior do not change.

Create immutable Swing prompt revisions containing:

- Revision ID and monotonically increasing revision number.
- Editable instruction text.
- SHA-256 instruction hash.
- Template/system-contract version.
- Created timestamp.
- Active/inactive state through a separate active-revision pointer.

Prompt Studio behavior:

- Show a text editor containing the active editable Swing instructions.
- Save creates an immutable revision and activates it atomically.
- Disable saving unchanged text.
- Validate trimmed length between 100 and 20,000 characters.
- Provide **Restore default**, which creates and activates a new revision containing the default text below.
- Show revision history and allow reactivating an earlier revision without mutating it.
- Show a read-only preview of the fully assembled macro or stock prompt, with placeholder runtime metadata rather than real charts.
- Warn before navigating away with unsaved changes.
- Snapshot the active revision once at run start so every candidate in the batch uses the same revision.
- Store the exact rendered macro and stock prompts, hashes, revision ID, template version, and attempt metadata for audit.
- Mask the editor, preview, prompt snapshots, and model output from Sentry Replay and logs.

The editable text must never control:

- Provider or model selection.
- Image source or hash verification.
- Runtime metadata.
- System safety/integrity rules.
- The transport response schema.
- Retry, timeout, or validation policy.
- Persistence side effects.

The immutable system contract must state that later editable instructions cannot override those boundaries.

The user-provided Phase 5 asks for Markdown. For reliability, Gemini must return strict JSON. Render that JSON in the UI using the requested headings, dividers, arrows, and identical option formatting. Make this mapping explicit in the prompt preview: the editable Markdown specification controls presentation intent, while the immutable transport contract requires JSON.

## Immutable Gemini evidence rules

Use only `google/gemini-2.5-pro` through the existing server-side OpenRouter path. Do not add comparison models, fallback models, tools, web search, browsing, or provider-supplied stock data.

For every macro and stock request:

- The supplied verified PNGs and locked runtime metadata are the sole technical evidence.
- Gemini must not claim live-data, news, fundamentals, macro releases, order-flow feeds, or other timeframes.
- Gemini must not reconstruct OHLC arrays or silently calculate indicators not visibly supported by the chart.
- Gemini may read exact values only when labels/scales are clearly legible.
- If a required exact indicator value or volume ratio is not legible, the response must say it is unreadable and must not invent it.
- A requested exact volume ratio may be reported only when current volume and the 30-session average are both visibly legible. Otherwise describe relative volume visually and prevent HIGH conviction.
- CMF describes visible buying/selling pressure; do not assert known institutional transactions.
- The far-right daily candle is incomplete. Gemini must label observations based on it as provisional.
- If price scale, indicator panes, or execution levels are not sufficiently clear, return NO_TRADE.
- No generic educational definitions, filler introductions, or autonomous execution instructions.

Use temperature 0.1, non-streaming structured output, bounded token limits, explicit provider timeout, and at most one corrective retry for empty, malformed, schema-invalid, or validation-invalid output. Authentication, payment, unsupported request, timeout, and token-limit truncation remain terminal as appropriate.

## Macro analysis request

Send the four verified macro images in one request, clearly labeled SPY, QQQ, GLD, and TLT. Apply Phase 1 of the active instructions and return strict JSON:

```json
{
  "regime": "BULLISH_ACCELERATION | BEARISH_REGIME | CHOPPING_RANGE | VOLATILITY_ENVELOPE_SQUEEZE",
  "long_bias": "SUPPORTIVE | NEUTRAL | HOSTILE",
  "short_bias": "SUPPORTIVE | NEUTRAL | HOSTILE",
  "high_beta_long_forbidden": true,
  "summary": "string",
  "anchors": {
    "SPY": { "stance": "BULLISH | BEARISH | NEUTRAL | UNREADABLE", "observation": "string", "visual_quality": "CLEAR | PARTIAL | UNREADABLE" },
    "QQQ": { "stance": "BULLISH | BEARISH | NEUTRAL | UNREADABLE", "observation": "string", "visual_quality": "CLEAR | PARTIAL | UNREADABLE" },
    "GLD": { "stance": "BULLISH | BEARISH | NEUTRAL | UNREADABLE", "observation": "string", "visual_quality": "CLEAR | PARTIAL | UNREADABLE" },
    "TLT": { "stance": "BULLISH | BEARISH | NEUTRAL | UNREADABLE", "observation": "string", "visual_quality": "CLEAR | PARTIAL | UNREADABLE" }
  }
}
```

Reject the macro result when any anchor is UNREADABLE or when the response contradicts the regime rule in the active instructions.

## Stock analysis request and response

For each stock, send:

- One verified daily stock PNG.
- Symbol, exchange, capture time, range, interval, session, open-candle status, prompt revision, and chart hash.
- The locked, already validated macro JSON.
- The active editable instructions.

The provider must execute Phases 2–5 and return strict JSON:

```json
{
  "symbol": "AAPL",
  "direction": "LONG | SHORT | NO_TRADE",
  "observed_price": 123.45,
  "entry_zone_low": 122.0,
  "entry_zone_high": 124.0,
  "stop_loss": 118.5,
  "profit_target_1": 132.0,
  "profit_target_2": 138.0,
  "conviction_level": "HIGH | MEDIUM | LOW",
  "macro_context": "string",
  "structural_setup_and_polarity": "string",
  "core_indicators_and_volume": "string",
  "three_candle_micro_audit": "string",
  "risk_notes": ["string"],
  "visual_quality": "CLEAR | PARTIAL | UNREADABLE",
  "unreadable_fields": ["string"]
}
```

Rules:

- `profit_target_2` may be null.
- NO_TRADE requires all execution prices to be null.
- NO_TRADE may keep an observed price only if it is clearly readable.
- LONG must satisfy `stop_loss < entry_zone_low <= entry_zone_high < profit_target_1`, and Target 2, when present, must exceed Target 1.
- SHORT must satisfy `profit_target_1 < entry_zone_low <= entry_zone_high < stop_loss`, and Target 2, when present, must be below Target 1.
- Directional results require positive finite prices, CLEAR or PARTIAL visual quality, and no required unreadable execution field.
- A response that fails semantic validation gets at most one corrective retry and is never partially displayed.

## Deterministic post-processing

Do not trust Gemini to calculate risk-to-reward or proximity. Calculate both on the server from validated returned prices.

Use conservative entry-boundary risk-to-reward:

- LONG risk = `entry_zone_high - stop_loss`; reward = `profit_target_1 - entry_zone_high`.
- SHORT risk = `stop_loss - entry_zone_low`; reward = `entry_zone_low - profit_target_1`.
- R:R = `reward / risk`, rounded to two decimals.
- Reject a directional result when risk or reward is non-positive.
- A directional result below 1.5 R:R is downgraded to NO_TRADE while preserving its explanation as rejection context.

Entry proximity:

- If observed price is within or on the entry zone, proximity is `0`.
- Otherwise, proximity = `distance to nearest entry boundary / observed price × 100`.
- If observed price is unavailable, proximity is null and the result cannot be actionable.

Sort actionable LONG/SHORT rows by:

1. Proximity ascending.
2. Conviction HIGH, MEDIUM, LOW.
3. R:R descending.
4. Visual quality CLEAR before PARTIAL.
5. Original watchlist order.

Keep NO_TRADE and failed symbols outside the actionable ranking.

## Default editable Swing instructions

Seed revision 1 with the following text exactly. Preserve paragraph breaks and Markdown. The immutable transport contract described above takes precedence only for JSON transport, evidence integrity, and safety.

```markdown
You are a deterministic, multi-timeframe quantitative technical analysis engine executing a strict structural audit on daily asset charts to identify high-certainty swing trade candidates (3-to-21 day holding horizons). 

CRITICAL COUNTER-BIAS REQUIREMENT: You must explicitly suppress the natural tendency to follow generic macro hype or recent trend lines. Do not let the immediate directional bias of the last few candles dictate your output. You must internally weigh the geometric intersections of the entire chart matrix, volume physics, moving averages, polarity flips, and global multi-asset indicator confluences before deciding. Every trade recommendation must be mathematically justified. If you default to a generic trend-following projection without verifying hidden support structures, line intersections, and indicator confluences, the evaluation is structurally invalid.

Follow this 5-Phase analytical framework sequentially before outputting a trade blueprint.

PHASE 1: THE GLOBAL MACRO MATRIX (INTER-MARKET CONFLUENCE)
Before auditing an individual stock ticker, you must ingest and calculate the daily structural health of the following four primary global macro anchors to establish your structural market regime bias (BULLISH ACCELERATION, BEARISH REGIME, CHOPPING RANGE, or VOLATILITY ENVELOPE SQUEEZE):
1. SPY (S&P 500 ETF): Assess structural location relative to the 50-day and 200-day Simple Moving Averages (SMA). Is the index printing sequential higher-lows or exhibiting head-and-shoulders distribution?
2. QQQ (Nasdaq 100 ETF): Measure growth momentum, tech multiple expansions, and outer Bollinger Band extensions.
3. GLD (Gold Trust): Map inflation hedging, global geopolitical friction, and safety-haven capital flows.
4. TLT (20+ Year Treasury Bond ETF): Quantify interest rate and macro yield environments. (A declining TLT indicates soaring yields, which places immediate compression pressure on high-multiple growth equities).
*REGIME RULE:* If QQQ and SPY are actively breaking below their daily 50-day SMAs while TLT is cascading lower, you are forbidden from issuing high-beta growth longs. You must favor defensive shorts or absolute value pivots.

PHASE 2: INDIVIDUAL STRUCTURAL GEOMETRY & POLARITY AUDIT
Audit the target asset’s daily chart for clear geometric patterns over a 60-day window:
- Identify dominant structures: Ascending/Descending Triangles, Horizontal Ranges, Flags, Symmetrical Triangles, Double Tops/Bottoms, or Bull/Bear Channels.
- Identify Historical Polarity Zones: Scan the chart left-to-right for prominent "Role-Reversal" levels where a major historical resistance line, range ceiling, or triangle boundary has been broken to the upside. Explicitly note if the asset is currently returning to test that broken ceiling from above to validate it as a newly established support floor.
- Locate the asset's exact price coordinate relative to key moving average lines: 8 EMA (momentum tracking), 20 EMA (mean inversion), 50 SMA (intermediate structural support), and 200 SMA (macro regime line).

PHASE 3: LOWER TECHNICAL INDICATORS, MOMENTUM, & MICRO-PHYSICS
Deeply analyze the visible technical panels and the immediate 3-candle execution window:
- Volume Profile & Volume Ratio: Calculate the breakout candle's volume relative to the 30-day trailing average. Breakouts on volume ratios below 1.5x must be classified as low-certainty traps.
- MACD (12, 26, 9): Check for signal line crossovers, centerline rejections, and histogram momentum acceleration. 
- RSI (14) & CCI (14): Identify overbought/oversold extremes (>70 or <30), midline rejections, and hidden structural divergences against price action.
- Chaikin Money Flow (CMF - 21): Evaluate institutional accumulation vs. distribution pressure relative to the zero line.
- The 3-Candle Micro-Audit: Compare the real-body sizes of the last 3 candles. Is velocity expanding or contracting? Note precise wick rejections (tails). Check if this micro-price coordinate matches the exact location of a previously broken resistance line. Look for a wick rejection spiking directly into that old line to confirm institutional defense of the structural flip. (Note: The last candle on the far right may be unclosed).

PHASE 4: CONFLICT RESOLUTION & HIERARCHY
Eliminate trend-following bias by weighting signals systematically using this strict rule:
- Dominant Weight: Horizontal Price Action Structural Breakout/Retest + Polarity Floors (Resistance-turned-Support) + Volume Ratio > 1.5x + Macro Confluence (Phase 1).
- Secondary Weight: Institutional Flow (CMF) + Moving Average alignment.
- Confirmation Weight: Momentum Oscillators (MACD/RSI/CCI).
*RESOLUTION RULE:* If a stock looks like a bullish breakout but QQQ/SPY are breaking down, TLT is plunging, and CMF shows a negative distribution divergence, you must classify the setup as NO_TRADE or evaluate it as a structural fade/short. 
*POLARITY EXCEPTION:* If a sharp red candle flushes down but lands directly on a heavy historical resistance-turned-support floor on decreasing volume while macro regimes are stable, prioritize the structural floor over the short-term negative momentum.

PHASE 5: OUTPUT SPECIFICATION
If a candidate meets all high-probability criteria, you must output a structured Markdown text blueprint containing exactly these parameters. Do not output generic definitions or conversational introductory filler. Use visual dividers between sections. Format each option identically. Lead directly with the asset status:

### 📌 [TICKER]: [LONG / SHORT / NO_TRADE]

➡️ **Macro Context Justification:** 
[The concise, highly detailed synthesis of SPY, QQQ, GLD, and TLT alignment mapping the active structural regime]

➡️ **Structural Setup & Polarity Description:** 
[Description of pattern geometry, e.g., Daily Symmetrical Triangle Breakout, and explicit tracking of any resistance-turned-support line flips]

➡️ **Core Indicators & Volume Ratio:** 
[Exact metrics, data points, CMF values, MACD status, and the 3-candle micro-audit physics verifying institutional footprint]

➡️ **Precise Execution Parameters:**
*   **Entry Zone:** [Strict price boundary bracket for execution]
*   **Stop-Loss Protection:** [Hard daily candle body close invalidation price]
*   **Profit Target 1 (T1):** [Immediate structural resistance or polarity layer]
*   **Profit Target 2 (T2):** [Extended mathematical Fibonacci or historical extension goal]
*   **Mathematical Risk-to-Reward (R:R):** [Calculated technical efficiency ratio of the setup]
```

## Persistence and API design

Add isolated PGlite/Drizzle models for:

- Swing settings and automatic toggle.
- Watchlist versions and ordered entries.
- Prompt revisions and active prompt pointer.
- Swing runs, status, mode, session date, idempotency key, lease, captured watchlist/prompt versions, macro result, costs, and errors.
- Swing chart artifacts with role `macro` or `candidate`.
- Candidate results and deterministic post-processing fields.
- Swing model runs and attempts, including prompt snapshot/hash, image hashes, requested/actual model/provider, request settings, latency, queue time, usage, cost, response, failure kind, and retry state.

Use foreign keys and indexes for run history, session idempotency, artifact lookup, prompt history, and candidate ordering. Keep existing scan tables unchanged.

Add authenticated routes for:

- Swing state and settings.
- Watchlist upload, history, and activation.
- Prompt preview, revision creation, history, activation, and default restore.
- Manual and scheduled run creation.
- Run progress.
- Run history and individual run retrieval.
- Hash-verified Swing chart image and metadata serving.

Use stable versioned TypeScript types for watchlists, prompts, macro results, candidates, runs, progress, provider attempts, and API payloads.

## Audit and observability

The candidate detail page must prove exactly what Gemini saw:

- Exact stored PNG.
- Current recomputed SHA-256 and verification state.
- Frozen Chart-Img input metadata and input hash.
- Prompt revision and exact rendered prompt hash.
- Macro result used for the stock analysis.
- Model/provider, inference settings, attempts, latency, token usage, and cost.
- Original validated JSON and rendered blueprint.

Add sanitized Sentry spans/logs for watchlist import, prompt revisions, scheduler leadership, batch/run stages, Chart-Img capture, artifact verification, macro analysis, candidate analysis, progress, retries, and final outcome.

Never send credentials, cookies, uploaded file contents, full symbol lists, PNG bytes, rendered prompts, customized instructions, model responses, or candidate narratives to Sentry. Mask Swing upload, Prompt Studio, charts, and results from Replay.

## Failure behavior

- No active watchlist: disable automatic runs and explain why.
- No Chart-Img or OpenRouter key: show unavailable state without exposing configuration values.
- Macro capture/analysis failure: fail the run; do not analyze candidates without macro context.
- Individual invalid symbol/capture/model failure: record a failed row and continue.
- Chart hash mismatch: refuse to serve or analyze the artifact and mark an integrity failure.
- Quota/payment/authentication errors: terminal, clearly classified, and never retried blindly.
- Transient provider errors: one bounded retry.
- Prompt/schema validation errors: one corrective retry when safe.
- Expired lease: permit safe reclaim without creating a duplicate scheduled run.
- Preserve the last completed run when a newer run fails.

## Tests and acceptance criteria

### Unit tests

- CSV/XLSX header normalization, row validation, duplicate detection, exchange aliases, file/row limits, atomic activation, version restore.
- Swing Chart-Img body uses `1D`, correct range, dimensions, studies, parameters, visual overrides, and open-candle metadata.
- Existing intraday Chart-Img body remains byte-for-byte behaviorally unchanged.
- Artifact atomic storage, hash verification, and tamper rejection.
- Default prompt seeding, immutable revisions, active-pointer changes, restore default, unchanged-text rejection, prompt preview, and batch snapshotting.
- Macro/stock prompt assembly includes only allowed metadata and exact image hashes.
- Strict JSON schema and semantic validation for LONG, SHORT, NO_TRADE, unreadable evidence, invalid targets, and corrective retries.
- R:R calculations, 1.5 minimum downgrade, proximity, and stable sorting.
- DST-safe 3:50 scheduling, early closes, holidays, slot expiry, idempotency, leader election, and lease recovery.
- Macro failure, partial candidate failure, and last-good-run preservation.

### Integration tests

- Mock four successful macro captures and one macro Gemini response.
- Mock a mixed stock batch with LONG, SHORT, NO_TRADE, invalid symbol, and transient provider failure.
- Verify exact artifacts, prompt/model audit records, cost totals, progress, final status, and sorted output.
- Verify no scan alerts, theses, evaluations, outcomes, or existing scan records are created.
- Verify authenticated artifact access and unauthenticated rejection.

### Browser tests

- Import and activate a watchlist.
- Restore a previous watchlist version.
- Edit Swing instructions, preview the assembled prompt, save a revision, reactivate history, and restore default.
- Start a mocked manual run and observe progress.
- Review macro regime, ranked candidates, NO_TRADE, and failed symbols.
- Open a candidate and verify its exact chart/audit panel.
- Load saved history.
- Verify responsive behavior at desktop and mobile widths.
- Verify existing Dashboard, scans, Settings, and Backtesting flows remain functional.

## Completion definition

The work is complete only when:

- The full Swing workflow works with mocked providers.
- Prompt editing is versioned, auditable, previewable, and isolated from scan prompts.
- Every model judgment is tied to hash-verified stored images and an immutable prompt snapshot.
- Automatic and manual runs are duplicate-safe and recover from partial failures.
- The requested blueprint is rendered consistently from validated JSON.
- Existing product invariants and tests remain intact.
- `pnpm validate` and `pnpm test:e2e` pass.
- `README.md` accurately documents Swing behavior, the chart contract, browser scheduling, provider usage/costs, prompt customization, local storage, and analysis-only limitations.
- No live provider call has been made without explicit user approval.

