import type { Metadata } from "next";
import { AppShell } from "@/components/normal/AppShell";
import { SignalsPage } from "@/components/normal/SignalsInbox";

export const metadata: Metadata = {
  title: "Signals · Normal",
  description: "Review consolidated incidents for the selected simulation run.",
};

export default function DashboardSignalsPage() {
  return <AppShell title="Signals" hidePageHeading><SignalsPage /></AppShell>;
}
