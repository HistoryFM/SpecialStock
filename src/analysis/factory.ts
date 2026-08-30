import "server-only";

import type { AnalysisModelProvider } from "@/analysis/provider";
import { OpenRouterAnalysisModelProvider } from "@/analysis/openrouter-provider";

export function createAnalysisModelProvider(): AnalysisModelProvider {
  return new OpenRouterAnalysisModelProvider();
}
