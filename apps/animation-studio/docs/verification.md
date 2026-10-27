# Standalone export verification

Checked on 27 October 2026 using a fresh virtual environment, Python 3.14.7,
Pillow 13.0.0, Blender 5.1.2 and FFmpeg 8.0.1 on macOS / Apple Silicon.

## Scope

The export contains only Animation Studio source, its static interface, setup
instructions and tests. It excludes ExplainWhy application code, business data,
training datasets, downloaded models, original job history, uploads, credentials,
virtual environments and QA outputs.

Machine-specific user paths were replaced with repository-relative or configurable
paths. The macOS Blender sandbox still denies network access and restricts writes.
Its home-directory rule is derived from the current user's home rather than one
developer's username.

## Checks

- Installed all declared development requirements into a new `.venv`.
- Ran the complete unit suite with `OPENROUTER_API_KEY` and `ORBIT_TEST_MODEL`
  absent from the environment. The optional local tokenizer test is skipped.
- Checked JavaScript syntax and the Bash launcher.
- Confirmed the fresh server exposes only the OpenRouter production provider and
  reports no configured API key.
- Rendered the built-in **Scene Tools Gallery** through the standalone HTTP API:
  2 seconds, 1280×720, 24 fps, 48 frames, local Blender and FFmpeg, no model call.
- Confirmed the MP4 and editable native project are produced.
- Scanned every publication candidate for recognizable API tokens, private keys,
  credential-bearing URLs, unexpected binaries and personal absolute paths.
- Confirmed Git ignores environment files, local registry, generated jobs, uploads,
  model weights and the virtual environment.

The export scan reports filenames, line numbers and categories without printing
possible credential values. Recognizable-token scanning is an additional check,
not a proof that arbitrary future files are safe to publish. The initial export
was assembled from an explicit source-file list, not a copy of the working tree.

No paid generation was run during export. The tool demonstration verifies local
construction and delivery; it does not establish model-generated artistic quality.
