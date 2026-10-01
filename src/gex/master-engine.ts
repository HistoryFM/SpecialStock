import "server-only";

import type { GexLiveRow } from "@/gex/live";

function dictionary(name: string, rows: GexLiveRow[], value: (row: NonNullable<GexLiveRow["levels"]> & GexLiveRow) => number) {
  const eligible = rows.filter((row): row is GexLiveRow & { levels: NonNullable<GexLiveRow["levels"]> } => row.levels !== null);
  return `def ${name} =\n    ${eligible.length ? eligible.map((row) => `if GetSymbol() == "${row.symbol}" then ${value({ ...row, ...row.levels }).toFixed(4)}`).join(" else\n    ") : "Double.NaN"} else Double.NaN;`;
}

/** The static engine body is intentionally held unchanged; only STEP 1 dictionaries are regenerated. */
export function buildGexMasterEngine(rows: GexLiveRow[]) {
  return `# GEX_Dynamic_MultiState_Master_Engine
# Generated from the latest authenticated GEX run. Levels are conditional only and require the chart trigger rules.
# ========================================================
# STEP 1: STATIC VALUE DICTIONARIES (LATEST GEX RUN)
# ========================================================
${dictionary("val_FlipLine", rows, (row) => row.gexFlip)}
${dictionary("val_CallWall", rows, (row) => row.callWall)}
${dictionary("val_PutWall", rows, (row) => row.putWall)}
${dictionary("BreakoutEntry", rows, (row) => row.callEntry)}
${dictionary("FloorFadeEntry", rows, (row) => row.putEntry)}
${dictionary("BreakoutTarget1", rows, (row) => row.callTarget)}
${dictionary("FloorFadeTarget1", rows, (row) => row.putTarget)}
${dictionary("BreakoutStopBound", rows, (row) => row.callStop)}
${dictionary("FloorFadeStopBound", rows, (row) => row.putStop)}

# ========================================================
# STEP 2: MULTI-STATE MACHINE LAYER CONTROLLER
# ========================================================
def Is_Call_Breakout = if close >= val_CallWall then 1 else 0;
def Is_Put_Breakout = if close <= val_PutWall then 1 else 0;
def Is_PutWall_Zone = if close < val_FlipLine and close > val_PutWall then 1 else 0;
def Is_Normal_Zone = if close >= val_FlipLine and close < val_CallWall then 1 else 0;

# ========================================================
# STEP 3: PHYSICAL PLOTS AND FORMATTING
# ========================================================
plot FlipLine = val_FlipLine;
FlipLine.SetDefaultColor(Color.WHITE);
FlipLine.SetPaintingStrategy(PaintingStrategy.HORIZONTAL);
FlipLine.SetLineWeight(3);
plot CallWallLine = val_CallWall;
CallWallLine.SetDefaultColor(Color.RED);
CallWallLine.SetPaintingStrategy(PaintingStrategy.DASHES);
CallWallLine.SetLineWeight(2);
plot PutWallLine = val_PutWall;
PutWallLine.SetDefaultColor(Color.GREEN);
PutWallLine.SetPaintingStrategy(PaintingStrategy.DASHES);
PutWallLine.SetLineWeight(2);
plot DynamicEntry = if Is_Call_Breakout then BreakoutEntry else if Is_Put_Breakout then FloorFadeEntry else if Is_PutWall_Zone then FloorFadeEntry else BreakoutEntry;
DynamicEntry.AssignValueColor(if Is_Call_Breakout then Color.CYAN else if Is_Put_Breakout then Color.RED else if Is_PutWall_Zone then Color.LIGHT_GREEN else Color.YELLOW);
DynamicEntry.SetPaintingStrategy(PaintingStrategy.HORIZONTAL);
DynamicEntry.SetLineWeight(2);
plot DynamicTarget1 = if Is_Call_Breakout then BreakoutTarget1 else if Is_Put_Breakout then FloorFadeTarget1 else if Is_PutWall_Zone then val_FlipLine else val_CallWall;
DynamicTarget1.SetDefaultColor(Color.YELLOW);
DynamicTarget1.SetPaintingStrategy(PaintingStrategy.HORIZONTAL);
DynamicTarget1.SetLineWeight(1);
plot DynamicTarget2 = if Is_Call_Breakout then BreakoutTarget1 * 1.015 else if Is_Put_Breakout then FloorFadeTarget1 * 0.985 else BreakoutTarget1;
DynamicTarget2.SetDefaultColor(Color.YELLOW);
DynamicTarget2.SetPaintingStrategy(PaintingStrategy.HORIZONTAL);
DynamicTarget2.SetLineWeight(1);
plot DynamicStop = if Is_Call_Breakout then BreakoutStopBound else if Is_Put_Breakout then FloorFadeStopBound else if Is_PutWall_Zone then FloorFadeStopBound else val_FlipLine;
DynamicStop.SetDefaultColor(Color.DARK_RED);
DynamicStop.SetPaintingStrategy(PaintingStrategy.HORIZONTAL);
DynamicStop.SetLineWeight(2);
#========================================================STEP 4: DASHBOARD STATE TEXT GENERATOR========================================================
AddLabel(yes, Concat(GetSymbol(), " GEX Risk Matrix"), Color.YELLOW);
AddLabel(Is_Call_Breakout, "CALL-WALL BREAKOUT (NEG GEX)", Color.CYAN);
AddLabel(Is_Put_Breakout, " PUT-WALL SHORT BREAKDOWN (NEG GEX)", Color.RED);
AddLabel(Is_PutWall_Zone, "PUT-WALL FADE LONG (POS GEX)", Color.LIGHT_GREEN);
AddLabel(Is_Normal_Zone, "CEILING SHORT FADE(POS GEX)", Color.WHITE);
`;
}
