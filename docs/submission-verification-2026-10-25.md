# Submission verification — 25 October 2026

Checked at 2026-10-25T08:27:56.299687Z, against main `07f966a` plus the Gemini training evidence and worker/experiment safeguards included in this update. The [machine-readable record](submission-verification-2026-10-25.json) preserves commands, results and source checksums.

- `npm run verify`: **385/385 tests across 62 files passed**, contract typechecking and all **15/15** examples passed, TypeScript passed, ESLint **0 errors and 14 existing warnings**.
- `npm run test:e2e`: **66/66 passed in 3.6 minutes**, covering desktop Chromium and Pixel 7. It used the isolated `normal_e2e` database, the repository's verified form-fill harness and saved model fixtures; it made no new model requests.
- `NORMAL_NEXT_DIST_DIR=.next/submission-build npm run build`: production build passed. The separate build directory preserves the running demo server; generated extra TypeScript include paths were removed after the check.
- Every current model stage is configured to **Gemini 4 Argon (`gemini-4-argon`) through Mubit**, using the native Gemini transport. Both workers were verified running with those settings. The optional compatible transport has its own validated Gemini task and independent saved baseline.
- Both Gemini source-support runs completed **40 teacher calls** and **24 held-out baseline cases**. Each baseline matched **18/24 synthetic labels (75%)**, with 24/24 valid responses. Both Mubit tasks still have **0 kept, 40 waiting/queued and 3 reviews running; first training not started**. [Actual results and limitations](training/gemini-source-support-evaluation-2026-10-25.md), [native console evidence](training/source-support-gemini-4-argon-v1/console/submission-queue.png). No adapter improvement or production savings is claimed.
- Historical workflow/model evidence retains the actual model IDs that produced it. New public console snapshots exclude the account sidebar at capture time; private environment files and full account-bearing captures are excluded from this update.

Publication checks verified **142 local Markdown targets** in the staged repository. Targeted credential/account-address checks found no matches in staged text; this is not an exhaustive security audit. Private environment files were not staged.

The final upload asset is [Normal_NightShift_Demo.mp4](demo/Normal_NightShift_Demo.mp4), the newer continuous recording with the revised voice: **110.16 seconds**, **4,980,760 bytes**, H.264/AAC, 1488×720. Its SHA-256 matches `17fa3459fc2de48a177a9f6add5529feaa8e124f6e170cdeeb8bd41d96c37a0b`. A fresh complete audio/video decode passed without FFmpeg errors. This revision supersedes `Normal_Clean_Screen_Recording.mp4`; use the linked current asset for the organizer upload.

The background Gemini adapter evaluation is active every 15 minutes and will evaluate a real passing version against its matching frozen baseline. Final organizer-form submission/upload and a receipt have **not** been verified by this check. The older public deployment is not evidence that this exact revision is deployed; use the current repository and verified demo materials for the submission.
