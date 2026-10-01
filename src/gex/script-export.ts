import "server-only";

import type { GexLiveRow } from "@/gex/live";
import { buildGexMasterEngine } from "@/gex/master-engine";
import { buildGexScanner } from "@/gex/scanner";
import { findGexTemplateBoundary } from "@/gex/template-boundary";

export type GexScriptKind = "engine" | "scanner";

const liveDictionaryNames = ["val_FlipLine", "val_CallWall", "val_PutWall", "BreakoutEntry", "FloorFadeEntry", "BreakoutTarget1", "FloorFadeTarget1", "BreakoutStopBound", "FloorFadeStopBound"];

function templateTickerOrder(template: string) {
  const tickers = [...template.matchAll(/GetSymbol\(\)\s*==\s*"([^"]+)"/g)].map((match) => match[1]!);
  return [...new Set(tickers)];
}

function orderRows(rows: GexLiveRow[], template: string | null) {
  if (!template) return rows;
  const positions = new Map(templateTickerOrder(template).map((symbol, index) => [symbol, index]));
  return rows.slice().sort((left, right) => (positions.get(left.symbol) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.symbol) ?? Number.MAX_SAFE_INTEGER));
}

function dictionaryFromGenerated(generated: string, name: string) {
  const expression = new RegExp(`def\\s+${name}\\s*=\\s*[\\s\\S]*?;`, "i");
  return generated.match(expression)?.[0] ?? null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A live run can legitimately omit symbols which the saved template still
 * contains (for example when Schwab did not return an option chain).  Update
 * the returned symbols in place instead of replacing the entire dictionary,
 * so the uploaded template's complete ticker list and ordering stay intact.
 */
function mergeLiveDictionaryValues(templateDictionary: string, generatedDictionary: string) {
  const liveValues = [...generatedDictionary.matchAll(/if GetSymbol\(\)\s*==\s*"([^"]+)"\s*then\s*(-?\d+(?:\.\d+)?)/g)];
  let merged = templateDictionary;
  for (const [, symbol, value] of liveValues) {
    const expression = new RegExp(`(if GetSymbol\\(\\)\\s*==\\s*"${escapeRegex(symbol!)}"\\s*then\\s*)(-?\\d+(?:\\.\\d+)?)`);
    merged = merged.replace(expression, `$1${value}`);
  }
  return merged;
}

function replaceLiveDictionaries(template: string, generated: string) {
  const boundary = findGexTemplateBoundary(template);
  if (boundary === -1) return generated;
  let stepOne = template.slice(0, boundary);
  const stepTwo = template.slice(boundary);
  for (const name of liveDictionaryNames) {
    const replacement = dictionaryFromGenerated(generated, name);
    if (!replacement) continue;
    const expression = new RegExp(`def\\s+${name}\\s*=\\s*[\\s\\S]*?;`, "i");
    stepOne = expression.test(stepOne)
      ? stepOne.replace(expression, (existing) => mergeLiveDictionaryValues(existing, replacement))
      : `${stepOne.trimEnd()}\n${replacement}\n`;
  }
  return `${stepOne}${stepTwo}`;
}

/**
 * Regenerates only named live-value dictionaries. Every other line in the
 * active uploaded template, including its own Step 1 structure, is retained.
 */
export function buildGexScriptExport(kind: GexScriptKind, rows: GexLiveRow[], template: string | null) {
  const orderedRows = orderRows(rows, template);
  const generated = kind === "engine" ? buildGexMasterEngine(orderedRows) : buildGexScanner(orderedRows);
  if (!template) return generated;

  return replaceLiveDictionaries(template, generated);
}
