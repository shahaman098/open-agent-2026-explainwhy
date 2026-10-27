import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { MonitoringPage as MonitoringContent } from "@/components/explainwhy/DashboardSections";

export const metadata: Metadata = { title: "Monitoring · ExplainWhy", description: "Worker health and scheduled monitoring status for the selected simulation run." };

export default function MonitoringRoute() {
  return <AppShell title="Monitoring"><MonitoringContent /></AppShell>;
}
