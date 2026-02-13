# Responsive Widths Contract

This document defines the runtime contract for responsive width generation (`--widths`).

## Scope

Applies to:

- CLI usage (`--widths`)
- Config usage (`imageforge.config.json` and `package.json#imageforge`)
- Manifest/report semantics for responsive outputs

## Input Contract

### Width list acceptance

Requested widths must satisfy all of the following:

1. Integer values only
2. Value range: `1..16384`
3. At least one value
4. Maximum `16` unique values after normalization

If validation fails, ImageForge exits with an error before processing.

### Normalization rules

Before generation, requested widths are normalized:

1. Duplicates are removed
2. Values are sorted ascending

The normalized list is the canonical width set for hashing, cache invalidation, and generation.

## Generation Contract

For each image and format:

1. Compute effective widths as requested widths `<= sourceWidth`.
2. If no requested width is eligible, fall back to `[sourceWidth]`.
3. No upscaling is performed.

### Manifest pointers

When responsive mode is enabled:

1. `variants.<format>` stores effective generated variants in ascending width order.
2. `outputs.<format>` points to the largest generated variant for that format.

## Interaction Rules

### `--check`

- Check mode compares current sources/options (including normalized width set) against cache state.
- Exits `1` when processing is needed and prints an exact rerun command.

### `--cache`

- Width-set changes invalidate cache hits because hash input includes normalized widths.
- Cache ownership checks still apply to output path safety.

### `--out-dir`

- Responsive output planning uses effective widths and collision checks preflight output paths.
- Manifest output paths remain input-root-relative even when `--out-dir` is outside the input tree.

## Examples

Requested: `--widths 300,100,300,200`

- Normalized requested widths: `[100,200,300]`
- For a `240px` source: effective widths `[100,200]`
- For an `80px` source: effective widths `[80]` (fallback)
