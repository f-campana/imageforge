# ImageForge CLI

Build-time image pipeline for Next.js and web apps: generate blur placeholders and optimized formats with hash-based caching.

## Why ImageForge

- WebP and AVIF conversion from one command
- blur placeholder generation (`blurDataURL`)
- hash-based caching for fast reruns
- bounded parallel processing with `--concurrency`
- `--check` mode for CI validation

## Install

```bash
npm install -g @imageforge/cli
```

## Development (pnpm)

```bash
pnpm install
pnpm build
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm test
pnpm run check
```

## Open Source Workflow

- Conventional Commit messages are required for commits and PR titles.
- Releases and `CHANGELOG.md` updates are automated via Release Please.
- Tags follow annotated SemVer with a `v` prefix (for example `v0.1.1`).

See:

- [CONTRIBUTING](./CONTRIBUTING.md)
- [SECURITY](./SECURITY.md)
- [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md)

## Release Verify

Run the pre-release gate locally before publishing:

```bash
pnpm run release:verify
```

## Quick Start

```bash
imageforge ./public/images
```

By default this writes:

- derivatives next to source files (for example `hero.jpg -> hero.webp`)
- cache file at `./public/images/.imageforge-cache.json`
- manifest at `./imageforge.json`

With `--out-dir`, derivatives and cache are written under that directory while manifest output paths stay relative to the input directory.

## Usage

```bash
imageforge <directory> [options]
```

Options:

- `-o, --output <path>`: manifest output path (default: `imageforge.json`)
- `-f, --formats <formats>`: comma-separated output formats (default: `webp`)
- `-q, --quality <number>`: output quality 1..100 (default: `80`)
- `--no-blur`: skip blur placeholder generation
- `--blur-size <number>`: blur dimensions 1..256 (default: `4`)
- `--no-cache`: disable cache reads/writes
- `--force-overwrite`: allow overwriting existing output files
- `--check`: exit with code `1` when files need processing
- `--out-dir <path>`: separate output directory for generated files
- `--concurrency <number>`: process images in parallel (default: `min(8, availableParallelism)`)
- `--json`: emit structured JSON report to stdout
- `--verbose`: print additional diagnostics (cache path, hashes, mode details)
- `--quiet`: suppress per-file non-error logs
- `--config <path>`: explicitly load a JSON config file
- `-V, --version`: print version
- `-h, --help`: print help

Runtime behavior:

- normal runs exit with code `1` if any file fails processing
- output collision checks are case-insensitive (`hero.jpg` and `Hero.png` are treated as conflicting outputs)
- when cache is enabled, existing output files must be cache-owned or the run fails fast
- if cache-enabled ownership protection blocks a run, `--force-overwrite` is the explicit override
- `--no-cache` ignores cache file reads/writes entirely
- with `--no-cache`, existing outputs are protected by default; use `--force-overwrite` to overwrite
- symlinks are skipped during discovery (the walker does not recurse into symlinked directories)
- `--check` prints an exact copy-pastable rerun command with effective processing options
- standard logs include progress prefixes like `[42/500]`

## Config File Support

ImageForge resolves configuration in this order:

1. defaults
2. config file (`--config <path>`, otherwise `imageforge.config.json`, otherwise `package.json#imageforge`)
3. CLI flags

Unknown config keys fail fast.

Boolean options can be explicitly disabled from CLI using `--no-<flag>` (for example `--no-check`, `--no-json`, `--no-force-overwrite`, `--no-quiet`).

Example `imageforge.config.json`:

```json
{
  "output": "imageforge.json",
  "formats": ["webp", "avif"],
  "quality": 80,
  "blur": true,
  "blurSize": 4,
  "cache": true,
  "outDir": "public/generated",
  "concurrency": 4
}
```

## JSON Output Mode

Use `--json` to emit a machine-readable report to stdout:

```bash
imageforge ./public/images --json
```

The report includes:

- normalized effective options
- per-image status (`processed`, `cached`, `failed`, `needs-processing`)
- summary counters and byte totals
- rerun command hint in `--check` failures

## Source Format Scope (v0.1.0)

ImageForge v0.1.0 processes: `jpg`, `jpeg`, `png`, `gif`, `tiff`, `tif`.

`webp` and `avif` source inputs are intentionally excluded in v0.1.0 to avoid in-place overwrite loops. Support for those as source inputs is planned for v0.2.0.

GIF handling is static-only in v0.1.0 (animated GIFs are processed as first frame).

## Manifest Shape

```json
{
  "version": "1.0",
  "generated": "2026-02-08T00:00:00.000Z",
  "images": {
    "hero.jpg": {
      "width": 1200,
      "height": 800,
      "aspectRatio": 1.5,
      "blurDataURL": "data:image/png;base64,...",
      "originalSize": 345678,
      "outputs": {
        "webp": { "path": "hero.webp", "size": 98765 },
        "avif": { "path": "hero.avif", "size": 65432 }
      },
      "hash": "abc123..."
    }
  }
}
```

All manifest keys and output paths are input-directory-relative POSIX paths (forward slashes).

When `--out-dir` is used, each output path is still relative to the input directory (for example `generated/hero.webp`).

## Next.js Example

```ts
import manifest from "./imageforge.json";

type Manifest = typeof manifest;

export function getImageData(src: string) {
  return (manifest as Manifest).images[src];
}
```

Then use:

- original source path for `src`
- `getImageData(src)?.blurDataURL` for `placeholder="blur"`

## Programmatic API

ImageForge now exports processor helpers from the package root and `./processor` subpath.

```ts
const imageforge = require("@imageforge/cli");
const processor = require("@imageforge/cli/processor");
```

Useful exports include `processImage`, `convertImage`, `generateBlurDataURL`, and manifest types.

## Git Hygiene (In-place Outputs)

If you do not want generated outputs committed, add:

```gitignore
# ImageForge generated outputs
**/*.webp
**/*.avif

# ImageForge cache
**/.imageforge-cache.json
```

## CI Check Mode

```bash
imageforge ./public/images --check
```

- exits `0` when all inputs are up to date
- exits `1` when at least one input needs processing
- failure output includes the exact non-check command to run with the same processing options

## CI Matrix Note

GitHub Actions runs quality checks on Node 22/24 to align with the `engines.node >=22` policy.
