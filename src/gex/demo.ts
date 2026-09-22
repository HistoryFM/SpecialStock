// Undated, illustrative values transcribed from the user-supplied GEX analysis sample.
// This is not option-chain evidence and must never be promoted to a live report.
export type GexDemoRow = {
  symbol: string;
  flip: number;
  callWall: number;
  callCascade: number;
  callDirection: "Long (Breakout)" | "Short (Fade)";
  callEntryLow: number;
  callEntryHigh: number;
  callTarget1: number;
  callTarget2: number;
  callStop: number;
  putWall: number;
  putHalt: number;
  putEntryLow: number;
  putEntryHigh: number;
  putTarget1: number;
  putTarget2: number;
  putStop: number;
};

type DemoTuple = [string, number, number, number, "Long (Breakout)" | "Short (Fade)", number, number, number, number, number, number, number, number, number, number, number, number];

const sourceRows: DemoTuple[] = [
  ["GOOGL", 350, 350, 350, "Long (Breakout)", 350.25, 350.25, 352.5, 354, 348.9, 345, 345.5, 345.8, 346.5, 349.5, 350, 342.4],
  ["AMD", 550, 565, 562.5, "Short (Fade)", 563.5, 564.5, 552, 550, 566.25, 545, 545.8, 546.3, 547.5, 554, 556, 540.9],
  ["META", 675, 680, 672, "Long (Breakout)", 672, 672, 680, 685, 665, 650, 651.5, 652, 654, 662, 665, 644],
  ["AVGO", 355, 362.5, 360, "Short (Fade)", 361, 362, 356.5, 355.5, 364, 350, 350.8, 350.9, 351.75, 354.5, 355, 347.3],
  ["NVDA", 222.5, 225, 223.5, "Long (Breakout)", 223.5, 223.5, 226.5, 228, 221.8, 217.5, 217.8, 218, 218.6, 221.5, 222, 215.8],
  ["MU", 1010, 1030, 1022.5, "Short (Fade)", 1027, 1029, 1015, 1011, 1034, 1000, 1002.5, 1003, 1005, 1012, 1015, 992],
  ["MSFT", 495, 500, 497, "Long (Breakout)", 497, 497, 500, 502.5, 494.2, 485, 486.2, 486.5, 487.5, 492.5, 494, 481.3],
  ["LRCX", 285, 292.5, 290, "Short (Fade)", 291, 292, 286.5, 285.5, 294.25, 280, 280.8, 281, 281.9, 284.5, 285.5, 277.9],
  ["ORCL", 148, 150, 148.75, "Long (Breakout)", 148.75, 148.75, 151, 152.5, 147.1, 142.5, 142.9, 143, 143.6, 146.5, 147.5, 141.4],
  ["PLTR", 175, 180, 179, "Short (Fade)", 178.5, 179.5, 176, 175.5, 181, 170, 170.4, 170.5, 171.25, 174, 174.8, 168.7],
  ["ACN", 195, 200, 197.5, "Short (Fade)", 198.5, 199.75, 194.8, 190.5, 202, 190, 190.5, 190.8, 191.5, 194, 194.8, 188.5],
  ["NOW", 135, 137.5, 136.5, "Short (Fade)", 136.5, 137.25, 135.5, 135, 138.6, 130, 130.3, 130.45, 131, 133.5, 134.5, 129],
  ["CRM", 240, 245, 242, "Long (Breakout)", 242.25, 242.25, 245, 247.5, 239.5, 232.5, 233.2, 233.5, 234.5, 238, 239.2, 230.7],
  ["WDC", 440, 445, 443.5, "Short (Fade)", 443.5, 444.5, 441.5, 431.5, 447, 430, 431, 431.25, 432.5, 438, 439.5, 426.7],
  ["SKHY", 190, 192.5, 190.5, "Long (Breakout)", 190.75, 190.75, 193, 195, 188.9, 180, 180.5, 180.9, 181.8, 186.5, 188, 178.5],
  ["BE", 270, 280, 274, "Long (Breakout)", 274.5, 274.5, 280, 284, 269.8, 250, 251.2, 251.5, 253, 262, 265, 248],
];

export const GEX_DEMO_ROWS: GexDemoRow[] = sourceRows.map((row) => ({
  symbol: row[0], flip: row[1], callWall: row[2], callCascade: row[3], callDirection: row[4],
  callEntryLow: row[5], callEntryHigh: row[6], callTarget1: row[7], callTarget2: row[8], callStop: row[9],
  putWall: row[10], putHalt: row[11], putEntryLow: row[12], putEntryHigh: row[13], putTarget1: row[14], putTarget2: row[15], putStop: row[16],
}));

export const GEX_DEMO_SYMBOLS = GEX_DEMO_ROWS.map((row) => row.symbol);

export function gexDemoSelection(symbols: string[]) {
  const bySymbol = new Map(GEX_DEMO_ROWS.map((row) => [row.symbol, row]));
  return {
    rows: symbols.flatMap((symbol) => { const row = bySymbol.get(symbol); return row ? [row] : []; }),
    unavailableSymbols: symbols.filter((symbol) => !bySymbol.has(symbol)),
  };
}
