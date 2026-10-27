import type { Metadata } from "next";
import { AppShell } from "@/components/explainwhy/AppShell";
import { IntegrationStatus } from "@/components/explainwhy/IntegrationStatus";
export const metadata: Metadata = { title: "Integrations · ExplainWhy" };
export default function IntegrationsPage() { return <AppShell title="Integrations" hidePageHeading><IntegrationStatus /></AppShell>; }
