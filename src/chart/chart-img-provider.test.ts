import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChartImgError,
  ChartImgProvider,
  chartImgRequestBodyForTest,
} from "@/chart/chart-img-provider";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a-secure-test-secret-that-is-at-least-32-characters");
  vi.stubEnv("APP_PASSWORD_HASH", "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
  vi.stubEnv("CHART_IMG_API_KEY", "chart-img-test-key");
  vi.stubEnv("CHART_IMG_WIDTH", "1600");
  vi.stubEnv("CHART_IMG_HEIGHT", "1920");
});

describe("ChartImgProvider", () => {
  it("builds exactly the approved five-minute chart with eight studies", () => {
    const body = chartImgRequestBodyForTest({
      chartSymbol: "NASDAQ:AAPL",
      range: { from: "2026-08-28T13:30:00.000Z", to: "2026-08-28T20:00:00.000Z" },
      width: 1600,
      height: 1920,
    });
    expect(body).toMatchObject({
      symbol: "NASDAQ:AAPL",
      interval: "5m",
      session: "regular",
      timezone: "America/New_York",
      width: 1600,
      height: 1920,
      override: { mainPaneHeight: 560, scalesFontSize: 16, showVertGrid: true, showHorzGrid: true },
      studies: [
        { name: "VWAP", forceOverlay: true },
        {
          name: "Keltner Channels",
          forceOverlay: true,
          input: { in_0: true, in_1: 20, in_2: 1 },
          override: {
            "Upper.color": "rgb(255,255,255)",
            "Middle.plottype": "circles",
            "Middle.color": "rgb(255,255,255)",
            "Lower.color": "rgb(255,255,255)",
            "Plots Background.visible": false,
          },
        },
        { name: "Volume", forceOverlay: false },
        { name: "Average Directional Index", forceOverlay: false, input: { in_0: 14, in_1: 14 } },
        { name: "Relative Strength Index", forceOverlay: false, input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 } },
        { name: "MACD", forceOverlay: false, input: { in_0: 12, in_1: 26, in_2: 9, in_3: "close" } },
        { name: "Commodity Channel Index", forceOverlay: false, input: { length: 20, smoothingLine: "SMA", smoothingLength: 20 } },
        { name: "Chaikin Money Flow", forceOverlay: false, input: { in_0: 20 } },
      ],
    });
    expect(body.studies).toHaveLength(8);
    expect(JSON.stringify(body)).not.toMatch(/Bollinger/i);
  });

  it("uses a server-only header and validates the returned PNG", async () => {
    const png = await sharp({
      create: { width: 1600, height: 1920, channels: 3, background: "#10131a" },
    }).png().toBuffer();
    let headers: HeadersInit | undefined;
    let body = "";
    vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
      headers = init?.headers;
      body = String(init?.body);
      return new Response(png, { headers: { "content-type": "image/png" } });
    }));
    const result = await new ChartImgProvider().capture({
      entry: { symbol: "AAPL", exchange: "NASDAQ", automaticScanEnabled: false },
      capturedAt: new Date("2026-08-28T20:00:10.000Z"),
      range: {
        from: new Date("2026-08-27T13:30:00.000Z"),
        to: new Date("2026-08-28T20:00:00.000Z"),
      },
      barStatus: "closed",
    });
    expect(new Headers(headers).get("x-api-key")).toBe("chart-img-test-key");
    expect(body).not.toContain("chart-img-test-key");
    expect(result.input.chartSymbol).toBe("NASDAQ:AAPL");
    expect(result.png.equals(png)).toBe(true);
  });

  it("does not retry quota failures", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new ChartImgProvider().capture({
      entry: { symbol: "IBM", exchange: "NYSE", automaticScanEnabled: false },
      capturedAt: new Date("2026-08-28T20:00:10.000Z"),
      range: {
        from: new Date("2026-08-27T13:30:00.000Z"),
        to: new Date("2026-08-28T20:00:00.000Z"),
      },
      barStatus: "closed",
    })).rejects.toMatchObject({ code: "quota_exceeded" } satisfies Partial<ChartImgError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries one transient server failure", async () => {
    const png = await sharp({
      create: { width: 1600, height: 1920, channels: 3, background: "#10131a" },
    }).png().toBuffer();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(png, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new ChartImgProvider().capture({
      entry: { symbol: "AAPL", exchange: "NASDAQ", automaticScanEnabled: false },
      capturedAt: new Date("2026-08-28T20:00:10.000Z"),
      range: {
        from: new Date("2026-08-27T13:30:00.000Z"),
        to: new Date("2026-08-28T20:00:00.000Z"),
      },
      barStatus: "closed",
    })).resolves.toMatchObject({ input: { chartSymbol: "NASDAQ:AAPL" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
