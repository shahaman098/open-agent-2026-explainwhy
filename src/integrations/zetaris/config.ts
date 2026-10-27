import "server-only";
import { z } from "zod";

// Relation names come from the operator, never an investigation or model output.
const Relation = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/);
export interface ZetarisConfig { baseUrl: string; apiKey: string; orgId: string; adsRelation: string; campaignsRelation: string }
export const ZETARIS_ENV = ["ZETARIS_BASE_URL", "ZETARIS_API_KEY", "ZETARIS_ORG_ID", "ZETARIS_ADS_RELATION", "ZETARIS_CAMPAIGNS_RELATION"] as const;

export function zetarisStatus() {
  const enabled = process.env.EXPLAINWHY_ZETARIS_ENABLED === "true";
  const missing = ZETARIS_ENV.filter((key) => !process.env[key]?.trim());
  return { enabled, configured: enabled && missing.length === 0, missing: [...missing] };
}

export function zetarisConfig(): ZetarisConfig {
  const status = zetarisStatus();
  if (!status.configured) throw new Error(status.enabled ? `Zetaris configuration missing: ${status.missing.join(", ")}` : "Zetaris integration is disabled");
  const url = new URL(process.env.ZETARIS_BASE_URL!);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("Zetaris requires HTTPS or a loopback HTTP endpoint without embedded credentials");
  return {
    baseUrl: url.href.replace(/\/$/, ""), apiKey: process.env.ZETARIS_API_KEY!.trim(),
    orgId: z.string().regex(/^\d+$/).parse(process.env.ZETARIS_ORG_ID),
    adsRelation: Relation.parse(process.env.ZETARIS_ADS_RELATION), campaignsRelation: Relation.parse(process.env.ZETARIS_CAMPAIGNS_RELATION),
  };
}

export function quoteRelation(name: string): string { return Relation.parse(name).split(".").map((part) => `\`${part}\``).join("."); }
