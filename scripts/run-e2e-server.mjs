import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import sharp from "sharp";

const mockPort = 3199;
const chart = await sharp({
  create: { width: 1600, height: 1920, channels: 3, background: "#10131a" },
}).png().toBuffer();

const analysis = {
  observed_price: 100,
  verdict: "bullish",
  setup_type: "Visible VWAP continuation",
  immediate_bias: "Price action is visually constructive above VWAP.",
  broader_trend: "The visible one-session structure slopes upward.",
  conviction: "high",
  candlestick_analysis: "Recent visible candles form higher lows.",
  vwap_keltner_analysis: "Price is visibly above VWAP and the Keltner midline.",
  cci_analysis: "CCI is visibly above its centerline without an extreme reading.",
  indicator_readings: Object.fromEntries(
    ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"].map(
      (key) => [key, { stance: "bullish", readability: "clear", observation: `${key} is visually constructive.` }],
    ),
  ),
  supporting_evidence: ["Higher lows and VWAP position support the view."],
  conflicting_evidence: ["Nearby visible resistance may limit follow-through."],
  support_levels: [98],
  resistance_levels: [104],
  primary_target: 104,
  deeper_scenario: "A move below the visible invalidation level changes the view.",
  invalidation_level: 97,
  data_quality_flags: ["e2e_mock_chart"],
  summary: "Bullish visual thesis with high conviction.",
};

const mockServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const requestBytes = Buffer.concat(chunks);
  if (request.url === "/chart" && request.method === "POST") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(chart);
    return;
  }
  if (request.url === "/openrouter" && request.method === "POST") {
    const requestBody = JSON.parse(requestBytes.toString("utf8"));
    const content = requestBody.messages?.[0]?.content ?? [];
    const images = content.filter((part) => part.type === "image_url");
    const expectedImage = `data:image/png;base64,${chart.toString("base64")}`;
    if (requestBody.model !== "google/gemini-2.5-pro" || images.length !== 1 || images[0]?.image_url?.url !== expectedImage) {
      response.writeHead(422, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Model or exact chart bytes did not match." }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      id: "e2e-openrouter-response",
      model: "google/gemini-2.5-pro",
      provider: "e2e-google-mock",
      choices: [{ message: { content: JSON.stringify(analysis) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 400, cost: 0.005 },
    }));
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));
const migration = spawnSync("pnpm", ["db:migrate"], { stdio: "inherit", env: process.env });
if (migration.status !== 0) {
  mockServer.close();
  process.exit(migration.status ?? 1);
}
const app = spawn("pnpm", ["dev", "--hostname", "127.0.0.1", "--port", "3100"], {
  stdio: "inherit",
  env: process.env,
});

const shutdown = () => {
  app.kill("SIGTERM");
  mockServer.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
app.on("exit", (code) => {
  mockServer.close();
  process.exit(code ?? 0);
});
