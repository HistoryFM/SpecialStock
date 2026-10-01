export const STEP_TWO_HEADING = /^\s*(?:#|\/\/)\s*(?:STEP\s*)?2(?:\b|\.).*$/im;

/**
 * The dynamic GEX dictionaries are Step 1. Everything beginning at the
 * first Step 2-style comment is user-authored code that a live run preserves.
 * Both `# STEP 2` and the scanner's `# 2. ...` convention are supported.
 */
export function findGexTemplateBoundary(content: string) {
  const match = content.match(STEP_TWO_HEADING);
  return match?.index ?? -1;
}
