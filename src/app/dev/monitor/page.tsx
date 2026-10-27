import type { Metadata } from "next";
import { MonitorConsole } from "@/components/monitor/MonitorConsole";

export const metadata: Metadata = {
  title: "Anomaly monitor — Nike (unaffiliated simulation) · Normal",
  description: "Run anomaly scans and inspect detected incidents, anomalies and investigations computed from the canonical event ledger.",
};

export default function MonitorPage() {
  return <MonitorConsole />;
}
