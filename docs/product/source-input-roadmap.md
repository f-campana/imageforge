# Source Input Roadmap

ImageForge currently discovers and processes these source extensions:

- `jpg`
- `jpeg`
- `png`
- `gif` (first frame, static output)
- `tiff`
- `tif`

## Current limitation

Input discovery intentionally excludes:

- `webp`
- `avif`
- `svg`

## Why this is deferred

1. Re-encoding already-compressed formats (`webp`/`avif`) needs explicit policy to avoid quality/size regressions.
2. Same-format source/output handling requires additional collision, cache-ownership, and manifest-path safeguards.
3. SVG handling needs a separate contract (passthrough vs rasterization targets) and security guidance for untrusted SVG inputs.

## Planned sequencing

1. Define product contracts for modern-source behavior (`webp`/`avif`) and SVG policy.
2. Add implementation behind explicit test coverage for discovery, collision preflight, cache behavior, and manifest stability.
3. Update CLI docs/examples once contracts and tests are complete.
