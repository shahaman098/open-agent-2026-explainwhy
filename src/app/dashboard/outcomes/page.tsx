import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { OutcomesPage as OutcomesContent } from "@/components/explainwhy/DashboardSections";

export const metadata: Metadata = { title: "Outcomes · ExplainWhy", description: "Verified execution and measured business outcomes for the selected simulation run." };

export default function OutcomesRoute() {
  return <AppShell title="Outcomes" hidePageHeading><OutcomesContent /></AppShell>;
}
