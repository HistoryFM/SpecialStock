import type { GexDemoRow } from "@/gex/demo";

function dictionary(rows: GexDemoRow[], value: (row: GexDemoRow) => number): string {
  if (!rows.length) return "Double.NaN";
  return `${rows.map((row) => `if GetSymbol() == "${row.symbol}" then ${value(row).toFixed(4)}`).join(" else\n    ")} else Double.NaN`;
}

function numberDictionary(name: string, rows: GexDemoRow[], value: (row: GexDemoRow) => number) {
  return `def ${name} =\n    ${dictionary(rows, value)};`;
}

const warning = [
  "# SAMPLE ONLY — undated illustrative levels, not current market data.",
  "# Inactive by default. showSampleLevels is for visual testing only, never live use.",
  "# Replace this file with a verified dated export when live GEX analysis is available.",
].join("\n");

export function buildGexChartScript(rows: GexDemoRow[]): string {
  return `${warning}
# GEX_Master_Charts — multi-symbol sample chart study
declare upper;
input showSampleLevels = no;

${numberDictionary("SampleFlip", rows, (row) => row.flip)}
${numberDictionary("SampleCallWall", rows, (row) => row.callWall)}
${numberDictionary("SamplePutWall", rows, (row) => row.putWall)}
${numberDictionary("SampleCallEntry", rows, (row) => row.callEntryLow)}
${numberDictionary("SampleCallTarget1", rows, (row) => row.callTarget1)}
${numberDictionary("SampleCallTarget2", rows, (row) => row.callTarget2)}
${numberDictionary("SampleCallStop", rows, (row) => row.callStop)}
${numberDictionary("SamplePutEntry", rows, (row) => row.putEntryLow)}
${numberDictionary("SamplePutTarget1", rows, (row) => row.putTarget1)}
${numberDictionary("SamplePutTarget2", rows, (row) => row.putTarget2)}
${numberDictionary("SamplePutStop", rows, (row) => row.putStop)}

def HasSample = !IsNaN(SampleFlip);
def Is_PutWall_Zone = close < SampleFlip;
def Visible = showSampleLevels and HasSample;

plot FlipLine = if Visible then SampleFlip else Double.NaN;
plot CallWallLine = if Visible then SampleCallWall else Double.NaN;
plot PutWallLine = if Visible then SamplePutWall else Double.NaN;
plot DynamicEntry = if Visible then (if Is_PutWall_Zone then SamplePutEntry else SampleCallEntry) else Double.NaN;
plot DynamicTarget1 = if Visible then (if Is_PutWall_Zone then SamplePutTarget1 else SampleCallTarget1) else Double.NaN;
plot DynamicTarget2 = if Visible then (if Is_PutWall_Zone then SamplePutTarget2 else SampleCallTarget2) else Double.NaN;
plot DynamicStop = if Visible then (if Is_PutWall_Zone then SamplePutStop else SampleCallStop) else Double.NaN;

FlipLine.AssignValueColor(Color.YELLOW);
CallWallLine.AssignValueColor(Color.CYAN);
PutWallLine.AssignValueColor(Color.MAGENTA);
DynamicEntry.AssignValueColor(if Is_PutWall_Zone then Color.GREEN else Color.CYAN);
DynamicTarget1.AssignValueColor(Color.GREEN);
DynamicTarget2.AssignValueColor(Color.GREEN);
DynamicStop.AssignValueColor(Color.RED);
AddLabel(yes, if !HasSample then "NO SAMPLE DATA" else "SAMPLE ONLY - UNDATED - NOT FOR TRADING", Color.ORANGE);
`;
}

export function buildGexWatchlistScript(rows: GexDemoRow[]): string {
  return `${warning}
# GEX_Watchlist_Column — install as one Custom Quote with 5-minute aggregation.
input showSampleLevels = no;

${numberDictionary("Flip", rows, (row) => row.flip)}
${numberDictionary("CallGate", rows, (row) => row.callEntryLow)}
${numberDictionary("PutGate", rows, (row) => row.putEntryLow)}
${numberDictionary("PutWall", rows, (row) => row.putWall)}
${numberDictionary("CallIsBreakout", rows, (row) => row.callDirection === "Long (Breakout)" ? 1 : 0)}

def HasSample = !IsNaN(Flip);
def Active = showSampleLevels and HasSample;
def DistToCall = if Active then (close - CallGate) / CallGate else Double.NaN;
def DistToPut = if Active then (close - PutGate) / PutGate else Double.NaN;
def CallSqueeze = Active and CallIsBreakout and close crosses above CallGate;
def PutBounce = Active and close crosses above PutGate;
def CeilingFade = Active and !CallIsBreakout and close crosses below CallGate;
def PutBreakdown = Active and close crosses below PutWall;
def NearCall = Active and AbsValue(DistToCall) <= 0.003;
def NearPut = Active and AbsValue(DistToPut) <= 0.003;

plot Data = if Active then (if AbsValue(DistToCall) <= AbsValue(DistToPut) then DistToCall else DistToPut) else Double.NaN;
Data.AssignValueColor(Color.WHITE);
AddLabel(yes,
    if !HasSample then "NO SAMPLE DATA" else
    if !showSampleLevels then "SAMPLE ONLY" else
    if CallSqueeze then "CALL SQUEEZE" else
    if PutBounce then "PUT WALL BOUNCE" else
    if CeilingFade then "CEILING FADE" else
    if PutBreakdown then "PUT BREAKDOWN" else
    if NearCall then "AT CALL GATE" else
    if NearPut then "AT PUT FLOOR" else
    "SAMPLE - NO TRIGGER", Color.WHITE);
AssignBackgroundColor(
    if !Active then Color.DARK_GRAY else
    if CallSqueeze then Color.CYAN else
    if PutBounce then CreateColor(39, 242, 90) else
    if CeilingFade then Color.ORANGE else
    if PutBreakdown then Color.RED else
    if NearCall or NearPut then CreateColor(12, 74, 44) else
    Color.BLACK);
`;
}
