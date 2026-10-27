import type { Metadata } from "next";
import { AppShell } from "@/components/normal/AppShell";
import { OperationsOverview } from "@/components/normal/OperationsOverview";

export const metadata: Metadata = { title: "Operations overview · Normal", description: "Operational risk, campaign performance, business metrics and signals for the selected simulation run." };

export default function DashboardPage() {
  return <AppShell title="Operations overview"><OperationsOverview /></AppShell>;
}
