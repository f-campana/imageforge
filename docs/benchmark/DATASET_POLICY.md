# Benchmark Dataset Policy

## Policy Goals

- Reproducible benchmark inputs across CI runs.
- License-auditable source provenance.
- Stable tier shapes for trend analysis.

## Source Policy

Phase 1 uses open-license plus synthetic data.

- Open-license media is tracked in `scripts/bench/dataset-sources.json`.
- Synthetic fixtures are generated deterministically by `scripts/bench/generate-synthetic.mjs`.

## Versioning

- Dataset tags are semantic: `bench-dataset-vX.Y.Z`.
- Any content or manifest change increments dataset version.

## Retention

- Keep all released dataset versions.
- Never overwrite existing dataset tag assets in-place.

## Integrity

- Every release ships `sha256sums-vX.Y.Z.txt`.
- CI verifies archive checksums before extraction.

## Tier Definitions

- `tier30`: PR advisory benchmark
- `tier200`: nightly trend benchmark
- `tier500`: manual/release benchmark

## Required Metadata

Each tier must include:

- image list
- format breakdown
- scenario candidates (`small`, `median`, `large`)
- archive checksum
