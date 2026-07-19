# Troubleshooting installs and generated state

## Node.js and native image runtime

ImageForge requires Node.js 20 or newer and uses Sharp for image decoding and encoding. Install the
CLI as a project dependency with optional dependencies enabled so your package manager can select
the Sharp/libvips binary for the current operating system, CPU, and C library.

If installation succeeds on one platform but fails after copying `node_modules` to another, perform
a frozen install on the target platform instead. Do not copy a macOS or glibc dependency tree into
an Alpine/musl container. For a lockfile shared across architectures, use the package manager's
supported-architecture configuration described in the
[Sharp installation guide](https://sharp.pixelplumbing.com/install/).

## The command is not found

Prefer an exact project dev dependency and a package script:

```bash
pnpm add --save-dev --save-exact @imageforge/cli
```

```json
{
  "scripts": {
    "images:build": "imageforge ./public/images"
  }
}
```

Run it with your package manager, for example `pnpm run images:build`. This avoids global binary
path and permission differences. For one-off evaluation, use `npx @imageforge/cli ... --dry-run`.

## `--check` fails after a source change

For ordinary source/configuration drift, run the non-check generation command printed by the
failure, inspect the source, derivative, manifest, and cache diff together, then rerun the check.
The printed command uses the detected project package manager and exact installed CLI version when
available. Without a matching local dependency it names the exact scoped package and version,
never the unrelated unscoped `imageforge` package. Prefer applying the effective options through
your pinned package script when the repository has one.
The generation and check invocations must use the same formats, quality, widths, filters, blur
settings, and output paths.

Do not run generation and check concurrently against the same paths. A check can safely observe a
partially updated cache/manifest transition and fail; rerun it after generation completes.

After upgrading from a cache written by an older ImageForge version, run one unfiltered generation
even when the images appear unchanged. Legacy and v1 caches remain readable for migration, but only
a fully migrated v2 cache stores derivative and blur-metadata SHA-256 digests plus generator
identity required by the stronger generated-state freshness check. An ImageForge, Sharp, or libvips
identity change likewise requires regeneration.

If the cache is missing, malformed, or unsupported, ImageForge cannot prove that existing
derivatives are owned by the current source/options contract. The suggested base command can stop
at collision preflight. Inspect the existing files, then remove or move conflicts, or add
`--force-overwrite` only when replacing them is intentional. Run `--check` again after the cache,
derivatives, and manifest have been regenerated together.

## A source or output contract changed

A normal run prunes deleted entries from the cache and manifest, including the case where the final
source was removed. Changing formats, responsive widths, output paths, or naming rules can likewise
leave a previously generated derivative outside the new manifest. ImageForge reports known
previously cache-owned paths as `OBSOLETE_OUTPUTS`, but does not delete them automatically. Review
and remove them explicitly so a filename that is now owned by another process is never deleted by
surprise.

## An existing output is protected

With `--no-cache`, ImageForge cannot prove that an existing derivative belongs to the current
source/options contract. It refuses to overwrite by default. Inspect the target, then pass
`--force-overwrite` only when replacement is intentional.

ImageForge also refuses a symlink used as the configured output root, or any symlinked directory
below it. Choose the real destination directory explicitly so ownership checks and atomic
replacement cannot cross an indirect filesystem boundary.
