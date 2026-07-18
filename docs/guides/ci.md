# CI and generated assets

ImageForge CLI works best when its version and generated state are reproducible.

## Recommended repository contract

1. Install `@imageforge/cli` as an exact development dependency.
2. Keep the invocation in package scripts or `imageforge.config.json`.
3. Commit generated derivatives, `imageforge.json`, and `.imageforge-cache.json`.
4. Run `imageforge <directory> --check` after a frozen dependency install in CI.

This makes a pull request show the source and generated changes together. A clean check means the
source hashes and metadata, options, configured formats and widths, deterministic regular output
files, byte sizes and SHA-256 digests, generator identity, cache entries, and manifest agree. The
manifest's `generated` timestamp is informational and does not make an otherwise identical check
fail.

## GitHub Actions example

```yaml
name: Images

on:
  pull_request:
  push:
    branches: [main]

jobs:
  image-freshness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.28.2
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run images:check
```

Pin third-party actions to full commit SHAs if your repository's security policy requires immutable
references.

## Failure recovery

For ordinary source/configuration drift, run the generation command printed by `--check` through
the same pinned project dependency used by CI, inspect the diff, and commit the refreshed generated
state. The hint is shell-dependent; prefer the repository's `images:build` package script over a
global `imageforge` binary. Do not edit the manifest or cache by hand.

If the cache is missing, malformed, or unsupported, its ownership evidence is unavailable and an
existing derivative is deliberately protected. Inspect those files first, then remove/move the
conflicts or add `--force-overwrite` to the suggested command only when replacement is intentional.

ImageForge prunes deleted sources from the cache and manifest on a normal run. Deleted sources and
changes to formats, widths, output paths, or naming can leave derivatives outside the current
manifest. ImageForge reports known prior paths as `OBSOLETE_OUTPUTS` for both deleted sources and
output-contract changes. Review and remove obsolete files explicitly in the same pull request.

Run generation and `--check` as separate steps rather than concurrently against the same output
paths. Concurrent generation can make a read-only check observe an in-progress cache/manifest
transition and fail safely; rerun the check after generation completes.
