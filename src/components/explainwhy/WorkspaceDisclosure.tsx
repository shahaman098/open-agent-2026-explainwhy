"use client";
import { useSearchParams } from "next/navigation";
export function WorkspaceDisclosure() {
  const search = useSearchParams();
  return <div>{search.get("businessId") === "nvidia_demo" ? "NVIDIA public financial disclosures are shown as dated USD reference data. GPU offers, GBP prices, orders, advertising, shipping and operational metrics are synthetic UK-channel demo records. This project is unaffiliated with NVIDIA." : "Nike names and imagery are used in an unaffiliated synthetic simulation. Operational metrics come from the selected run. The Shopify intro uses separate synthetic presentation fixtures."}</div>;
}
