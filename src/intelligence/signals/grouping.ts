import type { AnomalyT } from "@normal/contracts";

export type SignalSeverity = "low" | "medium" | "high" | "critical";

export interface SignalObservationInput {
  businessId: string;
  simulationRunId: string;
  anomaly: AnomalyT;
  signalId: string | null;
  signalLabel: string;
  theme: string | null;
  segment: { kind: string; id?: string } | null;
  segmentLabel: string | null;
  entityName: string;
  incident: {
    incidentId: string;
    title: string;
    summary: string;
    status: "monitoring" | "investigating" | "resolved" | "merged";
    primaryTheme: string;
    investigationId: string | null;
    severity: { level: SignalSeverity; score: number };
    onsetAt: string;
    lastTriggeredAt: string;
    resolvedAt: string | null;
  } | null;
  investigation: {
    investigationId: string;
    title: string;
    status: string;
  } | null;
}

export interface SignalObservationView {
  anomalyId: string;
  metric: AnomalyT["metric"];
  severity: SignalSeverity;
  status: AnomalyT["status"];
  direction: AnomalyT["direction"];
  actualValue: number;
  baselineValue: number;
  changePercent: number;
  detectedAt: string;
  currentWindow: AnomalyT["currentWindow"];
  baselineWindow: AnomalyT["baselineWindow"];
  sourceSnapshotIds: string[];
  entityKind: string | null;
  entityId: string | null;
  entityName: string;
  isBusinessAggregate: boolean;
}

export interface SignalGroup {
  groupId: string;
  businessId: string;
  simulationRunId: string;
  incidentId: string | null;
  incidentTitle: string | null;
  incidentSummary: string | null;
  investigationId: string | null;
  investigationTitle: string | null;
  signalFamilyId: string;
  title: string;
  metric: AnomalyT["metric"];
  metricLabel: string;
  theme: string | null;
  severity: SignalSeverity;
  severityRank: number;
  status: string;
  polarity: "increase" | "decrease" | "mixed";
  campaignCount: number;
  entityCount: number;
  affectedLabel: string;
  observationCount: number;
  aggregateObservationId: string | null;
  headline: SignalObservationView;
  timeRange: { startAt: string; endAt: string };
  lastTriggeredAt: string;
  observations: SignalObservationView[];
}

const SEVERITY_RANK: Record<SignalSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const THEME_LABEL: Record<string, string> = {
  advertising: "Advertising", conversion: "Checkout & conversion", demand: "Demand", fulfilment: "Delivery",
  inventory: "Inventory", reputation: "Customer ratings", sales: "Sales", traffic: "Traffic",
};

function metricLabel(value: string): string {
  return ({
    revenue_minor: "Revenue", conversion_rate: "Conversion rate", orders: "Orders", cac_minor: "Cost per acquisition",
    ctr: "Ad click-through rate", late_delivery_rate: "Late delivery rate", low_rating_rate: "Low-rating share", ad_spend_minor: "Ad spend",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function toObservation(input: SignalObservationInput): SignalObservationView {
  const segment = input.segment;
  return {
    anomalyId: input.anomaly.anomalyId,
    metric: input.anomaly.metric,
    severity: input.anomaly.severity,
    status: input.anomaly.status,
    direction: input.anomaly.direction,
    actualValue: input.anomaly.actualValue,
    baselineValue: input.anomaly.baselineValue,
    changePercent: input.anomaly.changePercent,
    detectedAt: input.anomaly.detectedAt,
    currentWindow: input.anomaly.currentWindow,
    baselineWindow: input.anomaly.baselineWindow,
    sourceSnapshotIds: input.anomaly.sourceSnapshotIds,
    entityKind: segment?.kind ?? null,
    entityId: segment?.kind === "global" ? null : segment?.id ?? null,
    entityName: input.entityName,
    isBusinessAggregate: segment?.kind === "global",
  };
}

function groupKey(input: SignalObservationInput): string {
  const correlationId = input.incident?.incidentId
    ?? input.investigation?.investigationId
    ?? `anomaly:${input.anomaly.anomalyId}`;
  return `${input.businessId}:${input.simulationRunId}:${correlationId}:${input.anomaly.metric}`;
}

export function groupSignalObservations(inputs: readonly SignalObservationInput[]): SignalGroup[] {
  const grouped = new Map<string, SignalObservationInput[]>();
  for (const input of inputs) {
    const key = groupKey(input);
    grouped.set(key, [...(grouped.get(key) ?? []), input]);
  }

  return [...grouped.entries()].map(([groupId, members]) => {
    const first = members[0];
    const observations = members.map(toObservation);
    const campaignIds = new Set(observations.filter((item) => item.entityKind === "campaign" && item.entityId).map((item) => item.entityId!));
    const entityIds = new Set(observations.filter((item) => item.entityKind && item.entityKind !== "global" && item.entityId).map((item) => `${item.entityKind}:${item.entityId}`));
    const entityKinds = new Set(observations.filter((item) => item.entityKind && item.entityKind !== "global").map((item) => item.entityKind!));
    const incident = members.find((item) => item.incident)?.incident ?? null;
    const investigation = members.find((item) => item.investigation)?.investigation ?? null;
    const severity = incident?.severity.level ?? [...observations].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0].severity;
    const status = incident?.status ?? investigation?.status ?? (new Set(observations.map((item) => item.status)).size === 1 ? observations[0].status : "mixed");
    const aggregate = observations
      .filter((item) => item.isBusinessAggregate && Number.isFinite(item.actualValue) && Number.isFinite(item.baselineValue) && Number.isFinite(item.changePercent))
      .sort((a, b) => b.currentWindow.endAt.localeCompare(a.currentWindow.endAt) || b.detectedAt.localeCompare(a.detectedAt))[0] ?? null;
    const fallbackHeadline = [...observations].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      || Math.abs(b.changePercent) - Math.abs(a.changePercent) || b.detectedAt.localeCompare(a.detectedAt))[0];
    const headline = aggregate ?? fallbackHeadline;
    const polaritySet = new Set(observations.map((item) => item.direction));
    const polarity: SignalGroup["polarity"] = polaritySet.size === 1 ? observations[0].direction : "mixed";
    const starts = observations.map((item) => item.currentWindow.startAt).sort();
    const ends = observations.map((item) => item.currentWindow.endAt).sort();
    const theme = first.theme ?? incident?.primaryTheme ?? null;
    const metric = first.anomaly.metric;
    const label = first.signalLabel || metricLabel(metric);
    const affectedLabel = campaignIds.size
      ? `${campaignIds.size} affected ${campaignIds.size === 1 ? "campaign" : "campaigns"}`
      : entityIds.size
        ? `${entityIds.size} affected ${entityKinds.size === 1 ? [...entityKinds][0] : "entities"}${entityIds.size === 1 && entityKinds.size === 1 ? "" : "s"}`
        : "Business-wide";
    const lastTriggeredAt = incident?.lastTriggeredAt ?? observations.map((item) => item.detectedAt).sort().at(-1)!;
    const sortedObservations = [...observations].sort((a, b) => Number(b.isBusinessAggregate) - Number(a.isBusinessAggregate)
      || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.detectedAt.localeCompare(a.detectedAt));

    return {
      groupId,
      businessId: first.businessId,
      simulationRunId: first.simulationRunId,
      incidentId: incident?.incidentId ?? null,
      incidentTitle: incident?.title ?? null,
      incidentSummary: incident?.summary ?? null,
      investigationId: incident?.investigationId ?? investigation?.investigationId ?? null,
      investigationTitle: investigation?.title ?? null,
      signalFamilyId: first.signalId ?? metric,
      title: `${theme ? THEME_LABEL[theme] ?? theme : "Operational"} · ${label}`,
      metric,
      metricLabel: label,
      theme,
      severity,
      severityRank: SEVERITY_RANK[severity],
      status,
      polarity,
      campaignCount: campaignIds.size,
      entityCount: entityIds.size,
      affectedLabel,
      observationCount: observations.length,
      aggregateObservationId: aggregate?.anomalyId ?? null,
      headline,
      timeRange: { startAt: starts[0], endAt: ends.at(-1)! },
      lastTriggeredAt,
      observations: sortedObservations,
    };
  }).sort((a, b) => b.severityRank - a.severityRank || b.lastTriggeredAt.localeCompare(a.lastTriggeredAt) || a.title.localeCompare(b.title));
}
