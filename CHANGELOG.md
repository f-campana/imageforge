# Changelog

All notable changes to this project will be documented in this file.

## [0.1.6](https://github.com/f-campana/imageforge/compare/v0.1.5...v0.1.6) (2026-02-13)


### Features

* **responsive:** finalize width-set behavior and contract ([022957c](https://github.com/f-campana/imageforge/commit/022957c640615c3abb45d1a7e3fb4cba961be558))

## [0.1.5](https://github.com/f-campana/imageforge/compare/v0.1.4...v0.1.5) (2026-02-11)


### Bug Fixes

* **cli:** harden parsing discovery and cache lifecycle ([ee115f9](https://github.com/f-campana/imageforge/commit/ee115f92736f633ca11263bca5718febcf4a7216))
* **lock:** add heartbeat and owner-aware stale reclaim ([3aa7a55](https://github.com/f-campana/imageforge/commit/3aa7a552b15e16d96f1f920293955878a7a9abfb))

## [0.1.4](https://github.com/f-campana/imageforge/compare/v0.1.3...v0.1.4) (2026-02-11)


### Bug Fixes

* **lockfile:** restore chalk 5.6.2 entry for frozen installs ([#19](https://github.com/f-campana/imageforge/issues/19)) ([0b20997](https://github.com/f-campana/imageforge/commit/0b20997719982b8c558b6a7775f1d03815ce46f1))

## [0.1.3](https://github.com/f-campana/imageforge/compare/v0.1.2...v0.1.3) (2026-02-10)


### Bug Fixes

* **ci:** ignore generated changelog formatting drift ([0ad6690](https://github.com/f-campana/imageforge/commit/0ad6690eef958269641e93431e2d5364473fbf81))

## [0.1.2](https://github.com/f-campana/imageforge/compare/v0.1.1...v0.1.2) (2026-02-10)


### Bug Fixes

* **ci:** allow manual publish workflow dispatch ([7a3c38b](https://github.com/f-campana/imageforge/commit/7a3c38b97acad6e018b1d715ea426ff5d779e35b))
* **ci:** stabilize release checks after version bump ([f51b60b](https://github.com/f-campana/imageforge/commit/f51b60bd27295fd71579b7730f88571c28fb885c))

## [0.1.1](https://github.com/f-campana/imageforge/compare/v0.1.0...v0.1.1) (2026-02-09)

### Features

- **cli:** add runner with config, out-dir, and concurrency ([43c965d](https://github.com/f-campana/imageforge/commit/43c965dedd52343b9f560f50e6a48ac0250ad87e))

### Bug Fixes

- **cli:** address opus review follow-ups ([14e9544](https://github.com/f-campana/imageforge/commit/14e9544f2c56cc02a2f1f6c7e39f82ad64570e1b))
- **cli:** apply post-review verbosity and progress fixes ([2b12abc](https://github.com/f-campana/imageforge/commit/2b12abc6ddef743ebfae1428f0c9f3ee43034579))
- **cli:** close final remediation gaps ([d744b3b](https://github.com/f-campana/imageforge/commit/d744b3b969220510619eba76cfcd9d733c5a8109))
- **cli:** close loop on config overrides and cache safety ([a80c124](https://github.com/f-campana/imageforge/commit/a80c124f4b14656782ea1a6d42f41015274c5f90))
- **cli:** enforce verbose and quiet mutual exclusivity ([2a8d708](https://github.com/f-campana/imageforge/commit/2a8d70800115002d36e9af72d0086a83d0f8c7c3))

## [0.1.0] - 2026-02-08

### Added

- Initial open-source release of `@imageforge/cli`.
- CLI image optimization pipeline with format conversion, blur placeholders, and hash-based caching.
- CI quality and release verification gates.
