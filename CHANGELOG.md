# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0](https://github.com/f-campana/imageforge/compare/cli-v0.1.0...cli-v0.2.0) (2026-02-08)


### ⚠ BREAKING CHANGES

* **node:** drop support for Node.js versions below 22 by raising the engines floor to >=22.

### Features

* **cli:** bootstrap v0.1.0 processing pipeline and packaging baseline ([e9372c0](https://github.com/f-campana/imageforge/commit/e9372c01e28e5d2dcef8b4f52efbab7728119a87))


### Bug Fixes

* **cli:** harden cache ownership handling and overwrite safeguards ([b95060b](https://github.com/f-campana/imageforge/commit/b95060b941d252ffb59d8daaead520d0c5b33392))
* **cli:** isolate fixtures and fix --no-cache reruns ([00824c8](https://github.com/f-campana/imageforge/commit/00824c8ee4335a900e96017107b6fc32b993e799))


### Miscellaneous Chores

* **node:** require Node.js &gt;=22 ([28a94dc](https://github.com/f-campana/imageforge/commit/28a94dc083d482ac219c72be06630b30f80a056c))

## [0.1.0] - 2026-02-08

### Added

- Initial open-source release of `@imageforge/cli`.
- CLI image optimization pipeline with format conversion, blur placeholders, and hash-based caching.
- CI quality and release verification gates.
