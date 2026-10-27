# Proof moments: a planted false lead and an independent Nemotron check

Two additions test whether ExplainWhy explains *why*, rather than repeating the loudest signal.

1. **A checkout incident with a planted false lead**: the `promo_checkout_failure_ad_decoy` scenario.
2. **A Nemotron verifier**: a second, blind model audits every diagnosis against the same verified evidence.
3. **Nemotron as the reasoning core, with no Mubit**: `EXPLAINWHY_MODEL_PROVIDER=nvidia` runs investigation, diagnosis and planning on `nvidia/nemotron-3-super-120b-a12b` through the NVIDIA API catalog. One free `NVIDIA_API_KEY` is the only credential needed.

**Status (27 Oct 2026, 13:30 UTC):** the scenario, evidence change and verifier are implemented and covered by tests. The deterministic evidence below was recorded on a local MongoDB replica set without any model request. **A live investigation and live Nemotron calls have not been recorded yet.** On the NVIDIA route they need only `NVIDIA_API_KEY`. Until a run appears in `docs/stage5-runs/`, nothing here claims that Gemini or Nemotron rejected the decoy.

## 1. The false lead

The promo code `AUTUMN15` starts failing at checkout. This is the same mechanism as `promo_checkout_failure`. At the same virtual hour, one small campaign, **Mercurial Speed Pack (Meta)**, fatigues sharply: its audience is exhausted, frequency spikes and CTR collapses. Its paid conversion is unchanged, so it only removes that campaign's clicks.

The detector merges both changes into one critical incident titled **"Advertising performance deterioration"**. The obvious reading is that the ads broke. The private ground truth is `discount_failure` / `checkout_failure`; ad fatigue is recorded only as a decoy (`decoyCauses`) and is never passed to the detector, evidence tools or models.

### What the evidence shows

From [the recorded evidence](decoy-evidence-stage5_1793106051151.txt), seed 42, severity 0.85, 72 h healthy baseline followed by 96 h of incident:

| Evidence the investigator receives | Points toward |
| --- | --- |
| Mercurial CTR **1.07% → 0.08%**, frequency **2.85 → 10.1**, attributed sessions/h **3.7 → 0.3** | The decoy: a real, visible ad problem |
| Revenue decomposition: **sessions share 0.001, conversion share 0.764** of the revenue change | Not traffic. The loss is in conversion |
| Sessions per hour **0% change**; conversion **2.21% → 1.53%** | Same |
| Failure codes: `coupon_rejected` **×44** (baseline 2) | The promo path |
| Paid conversion **−37%**, **non-paid conversion −17%** | Site-wide, not one campaign |
| Late deliveries 8.3% (baseline 0% on only 13 promises) | A second, incidental lead: normal delay hazard against a tiny baseline |

The paid and non-paid conversion split is new in `checkout_analysis`. Before this change, the channel breakdown lived only in evidence `detail`, which the model never sees. The investigator now gets the control comparison as a measurement.

### Tests

[`tests/simulator/decoy-scenario.test.ts`](../../tests/simulator/decoy-scenario.test.ts) checks seeds 42, 7 and 1234 on the in-memory engine, without a database or model:

- the decoy campaign's CTR falls by more than 80%;
- it supplied under 10% of sessions, and total sessions/h fall by under 12%;
- orders/h fall by over 12%, and by more than twice the session drop;
- over a fifth of checkout attempts fail, and `coupon_rejected` makes up over 80% of failures, hitting both paid and non-paid shoppers;
- the real detector groups the decoy CTR finding and the coupon-failure finding into one advertising + conversion incident.

The data-boundary test also forbids the decoy parameter names in production detection code.

### Run it

```sh
# Simulate and detect only (no model request):
npm run demo:stage5 -- --checkout-decoy --prepare
# Inspect the deterministic evidence the investigator will see (no model request):
node --conditions=react-server --import tsx scripts/inspect-decoy-evidence.ts <runId> <investigationId>
# Full live investigation (Mubit/Gemini, then Nemotron when enabled):
npm run demo:stage5 -- --checkout-decoy
```

A pass means the diagnosis names `discount_failure` or `checkout_failure`, does not make `ad_fatigue` primary, and keeps the Mercurial evidence as disclosed counterevidence. Anything else is recorded as a miss.

## 2. Nemotron verification

After the diagnosis passes deterministic validation, [`src/integrations/nemotron/verifier.ts`](../../src/integrations/nemotron/verifier.ts) sends the same verified evidence packet to the NVIDIA API catalog:

- **Judge (blind):** `nvidia/llama-3.1-nemotron-70b-instruct` receives only the candidate cause codes and the verified evidence. It never sees Gemini's primary cause, strengths or explanations. It rules every candidate *consistent*, *contradicted* or *insufficient*, cites evidence IDs and names the best-supported cause, so "agrees" means it reached the same cause on its own. Output is validated locally. Unknown evidence IDs, unassessed causes, mixed evidence roles, numerals or certainty claims are rejected. There is one repair attempt, then an honest failure.
- **Reward:** `nvidia/nemotron-4-340b-reward` scores each written explanation (the `correctness` and `helpfulness` attributes) against only the evidence that explanation cites, trimmed to fit the model's small context window. The original blueprint's 70B reward model is no longer listed in the NVIDIA catalog.

The verifier **cannot change the diagnosis**. Its verdict, challenged causes, reward ranking and per-call receipts (model, `nvcf-reqid`, latency, tokens, status) are stored in `report.independentVerification`. They appear on the investigation page as **Independent Nemotron check** and in the dossier. A disagreement becomes the first review note. Provider failures are kept as failed receipts and never block publication.

Enable it in `.env.local`:

```dotenv
EXPLAINWHY_NEMOTRON_VERIFIER="true"
NVIDIA_API_KEY="nvapi-..."
```

Smoke test with an NVIDIA key alone, no Mubit needed. Nemotron judges the recorded decoy evidence directly against three candidates (`discount_failure`, `ad_fatigue`, `delivery_delays`) and writes `docs/proof-moments/nemotron-smoke-<run>.json`. This is labelled as a direct Nemotron check; it is not a Gemini investigation.

```sh
node --conditions=react-server --import tsx scripts/smoke-nemotron.ts stage5_1793106051151 inv_stage5_1793106051151_a9689ba7395d
```

The recorded run lives in a local replica set under the gitignored `.local/mongo`, with `MONGODB_URI="mongodb://127.0.0.1:27018/?replicaSet=rs0"` in `.env.local`. To start it again after a reboot:

```sh
mongod --replSet rs0 --port 27018 --bind_ip 127.0.0.1 --dbpath .local/mongo --fork --logpath .local/mongo/mongod.log
```

[`tests/integrations/nemotron.test.ts`](../../tests/integrations/nemotron.test.ts) covers, with a stubbed endpoint:

- agreement;
- a judge that backs the decoy, which is flagged as a disagreement;
- invented-evidence and numeric-prose rejection with a single repair;
- an HTTP 503 kept as a receipt;
- reward parsing;
- report publication, including the review note.

**Limits:** reward scores are uncalibrated relative preferences. The judge is a model assessment, not proof. Agreement between two models is not ground truth.

## 3. Running without Mubit

Mubit was the gateway for the original Gemini runs; it is not a sponsor of this hackathon. With `EXPLAINWHY_MODEL_PROVIDER=nvidia`, [`provider.ts`](../../src/intelligence/investigator/provider.ts) calls `https://integrate.api.nvidia.com/v1/chat/completions` directly.

- **What carries over:** ExplainWhy already owns the parts that matter for audit. Its durable call ledger records each request ID (`nvcf-reqid`), model, tokens, prompt fingerprint and input checksum, and it never silently replays a billable call. The same local Zod validation, one-repair rule and deterministic checks apply.
- **Structured output:** `NVIDIA_STRUCTURED_OUTPUT` selects `json_schema` (`response_format`), `guided_json` (NIM `nvext`) or `prompt` (schema in the prompt). Visible `<think>` text and markdown fences are stripped before parsing. Which mode the catalog accepts for the large investigation schema will be confirmed by a live probe (`node --conditions=react-server --import tsx scripts/check-investigator-schema.ts`).
- **Not replaced:** Mubit's adapter training. It never produced an adapter here: 0 kept examples, and training never started. Nothing trained tonight could be measured. Learning from past incidents is handled by Meterless H-MEM recall of verified prior reports, which is context only and is not training.
- **Unavailable on this route:** grounded external research, which relies on Gemini's Google Search tool. It is disabled with a recorded reason.
- **Independence:** the default judge (`llama-3.1-nemotron-70b-instruct`) is a different model from the default investigator (Nemotron 3 Super), but from the same vendor. The report says so. If both are set to the same model, it reports a self-check.
- **History:** earlier recorded runs remain Gemini-through-Mubit and keep their original provenance.
