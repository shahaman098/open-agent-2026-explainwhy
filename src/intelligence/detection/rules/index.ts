import type { SignalDef } from "@/intelligence/detection/signal";
import { ADVERTISING_SIGNALS } from "@/intelligence/detection/rules/advertising";
import { CHECKOUT_SIGNALS } from "@/intelligence/detection/rules/checkout";
import { DEMAND_SIGNALS } from "@/intelligence/detection/rules/demand";
import { INVENTORY_SIGNALS } from "@/intelligence/detection/rules/inventory";
import { REPUTATION_SIGNALS } from "@/intelligence/detection/rules/reputation";
import { REVENUE_SIGNALS } from "@/intelligence/detection/rules/revenue";
import { SHIPPING_SIGNALS } from "@/intelligence/detection/rules/shipping";

export const ALL_SIGNALS: readonly SignalDef[] = [
  ...REVENUE_SIGNALS, ...ADVERTISING_SIGNALS, ...CHECKOUT_SIGNALS, ...SHIPPING_SIGNALS,
  ...INVENTORY_SIGNALS, ...REPUTATION_SIGNALS, ...DEMAND_SIGNALS,
];

export const SIGNALS_BY_ID: ReadonlyMap<string, SignalDef> = new Map(ALL_SIGNALS.map((s) => [s.id, s]));
