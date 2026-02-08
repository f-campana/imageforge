# ImageForge CLI

Build-time image pipeline for Next.js and web apps: generate blur placeholders and optimized formats with hash-based caching.

## Why ImageForge

- WebP and AVIF conversion from one command
- blur placeholder generation (`blurDataURL`)
- hash-based caching for fast reruns
- `--check` mode for CI validation

## Install

```bash
npm install -g @imageforge/cli
```

## Development (pnpm)

```bash
pnpm install
pnpm build
pnpm test
```

## Quick Start

```bash
imageforge ./public/images
```

By default this writes:

- derivatives next to source files (for example `hero.jpg -> hero.webp`)
- cache file at `./public/images/.imageforge-cache.json`
- manifest at `./imageforge.json`

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
- `-V, --version`: print version
- `-h, --help`: print help

Runtime behavior:

- normal runs exit with code `1` if any file fails processing
- when cache is enabled, existing output files must be cache-owned or the run fails fast
- if cache-enabled ownership protection blocks a run, `--force-overwrite` is the explicit override
- `--no-cache` ignores cache file reads/writes entirely
- with `--no-cache`, existing outputs are protected by default; use `--force-overwrite` to overwrite

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
