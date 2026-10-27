import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { SignalsPage } from "@/components/explainwhy/SignalsInbox";

export const metadata: Metadata = {
  title: "Signals · ExplainWhy",
  description: "Review consolidated incidents for the selected simulation run.",
};

export default function DashboardSignalsPage() {
  return <AppShell title="Signals" hidePageHeading><SignalsPage /></AppShell>;
}
