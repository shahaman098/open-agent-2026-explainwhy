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
  title: "Normal",
  description: "Evidence-led business operations powered by Gemini 4 Argon through Mubit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const modelNames = [...new Set(Object.values(configuredModels()))].map(modelDisplayName).join(", ");
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <footer className="demo-disclaimer">
          <div>Configured AI: {modelNames} through Mubit.</div>
          Nike names and imagery are used in an unaffiliated synthetic simulation. Operational metrics come from the selected run. The Shopify intro uses separate synthetic presentation fixtures.
        </footer>
      </body>
    </html>
  );
}
