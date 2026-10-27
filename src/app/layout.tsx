import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { configuredModels, modelDisplayName } from "@/intelligence/model-settings";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ExplainWhy Agent",
  description: "Open Agent Hackathon 2026 — evidence-led business operations investigation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const { researchModel, ...reasoningModels } = configuredModels();
  const modelNames = [...new Set(Object.values(reasoningModels))].map(modelDisplayName).join(", ");
  const researchName = process.env.EXPLAINWHY_EXTERNAL_RESEARCH_ENABLED === "true"
    ? process.env.EXPLAINWHY_RESEARCH_PROVIDER === "brightdata" ? "Bright Data public search" : `${modelDisplayName(researchModel)} public search`
    : null;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <footer className="demo-disclaimer">
          <div>Configured AI: {modelNames} {process.env.NVIDIA_INFERENCE_MODE === "local" ? "through the local inference server" : "via the NVIDIA API catalog"}.{researchName ? ` Research: ${researchName}.` : ""}</div>
          Nike names and imagery are used in an unaffiliated synthetic simulation. Operational metrics come from the selected run. The Shopify intro uses separate synthetic presentation fixtures.
        </footer>
      </body>
    </html>
  );
}
