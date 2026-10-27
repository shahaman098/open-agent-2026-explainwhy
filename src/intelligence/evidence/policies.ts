import "server-only";
import type { InvestigationContext } from "./context";
import { MAX_ENTITY_IDS, type ToolName } from "./types";

export interface ToolSelection {
  tool: ToolName;
  /** Why the policy chose this tool, in terms of observed detector output only. */
  reason: string;
  role: "primary" | "alternative_explanation" | "context";
  input: Record<string, unknown>;
}

export const MAX_TOOL_CALLS = 8;

/**
 * Deterministic, testable routing from observed anomalies to evidence tools. Inputs are the incident's themes,
 * signal ids, canonical metrics, affected entities and severity — never a scenario label. Primary tools target the
 * observed signal families; alternative-explanation tools look for competing causes; context tools add reference.
 */
export function selectTools(ctx: InvestigationContext): ToolSelection[] {
  const base = { businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, window: ctx.incidentWindow, ...(ctx.baselineWindow ? { baselineWindow: ctx.baselineWindow } : {}) };
  const has = (...themes: string[]) => themes.some((t) => ctx.themes.has(t));
  const metric = (...names: string[]) => names.some((m) => ctx.metrics.has(m));
  const signal = (pattern: RegExp) => [...ctx.signalIds].some((s) => pattern.test(s));
  const picks = new Map<ToolName, ToolSelection>();
  const add = (tool: ToolName, role: ToolSelection["role"], reason: string, input: Record<string, unknown> = {}) => {
    if (!picks.has(tool)) picks.set(tool, { tool, role, reason, input: { ...base, ...input } });
  };
  const campaigns = ctx.affected.campaigns.slice(0, MAX_ENTITY_IDS), products = ctx.affected.products.slice(0, MAX_ENTITY_IDS);
  const observed = [...ctx.metrics].sort().join(", ") || [...ctx.signalIds].sort().slice(0, 4).join(", ") || "detector findings";

  // Business impact is always measured first.
  add("revenue_analysis", "primary", `Quantify business impact of the observed signals (${observed}) against the pre-onset baseline`);

  if (has("advertising") || metric("ctr", "cac_minor", "ad_spend_minor") || signal(/ctr|frequency|cpa|roas|paid|spend/)) {
    add("advertising_analysis", "primary", `Advertising signals present (${[...ctx.signalIds].filter((s) => /ctr|frequency|cpa|roas|paid|spend/.test(s)).sort().slice(0, 5).join(", ") || "advertising theme"})${campaigns.length ? ` on campaigns ${campaigns.join(", ")}` : ""}`, { campaignIds: campaigns });
  }
  if (has("conversion", "traffic") || metric("conversion_rate") || signal(/conversion|checkout|coupon|session/)) {
    add("checkout_analysis", "primary", "Conversion, session or checkout-failure signals present; measure funnel completion and failure codes");
  }
  if (has("fulfilment") || metric("late_delivery_rate") || signal(/late|delivery|backlog|overdue/)) {
    add("shipping_analysis", "primary", "Fulfilment signals present; measure the due-date cohort, delayed orders and backlog");
  }
  if (has("inventory") || signal(/stock|depletion|inventory/)) {
    add("inventory_analysis", "primary", `Inventory signals present${products.length ? ` for ${products.join(", ")}` : ""}; measure availability, depletion and velocity`, { productIds: products });
  }
  if (has("reputation") || metric("low_rating_rate") || signal(/rating|review/)) {
    add("customer_feedback_analysis", "primary", `Review signals present${products.length ? ` for ${products.join(", ")}` : ""}; measure low-rating share and delivery complaints`, { productIds: products });
  }
  if (has("demand") || signal(/mention|viral|product_orders|organic/)) {
    add("inventory_analysis", "primary", "Demand growth observed; check whether stock can absorb it", { productIds: products });
    add("advertising_analysis", "alternative_explanation", "Demand growth observed; check whether paid acquisition changed at the same time", { campaignIds: campaigns });
  }

  // Alternative explanations for negative sales/traffic/advertising/conversion incidents.
  if (ctx.polarity !== "positive" && (has("sales", "traffic", "advertising", "conversion") || metric("revenue_minor", "orders", "conversion_rate", "ctr"))) {
    add("checkout_analysis", "alternative_explanation", "Rule out a storefront or checkout problem as the cause of fewer completed orders");
    add("inventory_analysis", "alternative_explanation", "Rule out stockouts suppressing conversion or sales", { productIds: products });
    add("shipping_analysis", "alternative_explanation", "Check whether delivery problems coincide with the sales change");
    add("customer_feedback_analysis", "alternative_explanation", "Check whether customer feedback deteriorated in the same period", { productIds: products });
  }
  if (ctx.polarity !== "positive" && has("fulfilment")) add("customer_feedback_analysis", "alternative_explanation", "Delivery problems often surface as low ratings; measure review impact", { productIds: products });
  if (has("reputation")) add("shipping_analysis", "alternative_explanation", "Low ratings may reflect late deliveries rather than product quality");

  // Context (cheap, bounded).
  add("historical_incidents", "context", "Compare with earlier investigations in this run and surface any recorded diagnoses or actions", { includeOtherRuns: false });
  add("public_reference_context", "context", "Attach verified public product references for the affected catalogue; context only", { productIds: products, includeFinancials: ctx.severity === "critical" || ctx.severity === "high" });

  const order: ToolSelection["role"][] = ["primary", "alternative_explanation", "context"];
  return [...picks.values()].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).slice(0, MAX_TOOL_CALLS);
}
