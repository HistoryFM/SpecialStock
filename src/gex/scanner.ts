import "server-only";
import type { GexLiveRow } from "@/gex/live";

function dictionary(name: string, rows: GexLiveRow[], value: (row: GexLiveRow) => number) {
  return `def ${name} =\n    ${rows.length ? rows.map((row) => `if GetSymbol() == "${row.symbol}" then ${value(row).toFixed(4)}`).join(" else\n    ") : "Double.NaN"} else Double.NaN;`;
}

export function buildGexScanner(rows: GexLiveRow[]) {
  return `# GEX_MultiState_Trigger_Scanner_v3
# Intraday Watchlist Column Logic (5-Min Aggregation Horizon)
# --------------------------------------------------------
# 1. HARDCODED ARCHITECTURE DICTIONARY (LATEST QUANT VALUE SET)
# --------------------------------------------------------
${dictionary("val_FlipLine", rows, (row) => row.gexFlip)}
${dictionary("val_CallWall", rows, (row) => row.callWall)}
${dictionary("val_PutWall", rows, (row) => row.putWall)}

# --------------------------------------------------------
# 2. STATE CHECK CALCULATIONS & DIRECTIONAL CRITERIA
# --------------------------------------------------------
def Price = close;
def PrevPrice = close[1];
def NearCallGate = if AbsValue((Price - val_CallWall) / val_CallWall) <= 0.0040 then 1 else 0;
def NearPutGate = if AbsValue((Price - val_PutWall) / val_PutWall) <= 0.0040 then 1 else 0;
def Is_Call_Breakout = if Price >= val_CallWall then 1 else 0;
def Is_Put_Breakout = if Price <= val_PutWall then 1 else 0;
def Is_Ceiling_Fade = if NearCallGate and Price < PrevPrice and Price < val_CallWall then 1 else 0;
def Is_Put_Bounce = if NearPutGate and Price > PrevPrice and Price > val_PutWall then 1 else 0;
def Is_Static_Call_Gate = if NearCallGate and !Is_Ceiling_Fade and !Is_Call_Breakout then 1 else 0;
def Is_Static_Put_Gate = if NearPutGate and !Is_Put_Bounce and !Is_Put_Breakout then 1 else 0;
def Is_PutWall_Zone = if Price < val_FlipLine and Price > val_PutWall and !NearPutGate then 1 else 0;
def Is_Normal_Zone = if Price >= val_FlipLine and Price < val_CallWall and !NearCallGate then 1 else 0;

# --------------------------------------------------------
# 3. HIGH-VISIBILITY WATCHLIST MATRIX INTERFACE
# --------------------------------------------------------
plot SortMetric = Price - val_FlipLine;
AddLabel(yes, if Is_Call_Breakout then "CALL BREAKOUT" else if Is_Put_Breakout then "PUT BREAKDOWN" else if Is_Ceiling_Fade then "CEILING FADE" else if Is_Put_Bounce then "PUT WALL BOUNCE" else if Is_Static_Call_Gate then "AT CALL GATE" else if Is_Static_Put_Gate then "AT PUT FLOOR" else if Is_PutWall_Zone then "FLUSH ZONE" else "NORMAL CORRIDOR");
AssignBackgroundColor(if Is_Call_Breakout then Color.CYAN else if Is_Put_Breakout then Color.RED else if Is_Ceiling_Fade then Color.ORANGE else if Is_Put_Bounce then Color.GREEN else if Is_Static_Call_Gate then Color.DARK_ORANGE else if Is_Static_Put_Gate then Color.DARK_GREEN else if Is_PutWall_Zone then Color.DARK_GRAY else Color.BLACK);
`;
}
