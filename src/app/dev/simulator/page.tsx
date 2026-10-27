import type { Metadata } from "next";
import { ControlRoom } from "@/components/control-room/ControlRoom";

export const metadata: Metadata = {
  title: "Business control room — Nike (unaffiliated simulation) · ExplainWhy",
  description: "Simulator control room: virtual time, incident injection and metrics computed from the canonical event ledger.",
};

export default function SimulatorPage() {
  return <ControlRoom />;
}
