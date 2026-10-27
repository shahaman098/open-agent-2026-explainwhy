import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { InvestigationWorkspace } from "@/components/explainwhy/InvestigationWorkspace";

export const metadata: Metadata = { title: "Investigation · ExplainWhy", description: "Verified diagnosis, recommended action, evidence, execution and measured outcome for one incident." };

/** The investigation id is read client-side (useParams) inside the shell's Suspense boundary; all data comes from the scoped APIs. */
export default function InvestigationPage() {
  return <AppShell title="Investigation" hidePageHeading><InvestigationWorkspace /></AppShell>;
}
