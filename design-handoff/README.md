# Normal dashboard · HTML design handoff

Static HTML snapshots of all ten dashboard routes, including the Operations Overview (home page). Open any `.html` file directly in a browser. The overview contains the actual rendered dashboard markup, original application CSS, and embedded fonts in one file; the other pages use the shared `styles.css`.

## Pages

- [Operations overview (home)](overview.html)
- [Signals](signals.html)
- [Investigations](investigations.html)
- [Investigation workspace](investigation-detail.html)
- [Campaign manager](campaigns.html)
- [Approvals](approvals.html)
- [Activity](activity.html)
- [Outcomes](outcomes.html)
- [Architecture](architecture.html)
- [Monitoring](monitoring.html)

## Data snapshot

The pages use the recorded simulation run `stage5_1792885194280` (seed 42, business `nike_demo`). Its incident window is 4 Oct 2026 06:00 to 5 Oct 2026 12:00 UTC.

`overview.html` was captured directly from the live `/dashboard` route with that run selected. It includes the actual risk score (98.3), five daily revenue snapshots, full displayed revenue (£13,068.35), 5,051 sessions, 115 orders, and recorded campaign performance. Its card geometry and typography were compared against the live page at 1440 × 900 and 390 × 844. Logos, campaign photos, and image icons retain their original positions as visible placeholders. All CSS and fonts are embedded, so the file can be shared and opened on its own.

The other page files use business figures and the investigation diagnosis from the run's persisted report at `docs/stage5-runs/stage5_1792885194280.json`; campaign names and daily budgets come from the simulator's campaign seed configuration.

This is a static design handoff. In the report-based page files, missing canonical event payloads, per-campaign breakdowns, and monitor worker details are marked as unavailable. A few incident headings in those files are concise display labels based on the report because its export does not include the source page title. Buttons in the overview preserve their visual states; local page links and native scroll panels work without the application backend.

## Source routes

| HTML | Dashboard route |
| --- | --- |
| `overview.html` | `/dashboard` |
| `signals.html` | `/dashboard/signals` |
| `investigations.html` | `/dashboard/investigations` |
| `investigation-detail.html` | `/dashboard/investigations/inv_stage5_1792885194280_d07498fe5b17` |
| `campaigns.html` | `/dashboard/campaigns/cmp_running_pegasus` |
| `approvals.html` | `/dashboard/approvals` |
| `activity.html` | `/dashboard/activity` |
| `outcomes.html` | `/dashboard/outcomes` |
| `architecture.html` | `/dashboard/architecture` |
| `monitoring.html` | `/dashboard/monitoring` |
