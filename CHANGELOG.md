# Changelog

All notable changes to this project will be documented in this file.

## [0.1.8](https://github.com/f-campana/imageforge/compare/v0.1.7...v0.1.8) (2026-02-23)


### Features

* **benchmark:** add mixed strictness regression gating ([e429426](https://github.com/f-campana/imageforge/commit/e42942661157c0be8a86cfa657ff412b3c75ab6b))
* **benchmark:** enforce mixed strictness regression gates ([a8f099e](https://github.com/f-campana/imageforge/commit/a8f099ee4674f154c90792d7bd3d7a8ee37a37e7))
* **cli:** add dry-run and include/exclude glob filters ([e0453f6](https://github.com/f-campana/imageforge/commit/e0453f62fddd313e6148b399fb72157ece973950))
* **cli:** add dry-run and include/exclude glob filters ([b20a6e9](https://github.com/f-campana/imageforge/commit/b20a6e998b39b97781d0370ac5dd2919b337f94e))
* **cli:** add init command scaffold ([b32a08b](https://github.com/f-campana/imageforge/commit/b32a08b99cbfcbc21d8eb6cbd0265dd3e65d7ce6))
* **cli:** add init command scaffold ([73147d4](https://github.com/f-campana/imageforge/commit/73147d44686ca2229807e7fddfd400af6eff8d1a))


### Bug Fixes

* **benchmark:** install site deps before sync formatting ([#51](https://github.com/f-campana/imageforge/issues/51)) ([fbb2a06](https://github.com/f-campana/imageforge/commit/fbb2a06f43949303db16b0a09311baaf0588266d))
* **benchmark:** normalize synced site json before status ([#49](https://github.com/f-campana/imageforge/issues/49)) ([c5c365e](https://github.com/f-campana/imageforge/commit/c5c365ec33acc1a77f67089ba133c60a0f9d58b9))

## [0.1.7](https://github.com/f-campana/imageforge/compare/v0.1.6...v0.1.7) (2026-02-23)


### Features

* **benchmark:** add benchmark program tooling and CI workflows ([d9e02ad](https://github.com/f-campana/imageforge/commit/d9e02adab86aa9ab3ce32db798d08a884660c02d))
* **benchmark:** add benchmark program tooling and CI workflows ([68222be](https://github.com/f-campana/imageforge/commit/68222bed626e328dd71f3b50e7e4a29d85903d82))
* **benchmark:** export and sync site snapshots from benchmark CI ([3d12b12](https://github.com/f-campana/imageforge/commit/3d12b12e55ee44cdcb29bb53e5458101b3442ca6))
* **cli:** migrate to esm-primary package with stable runner subpath ([#35](https://github.com/f-campana/imageforge/issues/35)) ([6731f2d](https://github.com/f-campana/imageforge/commit/6731f2d1695ed2b82d2400eac32ce7c43813a7e1))


### Bug Fixes

* **bench:** harden dataset integrity and sync security ([e6ed9fe](https://github.com/f-campana/imageforge/commit/e6ed9fe3fc0c8209ae77b3a3e3978d6a95e8d4b9))
* **bench:** harden dataset integrity and sync security ([d4c85c6](https://github.com/f-campana/imageforge/commit/d4c85c672b9073847a60a23240d9c3250d0a2458))
* **benchmark:** create fallback sources dir in CI workflow ([e3a907a](https://github.com/f-campana/imageforge/commit/e3a907a18a9e54553f2b5a21242264789aefde28))
* **benchmark:** fetch sync branch before force-with-lease push ([c7c2658](https://github.com/f-campana/imageforge/commit/c7c265826686281437e310db4de35df7d789a95a))
* **benchmark:** fetch sync branch before force-with-lease push ([201bae8](https://github.com/f-campana/imageforge/commit/201bae87ae9a6639537e264a8f0ded799aa207f2))
* **benchmark:** use explicit force-with-lease hash for sync push ([00a1584](https://github.com/f-campana/imageforge/commit/00a1584d4d22b06173d210f634f0bcc6652dd7e1))
* **benchmark:** use explicit force-with-lease hash for sync push ([180ef9e](https://github.com/f-campana/imageforge/commit/180ef9e046e24f6997895570b2497824c562b236))
* **bench:** normalize site snapshot json before sync ([#38](https://github.com/f-campana/imageforge/issues/38)) ([af81fad](https://github.com/f-campana/imageforge/commit/af81fad48fabe37c9ab3f7fd5c8b1e625199ddfc))
* **bench:** remove cross-repo prettier dependency in snapshot sync ([#43](https://github.com/f-campana/imageforge/issues/43)) ([1f7f238](https://github.com/f-campana/imageforge/commit/1f7f2386d667143515ee7fc6ef629cf2ae37cd2f))
* **ci:** pin benchmark publish workflow actions ([#41](https://github.com/f-campana/imageforge/issues/41)) ([c0ecd1a](https://github.com/f-campana/imageforge/commit/c0ecd1af7ee6dd558f9ac34b6f8bb2445f50ca25))
* **security:** sanitize path logs and stream hashing ([#40](https://github.com/f-campana/imageforge/issues/40)) ([af010b5](https://github.com/f-campana/imageforge/commit/af010b5f5b989e545b31fd4b979845d0a952541d))

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
