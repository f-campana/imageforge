# Experimental Vite Adapter Proof

## Status and scope

This adapter is an internal, build-mode-only proof. It validates that the ImageForge compiler,
manifest v1, framework-neutral rendering contract, and a real Vite lifecycle can share one small
boundary. It is not a general Vite or Vite-framework support claim and is not a separate package.

Vite is the first build-tool proof because its plugin lifecycle and public-directory convention
make the missing responsibility explicit: mapping generated filesystem paths to URLs that a build
actually serves.

## Experimental API

```ts
import { imageforgeVitePlugin } from "@imageforge/cli";

export default {
  base: "/docs/",
  plugins: [
    imageforgeVitePlugin({
      inputDir: "src/assets/images",
      outDir: "public/imageforge",
      publicBasePath: "/docs/imageforge",
      formats: ["webp", "avif"],
      widths: [320, 640, 960, 1280],
    }),
  ],
};
```

The plugin owns build-time compiler invocation, Vite output-layout validation, manifest path
mapping, and the `virtual:imageforge` module. The core rendering contract continues to own manifest
normalization, source ordering, `srcset` construction, fallback selection, and URL validation.

## Virtual module

```ts
import { getPictureProps, manifest } from "virtual:imageforge";

const picture = getPictureProps("hero.jpg", {
  alt: "Hero image",
  sizes: "(max-width: 720px) 100vw, 1200px",
  fallbackFormat: "webp",
});
```

The module exports the public manifest and a `getPictureProps(src, options)` wrapper. The wrapper
injects the plugin's `publicBasePath` unless a caller supplies an explicit override. Overrides still
pass through the core rendering contract's URL validation.

The compiler does not copy source assets. When `inputDir` is outside Vite's public directory, the
default `fallbackFormat: "original"` points to a URL Vite does not automatically serve. Select a
generated `webp` or `avif` fallback, as the fixture does, or arrange serving for the original source
separately.

## Public URL mapping

The proof requires `outDir` to be inside Vite's resolved `publicDir`. It also requires
`publicBasePath` to equal Vite's root-relative `base` plus the output directory's path below
`publicDir`. For example:

```txt
publicDir:      <root>/public
outDir:         <root>/public/imageforge
Vite base:      /docs/
publicBasePath: /docs/imageforge
```

ImageForge's compiler can record paths such as `../../../public/imageforge/hero.webp` because
manifest paths are input-directory-relative. The adapter resolves each generated path, proves it is
inside the configured output directory, and rewrites it to `hero.webp` before writing and exposing
the public manifest. The rendering wrapper then produces `/docs/imageforge/hero.webp`. Absolute
paths and unresolved `../` segments are never exposed.

Root-relative Vite bases such as `/` and `/docs/` are supported. Relative bases (`./`),
protocol-relative bases, external URL bases, and percent-encoded base paths are rejected with
`UNSUPPORTED_VITE_BASE`; those forms need a more explicit deployment URL policy than this proof
currently models.

Adapter failures are `ImageForgeViteError` instances. Callers integrating through Vite should
inspect `imageforgeCode`; Rollup may replace the generic `Error.code` field with `PLUGIN_ERROR` for
errors raised during build hooks.

Compiler cache state is staged through Vite's private `cacheDir`; `.imageforge-cache.json` is
removed from the public output directory before Vite copies assets into the build.

Manifest v1 remains sufficient: the adapter can derive the served path from compiler output plus
its explicit Vite output policy. No schema change is justified by this proof.

## Current limitations

- Build mode only; dev server, watch invalidation, and HMR are not implemented.
- Vite `publicDir` must be enabled, and generated output must live below it.
- The configured public path must match Vite's root-relative base and public-directory layout.
- Relative, protocol-relative, external, and percent-encoded Vite bases are not supported.
- Original source serving is caller-owned.
- No React, Vue, Svelte, Solid, TanStack Start, Rsbuild, remote-source, or CMS adapter is included.
- TypeScript projects must currently declare the virtual module locally if their type checker
  analyzes its imports.

The module stays inside `@imageforge/cli` until additional build-tool and framework examples prove
that its options and ownership boundary are stable enough for package extraction.

## Executable fixture

Run the plain-HTML proof from the repository root:

```sh
pnpm run example:vite:build
```

The fixture decodes a tiny source image, runs the experimental plugin, and produces a Vite build in
`examples/vite-basic/dist`.
