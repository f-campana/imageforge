# Typed React/Vite Consumer Proof

## Status

`examples/vite-react` is an experimental consumer proof. It is not a stable React adapter, a stable
Vite integration, or a framework-support claim. The example owns its React component locally and
uses the existing internal, build-only `imageforgeVitePlugin()`.

The proof covers one path:

```txt
ImageForge Vite plugin -> virtual:imageforge -> TypeScript -> local React component -> Vite build
```

## Consumer API

The Vite plugin compiles images before the browser entry is bundled. Its `virtual:imageforge`
module exposes the mapped manifest and a manifest-bound rendering function:

```tsx
import { getPictureProps } from "virtual:imageforge";

const hero = getPictureProps("hero.jpg", {
  alt: "Blue ImageForge fixture",
  sizes: "(max-width: 720px) 100vw, 960px",
  fallbackFormat: "webp",
});
```

`fallbackFormat: "webp"` is intentional. The compiler input lives under `src`, while generated
assets live under Vite's `public/imageforge` directory. The Vite build serves the generated WebP
fallback; it does not serve the original source image automatically.

The example maps the framework-neutral result to markup in a component it owns:

```tsx
import type { ImageForgePictureProps } from "@imageforge/cli/render";

export function ImageForgePicture({ sources, img }: ImageForgePictureProps) {
  return (
    <picture>
      {sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={source.sizes} />
      ))}
      <img {...img} />
    </picture>
  );
}
```

This component is example code, not a published React helper.

## Local virtual-module declaration

Virtual modules do not have a filesystem declaration that TypeScript can discover. The example
therefore owns this declaration in `src/vite-env.d.ts`:

```ts
declare module "virtual:imageforge" {
  import type {
    GetPicturePropsOptions,
    ImageForgeManifest,
    ImageForgePictureProps,
  } from "@imageforge/cli/render";

  export const manifest: ImageForgeManifest;
  export function getPictureProps(
    src: string,
    options: GetPicturePropsOptions
  ): ImageForgePictureProps;
}
```

The `@imageforge/cli/render` subpath contains only the framework-neutral rendering implementation
and its types. The Vite adapter itself runs at build time from the root package; it is absent from
the emitted browser module graph, along with the CLI, runner, processor, `sharp`, and Node built-ins.

Because this private example has its own `package.json` but is not an installed workspace package,
its TypeScript and Vite configurations map that package subpath to the repository's built render
artifact. A separately installed consumer resolves the same subpath through package exports.

## Run the proof

From the repository root:

```sh
pnpm run example:vite-react:typecheck
pnpm run example:vite-react:build
```

The build decodes a tiny fixture, generates AVIF and WebP derivatives, and writes the Vite output
under `examples/vite-react/dist`.

Manifest v1 remains sufficient. It already supplies dimensions, ordered derivative candidates,
fallback outputs, and blur data; the Vite boundary supplies the public URL policy.

## Extraction criteria

A real Vite package or React helper should not be published until additional consumers establish:

- a stable plugin option and deployment-URL contract;
- an explicit dev/watch/HMR lifecycle and invalidation policy;
- a maintainable virtual-module declaration strategy;
- evidence that repeated framework consumers benefit from shared React code instead of a local
  five-line mapping component;
- packaging tests that prove Node-only compiler code and browser rendering code remain separated.

This slice does not implement development mode, HMR, watch behavior, another framework, package
splitting, or manifest v2.
