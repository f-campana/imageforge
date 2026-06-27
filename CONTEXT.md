# ImageForge Domain Glossary

## Asset and output terms

**Source Asset** — An original image accepted by the compiler. Its input-relative POSIX path is
the asset key in the manifest.

**Asset Key** — The stable lookup key for a source asset within one manifest, such as
`products/hero.jpg`. It identifies an asset; it is not automatically a public URL.

**Generated Asset** — Any file emitted by ImageForge from a source asset.

**Derivative** — One generated asset with a specific output format and transformation. A
derivative is a file, not a manifest pointer or rendering prop.

**Variant** — A derivative at one effective responsive width. Variants of one format form the
candidate set for a `srcset`.

**Output** — The manifest's per-format fallback pointer. In responsive mode it points to the
largest generated variant; without responsive mode it points to the single derivative.

**Manifest Entry** — Manifest v1 metadata for one source asset: dimensions, blur data, hashes,
outputs, and optional variants.

## Consumption terms

**Normalized Asset** — The consumer-facing internal view produced from a manifest entry. It
orders formats and widths, resolves legacy output-only entries, and separates asset paths from
public URLs.

**Renderable Image** — The framework-neutral `sources`, `img`, and optional blur data returned by
the rendering contract.

**Rendering Contract** — The public `getPictureProps()` boundary that turns a manifest and an
asset key into a renderable image without exposing manifest normalization rules.

**URL Policy** — Caller-provided rules that map relative manifest paths to served URLs. The policy
may add a public path prefix and an absolute asset base URL.

**Fallback Policy** — The rule selecting `img.src`: the original source by default, or an explicit
generated WebP/AVIF output.

**Format Ordering** — The deterministic preference order for picture sources: AVIF, then WebP.

**Sizes Policy** — The caller-owned layout description supplied as `sizes`. ImageForge requires it
but does not infer layout from image metadata.

**Adapter** — A thin integration that translates the rendering contract into a framework or build
tool's lifecycle and serving conventions. An adapter does not redefine image semantics.

**Virtual Module** — A build-tool-owned module identifier whose source is generated at build time.
The experimental Vite adapter owns `virtual:imageforge` and exposes its mapped manifest plus a
rendering helper bound to the configured public path.

**Vite Public Directory** — The Vite directory whose files are copied to the build output root
without transformation. The experimental adapter requires generated assets to live below it.

**Public Manifest** — The manifest view exposed to rendering consumers after an adapter replaces
compiler filesystem-relative output paths with paths relative to its served output directory.

## Compiler and operation terms

**Compiler** — The build-time pipeline that discovers source assets, generates derivatives, and
writes the manifest.

**Check Mode** — A read-only compiler mode that reports whether generated state is stale.

**Freshness** — Whether source content and processing options match the cache and generated
outputs expected by the compiler.

**Capability** — A processor or environment feature that has been detected and can be used, not a
roadmap claim.

**Support Matrix** — The set of environments and integrations proven by executable validation.
Planned adapters are not support.
