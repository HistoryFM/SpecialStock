import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const mockPort = 3199;
const runRoot = mkdtempSync(join(tmpdir(), "specialstock-e2e-"));
const databasePath = join(runRoot, "database");
const artifactPath = join(runRoot, "charts");
const swingArtifactPath = join(runRoot, "swing-charts");
const sendSentryTelemetry = process.env.SPECIALSTOCK_E2E_SENTRY === "1";
const retryFirstCompact = process.env.SPECIALSTOCK_E2E_RETRY_ONCE === "1";
const testEnv = {
  ...process.env,
  SPECIALSTOCK_E2E_ISOLATED: "1",
  SENTRY_AUTH_TOKEN: "",
  ...(sendSentryTelemetry ? {} : { SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "" }),
  LOCAL_DATABASE_PATH: databasePath,
  CHART_ARTIFACT_DIR: artifactPath,
  SWING_CHART_ARTIFACT_DIR: swingArtifactPath,
};
const chart = await sharp({
  create: { width: 1600, height: 1920, channels: 3, background: "#10131a" },
}).png().toBuffer();

const compactAnalysis = { p: 100, v: "bullish", c: "high", t: 104, i: 97, q: "clear" };
const bearishCompactAnalysis = { p: 100, v: "bearish", c: "medium", t: 96, i: 103, q: "clear" };
const ineligibleCompactAnalysis = { p: 100, v: "no_trade", c: "low", t: null, i: null, q: "partial" };
const fullAnalysis = {
  phase1: "Recent visible candles form higher lows above VWAP.",
  phase2: "ADX rising; RSI above midpoint; MACD positive; CCI and CMF above zero.",
  phase3: "Three small candles with stable volume above VWAP.",
  phase4: "Price and volume align. The locked bullish verdict follows. Watch for a fresh scan near VWAP.",
  summary: "Bullish visual thesis with high conviction.",
};
const providerCalls = { chart: 0, compact: 0, full: 0, swingChart: 0, swingMacro: 0, swingStock: 0 };
const swingStockAttempts = new Map();
const chartRequests = [];
const providerConcurrency = {
  chart: { active: 0, maximum: 0 },
  compact: { active: 0, maximum: 0 },
  full: { active: 0, maximum: 0 },
};

function beginProviderRequest(phase) {
  providerConcurrency[phase].active += 1;
  providerConcurrency[phase].maximum = Math.max(
    providerConcurrency[phase].maximum,
    providerConcurrency[phase].active,
  );
}

function endProviderRequest(phase) {
  providerConcurrency[phase].active -= 1;
}

const providerDelay = () => new Promise((resolve) => setTimeout(resolve, 400));

const mockServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const requestBytes = Buffer.concat(chunks);
  if (request.url === "/chart" && request.method === "POST") {
    const requestBody = JSON.parse(requestBytes.toString("utf8"));
    if (requestBody.interval === "1D") providerCalls.swingChart += 1;
    else providerCalls.chart += 1;
    chartRequests.push({ symbol: requestBody.symbol, interval: requestBody.interval });
    beginProviderRequest("chart");
    await providerDelay();
    if (requestBody.symbol === "NASDAQ:AMZN") {
      response.writeHead(422, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Synthetic per-symbol chart failure." }));
      endProviderRequest("chart");
      return;
    }
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(chart);
    endProviderRequest("chart");
    return;
  }
  if (request.url === "/openrouter" && request.method === "POST") {
    const requestBody = JSON.parse(requestBytes.toString("utf8"));
    const backtestSystem = requestBody.messages?.[0]?.content;
    const backtestPhase = requestBody.response_format?.type === "json_object" && typeof backtestSystem === "string"
      ? backtestSystem.includes("You interpret historical daily-close portfolio strategies") ? "backtest_strategy"
        : backtestSystem.includes("Choose only supported report controls") ? "backtest_report"
          : backtestSystem.includes("A suggested plan") ? "backtest_analysis" : null : null;
    if (backtestPhase) {
      const approvedModels = ["google/gemini-2.5-pro", "openai/gpt-5.6-sol", "anthropic/claude-opus-5"];
      if (!approvedModels.includes(requestBody.model) || requestBody.response_format?.type !== "json_object" || requestBody.provider?.require_parameters !== true ||
        (requestBody.model !== "google/gemini-2.5-pro" && requestBody.reasoning?.effort !== "high")) {
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Backtesting model or reasoning settings did not match." }));
        return;
      }
      const atom = (relation) => ({ kind: "price_sma", ticker: "TQQQ", period: 50, bandPct: 0, relation });
      const plan = { version: 2, settings: { startingCapital: 1000, cashRate: 2.5, borrowRate: 0, slippage: 0, fee: 0, startDate: "first_january" },
        states: [{ id: "long", label: "Long TQQQ", allocations: [{ ticker: "TQQQ", side: "long", percent: 100 }] }],
        transitions: [{ from: "cash", to: "long", when: { any: [[atom("crosses_above")]] } }, { from: "long", to: "cash", when: { any: [[atom("crosses_below")]] } }], stops: [], assumptions: ["No 200-day SMA filter."] };
      const variant = { ...plan, transitions: [{ ...plan.transitions[0], when: { any: [[atom("crosses_above"), { kind: "rsi", ticker: "TQQQ", period: 14, threshold: 30, relation: "below" }]] } }, plan.transitions[1]] };
      const content = backtestPhase === "backtest_strategy" ? { clarification: "", plan }
        : backtestPhase === "backtest_report" ? { visibleSeries: ["Strategy", "QQQ"], sections: ["drawdown", "growth", "trades"], closeTickers: ["TQQQ", "SPY", "QQQ"], range: "last_year" }
          : { summary: "The strategy is sensitive to whipsaws and should be judged against the price-return benchmarks.", riskNotes: ["Maximum drawdown is measured over the full period."],
            suggestions: [{ title: "Add RSI filter", reason: "Test whether requiring RSI below 30 changes drawdown.", plan: variant }] };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: `e2e-${backtestPhase}`, model: requestBody.model,
        choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 300, completion_tokens: 200, cost: 0.01 } }));
      return;
    }
    const responseName = requestBody.response_format?.json_schema?.name;
    if (responseName === "swing_macro" || responseName === "swing_candidate") {
      const content = requestBody.messages?.[0]?.content ?? [];
      const images = content.filter((part) => part.type === "image_url");
      const expectedImage = `data:image/png;base64,${chart.toString("base64")}`;
      const promptText = content.find((part) => part.type === "text")?.text ?? "";
      const macro = responseName === "swing_macro";
      if (requestBody.model !== "google/gemini-2.5-pro" || images.length !== (macro ? 4 : 1) || images.some((image) => image.image_url?.url !== expectedImage) || requestBody.temperature !== 0.1 || requestBody.stream !== false) {
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Swing model, images, or settings did not match." }));
        return;
      }
      if (macro) providerCalls.swingMacro += 1;
      else providerCalls.swingStock += 1;
      beginProviderRequest(macro ? "full" : "compact");
      await providerDelay();
      if (!macro && promptText.includes("Symbol: MSFT")) {
        const attempts = (swingStockAttempts.get("MSFT") ?? 0) + 1;
        swingStockAttempts.set("MSFT", attempts);
        if (attempts === 1) {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Synthetic transient Swing failure." }));
          endProviderRequest("compact");
          return;
        }
      }
      const macroResult = {
        regime: "BULLISH_ACCELERATION", long_bias: "SUPPORTIVE", short_bias: "NEUTRAL", high_beta_long_forbidden: false,
        summary: "SPY and QQQ remain structurally constructive while GLD and TLT are neutral.",
        anchors: Object.fromEntries(["SPY", "QQQ", "GLD", "TLT"].map((symbol) => [symbol, { stance: symbol === "SPY" || symbol === "QQQ" ? "BULLISH" : "NEUTRAL", observation: `${symbol} daily structure is visually legible.`, visual_quality: "CLEAR" }])),
      };
      const symbol = promptText.match(/- Symbol: ([A-Z0-9.-]+)/)?.[1] ?? "AAPL";
      const direction = symbol === "MSFT" ? "SHORT" : symbol === "NVDA" ? "NO_TRADE" : "LONG";
      const candidateResult = direction === "LONG" ? {
        symbol, direction, observed_price: 123, entry_zone_low: 122, entry_zone_high: 124, stop_loss: 118, profit_target_1: 136, profit_target_2: 142,
        conviction_level: "HIGH", macro_context: "Constructive locked macro context.", pattern_name: "Daily horizontal range breakout and retest", polarity_analysis: "The former range ceiling is visibly holding as support.", moving_average_analysis: "Price is visibly above EMA 8, EMA 20, SMA 50, and SMA 200.", structural_setup_and_polarity: "Visible daily range breakout and retest.",
        core_indicators_and_volume: "Visible momentum and volume support the setup.", volume_ratio: 1.8, volume_analysis: "The visible 1.8x volume ratio confirms expansion.", macd_analysis: "MACD is visibly bullish with an expanding histogram.", rsi_analysis: "RSI is above its midpoint without a visible extreme.", cci_analysis: "CCI shows positive momentum expansion.", cmf_analysis: "CMF shows visible buying pressure above zero without proving transactions.", three_candle_micro_audit: "The open far-right candle is provisional; three-candle velocity is expanding.",
        trigger_rule: "A daily candle must continue to hold the retested polarity floor.", entry_rationale: "The entry brackets the visible retest zone.", stop_rationale: "A daily body close below the polarity floor invalidates the setup.", target_1_rationale: "Target 1 is the next visible resistance shelf.", target_2_rationale: "Target 2 is the next visible historical extension.",
        risk_notes: ["The far-right daily candle is incomplete."], visual_quality: "CLEAR", unreadable_fields: [],
      } : direction === "SHORT" ? {
        symbol, direction, observed_price: 101, entry_zone_low: 100, entry_zone_high: 102, stop_loss: 106, profit_target_1: 90, profit_target_2: 84,
        conviction_level: "MEDIUM", macro_context: "Locked macro context permits selective shorts.", pattern_name: "Daily support breakdown and failed retest", polarity_analysis: "Former support is visibly acting as overhead resistance.", moving_average_analysis: "Price is visibly below the fast averages and intermediate structure.", structural_setup_and_polarity: "Visible daily support breakdown and failed retest.",
        core_indicators_and_volume: "MACD and CMF show visible selling pressure.", volume_ratio: 1.6, volume_analysis: "The visible 1.6x ratio confirms the breakdown.", macd_analysis: "MACD is below its signal with a negative histogram.", rsi_analysis: "RSI is below its midpoint but remains readable.", cci_analysis: "CCI shows negative momentum expansion.", cmf_analysis: "CMF shows visible selling pressure below zero without proving transactions.", three_candle_micro_audit: "Three candles show contracting rebound velocity; the open candle is provisional.",
        trigger_rule: "A daily retest must reject the broken support from below.", entry_rationale: "The entry brackets the visible failed-retest zone.", stop_rationale: "A daily body close above the broken shelf invalidates the short.", target_1_rationale: "Target 1 is the next visible support shelf.", target_2_rationale: "Target 2 is the lower visible historical extension.",
        risk_notes: ["Wait for the daily candle to close."], visual_quality: "CLEAR", unreadable_fields: [],
      } : {
        symbol, direction, observed_price: 90, entry_zone_low: null, entry_zone_high: null, stop_loss: null, profit_target_1: null, profit_target_2: null,
        conviction_level: "LOW", macro_context: "Macro context is mixed for this setup.", pattern_name: "Unconfirmed polarity retest", polarity_analysis: "No stable defense of the visible polarity floor is confirmed.", moving_average_analysis: "Price is entangled with conflicting visible moving-average structure.", structural_setup_and_polarity: "No stable polarity retest is visible.",
        core_indicators_and_volume: "The exact volume ratio is unreadable and momentum conflicts.", volume_ratio: null, volume_analysis: "The exact volume ratio is not legible.", macd_analysis: "MACD remains directionally conflicted.", rsi_analysis: "RSI is readable but does not confirm reversal.", cci_analysis: "CCI does not confirm a durable turn.", cmf_analysis: "CMF is mixed and cannot prove participation.", three_candle_micro_audit: "The provisional open candle conflicts with prior candles.",
        trigger_rule: "Remain NO_TRADE until a completed daily candle visibly defends the polarity floor with a readable volume ratio above 1.5x.", entry_rationale: null, stop_rationale: null, target_1_rationale: null, target_2_rationale: null,
        risk_notes: ["Execution levels are not sufficiently clear."], visual_quality: "PARTIAL", unreadable_fields: ["volume_ratio"],
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: `e2e-${responseName}-${macro ? providerCalls.swingMacro : providerCalls.swingStock}`, model: "google/gemini-2.5-pro", provider: "e2e-google-mock", choices: [{ message: { content: JSON.stringify(macro ? macroResult : candidateResult) }, finish_reason: "stop" }], usage: { prompt_tokens: 1400, completion_tokens: 500, cost: 0.012 } }));
      endProviderRequest(macro ? "full" : "compact");
      return;
    }
    const content = requestBody.messages?.[0]?.content ?? [];
    const images = content.filter((part) => part.type === "image_url");
    const expectedImage = `data:image/png;base64,${chart.toString("base64")}`;
    const phase = requestBody.response_format?.json_schema?.name === "compact_signal" ? "compact" : "full";
    const promptText = content.find((part) => part.type === "text")?.text ?? "";
    if (requestBody.model !== "google/gemini-2.5-pro" || images.length !== 1 || images[0]?.image_url?.url !== expectedImage) {
      response.writeHead(422, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Model or exact chart bytes did not match." }));
      return;
    }
    if (phase === "compact" && (
      requestBody.max_tokens !== 5120 || requestBody.reasoning?.effort !== "medium" || requestBody.reasoning?.exclude !== true || "max_tokens" in requestBody.reasoning
    )) {
      response.writeHead(422, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Compact thinking settings did not match." }));
      return;
    }
    providerCalls[phase] += 1;
    beginProviderRequest(phase);
    await providerDelay();
    response.writeHead(200, { "Content-Type": "application/json" });
    const retryableCompactFailure = retryFirstCompact && phase === "compact" && providerCalls.compact === 1;
    response.end(JSON.stringify({
      id: `e2e-openrouter-${phase}-response-${providerCalls[phase]}`,
      model: "google/gemini-2.5-pro",
      provider: "e2e-google-mock",
      choices: [{
        message: { content: retryableCompactFailure ? null : JSON.stringify(
          phase === "compact"
            ? promptText.includes("NASDAQ:MSFT")
              ? ineligibleCompactAnalysis
              : promptText.includes("NASDAQ:NVDA") ? bearishCompactAnalysis : compactAnalysis
            : fullAnalysis,
        ) },
        finish_reason: "stop",
      }],
      usage: phase === "compact"
        ? { prompt_tokens: 1000, completion_tokens: 1880, completion_tokens_details: { reasoning_tokens: 1800 }, cost: 0.02005 }
        : { prompt_tokens: 1000, completion_tokens: 400, cost: 0.005 },
    }));
    endProviderRequest(phase);
    return;
  }
  if (request.url === "/stats" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ chart: providerCalls.chart, compact: providerCalls.compact, full: providerCalls.full }));
    return;
  }
  if (request.url === "/diagnostics" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ calls: providerCalls, concurrency: providerConcurrency, chartRequests }));
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));
const migration = spawnSync("pnpm", ["db:migrate"], { stdio: "inherit", env: testEnv });
if (migration.status !== 0) {
  mockServer.close();
  rmSync(runRoot, { recursive: true, force: true });
  process.exit(migration.status ?? 1);
}
const appArgs = process.env.SPECIALSTOCK_E2E_PRODUCTION === "1"
  ? ["start", "--hostname", "127.0.0.1", "--port", "3100"]
  : ["dev", "--hostname", "127.0.0.1", "--port", "3100"];
const app = spawn("pnpm", appArgs, {
  stdio: "inherit",
  env: testEnv,
});

const cleanup = () => {
  rmSync(runRoot, { recursive: true, force: true });
};
const shutdown = () => {
  app.kill("SIGTERM");
  mockServer.close();
  cleanup();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
process.on("exit", cleanup);
app.on("exit", (code) => {
  mockServer.close();
  cleanup();
  process.exit(code ?? 0);
});
