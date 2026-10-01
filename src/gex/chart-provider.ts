import "server-only";

import sharp from "sharp";

import { getServerEnv } from "@/config/env";
import { sha256 } from "@/lib/hash";

export const GEX_CHART_STUDIES = ["VWAP", "Keltner Channels", "Volume"] as const;

export class GexChartError extends Error {
  constructor(message: string) { super(message); this.name = "GexChartError"; }
}

export function gexChartRequestBody(input: { chartSymbol: string; from: string; to: string }) {
  return {
    symbol: input.chartSymbol,
    interval: "5m",
    width: 1600,
    height: 1000,
    style: "candle",
    theme: "dark",
    scale: "regular",
    session: "extended",
    timezone: "America/New_York",
    format: "png",
    range: { from: input.from, to: input.to },
    override: {
      mainPaneHeight: 760,
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
      { name: "VWAP", forceOverlay: true, override: { "VWAP.linewidth": 2, "VWAP.color": "rgb(255,193,7)" } },
      {
        name: "Keltner Channels", forceOverlay: true, input: { in_0: true, in_1: 20, in_2: 1 },
        override: {
          "Upper.visible": true, "Upper.linewidth": 1, "Upper.plottype": "line", "Upper.color": "rgb(255,255,255)",
          "Middle.visible": true, "Middle.linewidth": 1, "Middle.plottype": "line", "Middle.color": "rgb(180,180,180)",
          "Lower.visible": true, "Lower.linewidth": 1, "Lower.plottype": "line", "Lower.color": "rgb(255,255,255)",
          "Plots Background.visible": false,
        },
      },
      { name: "Volume", forceOverlay: false },
    ],
  };
}

function messageFor(status: number) {
  if (status === 401 || status === 403) return "Chart-Img credentials or plan permissions were rejected.";
  if (status === 402 || status === 429) return "Chart-Img quota or rate limit was exceeded.";
  if (status === 400 || status === 404 || status === 422) return "Chart-Img rejected the symbol or GEX chart configuration.";
  return "Chart-Img could not capture the GEX chart.";
}

export class GexChartImgProvider {
  async capture(input: { symbol: string; exchange: string; capturedAt: Date; fetcher?: typeof fetch }) {
    const env = getServerEnv();
    if (!env.CHART_IMG_API_KEY) throw new GexChartError("CHART_IMG_API_KEY is not configured.");
    const to = input.capturedAt.toISOString();
    const from = new Date(input.capturedAt.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const body = gexChartRequestBody({ chartSymbol: `${input.exchange}:${input.symbol}`, from, to });
    const fetcher = input.fetcher ?? fetch;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetcher(env.CHART_IMG_API_URL, {
          method: "POST", cache: "no-store", signal: AbortSignal.timeout(30_000),
          headers: { "Content-Type": "application/json", "x-api-key": env.CHART_IMG_API_KEY }, body: JSON.stringify(body),
        });
        if (response.ok || response.status < 500 || attempt === 1) break;
      } catch {
        if (attempt === 1) throw new GexChartError("Chart-Img could not be reached.");
      }
    }
    if (!response) throw new GexChartError("Chart-Img could not be reached.");
    if (!response.ok) throw new GexChartError(messageFor(response.status));
    if (response.headers.get("content-type")?.split(";")[0] !== "image/png") throw new GexChartError("Chart-Img returned an unexpected response format.");
    const png = Buffer.from(await response.arrayBuffer());
    const metadata = png.length && png.length <= 20 * 1024 * 1024 ? await sharp(png).metadata().catch(() => null) : null;
    if (metadata?.format !== "png" || metadata.width !== 1600 || metadata.height !== 1000) throw new GexChartError("Chart-Img returned invalid GEX chart dimensions.");
    return { png, imageHash: sha256(png), chartSymbol: body.symbol, capturedAt: to };
  }
}
