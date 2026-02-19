# Benchmark Dataset Policy

## Policy Goals

- Reproducible benchmark inputs across CI runs.
- License-auditable source provenance.
- Stable tier shapes for trend analysis.

## Source Policy

Phase 1 uses open-license plus synthetic data.

- Open-license media is tracked in `scripts/bench/dataset-sources.json`.
- Synthetic fixtures are generated deterministically by `scripts/bench/generate-synthetic.mjs`.
- Enabled open-license entries must include pinned `sha256` values.
- `scripts/bench/fetch-sources.mjs` is fail-closed by default for:
  - missing/invalid source hashes
  - source download failures
  - checksum mismatches
- Waiver flags are explicit and non-default:
  - `--allow-unpinned-sources`
  - `--allow-partial`

## Versioning

- Dataset tags are semantic: `bench-dataset-vX.Y.Z`.
- Any content or manifest change increments dataset version.

## Retention

- Keep all released dataset versions.
- Never overwrite existing dataset tag assets in-place.
- Dataset release workflow enforces immutability with `scripts/bench/assert-dataset-tag-absent.mjs`.
- Existing tags are treated as immutable and must be replaced by a new semantic version.

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
