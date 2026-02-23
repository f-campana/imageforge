import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { fromPosix, outputPathFor, toPosix } from "../processor.js";
import type { OutputFormat, ProcessOptions } from "../processor.js";
import { resolveEffectiveWidths, resolveOrientedDimensions } from "../responsive.js";
import { LIMIT_INPUT_PIXELS } from "../shared.js";
import { collectEntryOutputs } from "./cache.js";
import type { CacheEntry } from "./cache.js";

export interface PreflightItem {
  imagePath: string;
  relativePath: string;
}

export interface PreflightIssue {
  message: string;
  details: string[];
}

export function sanitizeForTerminal(value: string): string {
  let sanitized = "";
  for (const char of value) {
    if (char === "\n") {
      sanitized += "\\n";
      continue;
    }
    if (char === "\r") {
      sanitized += "\\r";
      continue;
    }
    if (char === "\t") {
      sanitized += "\\t";
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      sanitized += `\\x${code.toString(16).padStart(2, "0")}`;
      continue;
    }

    sanitized += char;
  }
  return sanitized;
}

function canonicalPathKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function resolveOutputPath(
  relativePath: string,
  format: OutputFormat,
  inputDir: string,
  outputDir: string,
  width?: number
): string {
  const outputInsideOutDir = outputPathFor(relativePath, format, width);
  const fullOutputPath = path.resolve(outputDir, fromPosix(outputInsideOutDir));
  return toPosix(path.relative(inputDir, fullOutputPath));
}

function resolveOutputPaths(
  relativePath: string,
  format: OutputFormat,
  inputDir: string,
  outputDir: string,
  widths: number[] | undefined
): string[] {
  if (!widths || widths.length === 0) {
    return [resolveOutputPath(relativePath, format, inputDir, outputDir)];
  }

  return widths.map((width) => resolveOutputPath(relativePath, format, inputDir, outputDir, width));
}

async function readImageWidthForPreflight(imagePath: string): Promise<number> {
  const metadata = await sharp(imagePath, {
    limitInputPixels: LIMIT_INPUT_PIXELS,
  }).metadata();
  const { width } = resolveOrientedDimensions(
    metadata.width,
    metadata.height,
    metadata.orientation
  );
  return width;
}

export async function preflightCollisions(
  items: PreflightItem[],
  options: ProcessOptions,
  inputDir: string,
  outputDir: string,
  cache: Map<string, CacheEntry>,
  useCache: boolean,
  forceOverwrite: boolean
): Promise<PreflightIssue | null> {
  const planned = new Map<string, { source: string; outputPath: string }>();
  const cacheOwners = new Map<string, { source: string; outputPath: string }>();

  for (const [source, entry] of cache.entries()) {
    for (const output of collectEntryOutputs(entry.result)) {
      cacheOwners.set(canonicalPathKey(output.path), { source, outputPath: output.path });
    }
  }

  for (const item of items) {
    let effectiveWidths: number[] | undefined;
    if (options.widths && options.widths.length > 0) {
      try {
        const sourceWidth = await readImageWidthForPreflight(item.imagePath);
        effectiveWidths = resolveEffectiveWidths(sourceWidth, options.widths);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return {
          message: "Failed preflight width planning:",
          details: [
            `  • ${sanitizeForTerminal(item.relativePath)}`,
            `  • ${message}`,
            "Fix: verify source image is readable and valid before rerunning.",
          ],
        };
      }
    }

    for (const format of options.formats) {
      const outputPaths = resolveOutputPaths(
        item.relativePath,
        format,
        inputDir,
        outputDir,
        effectiveWidths
      );

      for (const outputPath of outputPaths) {
        const outputKey = canonicalPathKey(outputPath);
        const existingSource = planned.get(outputKey);

        if (existingSource && existingSource.source !== item.relativePath) {
          return {
            message: "Output collision detected:",
            details: [
              `  • ${sanitizeForTerminal(existingSource.source)} -> ${sanitizeForTerminal(
                existingSource.outputPath
              )}`,
              `  • ${sanitizeForTerminal(item.relativePath)} -> ${sanitizeForTerminal(outputPath)}`,
              "Fix: rename one source file or change --out-dir.",
            ],
          };
        }

        planned.set(outputKey, {
          source: item.relativePath,
          outputPath,
        });

        const fullOutputPath = path.resolve(inputDir, fromPosix(outputPath));
        if (!fs.existsSync(fullOutputPath)) continue;
        if (forceOverwrite) continue;

        if (!useCache) {
          return {
            message: "Output path already exists and --no-cache is enabled:",
            details: [
              `  • ${sanitizeForTerminal(item.relativePath)} -> ${sanitizeForTerminal(outputPath)}`,
              "Fix: remove existing outputs or rerun with --force-overwrite.",
            ],
          };
        }

        const owner = cacheOwners.get(outputKey);
        if (!owner) {
          return {
            message: "Output path already exists and is not cache-owned:",
            details: [
              `  • ${sanitizeForTerminal(item.relativePath)} -> ${sanitizeForTerminal(outputPath)}`,
              "Fix: remove or rename the existing output, or use --out-dir.",
            ],
          };
        }

        if (owner.source !== item.relativePath) {
          return {
            message: "Output path already exists and is owned by a different cached source:",
            details: [
              `  • ${sanitizeForTerminal(owner.source)} -> ${sanitizeForTerminal(owner.outputPath)}`,
              `  • ${sanitizeForTerminal(item.relativePath)} -> ${sanitizeForTerminal(outputPath)}`,
              "Fix: rename the source file, remove conflicting output, or use --out-dir.",
            ],
          };
        }
      }
    }
  }

  return null;
}
