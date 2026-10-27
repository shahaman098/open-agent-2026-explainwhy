import type { Metadata } from "next";
import { AppShell } from "@/components/normal/AppShell";
import { OutcomesPage as OutcomesContent } from "@/components/normal/DashboardSections";

export const metadata: Metadata = { title: "Outcomes · Normal", description: "Verified execution and measured business outcomes for the selected simulation run." };

export default function OutcomesRoute() {
  return <AppShell title="Outcomes" hidePageHeading><OutcomesContent /></AppShell>;
}
