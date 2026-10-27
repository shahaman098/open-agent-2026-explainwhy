# ExplainWhy task profiles (in-house learning loop)

ExplainWhy replaces hosted adapter training with **task profiles**: curated few-shot examples per task fingerprint, promoted only after a frozen held-out comparison passes the pilot gate in `src/intelligence/training/score.ts`.

## Supported path

1. **Collect** training-split provider calls into the experiment ledger (`npm run training:source -- collect`).
2. **Approve** examples into `profile-draft.json` (`npm run training:source -- approve` or `--all-agreeing`).
3. **Promote** by re-running held-out cases with the draft profile (`npm run training:source -- promote`).
4. **Report** offline (`npm run training:source -- report`).

Default experiment directory: `docs/training/source-support-nemotron-v1` (NVIDIA Nemotron). The frozen `source-support-v1` folder remains an archived Gemini/Mubit pilot.

Production source-support calls load the latest **promoted** MongoDB profile for `normal.source_support.v1` when fingerprints match.

## Dev review API (development only)

- `GET /api/dev/training/profile?task=normal.source_support.v1`
- `POST /api/dev/training/examples` with `{ callId, decision: "approve" | "reject" }` for completed source-review calls.

## Limits

Profiles are eval-gated prompt augmentation, not fine-tuned weights. Improvement claims require the paired bootstrap gate on the frozen held-out set; archived Mubit console screenshots do not apply to new NVIDIA runs.
