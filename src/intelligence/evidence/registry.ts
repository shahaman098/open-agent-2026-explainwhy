import "server-only";
import type { EvidenceTool, ToolInputBaseT, ToolName } from "./types";
import { revenueAnalysis } from "./tools/revenue";
import { advertisingAnalysis } from "./tools/advertising";
import { checkoutAnalysis } from "./tools/checkout";
import { inventoryAnalysis } from "./tools/inventory";
import { shippingAnalysis } from "./tools/shipping";
import { customerFeedbackAnalysis } from "./tools/reviews";
import { publicReferenceContext } from "./tools/public-context";
import { historicalIncidents } from "./tools/historical-incidents";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyTool = EvidenceTool<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Read-only investigation tools. Each has a strict input schema; nothing here accepts collection names, pipelines,
 * operators or code from a caller. The future Mubit investigator chooses from this registry by name only.
 */
const TOOLS: ReadonlyArray<AnyTool> = [
  revenueAnalysis, advertisingAnalysis, checkoutAnalysis, inventoryAnalysis, shippingAnalysis, customerFeedbackAnalysis, publicReferenceContext, historicalIncidents,
];
const BY_NAME = new Map<ToolName, AnyTool>(TOOLS.map((t) => [t.name, t]));

export function getTool(name: ToolName): EvidenceTool<ToolInputBaseT> {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown evidence tool ${name}`);
  return tool as EvidenceTool<ToolInputBaseT>;
}
export const listTools = () => TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, category: t.category, dataSources: t.dataSources }));
export const isToolName = (name: string): name is ToolName => BY_NAME.has(name as ToolName);
