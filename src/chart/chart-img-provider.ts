import "server-only";

import sharp from "sharp";

import type { ChartAnalysisInput } from "@/analysis/types";
import { getServerEnv } from "@/config/env";
import { hashObject, sha256 } from "@/lib/hash";
import type { WatchlistEntry } from "@/settings/types";

const STUDIES = [
  "VWAP",
  "Keltner Channels",
  "Volume",
  "Average Directional Index",
  "Relative Strength Index",
  "MACD",
  "Commodity Channel Index",
  "Chaikin Money Flow",
] as const;

export class ChartImgError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "unauthorized"
      | "invalid_symbol"
      | "quota_exceeded"
      | "capture_failed"
      | "invalid_image",
  ) {
    super(message);
    this.name = "ChartImgError";
  }
}

export type CapturedChart = {
  png: Buffer;
  imageHash: string;
  input: ChartAnalysisInput;
};

function requestBody(input: {
  chartSymbol: string;
  range: { from: string; to: string };
  width: number;
  height: number;
}) {
  return {
    symbol: input.chartSymbol,
    interval: "5m",
    width: input.width,
    height: input.height,
    style: "candle",
    theme: "dark",
    scale: "regular",
    session: "regular",
    timezone: "America/New_York",
    format: "png",
    range: input.range,
    override: {
      mainPaneHeight: 560,
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
      {
        name: "VWAP",
        forceOverlay: true,
        override: {
          "VWAP.linewidth": 2,
          "VWAP.color": "rgb(255,193,7)",
        },
      },
      {
        name: "Keltner Channels",
        forceOverlay: true,
        input: { in_0: true, in_1: 20, in_2: 1 },
        override: {
          "Upper.visible": true,
          "Upper.linewidth": 1,
          "Upper.plottype": "line",
          "Upper.color": "rgb(255,255,255)",
          "Middle.visible": true,
          "Middle.linewidth": 1,
          "Middle.plottype": "circles",
          "Middle.color": "rgb(255,255,255)",
          "Lower.visible": true,
          "Lower.linewidth": 1,
          "Lower.plottype": "line",
          "Lower.color": "rgb(255,255,255)",
          "Plots Background.visible": false,
        },
      },
      { name: "Volume", forceOverlay: false },
      {
        name: "Average Directional Index",
        forceOverlay: false,
        input: { in_0: 14, in_1: 14 },
      },
      {
        name: "Relative Strength Index",
        forceOverlay: false,
        input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 },
      },
      {
        name: "MACD",
        forceOverlay: false,
        input: { in_0: 12, in_1: 26, in_2: 9, in_3: "close" },
      },
      {
        name: "Commodity Channel Index",
        forceOverlay: false,
        input: { length: 20, smoothingLine: "SMA", smoothingLength: 20 },
        override: {
          "Plot.linewidth": 2,
          "Plot.color": "rgb(228,147,97)",
          "UpperLimit.value": 100,
          "LowerLimit.value": -100,
        },
      },
      {
        name: "Chaikin Money Flow",
        forceOverlay: false,
        input: { in_0: 20 },
      },
    ],
  };
}

function errorForStatus(status: number): ChartImgError {
  if (status === 401 || status === 403) {
    return new ChartImgError("Chart-Img credentials or plan permissions were rejected.", "unauthorized");
  }
  if (status === 422) {
    return new ChartImgError("Chart-Img rejected the exchange, symbol, or chart configuration.", "invalid_symbol");
  }
  if (status === 429) {
    return new ChartImgError("Chart-Img request quota or rate limit was exceeded.", "quota_exceeded");
  }
  return new ChartImgError("Chart-Img could not capture the chart.", "capture_failed");
}

export class ChartImgProvider {
  async capture(input: {
    entry: WatchlistEntry;
    capturedAt: Date;
    range: { from: Date; to: Date };
    barStatus: "open" | "closed";
  }): Promise<CapturedChart> {
    const env = getServerEnv();
    if (!env.CHART_IMG_API_KEY) {
      throw new ChartImgError("CHART_IMG_API_KEY is not configured.", "not_configured");
    }
    const chartSymbol = `${input.entry.exchange}:${input.entry.symbol}`;
    const range = {
      from: input.range.from.toISOString(),
      to: input.range.to.toISOString(),
    };
    const metadataWithoutHash = {
      version: "chart-img-input-v1" as const,
      symbol: input.entry.symbol,
      chartSymbol,
      capturedAt: input.capturedAt.toISOString(),
      interval: "5m" as const,
      session: "regular" as const,
      barStatus: input.barStatus,
      range,
      width: env.CHART_IMG_WIDTH,
      height: env.CHART_IMG_HEIGHT,
      studies: [...STUDIES] as ChartAnalysisInput["studies"],
    };
    const frozen: ChartAnalysisInput = {
      ...metadataWithoutHash,
      inputHash: hashObject(metadataWithoutHash),
    };
    const body = requestBody({
      chartSymbol,
      range,
      width: frozen.width,
      height: frozen.height,
    });

    let response: Response | null = null;
    let timedOut = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        response = await fetch(env.CHART_IMG_API_URL, {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.CHART_IMG_API_KEY,
          },
          body: JSON.stringify(body),
        });
        if (response.ok || response.status < 500 || attempt === 1) break;
      } catch (error) {
        timedOut = error instanceof Error && error.name === "AbortError";
        if (attempt === 1) {
          throw new ChartImgError(
            timedOut ? "Chart-Img capture timed out." : "Chart-Img could not be reached.",
            "capture_failed",
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response) {
      throw new ChartImgError(
        timedOut ? "Chart-Img capture timed out." : "Chart-Img could not be reached.",
        "capture_failed",
      );
    }
    if (!response.ok) throw errorForStatus(response.status);
    if (response.headers.get("content-type")?.split(";")[0] !== "image/png") {
      throw new ChartImgError("Chart-Img returned an unexpected response format.", "invalid_image");
    }
    const png = Buffer.from(await response.arrayBuffer());
    if (png.byteLength === 0 || png.byteLength > 20 * 1024 * 1024) {
      throw new ChartImgError("Chart-Img returned an empty or oversized image.", "invalid_image");
    }
    const image = await sharp(png).metadata().catch(() => null);
    if (
      image?.format !== "png" ||
      image.width !== frozen.width ||
      image.height !== frozen.height
    ) {
      throw new ChartImgError("Chart-Img returned invalid image dimensions.", "invalid_image");
    }
    return { png, imageHash: sha256(png), input: frozen };
  }
}

export const chartImgRequestBodyForTest = requestBody;
