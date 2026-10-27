# Animation Studio

A text-to-animation workspace that plans scenes, builds editable 3D assets,
animates them in Blender, reviews rendered frames and exports a finished video.

**Prompt → art direction → asset construction → scene and motion → visual review → local render.**

This repository contains the standalone Animation Studio component. It does not
include the ExplainWhy investigation app, financial fixtures, training datasets,
downloaded models or previous production jobs.

## Features

- Generate scene plans and structured geometry through **DeepSeek via OpenRouter**.
- Build assets separately for more detailed compositions, or use a fast scene pass.
- Show actual asset previews, storyboard renders and production progress.
- Support materials, lights, terrain, imported GLBs, paths, cameras and animation.
- Render locally in Blender and encode MP4 with FFmpeg.
- Export editable `.blend`, data-only scene JSON and an additional `.glb`.
- Use angled orthographic cameras for 2.5D explainers or perspective shots.
- Stop production and resume saved checkpoints.
- Optionally use installed macOS narration voices and a supplied soundtrack.

Generated scenes are data, not Python scripts. Blender executes the local compiler
after validation. Visual quality depends on the brief, model output and reviews.

## Requirements

The current rendering sandbox and launcher target **macOS**. Other platforms are
not supported by the launcher; do not silently remove sandboxing to run elsewhere.

- Python **3.12+** (clean-environment checks used Python 3.14).
- Blender **5.1** at `/Applications/Blender.app/Contents/MacOS/Blender`, or set `ORBIT_BLENDER`.
- FFmpeg and FFprobe on PATH, or set `ORBIT_FFMPEG` and `ORBIT_FFPROBE`.
- Your own OpenRouter account and API key for model-generated animations.

No local LLM, NVIDIA GPU, CUDA, MLX or model download is required in the default
OpenRouter mode. Rendering performance depends on the scene and hardware.

## Quick start

```sh
git clone https://github.com/gtrg55/animation_studio.git
cd animation_studio
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
./start.sh
```

Open **http://127.0.0.1:8765/**. Use `./start.sh --port 8766` for another port.
Keep the terminal open; Ctrl-C stops the server.

Enter **your own key** in the OpenRouter password field and click **Use key**.
It stays in server memory only: it is not written to job files, returned in
status responses or saved in browser storage. Restarting clears a session key.
The backend also accepts `OPENROUTER_API_KEY` from your own process environment.

The configured model is `deepseek/deepseek-v4.1-flash-1017`. Production is locked
to OpenRouter. Older local-model and LM Studio compatibility modules remain for
regression coverage; the running server disables those inference paths.

## Example brief

> Create a 5-second stylized animation of a small car driving along a continuous
> winding road between bright mountains. Use a tracking camera, warm sunlight,
> a clear sense of scale and independently rotating wheels.

Choose duration, quality, framing, frame rate and review budget, then start
production. Detailed mode constructs each asset before assembling the scene.
Tool demonstrations and scene imports can render without model calls; these are
labelled as tool demos rather than model-generated animations.

## Production controls and outputs

Controls include 2 seconds to 5 minutes, 24/30/60 fps, 16:9/9:16/1:1/4:3 framing,
720p/1080p/4K long-edge output, Eevee or Cycles and up to five visual review rounds.
Selected image references, imported GLBs, narration and a soundtrack are optional.
Long clips, high resolution, reviews and path tracing require more time and disk.

Each run lives under ignored `jobs/<id>/`: plan, asset answers, scene JSON,
previews, review patches, logs, frames and exports. The native `.blend` is the
primary editable output. Blender-specific procedural materials, volumes, area
lights and audio may differ or be unavailable in the additional GLB export.

The scene language covers bounded meshes, primitives, text, lathe/extrusion,
curves, terrain, modifiers, hierarchies, paths, lights and timed camera shots.
See `scene_v2.py` or `GET /api/capabilities`. Orthographic shots support
`projection: "ORTHO"` and `ortho_scale: 20`.

## Credentials and data

**No OpenRouter key is included in this repository.** Do not commit your own key,
`.env` files, credentials, generated jobs or uploaded asset folders.

Generation uses HTTPS to OpenRouter. Prompts, selected references, scene context
and rendered review frames go to OpenRouter and its selected provider. Usage is
billed to the key owner. Blender, encoding and speech synthesis run locally.

The server binds to `127.0.0.1`, checks Host/Origin and requires a per-launch token
for mutations. Blender uses macOS `sandbox-exec`, factory startup and disabled
auto-execution. The sandbox denies network access and restricts file writes.
This is a local development tool, not a public multi-user rendering service.

## Integration API

1. Read `GET /api/status` for the per-launch token and provider state.
2. Send mutations with `X-Orbit-Token: <token>` from the local origin.
3. Use `POST /api/jobs` for generation, `POST /api/jobs/from-scene` for a data-only
   scene, or `POST /api/demos/render` for a labelled tool demonstration.
4. Poll `GET /api/jobs/<id>` and use the returned artifact URLs.

See `server.py` for exact validation and controls. The OpenRouter key is separate
from the per-launch local request token.

## Development checks

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -p 'test_*.py'
node --check public/app.js
.venv/bin/python scripts/check_export.py
```

Tests use fixtures and mock local HTTP servers, without paid model calls or
weights. The tokenizer test is opt-in via `ORBIT_TEST_MODEL` and normally skips.
Node is only needed for the JavaScript syntax check. See
[publication verification](docs/verification.md) for the checks performed.
