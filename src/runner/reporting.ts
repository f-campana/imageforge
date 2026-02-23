import * as os from "os";
import * as path from "path";
import type { ImageResult, OutputFormat } from "../processor.js";
import { toPosix } from "../processor.js";
import type { ImageForgeEntry } from "../types.js";
import { collectEntryOutputs } from "./cache.js";

export interface RerunCommandOptions {
  commandName: string;
  directoryArg: string;
  outputPath: string;
  formats: OutputFormat[];
  quality: number;
  blur: boolean;
  blurSize: number;
  widths: number[] | null;
  useCache: boolean;
  forceOverwrite: boolean;
  outDir: string | null;
  dryRun: boolean;
  includePatterns: string[];
  excludePatterns: string[];
  concurrency: number;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_.,/:-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function displayPath(targetPath: string): string {
  const relative = path.relative(process.cwd(), targetPath);
  if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return toPosix(relative);
  }
  return toPosix(targetPath);
}

export function buildRerunCommand(options: RerunCommandOptions, outputDir: string): string {
  const command: string[] = [
    options.commandName,
    options.directoryArg,
    "--output",
    displayPath(options.outputPath),
    "--formats",
    options.formats.join(","),
    "--quality",
    options.quality.toString(),
    "--blur-size",
    options.blurSize.toString(),
    "--concurrency",
    options.concurrency.toString(),
  ];

  if (!options.blur) command.push("--no-blur");
  if (options.widths && options.widths.length > 0) {
    command.push("--widths", options.widths.join(","));
  }
  if (!options.useCache) command.push("--no-cache");
  if (options.forceOverwrite) command.push("--force-overwrite");
  if (options.includePatterns.length > 0) {
    for (const pattern of options.includePatterns) {
      command.push("--include", pattern);
    }
  }
  if (options.excludePatterns.length > 0) {
    for (const pattern of options.excludePatterns) {
      command.push("--exclude", pattern);
    }
  }
  if (options.outDir) {
    command.push("--out-dir", displayPath(outputDir));
  }
  if (options.dryRun) command.push("--dry-run");

  return command.map(shellQuote).join(" ");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function totalProcessedSizeForEntry(entry: ImageForgeEntry): number {
  return collectEntryOutputs(entry).reduce((sum, output) => sum + output.size, 0);
}

export function totalProcessedSizeForResult(result: ImageResult): number {
  const outputs = new Map<string, number>();
  for (const output of Object.values(result.outputs)) {
    outputs.set(output.path, output.size);
  }
  for (const variants of Object.values(result.variants ?? {})) {
    for (const variant of variants) {
      outputs.set(variant.path, variant.size);
    }
  }
  return [...outputs.values()].reduce((sum, size) => sum + size, 0);
}

export function getDefaultConcurrency(): number {
  const available =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(8, available));
}
