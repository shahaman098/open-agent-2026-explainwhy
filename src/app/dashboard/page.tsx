import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { OperationsOverview } from "@/components/explainwhy/OperationsOverview";

export const metadata: Metadata = { title: "Operations overview · ExplainWhy", description: "Operational risk, campaign performance, business metrics and signals for the selected simulation run." };

export default function DashboardPage() {
  return <AppShell title="Operations overview"><OperationsOverview /></AppShell>;
}
