import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { InvestigationIndex } from "@/components/explainwhy/DashboardSections";

export const metadata: Metadata = { title: "Investigations · ExplainWhy", description: "Persisted investigations and their linked evidence for the selected simulation run." };

export default function InvestigationsPage() {
  return <AppShell title="Investigations" hidePageHeading><InvestigationIndex /></AppShell>;
}
