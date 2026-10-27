import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { ActivityConsole } from "@/components/explainwhy/ActivityConsole";

export const metadata: Metadata = { title: "Activity · ExplainWhy", description: "Run-scoped operations and business activity." };

export default function ActivityRoute() {
  return <AppShell title="Activity" hidePageHeading><ActivityConsole /></AppShell>;
}
