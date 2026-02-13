# Responsive Width Flow

This note defines the invariant flow used for responsive output planning and generation.

## Terms

- Requested widths: user-provided width list from CLI/config.
- Normalized requested widths: requested widths deduped and sorted ascending.
- Effective widths: normalized requested widths that are less than or equal to source width.
- Fallback width: source width used when all requested widths exceed source width.

## Single Source of Truth

`src/responsive.ts` provides shared utilities used by both planning and processing:

1. `normalizeRequestedWidths(widths)`

- Removes duplicates.
- Returns ascending order.

2. `resolveEffectiveWidths(sourceWidth, requestedWidths)`

- Uses normalized requested widths.
- Keeps only values `<= sourceWidth`.
- Falls back to `[sourceWidth]` when none are eligible.

3. `resolveOrientedDimensions(width, height, orientation)`

- Applies EXIF orientation normalization so width/height are aligned with rotated output behavior.

## Planning vs Processing

Planning (`src/runner.ts` preflight):

1. Reads source metadata width (orientation-normalized).
2. Resolves effective widths via shared utility.
3. Plans concrete output paths from effective widths.
4. Performs case-insensitive collision checks on those planned paths.

Processing (`src/processor.ts`):

1. Resolves orientation-normalized source dimensions.
2. Resolves effective widths via shared utility.
3. Generates only effective variants.
4. Sets `outputs.<format>` to the largest generated variant.

## Manifest/Output Invariants

When responsive widths are enabled:

1. `variants.<format>` contains effective generated widths in ascending order.
2. `outputs.<format>` points to the largest generated variant path.
3. Requested widths larger than source are never upscaled; source-width fallback is used.

These invariants ensure preflight path planning and runtime output generation stay in sync.
