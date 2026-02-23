# Benchmark Standard

## Scope

This standard defines CI-native benchmark requirements for ImageForge CLI performance and claim governance.

## Gate Policy

- Runner: `ubuntu-24.04`
- Node: `22`
- Policy: mixed strictness
  - `pull_request`: advisory (non-blocking)
  - `schedule` on `main`: strict (fail-closed on alerts)
  - `workflow_dispatch` with `publish_site_snapshot=true`: strict unless `allow_regression_override=true`
- Comparison model: `head` vs `main` in the same workflow run
- Comparator mode flag: `--mode advisory|strict` (default `advisory`)

## Profiles

- `P1`: `--formats webp --quality 80 --blur`
- `P2`: `--formats webp,avif --quality 80 --blur`
- `P3`: `--formats webp,avif --quality 80 --blur --widths 320,640,960,1280`

## Scenarios

- `single-small`
- `single-median`
- `single-large`
- `batch-all`

Single-image scenarios are selected from each tier manifest (`singleScenarios.small|median|large`).

## Run Protocol

- PR mode: `1 cold + 3 warm`
- Nightly/manual mode: `1 cold + 9 warm`

Cold run deletes scenario out-dir and manifest before execution. Warm runs reuse cache and outputs.

## Dataset Tiers

- `tier30`: PR advisory signal
- `tier200`: nightly baseline signal
- `tier500`: manual/release confidence run

Distribution target per tier:

- ~65% JPG
- ~25% PNG
- ~5% GIF
- ~5% TIFF

## Required Metrics

- Wall-clock duration (`wallMs`)
- CLI duration (`report.summary.durationMs`)
- Mean, p50, p95, stddev (warm)
- Throughput (images/sec)
- Per-image milliseconds

## Validation Rules

Each run must satisfy:

- exit code `0`
- `summary.failed === 0`
- `errors.length === 0`
- cold: `processed === total`, `cached === 0`
- warm: `cached === total`, `processed === 0`

## Regression Thresholds

- warm p50: `+10%`
- cold wall duration: `+15%`
- warm p95: `+20%`

Small-baseline guard:

- if baseline metric `< 100ms`, alert only when absolute delta is `>= 15ms` and threshold is exceeded.
