# Release Note Draft - Responsive Widths

ImageForge now supports responsive width targets via `--widths`.

- Requested widths are normalized (deduped + ascending) and capped at 16 unique values.
- Generation uses effective widths per image with no upscaling.
- If all requested widths exceed source width, ImageForge falls back to source-width output.
- `variants` is additive in manifest entries, and `outputs.<format>` points to the largest generated variant.
