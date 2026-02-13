export const MIN_WIDTH = 1;
export const MAX_WIDTH = 16_384;

export interface OrientedDimensions {
  width: number;
  height: number;
}

export function normalizeRequestedWidths(widths: readonly number[]): number[] {
  return Array.from(new Set(widths)).sort((left, right) => left - right);
}

export function resolveEffectiveWidths(
  sourceWidth: number,
  requestedWidths: readonly number[] | null | undefined
): number[] {
  if (!requestedWidths || requestedWidths.length === 0) {
    return [sourceWidth];
  }

  const eligible = normalizeRequestedWidths(requestedWidths).filter(
    (requestedWidth) => requestedWidth <= sourceWidth
  );

  if (eligible.length > 0) {
    return eligible;
  }

  return [sourceWidth];
}

export function resolveOrientedDimensions(
  baseWidth: number | undefined,
  baseHeight: number | undefined,
  orientation: number | undefined
): OrientedDimensions {
  const width = baseWidth ?? 0;
  const height = baseHeight ?? 0;
  const normalizedOrientation = orientation ?? 1;
  const isQuarterTurn = normalizedOrientation >= 5 && normalizedOrientation <= 8;

  return isQuarterTurn ? { width: height, height: width } : { width, height };
}
