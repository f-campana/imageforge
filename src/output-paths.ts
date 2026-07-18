import * as fs from "node:fs";
import * as path from "node:path";

import type { OutputFormat } from "./processor.js";

export type OutputRootState = "missing" | "directory" | "symlink" | "other";

export interface SafeOutputOptions {
  requireRoot?: boolean;
  verifiedDirectories?: Set<string>;
}

export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/").split(path.sep).join("/");
}

export function fromPosix(filePath: string): string {
  return filePath.split("/").join(path.sep);
}

export function outputPathFor(relativePath: string, format: OutputFormat, width?: number): string {
  const parsed = path.posix.parse(toPosix(relativePath));
  const widthSuffix = width === undefined ? "" : `.w${width.toString()}`;
  return path.posix.join(parsed.dir, `${parsed.name}${widthSuffix}.${format}`);
}

export function resolveOutputPath(
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

export function resolveOutputPaths(
  relativePath: string,
  format: OutputFormat,
  inputDir: string,
  outputDir: string,
  widths: readonly number[] | null | undefined
): string[] {
  if (!widths || widths.length === 0) {
    return [resolveOutputPath(relativePath, format, inputDir, outputDir)];
  }
  return widths.map((width) => resolveOutputPath(relativePath, format, inputDir, outputDir, width));
}

export function inspectOutputRoot(outputDir: string): OutputRootState {
  const logicalRoot = path.resolve(outputDir);
  try {
    const stat = fs.lstatSync(logicalRoot);
    if (stat.isSymbolicLink()) return "symlink";
    return stat.isDirectory() ? "directory" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export function assertSafeOutputParents(
  outputFullPath: string,
  outputDir: string,
  options: SafeOutputOptions = {}
): void {
  const logicalRoot = path.resolve(outputDir);
  const rootState = inspectOutputRoot(logicalRoot);
  if (rootState === "symlink") {
    throw new Error(`Refusing to write through a symlinked output root: ${logicalRoot}`);
  }
  if (rootState === "other") {
    throw new Error(`Refusing to use an output root that is not a directory: ${logicalRoot}`);
  }
  if (options.requireRoot && rootState === "missing") {
    throw new Error(`Output root does not exist: ${logicalRoot}`);
  }

  const relativeOutput = path.relative(logicalRoot, outputFullPath);
  if (relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) {
    throw new Error(`Refusing to write outside the configured output root: ${outputFullPath}`);
  }

  const verifiedDirectories = options.verifiedDirectories;
  if (rootState === "directory") verifiedDirectories?.add(logicalRoot);
  let cursor = logicalRoot;
  for (const segment of relativeOutput.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (verifiedDirectories?.has(cursor)) continue;
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to write through a symlinked output directory: ${cursor}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Refusing to write through a non-directory output path: ${cursor}`);
      }
      verifiedDirectories?.add(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      break;
    }
  }
}
