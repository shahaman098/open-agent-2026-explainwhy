import type { Metadata } from "next";
import { MetaAdsManagerPage } from "@/components/partner/MetaAdsManager";

export const metadata: Metadata = {
  title: "Ads Manager · Nike Demo Account",
  description: "A standalone Meta Ads Manager style simulation showing campaigns and recorded performance for the selected run.",
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MetaAdsManagerPage campaignId={id} />;
}
