export const MODEL_CATALOG = [
  {
    id: "google/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    intendedRole: "Exclusive visual-judgment model for Chart-Img captures",
  },
] as const;

export type ModelId = (typeof MODEL_CATALOG)[number]["id"];

export const MODEL_IDS = MODEL_CATALOG.map((model) => model.id) as [
  ModelId,
  ...ModelId[],
];
export const DEFAULT_MODEL_ID: ModelId = "google/gemini-2.5-pro";
export const DEFAULT_WATCHLIST = [
  { symbol: "AAPL", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "MSFT", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "AMZN", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "GOOGL", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "META", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "TSLA", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "NVDA", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "AMD", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "AVGO", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "BE", exchange: "NYSE", automaticScanEnabled: true },
  { symbol: "MU", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "SKHY", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "SNDK", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "NOW", exchange: "NYSE", automaticScanEnabled: true },
  { symbol: "CRM", exchange: "NYSE", automaticScanEnabled: true },
  { symbol: "SPCX", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "ORCL", exchange: "NYSE", automaticScanEnabled: true },
  { symbol: "GLD", exchange: "AMEX", automaticScanEnabled: true },
  { symbol: "SLV", exchange: "AMEX", automaticScanEnabled: true },
  { symbol: "USO", exchange: "AMEX", automaticScanEnabled: true },
] as const;

export function getModelDefinition(modelId: ModelId) {
  return MODEL_CATALOG.find((model) => model.id === modelId)!;
}
