import type { Metadata } from "next";
import { AppShell } from "@/components/normal/AppShell";
import { MonitoringPage as MonitoringContent } from "@/components/normal/DashboardSections";

export const metadata: Metadata = { title: "Monitoring · Normal", description: "Worker health and scheduled monitoring status for the selected simulation run." };

export default function MonitoringRoute() {
  return <AppShell title="Monitoring"><MonitoringContent /></AppShell>;
}
