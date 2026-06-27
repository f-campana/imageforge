# Rendering Contract V0

## Purpose

ImageForge compiles responsive image assets at build time. The manifest records generated files,
but consumers should not need to understand optional variants, format ordering, fallback pointers,
or filesystem-to-URL boundaries. `getPictureProps()` is the small public seam between manifest v1
and rendering code.

This contract is framework-neutral. It returns data for picture markup; it does not render HTML,
serve files, or claim integration with a framework.

## Public API

```ts
export interface GetPicturePropsOptions {
  alt: string;
  sizes: string;
  publicBasePath?: string;
  assetBaseUrl?: string;
  fallbackFormat?: "original" | "webp" | "avif";
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
}

export function getPictureProps(
  manifest: ImageForgeManifest,
  src: string,
  options: GetPicturePropsOptions
): ImageForgePictureProps;
```

`ImageForgePictureProps` contains ordered `sources`, `img` properties, and an optional
`blurDataURL`. Failures throw `ImageForgeRenderError`, whose stable `code` can be inspected by
callers.

## Manifest v1 input

Manifest v1 already provides the information needed by this slice:

- source asset keys;
- oriented source width and height;
- per-format generated output pointers;
- optional per-format responsive variants with effective widths;
- optional blur placeholder content (represented as an empty string when generation is disabled).

The renderer normalizes each selected entry into source dimensions, a per-format candidate list,
and a fallback pointer. When `variants.<format>` is absent or empty, `outputs.<format>` becomes one
candidate at the entry's source width. Existing non-responsive manifests therefore remain usable.

Conceptually, the private normalized view is:

```ts
type NormalizedAsset = {
  key: string;
  width: number;
  height: number;
  candidates: Partial<Record<"avif" | "webp", Array<{ path: string; width: number }>>>;
  fallbackOutputs: Partial<Record<"avif" | "webp", string>>;
  blurDataURL?: string;
};
```

This type is deliberately not public. The public module returns only rendering props, leaving room
to evolve manifest normalization without making consumers depend on it.

No manifest version change is required.

## Source and `srcset` rules

Sources are emitted only for generated AVIF and WebP data, in this order:

1. `image/avif`
2. `image/webp`

Within each source, candidates are sorted by numeric width and formatted as
`<resolved-url> <width>w`. The helper uses only widths recorded by the manifest. It does not invent
a source-width candidate when responsive generation produced a smaller source-bounded set.

`sizes` is required and copied to every source. Image dimensions cannot describe page layout, so
the helper does not guess a default. An empty runtime value is rejected.

## Fallback rules

`img.width`, `img.height`, and `img.alt` come from the manifest entry and caller options.
`loading` and `decoding` are copied when supplied.

The default `fallbackFormat` is `original`, so `img.src` resolves the source asset key. A caller may
select `webp` or `avif`; the matching `outputs.<format>.path` is then used. Selecting a generated
format that is absent is an explicit error rather than an implicit format change.

An empty `alt` string is valid for a decorative image, but the property itself is required.

## URL policy

Manifest paths are asset paths, not proof that a web server exposes those paths. URL resolution is
deterministic:

- with no options, `images/hero.webp` becomes `/images/hero.webp`;
- `publicBasePath: "/compiled"` prefixes it as `/compiled/images/hero.webp`;
- `assetBaseUrl: "https://cdn.example.com/assets"` appends it to that absolute base;
- when both are set, the public path is appended after the asset base, for example
  `https://cdn.example.com/assets/compiled/images/hero.webp`.

Asset and public-path segments are URL-encoded. Asset paths must be non-empty, relative POSIX paths.
Absolute paths, backslashes, empty segments, and `.` or `..` segments are rejected. `assetBaseUrl`
must be an absolute HTTP(S) URL without a query or hash.

This is intentionally strict about manifest paths containing `../`, which ImageForge can currently
write when `--out-dir` is outside the input tree. Such a path describes a filesystem relationship,
not an unambiguous public URL. Consumers must arrange a public-relative output layout before using
this helper. A future build adapter may supply an explicit path mapping, but the renderer does not
guess one.

## Blur data

A non-empty manifest `blurDataURL` is returned unchanged. The field is omitted when the manifest
contains the empty string produced by `--no-blur`. Applying the placeholder is the renderer's
responsibility.

## Errors

| Code                        | Meaning                                                  |
| --------------------------- | -------------------------------------------------------- |
| `IMAGE_NOT_FOUND`           | The asset key is absent from the manifest.               |
| `NO_RENDERABLE_OUTPUTS`     | The entry has neither AVIF nor WebP candidates.          |
| `FALLBACK_FORMAT_NOT_FOUND` | The requested generated fallback output is absent.       |
| `INVALID_MANIFEST_ENTRY`    | Required dimensions or candidate widths are invalid.     |
| `INVALID_ASSET_PATH`        | An asset path cannot safely become a public URL.         |
| `INVALID_URL_POLICY`        | A configured URL base or prefix is invalid.              |
| `INVALID_OPTIONS`           | Required runtime rendering options are invalid or empty. |

## Example

```ts
import { getPictureProps } from "@imageforge/cli";
import manifest from "./imageforge.json" with { type: "json" };

const picture = getPictureProps(manifest, "images/hero.jpg", {
  alt: "Sunrise over a valley",
  sizes: "(max-width: 720px) 100vw, 1200px",
  publicBasePath: "/media",
});
```

Framework or HTML code can map `picture.sources` to `<source>` elements and `picture.img` to the
fallback `<img>`. Adapters remain a later slice after this contract is proven.

## Manifest v1 decision

Manifest v1 is sufficient for this rendering-contract slice through internal normalization. Its
known boundary is public URL mapping for filesystem-relative `../` outputs; that ambiguity does not
justify a breaking manifest v2 here. Evidence from future adapters should determine whether an
additive public-path field or a later schema revision is needed.
