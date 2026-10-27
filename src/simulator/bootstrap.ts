import type { ReferenceProductT } from "@/reference/schemas";
import { buildSimulatedProducts } from "@/simulator/catalogue";
import {
  CAMPAIGN_SEEDS, CATEGORIES, DEFAULT_CONFIG, DEFAULT_MINUTES_PER_TICK, DEFAULT_VIRTUAL_START, DEVICES, DEVICE_WEIGHTS,
  FIRST_NAMES, HOUR_WEIGHTS, LAST_INITIALS, ORGANIC_CHANNELS, ORGANIC_CHANNEL_WEIGHTS, type SimulationConfig,
} from "@/simulator/config";
import { FREQUENCY_WINDOW_HOURS } from "@/simulator/engine";
import { Rng } from "@/simulator/rng";
import { HEALTHY_PARAMS } from "@/simulator/scenarios";
import type { SimulatorStateDoc, World } from "@/simulator/state";
import { pad } from "@/simulator/time";
import type { SimulatedCampaign, SimulatedCustomer, SimulatedStorefront } from "@/types/domain";

export interface BootstrapOptions {
  businessId: string;
  simulationRunId: string;
  seed: number;
  catalogue: readonly ReferenceProductT[];
  virtualStartAt?: string;
  minutesPerTick?: number;
  config?: Partial<SimulationConfig>;
  /** Wall-clock creation time (not part of determinism). */
  createdAt: string;
}

/**
 * Builds the initial in-memory world for a run. Pure: the same options produce
 * the same world and the same RNG state, so two runs with equal seeds replay
 * identically.
 */
export function createInitialWorld(opts: BootstrapOptions): { world: World; rng: Rng } {
  const virtualStartAt = opts.virtualStartAt ?? DEFAULT_VIRTUAL_START;
  const minutesPerTick = opts.minutesPerTick ?? DEFAULT_MINUTES_PER_TICK;
  const config: SimulationConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const rng = Rng.fromSeed(opts.seed);

  const products = buildSimulatedProducts(opts.businessId, opts.simulationRunId, opts.catalogue, virtualStartAt);

  const campaigns: SimulatedCampaign[] = CAMPAIGN_SEEDS.map((seed) => {
    const expectedDaily = (seed.dailyBudgetMinor * 1000) / seed.cpmMinor;
    // Prime the rolling window with steady-state hourly impressions so frequency starts realistic.
    const rolling: number[] = [];
    for (let h = 0; h < FREQUENCY_WINDOW_HOURS; h++) rolling.push(Math.round((expectedDaily / 24) * (HOUR_WEIGHTS[h % 24] ?? 1) * 0.92));
    return {
      businessId: opts.businessId, simulationRunId: opts.simulationRunId, campaignId: seed.campaignId, name: seed.name,
      platform: seed.platform, channel: seed.channel, targetCategory: seed.targetCategory, targetProductIds: [...seed.targetProductIds],
      status: "active", dailyBudgetMinor: seed.dailyBudgetMinor, currency: "GBP", cpmMinor: seed.cpmMinor, baseCtr: seed.baseCtr,
      creativeQuality: seed.creativeQuality, audienceRelevance: seed.audienceRelevance, audienceSize: seed.audienceSize,
      rollingImpressions: rolling,
      totals: { impressions: 0, clicks: 0, spendMinor: 0, sessions: 0, attributedOrders: 0, attributedRevenueMinor: 0 },
      budgetSpentTodayMinor: 0, budgetDay: virtualStartAt.slice(0, 10), createdAt: virtualStartAt, updatedAt: virtualStartAt,
    };
  });

  const customers: SimulatedCustomer[] = [];
  for (let i = 1; i <= config.initialCustomers; i++) {
    const interestCount = rng.chance(0.35) ? 2 : 1;
    const interests = new Set<SimulatedCustomer["interests"][number]>();
    while (interests.size < interestCount) interests.add(rng.pick(CATEGORIES));
    customers.push({
      businessId: opts.businessId, simulationRunId: opts.simulationRunId, customerId: `cust_${opts.simulationRunId}_${pad(i)}`,
      displayName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_INITIALS)}.`,
      preferredDevice: rng.weightedPick(DEVICES, (d) => DEVICE_WEIGHTS[d]),
      acquisitionChannel: rng.weightedPick(ORGANIC_CHANNELS, (c) => ORGANIC_CHANNEL_WEIGHTS[c] ?? 0),
      interests: [...interests], purchasePropensity: rng.uniform(0.3, 1.0), priceSensitivity: rng.uniform(0.2, 1.0),
      deliverySensitivity: rng.uniform(0.2, 1.0), satisfaction: rng.uniform(0.6, 0.9), ordersPlaced: rng.chance(0.4) ? 1 : 0,
      createdAt: virtualStartAt, lastSeenAt: virtualStartAt,
    });
  }

  const storefront: SimulatedStorefront = {
    businessId: opts.businessId, simulationRunId: opts.simulationRunId, banners: [], promotions: [], updatedAt: virtualStartAt,
  };

  const state: SimulatorStateDoc = {
    schemaVersion: 1, businessId: opts.businessId, simulationRunId: opts.simulationRunId, seed: opts.seed, status: "running",
    virtualTime: virtualStartAt, minutesPerTick, activeScenario: "healthy", scenarioSeverity: 0,
    createdAt: opts.createdAt, updatedAt: opts.createdAt,
    virtualStartAt, tickIndex: 0, rng: rng.getState(),
    counters: { session: 0, order: 0, customer: config.initialCustomers, shipment: 0, review: 0, mention: 0, checkout: 0, refund: 0 },
    storefrontOrderCounter: 0, config, scenarioParams: { ...HEALTHY_PARAMS }, scenarioInjectedAt: null, lock: null,
    recentTickReceipts: [], totals: { events: 0, orders: 0, sessions: 0 },
  };

  return {
    world: {
      state, products: new Map(products.map((p) => [p.productId, p])), campaigns: new Map(campaigns.map((c) => [c.campaignId, c])),
      customers: new Map(customers.map((c) => [c.customerId, c])), shipments: [], storefront,
    },
    rng,
  };
}

/** Deep-copies a world (used by tests and by restart-safety checks). */
export function cloneWorld(world: World): World {
  const clone = JSON.parse(JSON.stringify({
    state: world.state, products: [...world.products.values()], campaigns: [...world.campaigns.values()],
    customers: [...world.customers.values()], shipments: world.shipments, storefront: world.storefront,
  })) as { state: SimulatorStateDoc; products: World["products"] extends Map<string, infer P> ? P[] : never; campaigns: SimulatedCampaign[]; customers: SimulatedCustomer[]; shipments: World["shipments"]; storefront: SimulatedStorefront | null };
  return {
    state: clone.state, products: new Map(clone.products.map((p) => [p.productId, p])),
    campaigns: new Map(clone.campaigns.map((c) => [c.campaignId, c])), customers: new Map(clone.customers.map((c) => [c.customerId, c])),
    shipments: clone.shipments, storefront: clone.storefront,
  };
}
