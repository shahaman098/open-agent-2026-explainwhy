import type { Metadata } from "next";
import { AppShell } from "@/components/normal/AppShell";
import { InvestigationIndex } from "@/components/normal/DashboardSections";

export const metadata: Metadata = { title: "Investigations · Normal", description: "Persisted investigations and their linked evidence for the selected simulation run." };

export default function InvestigationsPage() {
  return <AppShell title="Investigations" hidePageHeading><InvestigationIndex /></AppShell>;
}
