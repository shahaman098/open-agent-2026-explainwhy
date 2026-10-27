import type { Metadata } from "next";
import { AppShell } from "@/components/normal/AppShell";
import { ProcessFlow } from "@/components/normal/ProcessFlow";

export const metadata: Metadata = { title: "Architecture · Normal", description: "Observe → Detect → Retrieve → Investigate → Plan → Approve → Execute → Verify → Learn, with measured readiness per stage." };

export default function ArchitecturePage() {
  return <AppShell title="Architecture"><ProcessFlow /></AppShell>;
}
