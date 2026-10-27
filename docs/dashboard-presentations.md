# Dashboard presentations

Open the dashboard and choose **Animate dashboard**, or choose **Animate** beside a chart. The preview captures the selected chart values and period at that moment. Dashboard auto-refresh continues separately; it cannot change an open presentation.

The shared action is available on revenue, risk and KPI charts, the control-room charts, signal trends, investigation evidence comparisons, outcome charts and campaign history. Empty charts do not export invented observations. Missing line observations remain gaps, and values keep their original units.

Choose Midnight or Paper, 8/12/20/60 seconds, and Full HD or 4K, then **Export MP4**. The whole dashboard opens as a grid, focuses on each chart, and returns to the grid. A single chart animates its own measurements. MP4 exports are silent, 16:9 and 24 fps. **Save presentation slide** downloads SVG; completed exports also provide the original snapshot as JSON.

Preview and export use the same SVG renderer. Numbers come from the on-screen snapshot; the exporter does not create a diagnosis or independently re-verify source data. Synthetic data remain labelled.

The local export worker uses the installed Node/tsx/sharp runtime and FFmpeg. Set `EXPLAINWHY_FFMPEG` if FFmpeg is not at a standard local path. Jobs and snapshots live in ignored `.local/presentation-exports/`. One export runs at a time. Identical data, options and renderer versions reuse a completed file. Exports continue if the preview closes; use the same options to retrieve them.

Endpoints follow the existing development/demo guard. Download and status requests must match the stored business and simulation run. Nothing is uploaded to an external video service.
