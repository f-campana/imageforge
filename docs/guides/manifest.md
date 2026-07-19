# Manifest and freshness contract

`imageforge.json` maps each input-relative source path to intrinsic dimensions, a source/options
hash, optional blur data, and generated outputs. Responsive runs also include ordered variants.

## Path rules

- Keys and output paths use POSIX separators.
- Output paths are relative to the input directory.
- An external `--out-dir` can therefore produce paths containing `../` segments.
- `outputs.<format>` points to the largest effective variant when `--widths` is enabled.

Resolve public URLs using the URL mount point that corresponds to your input directory. For
example, an input of `public/images` and a manifest path of `hero.webp` maps to `/images/hero.webp`.

## Expected generated state

For this command:

```bash
imageforge ./public/images --formats webp,avif --widths 320,640
```

a single `hero.jpg` source produces a reviewable tree similar to:

```text
.
├── imageforge.json
└── public/images
    ├── .imageforge-cache.json
    ├── hero.jpg
    ├── hero.w320.avif
    ├── hero.w320.webp
    ├── hero.w640.avif
    └── hero.w640.webp
```

The largest effective variant is also exposed through `outputs.webp` and `outputs.avif`; every
candidate is listed under `variants.webp` and `variants.avif`. Width targets larger than the source
are filtered rather than upscaled, so the exact suffixes can be smaller than the requested set.

## Check semantics

`--check` is a read-only generated-state assertion. It exits `1` when:

- a source hash/options combination has no valid cached output;
- cached source dimensions, configured formats, or responsive widths do not match the current
  source and command;
- a recorded output is missing, has a non-deterministic path, byte size, or SHA-256 content digest,
  or resolves through a symlink at or below the configured output root; or
- the cache is missing, malformed, uses an unsupported schema, or contains deleted-source entries; or
- the manifest is missing, invalid, or differs from the expected version and image entries.

The top-level `generated` timestamp is excluded from freshness comparison. This keeps identical
content reproducible while preserving a useful audit timestamp on normal builds.

Cache schema v2 records derivative and blur-metadata SHA-256 digests plus the ImageForge, Sharp, and
libvips generator identity. ImageForge can read v1 and legacy caches as migration input, but they
cannot prove exact generated state: run one unfiltered generation after upgrading ImageForge or its
image runtime to refresh every retained entry and write a current v2 cache before expecting
`--check` to pass.

If every source is deleted, the old non-empty manifest is stale. Run the printed build command to
write an empty manifest/cache, then explicitly review orphaned derivative files.
