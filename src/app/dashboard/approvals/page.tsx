import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { Approvals as ApprovalsContent } from "@/components/explainwhy/Approvals";

export const metadata: Metadata = { title: "Approvals · ExplainWhy", description: "Approval handoff status and readiness for the selected simulation run." };

export default function ApprovalsRoute() {
  return <AppShell title="Approvals" hidePageHeading><ApprovalsContent /></AppShell>;
}
