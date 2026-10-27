import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { ProcessFlow } from "@/components/explainwhy/ProcessFlow";

export const metadata: Metadata = { title: "Architecture · ExplainWhy", description: "Observe → Detect → Retrieve → Investigate → Plan → Approve → Execute → Verify → Learn, with measured readiness per stage." };

export default function ArchitecturePage() {
  return <AppShell title="Architecture"><ProcessFlow /></AppShell>;
}
