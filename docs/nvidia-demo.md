# NVIDIA demo workspace

Open `http://localhost:8772/dashboard?businessId=nvidia_demo&run=nvidia_channel_20261027` or choose NVIDIA in the Business workspace selector. Existing Nike runs remain in their own workspace.

The top panel uses NVIDIA's official investor relations disclosures: Q2 FY2026 through Q2 FY2027 revenue, and Q2 FY2027 GAAP figures. Dates and source links are displayed. Reference values are stored in USD millions; charts convert them to USD billions. These dated snapshots are not a live financial feed.

Orders, advertising, shipping, inventory, reviews and GBP prices are independently simulated UK GPU-channel records. Public product names do not make the invented prices official. All seven GPU offers retain `dataOrigin: synthetic`, `verification: unverified`, and synthetic price provenance. Public-reference evidence excludes these prices. Reported quarterly USD revenue is never used as simulated daily GBP revenue.

`node --conditions=react-server --import tsx scripts/demo-nvidia.ts` creates or resumes the fixed demo run: 72 healthy hours followed by 36 hours of advertising fatigue, seed 61. It does not reset another workspace. The generated receipt is `.local/nvidia/dataset.json`. A local Zetaris snapshot refresh is needed after creating or advancing the run before querying its new observations.

Use **Animate NVIDIA results** for official financial charts, or **Animate dashboard** for the clearly labelled synthetic operations. Both offer 60-second silent 4K MP4 export with a downloadable source snapshot. Evidence sufficiency and approval gates still apply; changing the data does not automatically validate an AI diagnosis.
