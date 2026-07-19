# Next.js delivery

ImageForge CLI generates files at build time. Next.js only serves those files directly when your
rendered markup points to the generated paths and avoids a second runtime transformation.

## `next/image`

Use manifest dimensions and a generated output path. Set `unoptimized` to bypass the runtime image
optimizer:

```tsx
import Image from "next/image";
import manifest from "../../imageforge.json";

const hero = manifest.images["hero.jpg"];

export function Hero() {
  return (
    <Image
      src={`/images/${hero.outputs.webp.path}`}
      width={hero.width}
      height={hero.height}
      alt="Product dashboard"
      placeholder="blur"
      blurDataURL={hero.blurDataURL}
      unoptimized
    />
  );
}
```

Without `unoptimized` (or an equivalent custom loader), `next/image` may route the generated file
through Next.js image optimization again.

## Responsive `<picture>`

For generated WebP and AVIF variants, build `srcSet` from `variants` and supply a `sizes` value that
matches the rendered layout. Keep the original format as a fallback when older clients matter.

```tsx
const avif = hero.variants?.avif ?? [];
const webp = hero.variants?.webp ?? [];
const srcSet = (items: typeof avif) =>
  items.map(({ path, width }) => `/images/${path} ${width}w`).join(", ");

<picture>
  <source type="image/avif" srcSet={srcSet(avif)} sizes="(min-width: 1024px) 50vw, 100vw" />
  <source type="image/webp" srcSet={srcSet(webp)} sizes="(min-width: 1024px) 50vw, 100vw" />
  <img src="/images/hero.jpg" width={hero.width} height={hero.height} alt="Product dashboard" />
</picture>;
```

Static source imports already give Next.js intrinsic dimensions and optional blur metadata for
supported local files. ImageForge is most useful when you want committed derivatives, framework-
independent manifests, controlled width sets, or a CI freshness contract.
