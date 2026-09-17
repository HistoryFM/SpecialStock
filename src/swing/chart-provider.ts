import "server-only";

import * as Sentry from "@sentry/nextjs";
import { Temporal } from "@js-temporal/polyfill";
import sharp from "sharp";

import { getServerEnv } from "@/config/env";
import { hashObject, sha256 } from "@/lib/hash";
import { SWING_MARKET_CONFIG, type SwingChartInput, type SwingMarket } from "@/swing/types";

export const SWING_STUDIES = [
  "EMA 8", "EMA 20", "SMA 50", "SMA 200", "Bollinger Bands 20/2",
  "Volume", "RSI 14", "MACD 12/26/9", "CCI 14", "Chaikin Money Flow 21",
] as const;

export class SwingChartError extends Error {
  constructor(message: string, readonly code: "not_configured" | "unauthorized" | "invalid_symbol" | "quota_exceeded" | "rate_limited" | "transient" | "timeout" | "invalid_image", readonly providerCalls = 0) {
    super(message);
    this.name = "SwingChartError";
  }
}

export function swingChartRequestBody(input: { chartSymbol: string; from: string; to: string; timezone?: SwingChartInput["timezone"] }) {
  const line = (name: string, length: number, color: string) => ({
    name, forceOverlay: true,
    input: { length, source: "close", offset: 0, smoothingLine: "SMA", smoothingLength: length },
    override: { "Plot.visible": true, "Plot.linewidth": 2, "Plot.plottype": "line", "Plot.color": color },
  });
  return {
    symbol: input.chartSymbol,
    interval: "1D",
    width: 1600,
    height: 1920,
    style: "candle",
    theme: "dark",
    scale: "regular",
    session: "regular",
    timezone: input.timezone ?? "America/New_York",
    format: "png",
    range: { from: input.from, to: input.to },
    override: {
      mainPaneHeight: 860,
      scalesFontSize: 16,
      showLegend: true,
      showLegendValues: true,
      showPriceLine: true,
      showSeriesLastValue: true,
      showSeriesOHLC: true,
      showStudyLastValue: true,
      showStudyPlotNamesAction: false,
      showVertGrid: true,
      showHorzGrid: true,
    },
    studies: [
      line("Moving Average Exponential", 8, "rgb(255,193,7)"),
      line("Moving Average Exponential", 20, "rgb(0,188,212)"),
      line("Moving Average", 50, "rgb(156,39,176)"),
      line("Moving Average", 200, "rgb(244,67,54)"),
      {
        name: "Bollinger Bands", forceOverlay: true, input: { in_0: 20, in_1: 2 },
        override: {
          "Median.visible": true, "Median.linewidth": 1, "Median.plottype": "line", "Median.color": "rgb(158,158,158)",
          "Upper.visible": true, "Upper.linewidth": 1, "Upper.plottype": "line", "Upper.color": "rgb(255,255,255)",
          "Lower.visible": true, "Lower.linewidth": 1, "Lower.plottype": "line", "Lower.color": "rgb(255,255,255)",
          "Plots Background.visible": false,
        },
      },
      { name: "Volume", forceOverlay: false, override: { "Volume.plottype": "columns" } },
      {
        name: "Relative Strength Index", forceOverlay: false,
        input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 },
        override: {
          "Plot.linewidth": 2, "UpperLimit.visible": true, "UpperLimit.value": 70,
          "LowerLimit.visible": true, "LowerLimit.value": 30, "Hlines Background.visible": true,
        },
      },
      { name: "MACD", forceOverlay: false, input: { in_0: 12, in_1: 26, in_2: 9, in_3: "close" } },
      {
        name: "Commodity Channel Index", forceOverlay: false,
        input: { in_0: 14, smoothingLine: "SMA", smoothingLength: 14 },
        override: { "Plot.linewidth": 2, "UpperLimit.visible": true, "UpperLimit.value": 100, "LowerLimit.visible": true, "LowerLimit.value": -100 },
      },
      {
        name: "Chaikin Money Flow", forceOverlay: false, input: { in_0: 21 },
        override: { "Plot.linewidth": 2, "Zero.visible": true, "Zero.value": 0, "Zero.linestyle": 2 },
      },
    ],
  };
}

function providerError(status: number, providerCalls: number) {
  if (status === 401 || status === 403) return new SwingChartError("Chart-Img credentials or plan permissions were rejected.", "unauthorized", providerCalls);
  if (status === 400 || status === 404 || status === 422) return new SwingChartError("Chart-Img rejected the symbol or Swing chart configuration.", "invalid_symbol", providerCalls);
  if (status === 402) return new SwingChartError("Chart-Img quota or plan credit is exhausted.", "quota_exceeded", providerCalls);
  if (status === 429) return new SwingChartError("Chart-Img rate limit was exceeded.", "rate_limited", providerCalls);
  return new SwingChartError("Chart-Img could not capture the Swing chart.", "transient", providerCalls);
}

export class SwingChartImgProvider {
  async capture(input: { market?: SwingMarket; role: "macro" | "candidate"; symbol: string; exchange: string; capturedAt: Date; signal?: AbortSignal }) {
    const env = getServerEnv();
    if (!env.CHART_IMG_API_KEY) throw new SwingChartError("CHART_IMG_API_KEY is not configured.", "not_configured");
    const apiKey = env.CHART_IMG_API_KEY;
    const market = input.market ?? "US";
    const timezone = SWING_MARKET_CONFIG[market].timezone;
    const to = input.capturedAt.toISOString();
    const from = Temporal.Instant.fromEpochMilliseconds(input.capturedAt.getTime()).toZonedDateTimeISO(timezone).subtract({ months: 18 }).toInstant().toString();
    const chartSymbol = `${input.exchange}:${input.symbol}`;
    const base = {
      version: "swing-chart-img-input-v2" as const,
      market,
      role: input.role,
      symbol: input.symbol,
      chartSymbol,
      capturedAt: to,
      interval: "1D" as const,
      session: "regular" as const,
      timezone,
      barStatus: "open" as const,
      range: { from, to },
      width: 1600 as const,
      height: 1920 as const,
      studies: [...SWING_STUDIES],
    };
    const frozen: SwingChartInput = { ...base, inputHash: hashObject(base) };
    const body = swingChartRequestBody({ chartSymbol, from, to, timezone });
    let response: Response | null = null;
    let providerCalls = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        providerCalls += 1;
        response = await Sentry.startSpan({ name: "Capture Swing chart", op: "specialstock.swing.chart.capture", attributes: { "specialstock.swing.role": input.role, "specialstock.swing.attempt": attempt + 1 } }, async (span) => {
          const result = await fetch(env.CHART_IMG_API_URL, {
            method: "POST", cache: "no-store", signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
            headers: { "Content-Type": "application/json", "x-api-key": apiKey },
            body: JSON.stringify(body),
          });
          span.setAttribute("http.response.status_code", result.status);
          span.setStatus({ code: result.ok ? 1 : 2 });
          return result;
        });
        if (response.ok || response.status < 500 || attempt === 1) break;
        Sentry.logger.info("swing.chart.retry", { "specialstock.swing.role": input.role, "specialstock.swing.failure_kind": "http_transient", "specialstock.swing.attempt": attempt + 1 });
      } catch (error) {
        if (input.signal?.aborted) throw new SwingChartError("Swing analysis was canceled.", "transient", providerCalls);
        if (attempt === 0) Sentry.logger.info("swing.chart.retry", { "specialstock.swing.role": input.role, "specialstock.swing.failure_kind": "network", "specialstock.swing.attempt": attempt + 1 });
        if (attempt === 1) throw new SwingChartError(error instanceof Error && error.name === "TimeoutError" ? "Chart-Img Swing capture timed out." : "Chart-Img could not be reached.", error instanceof Error && error.name === "TimeoutError" ? "timeout" : "transient", providerCalls);
      }
    }
    if (!response) throw new SwingChartError("Chart-Img could not be reached.", "transient", providerCalls);
    if (!response.ok) throw providerError(response.status, providerCalls);
    if (response.headers.get("content-type")?.split(";")[0] !== "image/png") throw new SwingChartError("Chart-Img returned an unexpected response format.", "invalid_image", providerCalls);
    const png = Buffer.from(await response.arrayBuffer());
    if (!png.length || png.length > 20 * 1024 * 1024) throw new SwingChartError("Chart-Img returned an empty or oversized image.", "invalid_image", providerCalls);
    const metadata = await sharp(png).metadata().catch(() => null);
    if (metadata?.format !== "png" || metadata.width !== 1600 || metadata.height !== 1920) throw new SwingChartError("Chart-Img returned invalid Swing chart dimensions.", "invalid_image", providerCalls);
    return { png, imageHash: sha256(png), input: frozen, requestBody: body, providerCalls };
  }
}
