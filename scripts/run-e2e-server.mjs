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
const sendSentryTelemetry = process.env.SPECIALSTOCK_E2E_SENTRY === "1";
const retryFirstCompact = process.env.SPECIALSTOCK_E2E_RETRY_ONCE === "1";
const testEnv = {
  ...process.env,
  SPECIALSTOCK_E2E_ISOLATED: "1",
  SENTRY_AUTH_TOKEN: "",
  ...(sendSentryTelemetry ? {} : { SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "" }),
  LOCAL_DATABASE_PATH: databasePath,
  CHART_ARTIFACT_DIR: artifactPath,
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
const providerCalls = { chart: 0, compact: 0, full: 0 };
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
    providerCalls.chart += 1;
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
    response.end(JSON.stringify(providerCalls));
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
