# ExplainWhy — pitch and one-minute demo

Prepared for the local hackathon demo, 27 October 2026. English captions, silent video, 16:9, 4K. This script uses the currently recorded product behavior; it does not claim that the unrecorded checkout false-lead investigation succeeded.

## Positioning

**Investigate the change. Show the evidence. Review the response.**

ExplainWhy helps operations teams investigate business changes before choosing a response. Its value is a traceable path from an alert to checked records, remembered context and a human review decision. An unresolved investigation remains unresolved on screen.

## Pitch — approximately 30 seconds

Revenue drops. Advertising, checkout and delivery systems all raise alarms. What should your team trust before acting?

ExplainWhy gathers the records, uses Zetaris to query campaign data, verifies the observations, and recalls prior findings through Meterless H-MEM. Evidence and uncertainty stay visible. Planning requires an accepted diagnosis; supported actions require human approval.

Then, turn the same dashboard values into a presentation-ready animation.

**ExplainWhy: evidence you can inspect, decisions you control.**

## One-minute screen demo

| Time | Show and do | English caption |
| --- | --- | --- |
| 00–06 | Open the NVIDIA investigation. Frame the advertising alert and the observed changes; keep the synthetic workspace label visible. | **An alert tells you what changed. What should you check next?** |
| 06–14 | Open Integrations and press **Run live check**. Show the returned Zetaris status and observation count. If the check is unavailable, use the saved receipt with its actual timestamp and label it as saved. | **Zetaris queries campaign data. Returned observations are checked against source events.** |
| 14–24 | Open **Inspect evidence**. Show the campaign observations, checkout comparison and shipping records. These additional operational tools read the app's canonical records; do not imply every tool uses Zetaris. | **Compare advertising, checkout and fulfilment evidence in one investigation.** |
| 24–34 | Switch to the recorded Nike Integrations example. Frame **Save + recall verified**, the recalled context and its original investigation link. Keep a visible caption identifying this as a separate example. | **Meterless H-MEM recalls prior findings as context.** Small label: **Separate recorded synthetic Nike example.** |
| 34–44 | Return to the NVIDIA investigation. Open **Decision / Plan** and show the actual planning gate. No completed model diagnosis is recorded for this NVIDIA case. | **No accepted diagnosis? Planning stays blocked.** |
| 44–54 | Open the NVIDIA overview and choose **Animate NVIDIA results**. Select 60 seconds and 4K. Show the preview and the existing completed export. Keep **Official public data · USD** visible. | **Turn the dashboard's recorded values into a presentation-ready animation.** |
| 54–60 | Play a short section of the exported NVIDIA financial-results animation. End on the product name and closing line. | **ExplainWhy. Evidence you can inspect. Decisions you control.** |

Use gentle cuts between screens. Hold each caption long enough to read it. Capture real controls and saved results; avoid waiting for a new model run during the recording.

## Screens and assets

- NVIDIA overview: `http://localhost:8772/dashboard?businessId=nvidia_demo&run=nvidia_channel_20261027`
- NVIDIA integrations: `http://localhost:8772/dashboard/integrations?businessId=nvidia_demo&run=nvidia_channel_20261027`
- NVIDIA investigation: `http://localhost:8772/dashboard/investigations/inv_nvidia_channel_20261027_966034799c06?businessId=nvidia_demo&run=nvidia_channel_20261027`
- Recorded Nike memory example: `http://localhost:8772/dashboard/integrations?businessId=nike_demo&run=stage5_1793121265522`
- NVIDIA public-results video: `http://localhost:8772/assets/ExplainWhy_NVIDIA_60s_4K.mp4`

## Claims to keep precise

- NVIDIA financial disclosures are dated public reference data in USD. The operational GPU-channel dataset, GBP prices, campaigns, orders and shipping are synthetic and unaffiliated with NVIDIA.
- The NVIDIA evidence collection recorded 150 advertising observations across five campaigns and 16 verified evidence records. Read any live count from the current receipt rather than hard-coding it into a capture.
- The NVIDIA run has no prior completed report in H-MEM. The recorded save-and-recall proof belongs to the separate Nike run; keep the distinction visible.
- The independent Nemotron verifier is advisory. It can flag a disagreement; it does not currently revise the diagnosis itself.
- Do not claim a completed checkout repair, prevented loss, improved revenue, comparative accuracy or commercial benefit from this recording.

## Stronger story after a successful recorded investigation

“The dashboard flags advertising. ExplainWhy checks the alternatives and finds the checkout fault before the team changes the ad budget.”

Use this opening only after the [false-lead proof](proof-moments/README.md) has a recorded live model run with an accepted diagnosis, resolved evidence references and explicit treatment of the competing advertising explanation. A deterministic scenario test alone does not establish that result. Until then, the one-minute script above presents the verified integrations, evidence and review gate accurately.
