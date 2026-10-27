import type { Metadata } from "next";
import { AppShell } from "@/components/normal/AppShell";
import { ActivityConsole } from "@/components/normal/ActivityConsole";

export const metadata: Metadata = { title: "Activity · Normal", description: "Run-scoped operations and business activity." };

export default function ActivityRoute() {
  return <AppShell title="Activity" hidePageHeading><ActivityConsole /></AppShell>;
}
