<p align="center">
  <a href="https://github.com/f-campana/imageforge">
    <img src="./assets/imageforge-logo.svg" alt="ImageForge" width="440" />
  </a>
</p>

<p align="center">
  Build-time image pipeline for Next.js and web apps.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@imageforge/cli"><strong>npm</strong></a>
  ·
  <a href="./CONTRIBUTING.md"><strong>Contributing</strong></a>
  ·
  <a href="./SECURITY.md"><strong>Security</strong></a>
  ·
  <a href="./CHANGELOG.md"><strong>Changelog</strong></a>
</p>

<p align="center">
  <a href="https://github.com/f-campana/imageforge/actions/workflows/ci.yml">
    <img src="https://github.com/f-campana/imageforge/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" />
  </a>
  <a href="https://github.com/f-campana/imageforge/actions/workflows/release-please.yml">
    <img src="https://github.com/f-campana/imageforge/actions/workflows/release-please.yml/badge.svg?branch=main" alt="Release Please" />
  </a>
  <a href="https://www.npmjs.com/package/@imageforge/cli">
    <img src="https://img.shields.io/npm/v/%40imageforge%2Fcli?logo=npm" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/@imageforge/cli">
    <img src="https://img.shields.io/npm/dm/%40imageforge%2Fcli?logo=npm" alt="npm downloads" />
  </a>
  <a href="https://www.npmjs.com/package/@imageforge/cli">
    <img src="https://img.shields.io/node/v/%40imageforge%2Fcli" alt="Node version" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/npm/l/%40imageforge%2Fcli" alt="License" />
  </a>
</p>

Generate optimized derivatives (`webp`, `avif`) and `blurDataURL` placeholders with hash-based caching.

## Features

- One command for image conversion + manifest generation
- Blur placeholder generation for `next/image` (`blurDataURL`)
- Hash-based cache for fast reruns
- Bounded parallel processing with `--concurrency`
- Deterministic CI guard with `--check`
- Structured machine output with `--json`

## Install

Runtime requirement: **Node.js >= 22**.

Install globally:

```bash
npm install -g @imageforge/cli
```

Run without global install:

```bash
npx @imageforge/cli ./public/images
```

## Quick Start

```bash
imageforge ./public/images
```

By default this writes:

- Derivatives next to source files (for example `hero.jpg -> hero.webp`)
- Cache file at `./public/images/.imageforge-cache.json`
- Manifest at `./imageforge.json`

Generate both formats:

```bash
imageforge ./public/images --formats webp,avif
```

Write outputs to a dedicated directory:

```bash
imageforge ./public/images --out-dir ./public/generated
```

Generate responsive width variants:

```bash
imageforge ./public/images --formats webp,avif --widths 320,640,960,1280
```

`--widths` values are requested targets. ImageForge generates effective widths that do not exceed
the source image dimensions (no upscaling).

## CLI Usage

```bash
imageforge <directory> [options]
```

| Option                                       | Description                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `-o, --output <path>`                        | Manifest output path (default: `imageforge.json`)                                   |
| `-f, --formats <formats>`                    | Output formats, comma-separated (default: `webp`)                                   |
| `-q, --quality <number>`                     | Output quality `1..100` (default: `80`)                                             |
| `--blur` / `--no-blur`                       | Enable/disable blur placeholder generation                                          |
| `--blur-size <number>`                       | Blur dimensions `1..256` (default: `4`)                                             |
| `--widths <list>`                            | Requested width targets as comma-separated integers (source-bounded, max 16 unique) |
| `--cache` / `--no-cache`                     | Enable/disable cache reads/writes                                                   |
| `--force-overwrite` / `--no-force-overwrite` | Allow/disallow overwriting existing outputs                                         |
| `--check` / `--no-check`                     | Check mode for CI (exit `1` if processing is needed)                                |
| `--out-dir <path>`                           | Output directory for generated derivatives                                          |
| `--concurrency <number>`                     | Parallel processing (`1..64`, default: `min(8, availableParallelism)`)              |
| `--json` / `--no-json`                       | Emit machine-readable JSON report to stdout                                         |
| `--verbose` / `--no-verbose`                 | Show additional diagnostics                                                         |
| `--quiet` / `--no-quiet`                     | Suppress per-file non-error logs                                                    |
| `--config <path>`                            | Explicit JSON config path                                                           |
| `-V, --version`                              | Print version                                                                       |
| `-h, --help`                                 | Print help                                                                          |

## Runtime Behavior

- Normal runs exit with code `1` if any file fails processing.
- `--check` exits `1` when at least one file needs processing, otherwise `0`.
- Symlinks are skipped during discovery.
- Output collision checks are case-insensitive.
- Existing outputs are protected unless explicitly overwritten with `--force-overwrite`.
- With `--check`, ImageForge prints an exact copy-pastable rerun command.
- Responsive width sets are opt-in via `--widths` (default behavior is unchanged).
- Requested widths are targets; generated effective widths may be smaller for source-bounded runs.
- Width lists are capped at 16 unique values to bound compute and output fan-out.
- Full behavior contract: `docs/product/responsive-widths-contract.md`.

### Responsive Guardrail

ImageForge enforces a maximum of 16 unique requested widths per run/config. This guard keeps
responsive generation predictable and reduces accidental or hostile CPU/IO amplification from
oversized width lists.

## Configuration

Config resolution order:

1. Internal defaults
2. Config file (`--config <path>`, otherwise `imageforge.config.json`, otherwise `package.json#imageforge`)
3. CLI flags

Unknown config keys fail fast.

Example `imageforge.config.json`:

```json
{
  "output": "imageforge.json",
  "formats": ["webp", "avif"],
  "quality": 80,
  "blur": true,
  "blurSize": 4,
  "widths": [320, 640, 960, 1280],
  "cache": true,
  "outDir": "public/generated",
  "concurrency": 4
}
```

## JSON Output

Use `--json` to emit a structured report:

```bash
imageforge ./public/images --json
```

The report includes:

- Effective options
- Per-image status (`processed`, `cached`, `failed`, `needs-processing`)
- Effective generated widths in `images[*].variants[*].width` when `--widths` is used
- Summary counters and size totals
- Rerun command hint for `--check` failures

## Manifest

Manifest shape (`imageforge.json`):

```json
{
  "version": "1.0",
  "generated": "2026-02-08T00:00:00.000Z",
  "images": {
    "hero.jpg": {
      "width": 1920,
      "height": 1280,
      "aspectRatio": 1.5,
      "blurDataURL": "data:image/png;base64,...",
      "originalSize": 345678,
      "outputs": {
        "webp": { "path": "hero.w1280.webp", "size": 50210 },
        "avif": { "path": "hero.w1280.avif", "size": 31100 }
      },
      "variants": {
        "webp": [
          { "width": 320, "height": 213, "path": "hero.w320.webp", "size": 9012 },
          { "width": 640, "height": 427, "path": "hero.w640.webp", "size": 17654 },
          { "width": 960, "height": 640, "path": "hero.w960.webp", "size": 33210 },
          { "width": 1280, "height": 853, "path": "hero.w1280.webp", "size": 50210 }
        ],
        "avif": [
          { "width": 320, "height": 213, "path": "hero.w320.avif", "size": 6010 },
          { "width": 640, "height": 427, "path": "hero.w640.avif", "size": 12203 },
          { "width": 960, "height": 640, "path": "hero.w960.avif", "size": 21998 },
          { "width": 1280, "height": 853, "path": "hero.w1280.avif", "size": 31100 }
        ]
      },
      "hash": "abc123..."
    }
  }
}
```

Notes:

- Manifest keys and output paths are input-directory-relative POSIX paths.
- When using `--out-dir`, output paths remain relative to the input directory.
- If `--out-dir` is outside the input tree, manifest paths may include `../` segments.
- When `--widths` is used, `outputs.<format>` points to the largest generated variant.
- `variants[*].width` stores effective generated widths (requested values filtered by source size).

## Next.js Integration Example

```ts
import manifest from "./imageforge.json";

type Manifest = typeof manifest;

export function getImageData(src: string) {
  return (manifest as Manifest).images[src];
}
```

Then use:

- Original source path for `src`
- `getImageData(src)?.blurDataURL` for `placeholder="blur"`

Optional `srcset` helper for responsive variants:

```ts
export function getSrcSet(src: string, format: "webp" | "avif") {
  const variants = (manifest as Manifest).images[src]?.variants?.[format];
  return variants?.map((variant) => `${variant.path} ${variant.width}w`).join(", ");
}
```

## Programmatic API

ImageForge supports both ESM (`import`) and CJS (`require`) consumers.

Root exports processor helpers and manifest types.

Runner functions are exposed on a stable subpath API: `@imageforge/cli/runner`.

ESM:

```ts
import * as imageforge from "@imageforge/cli";
import * as processor from "@imageforge/cli/processor";
import { getDefaultConcurrency, runImageforge } from "@imageforge/cli/runner";
```

CJS:

```ts
const imageforge = require("@imageforge/cli");
const processor = require("@imageforge/cli/processor");
const { getDefaultConcurrency, runImageforge } = require("@imageforge/cli/runner");
```

Useful root exports include `processImage`, `convertImage`, `generateBlurDataURL`, and manifest
types. The runner API is intentionally subpath-only and semver-stable.

## Source Input Scope

Current supported source extensions:

- `jpg`, `jpeg`, `png`, `gif`, `tiff`, `tif`

Notes:

- `webp` and `avif` source files are currently excluded as inputs.
- GIF handling is static-only (first frame).

## CI Mode

Use check mode in CI to fail when assets are out of date:

```bash
imageforge ./public/images --check
```

## Benchmarking

CI-native benchmark tooling and contracts live in `docs/benchmark/`.

- Standard and thresholds: `docs/benchmark/STANDARD.md`
- Data contracts: `docs/benchmark/INTERFACES.md`
- Operational runbook: `docs/benchmark/RUNBOOK.md`
- Dataset policy: `docs/benchmark/DATASET_POLICY.md`

Core commands:

```bash
pnpm run bench:dataset:download -- --dataset-version 1.0.0 --tier tier30 --out-dir /tmp/imageforge-bench-dataset
pnpm run bench:run -- --cli-path ./dist/cli.js --tier-manifest /tmp/imageforge-bench-dataset/extracted/tier30/tier-manifest.json --workspace /tmp/imageforge-bench-run --run-count 4 --profiles P1,P2,P3
pnpm run bench:compare -- --base-summary /tmp/base-summary.json --head-summary /tmp/head-summary.json --out-json /tmp/compare.json --out-md /tmp/compare.md
pnpm run bench:report -- --head-summary /tmp/head-summary.json --base-summary /tmp/base-summary.json --compare /tmp/compare.json --out /tmp/report.md
```

## Development

```bash
pnpm install
pnpm build
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm test
pnpm run check
```

Quality checks run in CI on Node `22` and `24`.

## Release Workflow

- Semantic PR titles are enforced in CI; commit-message lint is currently informational unless branch-protection policy is changed.
- Releases and `CHANGELOG.md` updates are automated via Release Please.
- Tags follow annotated SemVer with `v` prefix (for example `v0.1.3`).
- npm publish workflow uses GitHub OIDC trusted publishing.

Run the local pre-release gate before publishing:

```bash
pnpm run release:verify
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE)
