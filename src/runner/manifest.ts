import * as fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { isRecord } from "../shared.js";
import type { ImageForgeManifest } from "../types.js";

function withoutGenerated(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "generated"));
}

export function manifestMatches(outputPath: string, expected: ImageForgeManifest): boolean {
  try {
    const current = JSON.parse(fs.readFileSync(outputPath, "utf8")) as unknown;
    if (!isRecord(current)) return false;
    if (Object.keys(current).sort().join(",") !== "generated,images,version") return false;
    if (typeof current.generated !== "string") {
      return false;
    }
    const generated = new Date(current.generated);
    if (Number.isNaN(generated.getTime()) || generated.toISOString() !== current.generated)
      return false;
    return isDeepStrictEqual(
      withoutGenerated(current),
      withoutGenerated(expected as unknown as Record<string, unknown>)
    );
  } catch {
    return false;
  }
}
