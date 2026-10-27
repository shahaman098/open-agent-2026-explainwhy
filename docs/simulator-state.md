# Simulator state and mechanics

## Persistence (`simulator_state`, one document per run)

Canonical `SimulatorRun` fields (`schemaVersion, businessId, simulationRunId, seed, status, virtualTime,
minutesPerTick, activeScenario, scenarioSeverity, createdAt, updatedAt`) plus:

| Field | Purpose |
|---|---|
| `virtualStartAt`, `tickIndex` | clock origin and number of ticks executed |
| `rng: [u32×4]` | sfc32 PRNG state, saved after every persisted batch; restart-safe |
| `counters` | deterministic ID counters (session, order, customer, shipment, review, mention, checkout, refund) |
| `storefrontOrderCounter` | incremented atomically by human checkouts; never overwritten by ticks |
| `config` | baseline rates (organic sessions/hour, returning rate, base conversion, landing rate…) |
| `scenarioParams` | **private** mechanistic parameters derived from `(activeScenario, severity)` |
| `lock` | lease lock `{token, expiresAt}` serialising ticks/injections per run |
| `recentTickReceipts` | last 25 `Idempotency-Key → SimulatorTickResponse` replays |
| `totals` | running counts of events/orders/sessions |

Domain collections: `simulated_products`, `simulated_customers`, `simulated_sessions`, `simulated_orders`,
`simulated_campaigns`, `simulated_shipments`, `simulated_reviews`, `simulated_storefront`, `simulated_messages`.
`businesses.activeSimulationRunId` names the run the storefront sells from.

## One tick (= one virtual hour, `TickEngine.run()`)

1. **Advertising** per campaign: paced hourly allowance → impressions (budget ÷ CPM, capped by audience) → spend
   (≤ allowance, ≤ daily budget) → frequency = trailing 168h impressions ÷ effective audience → CTR =
   base × creative × relevance × fatigue(frequency) → clicks ~ Binomial → landed sessions ~ Binomial(landing rate).
2. **Organic traffic**: Poisson(base × hour weight × organic multiplier) sessions over organic channels.
3. **Each session**: returning customer or anonymous visitor → 1–3 product views weighted by popularity, interests,
   campaign targets and viral boost → cart → purchase probability (base × channel × propensity × price sensitivity ×
   satisfaction × paid-conversion multiplier × viral intent) → stock check (`checkout.failed/out_of_stock`) → coupon
   path (`checkout.failed/coupon_rejected`) → `order.completed` with server-side arithmetic → shipment created.
4. **Fulfilment**: scheduled transitions pending → shipped (outcome rolled at dispatch with the hazards in force) →
   delayed/delivered/lost; lost parcels refund (`order.refunded`); delivery experience updates customer satisfaction.
5. **Reviews**: delivered orders may schedule a review 12–72h later; rating = round(1 + 4 × (product quality −
   quality penalty − delivery penalty − expectation gap + noise)), clamped 1–5.
6. **Social mentions**: Poisson(rate × hour weight), biased to the viral product when one exists.
7. **Inventory**: one `inventory.level_changed` per touched product with the end-of-tick level.
8. One `ad.metrics_observed` per campaign per tick with attribution derived from this tick's linked orders.

Determinism: identical seed + initial state + request sequence ⇒ identical observations (only `receivedAt`
and MongoDB `_id`s differ). Ticks are persisted in chunks of 12; IDs are deterministic so retries dedupe.
Concurrent storefront purchases are handled with atomic `$inc` guards; if a tick's generated orders exceed
stock drained meanwhile, the chunk is regenerated from the chunk-start RNG state (up to 3 attempts).

## Scenarios → mechanics (`src/simulator/scenarios.ts`)

| Scenario | Changed parameters (severity s ∈ [0,1]) | Observable consequences |
|---|---|---|
| `healthy` | defaults | stable baseline |
| `ad_fatigue` | effective audience ×(1−0.75s), CTR fatigue strength 0.35+1.4s, paid conversion ×(1−0.35s) | frequency ↑, CTR/clicks/paid sessions/orders ↓, spend ≈ flat, CPA ↑, revenue ↓ |
| `delivery_delays` | delay hazard 0.06+0.6s, delay scale 1+2s, lost hazard 0.004+0.03s | delayed shipments ↑, late reviews ↓ ratings, satisfaction ↓, refunds ↑ |
| `viral_demand` | organic ×(1+2.5s) via social, interest boost 8s on `nk_dunk_low_retro`, mentions 0.15+4s/h | mentions ↑, sessions ↑, product orders ↑, revenue ↑, stock-outs |
| `negative_reviews` | quality penalty 0.55s on `nk_quest_7`, higher review propensity | low ratings on that product |
| `promo_checkout_failure` | coupon usage 0.12+0.3s, coupon failure 0.02+0.9s | `checkout.failed/coupon_rejected` ↑, orders ↓ |

Ground truth for a run (scenario, root causes, parameters) is written to `simulator_ground_truth` for tests only.
