# SpecialStock — Historical Product and Implementation Plan

> **ARCHIVED — DO NOT IMPLEMENT FROM THIS FILE.** The Chart-Img + Gemini-only application supersedes the local indicator calculation, deterministic renderer, numeric model companion, multi-model comparison, and fallback sections below. `README.md` and `AGENTS.md` are the current sources of truth. This file remains only as historical product context.

Last updated: 2026-08-28

This file is not an implementation source of truth and should not be used to direct new Codex tasks.

## 1. Product goal

Build a private web app that continuously reviews technical charts for a small stock watchlist and helps one trader identify or reject short-horizon opportunities.

The app should reproduce the useful part of the current workflow:

1. Market data creates a familiar technical chart.
2. An image-capable AI model reviews the chart structure.
3. The app reports `Bullish`, `Bearish`, or `No trade`, with technical evidence, conflicts, targets, and invalidation.
4. High-quality material changes can create browser alerts.
5. Subsequent price action is measured so model quality can be evaluated rather than assumed.

The primary analysis horizon is the next 15–30 minutes. The product is an analysis assistant, not an execution system or autonomous trader.

## 2. Initial user and scope

- Private, single-user application for the user's sister.
- Regular US market session only: 9:30 AM–4:00 PM America/New_York.
- Initial watchlist: `AAPL`, `MSFT`, `NVDA`, `AMZN`, `GOOGL`.
- The five symbols should be editable in settings, with a five-symbol limit for the first release.
- Weekly options trading is part of the user's private workflow but is outside the app.
- Initial release performs continuous AI discovery. It does not ingest or recreate her thinkScript alerts.

## 3. Explicit non-goals

Do not include:

- Options contracts, strikes, expirations, delta, premiums, or Greeks.
- Position sizing, entries, order types, stop orders, execution, or brokerage trading.
- Automated trading or order submission.
- Claims of guaranteed accuracy, profitability, or a predicted win probability.
- News, fundamentals, sentiment, or social feeds in the initial release.
- thinkScript ingestion or integration in the initial release.
- A 25-stock scanner in the initial release.
- Autonomous cloud scanning while the browser is closed on Vercel Hobby.

Technical price targets and thesis invalidation levels are in scope because they describe the chart thesis, not trade mechanics.

## 4. Core user experience

### Live dashboard

Show one card per symbol with:

- Current price and data timestamp.
- Data quality/source badge, initially `Alpaca IEX`.
- Last completed scan and next scheduled scan.
- Current AI verdict: `Bullish`, `Bearish`, or `No trade`.
- Conviction: `Low`, `Medium`, or `High`; this is qualitative, not a probability.
- Short technical summary.
- Primary target and invalidation, when applicable.
- Active model used.
- Link to the full symbol analysis.

### Symbol detail

Show:

- The exact composite chart submitted to the model.
- Exact OHLCV and indicator snapshot supplied alongside the image.
- Candlestick, volume, VWAP/Keltner, momentum, and relative-velocity analysis.
- Supporting and conflicting evidence.
- Immediate bias, broader trend, support/resistance, target, deeper scenario, and invalidation.
- Whether the current 5-minute bar was open or closed.
- Model, prompt version, renderer version, latency, tokens, and cost.
- Prior analyses and their measured outcomes.

### Alert inbox

Show material thesis events, not every model response. Examples:

- `No trade` becomes high-conviction `Bullish` or `Bearish`.
- Direction changes.
- Target or invalidation changes materially.
- A thesis becomes invalidated.

### Settings

Include:

- Five-symbol watchlist editor.
- AI model picker.
- Optional silent comparison model picker.
- Browser-notification permission and test action.
- Approximate AI spend today and this month.
- Active data provider and connection status.

## 5. AI model strategy

### Default and model catalog

Start with this allowlisted catalog:

| Display name | OpenRouter slug | Intended role |
| --- | --- | --- |
| GPT-5.6 Luna | `openai/gpt-5.6-luna` | Initial default; price/speed/quality balance |
| Gemini 3.7 Flash | `google/gemini-3.7-flash` | Primary accuracy challenger and fallback |
| MiMo V2.5 | `xiaomi/mimo-v2.5` | Budget challenger; requires stricter application validation |
| Gemini 3.1 Flash Lite | `google/gemini-3.1-flash-lite` | Low-latency extraction-oriented challenger |

Before exposing a model, validate its current availability and required capabilities through OpenRouter. Disable unavailable or incompatible models cleanly. Do not depend on a `latest` alias because an unannounced model change would make evaluations irreproducible.

### Model picker behavior

- The settings page lets the user choose one active model.
- A changed selection applies to subsequent scans; it does not rewrite previous results.
- Every model run stores the exact requested model slug and actual returned model/provider metadata when available.
- The UI shows the active model on every result.
- Model-specific settings are controlled by the application, not exposed as a confusing set of advanced controls initially.
- Default reasoning level: low.
- Low/near-zero temperature.
- Keep the visible answer concise; target roughly 400–600 output tokens maximum.

### Silent comparison mode

- Optional and off by default after the initial evaluation period.
- Allows one challenger to analyze the same frozen chart and numeric snapshot.
- Challenger output is stored for evaluation but cannot create a second user alert.
- Primary and challenger outcomes are scored independently.
- Clearly show the extra estimated and actual cost.
- Use this for a limited bake-off, not permanently unless it provides measurable value.

### Failover

- Retry one malformed or transiently failed request.
- If the active model is unavailable, optionally use the configured fallback model.
- Record that failover explicitly; never label fallback output as though the selected model produced it.
- Fail closed: invalid, contradictory, stale, or unparseable output creates no notification.

### Inputs to the model

Each request must contain both:

1. The deterministic composite chart image.
2. A machine-readable snapshot containing exact timestamps, OHLCV, indicator values/slopes, visible price range, session state, and open/closed-bar status.

The image preserves visual pattern recognition. The numeric snapshot prevents OCR errors on small labels and grounds exact price levels. The model should synthesize technicals, not recalculate indicators from pixels.

### Required output schema

Validate a structured response containing at least:

- `verdict`: `bullish | bearish | no_trade`
- `bar_status`: `open | closed`
- `setup_type`
- `immediate_bias`
- `broader_trend`
- `conviction`: `low | medium | high`
- `candlestick_analysis`
- `volume_analysis`
- `vwap_keltner_analysis`
- `momentum_analysis`
- `relative_velocity_analysis`
- `supporting_evidence[]`
- `conflicting_evidence[]`
- `support_levels[]`
- `resistance_levels[]`
- `primary_target`
- `deeper_scenario`
- `invalidation_level`
- `data_quality_flags[]`
- `summary`

For providers that cannot enforce a JSON schema, use application-level parsing and validation. Suppress invalid output rather than improvising missing fields.

### Prompt behavior

The prompt should operationalize the user's current question:

> Evaluate this chart structure using candlestick behavior, volume, VWAP/Keltner structure, momentum indicators, and relative velocity. What is the most likely next 15–30 minute technical move?

Additional guardrails:

- Consider all supplied timeframes and indicators; do not manufacture agreement.
- Prefer `No trade` when the evidence conflicts or the expected move is not technically clear.
- Separate observed chart evidence from inference.
- Treat an active candle as incomplete and explicitly say so.
- Do not claim that CMF or volume proves institutional buying/selling.
- Avoid claims such as compression “always” causing a move.
- Do not provide options or trade mechanics.
- Do not invent levels outside the supplied visible/numeric price context.
- Do not express conviction as a statistical probability.

## 6. Market data architecture

### Provider abstraction

Define an internal `MarketDataProvider` interface so the analysis pipeline does not depend on Alpaca-specific response shapes. It should support:

- Historical bars for a symbol/time range.
- Latest bars/quotes needed for scan freshness.
- Market-calendar/session information where available.
- Provider identity and data-quality metadata.

Implementations:

1. `AlpacaMarketDataProvider` for the prototype.
2. `SchwabMarketDataProvider` later, without changing indicator, chart, AI, or evaluation code.

### Prototype data source

- Use the free Alpaca plan and its IEX stock feed.
- Treat IEX as prototype-quality partial-market data.
- Always display the feed source because its candles, volume, VWAP, and CMF can differ from thinkorswim/consolidated data.
- Do not use prototype outcome results to claim Schwab/thinkorswim production accuracy.

### REST versus WebSocket

Use batched server-side REST retrieval for the initial Vercel deployment:

- The app analyzes at fixed points in a 5-minute cycle, not at tick frequency.
- A durable market WebSocket does not fit naturally inside short-lived Vercel Hobby functions.
- Never put Alpaca or Schwab secrets in the browser.
- Keep the provider interface compatible with a future persistent worker/WebSocket collector if autonomous or tick-level collection becomes necessary.

## 7. Scheduling and deployment constraints

- Deploy the UI and server functions to Vercel Hobby for the prototype.
- Scanning operates only while an authenticated browser tab is open.
- The browser schedules scan requests; the server performs all secret-bearing provider and AI work.
- Scan each stock approximately three minutes into every 5-minute candle and shortly after each 5-minute close.
- Restrict scans to regular market hours in `America/New_York`.
- Use database uniqueness/idempotency keys so refreshes, retries, or multiple tabs cannot duplicate a symbol/scan-slot/model run.
- Send one server request per stock so five scans can run independently/concurrently and one slow model response does not fail all symbols.
- Give each OpenRouter call an application timeout below Vercel's function limit.
- Browser sleep, a closed tab, or lost connectivity means scans are missed; make that visible in the UI.
- Vercel Pro or a separate persistent worker is a later upgrade only if scanning must continue without an open browser.

## 8. Bar processing and indicators

- Normalize source data to 1-minute bars where available.
- Derive 5-minute and 15-minute bars deterministically.
- Retrieve daily bars separately.
- Use exchange/session boundaries in `America/New_York`; test daylight-saving transitions, holidays, early closes, and missing bars.
- Do not mix premarket or after-hours bars into regular-session VWAP in the initial release.

Initial indicator definitions should match the sister's current chart/script as closely as data allows:

- Session VWAP.
- Keltner Channels: length 20, multiplier 2.0.
- Volume average: 30.
- ADX: 10, Wilder smoothing.
- RSI: 14, Wilder smoothing.
- MACD: 12/26/9 EMA.
- CCI: 14.
- Chaikin Money Flow: 21.

Also compute deterministic slopes/changes used to ground “relative velocity,” including recent price slope, candle-body expansion, volume change, and indicator momentum. Do not present these as physical velocity or causal proof.

## 9. Composite chart generation

Generate a deterministic chart for every analysis so historical runs can be reproduced:

- 5-minute panel: approximately two sessions, candles, VWAP, Keltner, volume, and all lower indicators.
- 15-minute panel: approximately ten sessions with candles, VWAP/Keltner, volume, and compact indicator state.
- Daily panel: approximately six months with candles and volume for broader structure/support/resistance.
- Clearly label symbol, timeframe, time zone, data source, last bar time, and whether the last 5-minute candle is active or closed.
- Render server-side SVG and rasterize to a consistently sized PNG/WebP suitable for model vision.
- Record renderer version, dimensions, and image hash.
- Keep the numeric snapshot and chart generated from the exact same frozen data.

## 10. Alerts and thesis lifecycle

Desired behavior is selective—roughly 3–8 useful alerts per day across the watchlist—but do not force alert frequency.

Notify only when:

- The result is valid and fresh.
- Conviction is high.
- A new directional thesis begins, direction changes, or another configured material lifecycle event occurs.
- The thesis is meaningfully different from the last notified state.

Use a 30-minute same-thesis notification cooldown unless direction changes or the thesis becomes invalidated. `No trade` results should normally remain visible without generating browser notifications.

The application must track a thesis as a stateful lifecycle rather than treating every scan as a new alert.

## 11. Outcome evaluation

Evaluate chart-analysis claims, not trading profitability.

For each directional thesis:

- Track whether the primary target or invalidation level is touched first during the 15–30 minute horizon.
- If neither is touched, mark it `expired`.
- If both occur in the same 1-minute bar and tick ordering is unavailable, mark it `ambiguous`.
- Track stale/missing data separately.
- Do not convert these results into a promised win probability.

Compare models using:

- Target-before-invalidation rate.
- Invalidation-before-target rate.
- Expired and ambiguous rates.
- Quality of `No trade` filtering.
- Invalid/hallucinated level rate.
- Unsupported-claim rate based on review.
- Structured-output failure rate.
- Median and tail latency.
- Average cost per analysis and per useful alert.
- Agreement/disagreement with the sister's reviewed assessment.

Start with a silent three-session model bake-off using Luna as primary and Gemini 3.7 Flash as challenger. The final default should be chosen from app-specific evidence, not general model rankings.

## 12. Suggested technical stack

- Next.js App Router and TypeScript.
- Tailwind CSS.
- Server-side route handlers/functions for market data, chart generation, OpenRouter, and persistence.
- Managed Postgres, initially Neon free tier.
- Drizzle ORM/migrations.
- Auth.js credentials flow or an equivalently small server-side shared-password implementation.
- Deterministic SVG chart renderer plus `sharp` for rasterization.
- Runtime schema validation, e.g. Zod.
- Vitest for unit/integration tests.
- Playwright for critical browser flows.

Production dependencies must be approved before installation, per repository working instructions.

## 13. Data model outline

Keep the schema focused but preserve reproducibility:

- `app_settings`: watchlist, active model, fallback/comparison model, notification settings.
- `market_bars`: normalized OHLCV, timeframe, provider, session, timestamp.
- `scan_slots`: scheduled slot, symbol, status, idempotency key, freshness metadata.
- `indicator_snapshots`: exact calculated values and versions.
- `chart_artifacts`: renderer version, hash, storage reference/bytes metadata.
- `model_runs`: requested/actual model, provider, prompt version, input hash, latency, tokens, cost, raw/validated status, failover metadata.
- `analyses`: validated technical-analysis fields.
- `theses`: normalized direction, target, invalidation, lifecycle state.
- `notification_events`: reason, delivery state, cooldown linkage.
- `outcomes`: target/invalidation/expired/ambiguous result and timestamps.
- `review_labels`: optional sister assessment and notes for model comparison.

Retain detailed run data for approximately 90 days initially. Avoid storing duplicate chart images where identical hashes can be referenced.

## 14. Security and privacy

- Keep `OPENROUTER_API_KEY`, Alpaca credentials, future Schwab OAuth credentials, database credentials, and auth secrets server-side only.
- Never expose provider credentials in client bundles, logs, screenshots, or model prompts.
- Use environment variables locally and Vercel encrypted environment configuration when deployed.
- A Schwab integration will require a proper OAuth flow and token refresh handling, not merely a text field for an API key.
- Protect all app routes and scan endpoints with the shared authentication/session.
- Rate-limit or idempotently guard scan endpoints.
- Send only chart/market data and technical instructions to OpenRouter—no brokerage credentials or account data.

## 15. Failure and data-quality behavior

- Missing, delayed, partial, or out-of-session data must be visible.
- Do not alert on stale data.
- Do not silently fill missing bars in a way that changes indicators.
- If chart and numeric snapshot hashes do not refer to the same frozen dataset, abort the analysis.
- Validate model-generated levels against the supplied/visible price domain and logical direction.
- Reject internally contradictory outputs, such as a bullish target below price without an explicitly defined retracement scenario.
- Preserve the last valid analysis while showing that a newer scan failed.

## 16. Implementation sequence

### Phase 1 — Foundation

- Scaffold the approved Next.js/TypeScript stack.
- Add environment validation, shared-password authentication, database schema/migrations, and basic protected layout.
- Implement watchlist and model settings, including model availability validation.

### Phase 2 — Market data and calculations

- Implement the provider interface and Alpaca adapter.
- Normalize/aggregate bars and handle session boundaries.
- Implement and unit-test all indicators against known fixtures/reference calculations.
- Add freshness and data-quality states.

### Phase 3 — Chart and AI pipeline

- Build the deterministic composite chart and numeric snapshot.
- Add OpenRouter client, strict schema, prompt versioning, retry/failover, cost capture, and model picker integration.
- Store complete reproducibility metadata.
- Add model comparison mode.

### Phase 4 — Live workflow

- Build browser-driven scheduler with server-side idempotency.
- Build dashboard, symbol detail, scan status, alert inbox, and browser notifications.
- Implement thesis lifecycle and material-change suppression.

### Phase 5 — Evaluation

- Implement target/invalidation outcome tracking and review labels.
- Build model/cost/latency comparison views.
- Run three silent sessions before enabling notifications.

### Phase 6 — Deployment and pilot

- Deploy to Vercel Hobby and Neon.
- Verify behavior across tab refreshes, duplicate tabs, sleep/wake, provider failures, and market-calendar edge cases.
- Run a 1–2 week high-conviction pilot.
- Later, implement Schwab behind the same provider interface and compare Alpaca versus Schwab data in shadow mode for at least five sessions before switching.

## 17. Validation requirements

At minimum, test:

- 1m→5m/15m aggregation, including missing bars.
- Session VWAP reset and all indicator formulas.
- America/New_York DST, holidays, early close, and session boundaries.
- Scan-slot uniqueness across refreshes, retries, and multiple tabs.
- Model-picker changes applying only to future scans.
- Primary/challenger runs sharing the same frozen input.
- Malformed schema, invalid levels, timeout, retry, and model failover.
- Stale data suppressing notifications.
- Thesis lifecycle, cooldown, direction changes, and invalidation.
- Target-before-invalidation, expired, and same-bar ambiguous outcomes.
- Deterministic chart image hashes for identical input/version.
- Authentication and secret non-exposure.
- End-to-end: login → scheduled scan → analysis → dashboard → notification/inbox → measured outcome.

## 18. Initial-release acceptance criteria

The first release is ready for silent testing when:

- The authenticated app can continuously scan all five symbols while its browser tab remains open.
- A scan executes at the intended mid-bar and post-close slots without duplication.
- Each analysis uses a deterministic chart plus exact numeric snapshot.
- The model picker reliably changes the model used for subsequent scans.
- Luna and one silent challenger can be compared on identical stored inputs.
- Every result records source, timestamps, model, prompt, chart hash, latency, token usage, and cost.
- Invalid/stale analyses fail closed and never notify.
- Technical results contain no options or execution mechanics.
- Historical targets/invalidation outcomes are measurable.
- Relevant automated tests and a production build pass.

## 19. Known product risks

- AI chart explanations can sound persuasive while being technically unsupported. Guardrails and outcome measurement are essential.
- Alpaca IEX data will not perfectly match thinkorswim; this prototype establishes workflow viability, not final data parity.
- Browser-driven scheduling is inexpensive but not autonomous or perfectly reliable.
- Model quality, pricing, and availability change; model selection and stored provenance must remain configurable.
- “Win ratio” based only on fired alerts can hide missed opportunities and selection bias. Track `No trade` decisions and expired/ambiguous outcomes as well.

## 20. Deferred decisions

These do not block the prototype:

- Exact Schwab API/OAuth application configuration.
- Whether autonomous scanning justifies Vercel Pro or a persistent worker.
- Whether thinkScript alert review should become a later secondary workflow.
- Whether the universe should expand beyond five symbols after data and AI costs are understood.
