# Manifest Compatibility Notes

## Compatibility Statement

Responsive support is additive. `variants` is optional and may be absent.

- Existing consumers that read only `outputs` remain compatible.
- Consumers that use responsive data must treat `variants` as optional.

## Consumer Guidance

1. Always read `outputs.<format>` as a valid fallback path.
2. Use `variants?.<format>` only when present.
3. Do not assume every image has responsive variants.

Recommended robust access pattern:

```ts
const entry = manifest.images[src];
const primaryWebp = entry.outputs.webp.path;
const webpVariants = entry.variants?.webp ?? [];
```

## Schema Notes

- No schema version bump is required for this additive field.
- `variants[*].width` values represent effective generated widths, not raw requested targets.
