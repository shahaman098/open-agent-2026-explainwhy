import type { BusinessEventT } from "@normal/contracts";
import type { ScenarioNameT, ScenarioParams } from "@/simulator/scenarios";
import type { RngState } from "@/simulator/rng";
import type { SimulationConfig } from "@/simulator/config";
import type {
  SimulatedCampaign, SimulatedCustomer, SimulatedOrder, SimulatedProduct, SimulatedReview,
  SimulatedSession, SimulatedShipment, SimulatedStorefront,
} from "@/types/domain";

export interface SimulatorCounters {
  session: number; order: number; customer: number; shipment: number; review: number;
  mention: number; checkout: number; refund: number;
}

export interface TickReceipt {
  key: string;
  response: { simulationRunId: string; virtualTime: string; generatedEventIds: string[]; generatedEventsCount: number; metricSnapshotIds: string[] };
  recordedAt: string;
}

/**
 * Durable simulator state (one document per run). Canonical `SimulatorRun`
 * fields are kept at the top level so the record can be projected straight
 * into the contract. `scenarioParams` is PRIVATE.
 */
export interface SimulatorStateDoc {
  schemaVersion: 1;
  businessId: string;
  simulationRunId: string;
  seed: number;
  status: "created" | "running" | "paused" | "completed";
  virtualTime: string;
  minutesPerTick: number;
  activeScenario: ScenarioNameT;
  scenarioSeverity: number;
  createdAt: string;
  updatedAt: string;
  // --- supplementary ---
  virtualStartAt: string;
  tickIndex: number;
  rng: RngState;
  counters: SimulatorCounters;
  /** Storefront (human) checkout counter, incremented atomically and never overwritten by ticks. */
  storefrontOrderCounter: number;
  config: SimulationConfig;
  /** PRIVATE mechanistic fault parameters. Never serialise to public APIs. */
  scenarioParams: ScenarioParams;
  scenarioInjectedAt: string | null;
  lock: { token: string; expiresAt: string } | null;
  recentTickReceipts: TickReceipt[];
  totals: { events: number; orders: number; sessions: number };
}

export interface World {
  state: SimulatorStateDoc;
  products: Map<string, SimulatedProduct>;
  campaigns: Map<string, SimulatedCampaign>;
  customers: Map<string, SimulatedCustomer>;
  /** Shipments that still have a scheduled transition or a scheduled review. */
  shipments: SimulatedShipment[];
  storefront: SimulatedStorefront | null;
}

export interface TickOutput {
  tickIndex: number;
  windowStart: string;
  windowEnd: string;
  events: BusinessEventT[];
  sessions: SimulatedSession[];
  orders: SimulatedOrder[];
  orderRefunds: Array<{ orderId: string; refundedMinor: number; status: SimulatedOrder["status"] }>;
  newCustomers: SimulatedCustomer[];
  touchedCustomerIds: Set<string>;
  newShipments: SimulatedShipment[];
  updatedShipmentIds: Set<string>;
  reviews: SimulatedReview[];
  touchedProductIds: Set<string>;
  /** productId -> units consumed by simulator orders this tick (applied atomically by the runtime). */
  unitsConsumed: Map<string, number>;
  touchedCampaignIds: Set<string>;
}
