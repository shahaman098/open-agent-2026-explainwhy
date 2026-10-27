import type { BusinessEventT } from "@normal/contracts";
import {
  CATEGORIES, CHANNEL_CONVERSION_FACTOR, DEVICES, DEVICE_WEIGHTS, DISPATCH_MAX_HOURS, DISPATCH_MIN_HOURS,
  FIRST_NAMES, HOUR_WEIGHTS, LAST_INITIALS, ORGANIC_CHANNELS, ORGANIC_CHANNEL_WEIGHTS, STANDARD_DELIVERY_HOURS,
} from "@/simulator/config";
import { buildSimulatorEvent } from "@/simulator/events";
import type { Rng } from "@/simulator/rng";
import type { TickOutput, World } from "@/simulator/state";
import { addHours, addMinutes, dayKey, minutesBetween, pad } from "@/simulator/time";
import type {
  Channel, Device, SimulatedCampaign, SimulatedCustomer, SimulatedOrder, SimulatedOrderLine, SimulatedProduct,
  SimulatedReview, SimulatedSession, SimulatedShipment,
} from "@/types/domain";

/** Rolling impression window (hours) used to derive ad frequency. */
export const FREQUENCY_WINDOW_HOURS = 168;
const FREQUENCY_COMFORT_THRESHOLD = 3.0;
const COUPON_PERCENT_OFF = 15;

const REVIEW_TEXTS: Record<"delivery" | "quality" | "positive" | "neutral", string[]> = {
  delivery: [
    "Product is fine but the parcel arrived well after the promised date.",
    "Late delivery with no update; the shoes themselves are good.",
    "Waited far longer than expected for this order to arrive.",
    "Delivery was delayed by days, which spoilt the experience.",
  ],
  quality: [
    "Disappointed with the build quality on this pair.",
    "Stitching came loose within a week of wearing.",
    "Not the quality I expected at this price.",
    "Sizing and finish were off compared with previous pairs.",
  ],
  positive: [
    "Exactly as described and arrived on time. Very comfortable.",
    "Great fit and fast delivery, would buy again.",
    "Love these, true to size and look even better in person.",
    "Smooth order, quick dispatch, no complaints.",
  ],
  neutral: [
    "Decent product, delivery was fine.",
    "Does the job. Nothing special about the ordering experience.",
    "Okay overall; fit is a little narrow for me.",
  ],
};

const MENTION_TEXTS = [
  "Everyone on my feed is wearing the {product} right now.",
  "Just picked up the {product} and they are unreal.",
  "Is the {product} worth it? Seeing it everywhere this week.",
  "The {product} drop is all over my timeline.",
];
const PLATFORMS = ["tiktok", "instagram", "x", "reddit"];

export class TickEngine {
  private readonly out: TickOutput;
  private readonly start: string;
  private readonly end: string;
  private readonly hourWeight: number;

  constructor(private readonly world: World, private readonly rng: Rng, private readonly receivedAt: string) {
    const s = world.state;
    this.start = s.virtualTime;
    this.end = addMinutes(s.virtualTime, s.minutesPerTick);
    this.hourWeight = HOUR_WEIGHTS[new Date(this.start).getUTCHours()] ?? 1;
    this.out = {
      tickIndex: s.tickIndex, windowStart: this.start, windowEnd: this.end,
      events: [], sessions: [], orders: [], orderRefunds: [], newCustomers: [], touchedCustomerIds: new Set(),
      newShipments: [], updatedShipmentIds: new Set(), reviews: [], touchedProductIds: new Set(),
      unitsConsumed: new Map(), touchedCampaignIds: new Set(),
    };
  }

  /** Runs one tick and advances the world's virtual clock. */
  run(): TickOutput {
    const s = this.world.state;
    this.runAdvertising();
    this.runOrganicTraffic();
    this.runFulfilment();
    this.runReviews();
    this.runSocialMentions();
    this.emitInventoryLevels();
    s.virtualTime = this.end;
    s.tickIndex += 1;
    s.totals.events += this.out.events.length;
    s.totals.orders += this.out.orders.length;
    s.totals.sessions += this.out.sessions.length;
    return this.out;
  }

  // ---------------------------------------------------------------- helpers
  private get state() { return this.world.state; }
  private get params() { return this.world.state.scenarioParams; }
  private get runId() { return this.world.state.simulationRunId; }
  private get businessId() { return this.world.state.businessId; }

  private nextId(kind: keyof World["state"]["counters"], prefix: string): string {
    const n = ++this.state.counters[kind];
    return `${prefix}_${this.runId}_${pad(n)}`;
  }

  private emit<T extends BusinessEventT["type"]>(
    type: T, payload: Parameters<typeof buildSimulatorEvent<T>>[1], occurredAt: string, sourceRecordId: string, correlationId?: string,
  ): void {
    this.out.events.push(buildSimulatorEvent(type, payload, {
      businessId: this.businessId, simulationRunId: this.runId, occurredAt, receivedAt: this.receivedAt,
      sourceRecordId: `${this.runId}:${sourceRecordId}`, correlationId,
    }));
  }

  private randomTimeInTick(): string {
    return new Date(Date.parse(this.start) + Math.floor(this.rng.next() * (Date.parse(this.end) - Date.parse(this.start)))).toISOString();
  }

  private activeProducts(): SimulatedProduct[] {
    return [...this.world.products.values()].filter((p) => p.active);
  }

  private productWeight(p: SimulatedProduct, categories: readonly string[]): number {
    let w = p.popularity * (categories.includes(p.category) ? 1 : 0.25);
    if (this.params.viralProductId === p.productId) w *= 1 + this.params.viralInterestBoost;
    return w;
  }

  // ------------------------------------------------------------ advertising
  private runAdvertising(): void {
    const today = dayKey(this.start);
    for (const campaign of this.world.campaigns.values()) {
      if (campaign.budgetDay !== today) {
        campaign.budgetDay = today;
        campaign.budgetSpentTodayMinor = 0;
      }
      if (campaign.status !== "active" || campaign.dailyBudgetMinor <= 0) {
        this.recordAdHour(campaign, 0, 0, 0, this.currentFrequency(campaign, 0), []);
        continue;
      }
      const remaining = Math.max(0, campaign.dailyBudgetMinor - campaign.budgetSpentTodayMinor);
      const pacedAllowance = Math.floor((campaign.dailyBudgetMinor / 24) * this.hourWeight * 1.6);
      const allowance = Math.min(remaining, pacedAllowance);
      const byBudget = Math.floor((allowance * 1000) / campaign.cpmMinor);
      const byAudience = Math.floor(campaign.audienceSize * this.hourWeight * 0.25);
      let impressions = Math.floor(Math.min(byBudget, byAudience) * this.rng.uniform(0.85, 1.0));
      let spend = Math.ceil((impressions * campaign.cpmMinor) / 1000);
      while (spend > allowance && impressions > 0) {
        impressions -= 1;
        spend = Math.ceil((impressions * campaign.cpmMinor) / 1000);
      }
      const frequency = this.currentFrequency(campaign, impressions);
      const fatigue = 1 / (1 + this.params.ctrFatigueStrength * Math.max(0, frequency - FREQUENCY_COMFORT_THRESHOLD));
      const ctr = Math.min(0.5, campaign.baseCtr * campaign.creativeQuality * campaign.audienceRelevance * fatigue * this.rng.uniform(0.92, 1.08));
      const clicks = this.rng.binomial(impressions, ctr);
      const landed = this.rng.binomial(clicks, this.state.config.landingRate);

      const orders: SimulatedOrder[] = [];
      for (let i = 0; i < landed; i++) {
        const order = this.simulateSession(campaign.channel, campaign);
        if (order) orders.push(order);
      }
      this.recordAdHour(campaign, impressions, clicks, spend, frequency, orders);
    }
  }

  private currentFrequency(campaign: SimulatedCampaign, impressionsThisHour: number): number {
    const window = [...campaign.rollingImpressions.slice(-(FREQUENCY_WINDOW_HOURS - 1)), impressionsThisHour];
    const total = window.reduce((a, b) => a + b, 0);
    const effectiveAudience = Math.max(1, campaign.audienceSize * (1 - this.params.adAudienceShrink));
    return Math.round((total / effectiveAudience) * 100) / 100;
  }

  private recordAdHour(campaign: SimulatedCampaign, impressions: number, clicks: number, spend: number, frequency: number, orders: SimulatedOrder[]): void {
    campaign.rollingImpressions = [...campaign.rollingImpressions.slice(-(FREQUENCY_WINDOW_HOURS - 1)), impressions];
    campaign.budgetSpentTodayMinor += spend;
    const attributedRevenue = orders.reduce((a, o) => a + o.netRevenueMinor, 0);
    campaign.totals.impressions += impressions;
    campaign.totals.clicks += clicks;
    campaign.totals.spendMinor += spend;
    campaign.totals.sessions += this.out.sessions.filter((s) => s.campaignId === campaign.campaignId && s.startedAt >= this.start && s.startedAt < this.end).length;
    campaign.totals.attributedOrders += orders.length;
    campaign.totals.attributedRevenueMinor += attributedRevenue;
    campaign.updatedAt = this.end;
    this.out.touchedCampaignIds.add(campaign.campaignId);
    this.emit("ad.metrics_observed", {
      campaignId: campaign.campaignId, window: { startAt: this.start, endAt: this.end },
      impressions, clicks, spendMinor: spend, attributedOrders: orders.length,
      attributedRevenueMinor: attributedRevenue, frequency, currency: "GBP",
    }, this.end, `ad:${campaign.campaignId}:t${pad(this.state.tickIndex)}`);
  }

  // ---------------------------------------------------------------- traffic
  private runOrganicTraffic(): void {
    const base = this.state.config.baseOrganicSessionsPerHour * this.hourWeight;
    const baseline = this.rng.poisson(base);
    for (let i = 0; i < baseline; i++) {
      const channel = this.rng.weightedPick(ORGANIC_CHANNELS, (c) => ORGANIC_CHANNEL_WEIGHTS[c] ?? 0);
      this.simulateSession(channel);
    }
    const viralExtra = this.rng.poisson(base * Math.max(0, this.params.organicTrafficMultiplier - 1));
    for (let i = 0; i < viralExtra; i++) this.simulateSession("social");
  }

  private sampleDevice(): Device {
    return this.rng.weightedPick(DEVICES, (d) => DEVICE_WEIGHTS[d]);
  }

  private sampleVisitor(channel: Channel, device: Device): Omit<SimulatedCustomer, "businessId" | "simulationRunId" | "customerId" | "createdAt" | "lastSeenAt" | "ordersPlaced"> {
    const interestCount = this.rng.chance(0.35) ? 2 : 1;
    const interests = new Set<SimulatedCustomer["interests"][number]>();
    while (interests.size < interestCount) interests.add(this.rng.pick(CATEGORIES));
    return {
      displayName: `${this.rng.pick(FIRST_NAMES)} ${this.rng.pick(LAST_INITIALS)}.`,
      preferredDevice: device, acquisitionChannel: channel, interests: [...interests],
      purchasePropensity: this.rng.uniform(0.3, 1.0), priceSensitivity: this.rng.uniform(0.2, 1.0),
      deliverySensitivity: this.rng.uniform(0.2, 1.0), satisfaction: 0.75,
    };
  }

  /** Simulates one session end-to-end. Returns the order if a purchase happened. */
  private simulateSession(channel: Channel, campaign?: SimulatedCampaign): SimulatedOrder | undefined {
    const startedAt = this.randomTimeInTick();
    const sessionId = this.nextId("session", "sess");
    const pool = [...this.world.customers.values()];
    const returning = pool.length > 0 && this.rng.chance(this.state.config.returningRate);
    const customer = returning ? this.rng.weightedPick(pool, (c) => (0.3 + c.purchasePropensity) * (0.5 + c.satisfaction)) : undefined;
    const device = customer && this.rng.chance(0.9) ? customer.preferredDevice : this.sampleDevice();
    const visitor = customer ?? { ...this.sampleVisitor(channel, device), ordersPlaced: 0 };

    const products = this.activeProducts();
    const candidates = campaign && this.rng.chance(0.7)
      ? products.filter((p) => campaign.targetProductIds.includes(p.productId))
      : products;
    const viewCount = this.rng.int(1, 3);
    const viewed: SimulatedProduct[] = [];
    for (let i = 0; i < viewCount && candidates.length > 0; i++) {
      const p = this.rng.weightedPick(candidates, (x) => this.productWeight(x, visitor.interests));
      if (!viewed.includes(p)) viewed.push(p);
    }
    const primary = viewed[0];
    const session: SimulatedSession = {
      businessId: this.businessId, simulationRunId: this.runId, sessionId,
      customerId: customer?.customerId ?? "", isNewCustomer: !customer, device, channel,
      ...(campaign ? { campaignId: campaign.campaignId } : {}),
      startedAt, viewedProductIds: viewed.map((p) => p.productId), cart: [], outcome: "browsed",
    };
    this.out.sessions.push(session);
    this.emit("web.session_started", {
      sessionId, device, channel, ...(campaign ? { campaignId: campaign.campaignId } : {}),
    }, startedAt, `session:${sessionId}`, sessionId);
    if (customer) {
      customer.lastSeenAt = startedAt;
      this.out.touchedCustomerIds.add(customer.customerId);
    }
    if (!primary) return undefined;

    const quantity = primary.category === "apparel" && this.rng.chance(0.15) ? 2 : 1;
    const priceFactor = Math.min(1.3, Math.max(0.4, 1.25 - visitor.priceSensitivity * (primary.priceMinor / 12000)));
    let p = this.state.config.baseConversion * CHANNEL_CONVERSION_FACTOR[channel] * (0.5 + visitor.purchasePropensity)
      * priceFactor * (0.5 + visitor.satisfaction);
    if (campaign) p *= this.params.paidConversionMultiplier;
    if (this.params.viralProductId === primary.productId) p *= 1.3;
    const carted = this.rng.chance(Math.min(1, p * 4));
    if (carted) session.cart = [{ productId: primary.productId, quantity }];
    if (!carted || !this.rng.chance(p / Math.min(1, p * 4))) {
      session.outcome = carted ? "abandoned_cart" : "browsed";
      return undefined;
    }

    // Checkout attempt.
    const checkoutAt = addMinutes(startedAt, this.rng.int(3, 25));
    const available = (primary.availableUnits - (this.out.unitsConsumed.get(primary.productId) ?? 0)) >= quantity;
    if (!available) {
      return this.failCheckout(session, checkoutAt, "out_of_stock", undefined, "stockout");
    }
    const usesCoupon = this.rng.chance(this.params.couponUsageRate);
    if (usesCoupon && this.rng.chance(this.params.couponFailureRate)) {
      return this.failCheckout(session, checkoutAt, "coupon_rejected", this.params.couponCode, "checkout_failed");
    }

    const resolvedCustomer = customer ?? this.createCustomer(visitor, startedAt);
    const line = this.buildLine(primary, quantity, usesCoupon ? COUPON_PERCENT_OFF : 0);
    const order = this.placeOrder(session, resolvedCustomer, [line], checkoutAt, usesCoupon ? this.params.couponCode : undefined, campaign?.campaignId);
    return order;
  }

  private failCheckout(session: SimulatedSession, at: string, failureCode: string, couponCode: string | undefined, outcome: SimulatedSession["outcome"]): undefined {
    const checkoutId = this.nextId("checkout", "chk");
    session.outcome = outcome;
    session.checkoutId = checkoutId;
    session.failureCode = failureCode;
    this.emit("checkout.failed", {
      checkoutId, sessionId: session.sessionId, failureCode, device: session.device, ...(couponCode ? { couponCode } : {}),
    }, at, `checkout_failed:${checkoutId}`, session.sessionId);
    return undefined;
  }

  private createCustomer(visitor: ReturnType<TickEngine["sampleVisitor"]> & { ordersPlaced: number }, at: string): SimulatedCustomer {
    const customer: SimulatedCustomer = {
      businessId: this.businessId, simulationRunId: this.runId, customerId: this.nextId("customer", "cust"),
      ...visitor, createdAt: at, lastSeenAt: at,
    };
    this.world.customers.set(customer.customerId, customer);
    this.out.newCustomers.push(customer);
    return customer;
  }

  private buildLine(product: SimulatedProduct, quantity: number, extraPercentOff: number): SimulatedOrderLine {
    const unitPriceMinor = product.priceMinor;
    const gross = unitPriceMinor * quantity;
    const percent = Math.min(100, product.discountPercent + extraPercentOff);
    const discountMinor = Math.round((gross * percent) / 100);
    return { productId: product.productId, name: product.name, quantity, unitPriceMinor, discountMinor, lineTotalMinor: gross - discountMinor };
  }

  private placeOrder(session: SimulatedSession, customer: SimulatedCustomer, lines: SimulatedOrderLine[], placedAt: string, couponCode: string | undefined, campaignId: string | undefined): SimulatedOrder {
    const orderId = this.nextId("order", "ord");
    const grossTotalMinor = lines.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0);
    const discountMinor = lines.reduce((a, l) => a + l.discountMinor, 0);
    const order: SimulatedOrder = {
      businessId: this.businessId, simulationRunId: this.runId, orderId, customerId: customer.customerId,
      sessionId: session.sessionId, ...(campaignId ? { campaignId } : {}), channel: session.channel, device: session.device,
      lines, grossTotalMinor, discountMinor, netRevenueMinor: grossTotalMinor - discountMinor, refundedMinor: 0,
      currency: "GBP", ...(couponCode ? { couponCode } : {}), placedAt, origin: "simulator", status: "placed",
    };
    for (const l of lines) {
      this.out.unitsConsumed.set(l.productId, (this.out.unitsConsumed.get(l.productId) ?? 0) + l.quantity);
      this.out.touchedProductIds.add(l.productId);
    }
    session.outcome = "purchased";
    session.orderId = orderId;
    session.customerId = customer.customerId;
    customer.ordersPlaced += 1;
    customer.lastSeenAt = placedAt;
    this.out.touchedCustomerIds.add(customer.customerId);
    this.out.orders.push(order);
    this.emit("order.completed", {
      orderId, sessionId: session.sessionId, customerId: customer.customerId,
      productIds: lines.map((l) => l.productId), grossTotalMinor, discountMinor,
      netRevenueMinor: order.netRevenueMinor, currency: "GBP", ...(campaignId ? { campaignId } : {}),
    }, placedAt, `order:${orderId}`, session.sessionId);
    this.createShipment(order, placedAt);
    return order;
  }

  // -------------------------------------------------------------- fulfilment
  private createShipment(order: SimulatedOrder, placedAt: string): void {
    const dispatchAt = addHours(placedAt, this.rng.uniform(DISPATCH_MIN_HOURS, DISPATCH_MAX_HOURS));
    const shipment: SimulatedShipment = {
      businessId: this.businessId, simulationRunId: this.runId, shipmentId: this.nextId("shipment", "shp"),
      orderId: order.orderId, customerId: order.customerId, status: "pending", createdAt: placedAt,
      promisedAt: addHours(dispatchAt, STANDARD_DELIVERY_HOURS), nextTransitionAt: dispatchAt, nextStatus: "shipped",
      plannedOutcome: "on_time", reviewScheduledAt: null, refundIssued: false,
      orderNetMinor: order.netRevenueMinor, productIds: order.lines.map((l) => l.productId),
    };
    this.world.shipments.push(shipment);
    this.out.newShipments.push(shipment);
    this.emit("delivery.status_changed", { orderId: order.orderId, status: "pending", promisedAt: shipment.promisedAt },
      placedAt, `delivery:${order.orderId}:pending`, order.orderId);
  }

  private runFulfilment(): void {
    const orderNet = new Map(this.out.orders.map((o) => [o.orderId, o.netRevenueMinor]));
    for (const shipment of this.world.shipments) {
      let guard = 0;
      while (shipment.nextTransitionAt && shipment.nextTransitionAt <= this.end && guard++ < 5) {
        const at = shipment.nextTransitionAt;
        const to = shipment.nextStatus!;
        this.transition(shipment, to, at, orderNet);
        this.out.updatedShipmentIds.add(shipment.shipmentId);
      }
    }
  }

  private transition(s: SimulatedShipment, to: SimulatedShipment["status"], at: string, orderNet: Map<string, number>): void {
    const customer = this.world.customers.get(s.customerId);
    switch (to) {
      case "shipped": {
        s.status = "shipped";
        s.shippedAt = at;
        s.promisedAt = addHours(at, STANDARD_DELIVERY_HOURS);
        // Outcome is rolled at dispatch with the hazards in force at that moment.
        if (this.rng.chance(this.params.deliveryLostHazard)) {
          s.plannedOutcome = "lost";
          s.nextStatus = "lost";
          s.nextTransitionAt = addHours(s.promisedAt, 72);
        } else if (this.rng.chance(this.params.deliveryDelayHazard)) {
          s.plannedOutcome = "delayed";
          s.delayMinutes = Math.round(this.rng.uniform(10, 60) * 60 * this.params.deliveryDelayScale);
          s.nextStatus = "delayed";
          s.nextTransitionAt = addHours(s.promisedAt, this.rng.uniform(0.5, 2));
        } else {
          s.plannedOutcome = "on_time";
          s.nextStatus = "delivered";
          s.nextTransitionAt = addHours(s.promisedAt, -this.rng.uniform(2, 14));
        }
        this.emit("delivery.status_changed", { orderId: s.orderId, status: "shipped", promisedAt: s.promisedAt }, at, `delivery:${s.orderId}:shipped`, s.orderId);
        break;
      }
      case "delayed": {
        s.status = "delayed";
        s.nextStatus = "delivered";
        s.nextTransitionAt = addMinutes(s.promisedAt, s.delayMinutes ?? 600);
        this.emit("delivery.status_changed", {
          orderId: s.orderId, status: "delayed", promisedAt: s.promisedAt, delayMinutes: s.delayMinutes ?? 600,
        }, at, `delivery:${s.orderId}:delayed`, s.orderId);
        break;
      }
      case "delivered": {
        const wasDelayed = s.status === "delayed";
        s.status = "delivered";
        s.deliveredAt = at;
        s.nextStatus = null;
        s.nextTransitionAt = null;
        const delayMinutes = wasDelayed ? Math.max(1, minutesBetween(s.promisedAt, at)) : undefined;
        if (wasDelayed) s.delayMinutes = delayMinutes;
        this.emit("delivery.status_changed", {
          orderId: s.orderId, status: "delivered", promisedAt: s.promisedAt, deliveredAt: at,
          ...(delayMinutes !== undefined ? { delayMinutes } : {}),
        }, at, `delivery:${s.orderId}:delivered`, s.orderId);
        if (customer) {
          customer.satisfaction = wasDelayed
            ? Math.max(0, customer.satisfaction - 0.12 * customer.deliverySensitivity * Math.min(2, (delayMinutes ?? 0) / (24 * 60) + 0.5))
            : Math.min(1, customer.satisfaction + 0.02);
          this.out.touchedCustomerIds.add(customer.customerId);
        }
        // Dissatisfied customers review more often: delays and defective products both raise the propensity.
        const hasQualityIssue = Boolean(this.params.qualityIssueProductId && s.productIds?.includes(this.params.qualityIssueProductId));
        const reviewRate = this.state.config.baseReviewRate + (wasDelayed ? 0.25 : 0) + (hasQualityIssue ? 0.35 * this.params.qualityPenalty : 0);
        if (this.rng.chance(reviewRate)) s.reviewScheduledAt = addHours(at, this.rng.uniform(12, 72));
        break;
      }
      case "lost": {
        s.status = "lost";
        s.nextStatus = null;
        s.nextTransitionAt = null;
        this.emit("delivery.status_changed", { orderId: s.orderId, status: "lost", promisedAt: s.promisedAt }, at, `delivery:${s.orderId}:lost`, s.orderId);
        if (!s.refundIssued) {
          s.refundIssued = true;
          const refundMinor = orderNet.get(s.orderId) ?? s.orderNetMinor ?? 0;
          const refundId = this.nextId("refund", "rfd");
          this.emit("order.refunded", { orderId: s.orderId, refundId, refundMinor, currency: "GBP", reason: "parcel_lost" },
            addMinutes(at, 30), `refund:${refundId}`, s.orderId);
          this.out.orderRefunds.push({ orderId: s.orderId, refundedMinor: refundMinor, status: "refunded" });
        }
        if (customer) {
          customer.satisfaction = Math.max(0, customer.satisfaction - 0.3);
          this.out.touchedCustomerIds.add(customer.customerId);
        }
        break;
      }
      case "pending":
        break;
    }
  }

  // ----------------------------------------------------------------- reviews
  private runReviews(): void {
    for (const s of this.world.shipments) {
      if (!s.reviewScheduledAt || s.reviewScheduledAt > this.end || s.status !== "delivered") continue;
      const at = s.reviewScheduledAt;
      s.reviewScheduledAt = null;
      this.out.updatedShipmentIds.add(s.shipmentId);
      const productId = s.productIds?.[0] ?? this.out.orders.find((o) => o.orderId === s.orderId)?.lines[0]?.productId;
      const product = productId ? this.world.products.get(productId) : undefined;
      if (!product) continue;
      const customer = this.world.customers.get(s.customerId);
      const delayHours = (s.delayMinutes ?? 0) / 60;
      const deliveryPenalty = s.plannedOutcome === "delayed"
        ? 0.2 + 0.35 * (customer?.deliverySensitivity ?? 0.6) * Math.min(1.2, delayHours / 48)
        : 0;
      const qualityPenalty = this.params.qualityIssueProductId === product.productId ? this.params.qualityPenalty : 0;
      const expectationGap = (customer?.priceSensitivity ?? 0.6) * 0.08 * (product.priceMinor / 15000);
      const productSatisfaction = product.qualityScore - qualityPenalty;
      const score = productSatisfaction - deliveryPenalty - expectationGap + this.rng.normal(0, 0.08);
      const rating = Math.min(5, Math.max(1, Math.round(1 + 4 * score)));
      const pool = deliveryPenalty > 0.15 && rating <= 3 ? REVIEW_TEXTS.delivery
        : qualityPenalty > 0 && rating <= 3 ? REVIEW_TEXTS.quality
        : rating >= 4 ? REVIEW_TEXTS.positive : REVIEW_TEXTS.neutral;
      const review: SimulatedReview = {
        businessId: this.businessId, simulationRunId: this.runId, reviewId: this.nextId("review", "rev"),
        productId: product.productId, orderId: s.orderId, customerId: s.customerId, rating,
        text: this.rng.pick(pool), drivers: { productSatisfaction, deliveryPenalty, expectationGap }, createdAt: at,
      };
      this.out.reviews.push(review);
      this.emit("review.created", { reviewId: review.reviewId, productId: product.productId, orderId: s.orderId, rating, text: review.text },
        at, `review:${review.reviewId}`, s.orderId);
    }
  }

  // ------------------------------------------------------------------ social
  private runSocialMentions(): void {
    const count = this.rng.poisson(this.params.socialMentionRatePerHour * this.hourWeight);
    const products = this.activeProducts();
    for (let i = 0; i < count; i++) {
      const product = this.params.viralProductId && this.world.products.get(this.params.viralProductId) && this.rng.chance(0.85)
        ? this.world.products.get(this.params.viralProductId)!
        : this.rng.weightedPick(products, (p) => p.popularity);
      const mentionId = this.nextId("mention", "mnt");
      const viral = this.params.viralProductId === product.productId;
      this.emit("social.mention_observed", {
        mentionId, platform: this.rng.pick(PLATFORMS),
        content: this.rng.pick(MENTION_TEXTS).replace("{product}", product.name),
        views: Math.round(this.rng.uniform(viral ? 20000 : 300, viral ? 400000 : 8000)),
        productId: product.productId,
      }, this.randomTimeInTick(), `mention:${mentionId}`);
    }
  }

  // --------------------------------------------------------------- inventory
  private emitInventoryLevels(): void {
    for (const productId of [...this.out.touchedProductIds].sort()) {
      const product = this.world.products.get(productId);
      if (!product) continue;
      const consumed = this.out.unitsConsumed.get(productId) ?? 0;
      const availableUnits = Math.max(0, product.availableUnits - consumed);
      product.availableUnits = availableUnits;
      product.updatedAt = this.end;
      this.emit("inventory.level_changed", { productId, availableUnits, reservedUnits: product.reservedUnits },
        this.end, `inv:${productId}:t${pad(this.state.tickIndex)}`);
    }
  }
}
