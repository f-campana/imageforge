import chalk from "chalk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import pLimit from "p-limit";
import sharp from "sharp";
import {
  discoverImages,
  fileHash,
  fromPosix,
  outputPathFor,
  processImage,
  toPosix,
} from "./processor.js";
import type { DiscoveryWarning, ImageResult, OutputFormat, ProcessOptions } from "./processor.js";
import { resolveEffectiveWidths, resolveOrientedDimensions } from "./responsive.js";
import type { ImageForgeEntry, ImageForgeManifest, ImageForgeVariant } from "./types.js";

interface CacheEntry {
  hash: string;
  result: ImageForgeEntry;
}

interface ImageWorkItem {
  imagePath: string;
  relativePath: string;
  hash: string;
}

interface RunnerError {
  code: string;
  message: string;
  file?: string;
}

type WorkOutcome =
  | {
      kind: "cached";
      item: ImageWorkItem;
      entry: ImageForgeEntry;
    }
  | {
      kind: "processed";
      item: ImageWorkItem;
      entry: ImageForgeEntry;
      result: ImageResult;
    }
  | {
      kind: "failed";
      item: ImageWorkItem;
      message: string;
    }
  | {
      kind: "needs-processing";
      item: ImageWorkItem;
    };

export interface RunOptions {
  version: string;
  inputDir: string;
  outputPath: string;
  directoryArg: string;
  commandName: string;
  formats: OutputFormat[];
  quality: number;
  blur: boolean;
  blurSize: number;
  widths: number[] | null;
  useCache: boolean;
  forceOverwrite: boolean;
  checkMode: boolean;
  outDir: string | null;
  concurrency: number;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
}

export interface RunImageReport {
  file: string;
  hash: string;
  status: "processed" | "cached" | "failed" | "needs-processing";
  message?: string;
  outputs?: Record<string, { path: string; size: number }>;
  variants?: Record<string, ImageForgeVariant[]>;
}

export interface RunSummary {
  total: number;
  processed: number;
  cached: number;
  failed: number;
  needsProcessing: number;
  totalOriginalSize: number;
  totalProcessedSize: number;
  durationMs: number;
}

export interface RunReport {
  version: string;
  checkMode: boolean;
  inputDir: string;
  outputDir: string;
  outputPath: string;
  cachePath: string;
  options: {
    formats: OutputFormat[];
    quality: number;
    blur: boolean;
    blurSize: number;
    widths: number[] | null;
    cache: boolean;
    forceOverwrite: boolean;
    concurrency: number;
    json: boolean;
    verbose: boolean;
    quiet: boolean;
  };
  summary: RunSummary;
  rerunCommand: string | null;
  images: RunImageReport[];
  errors: RunnerError[];
}

export interface RunResult {
  exitCode: number;
  report: RunReport;
  manifest: ImageForgeManifest | null;
}

interface PreflightIssue {
  message: string;
  details: string[];
}

const CACHE_FILE = ".imageforge-cache.json";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_LOCK_STALE_MS = 120_000;
const DEFAULT_CACHE_LOCK_HEARTBEAT_MS = 5_000;
const CACHE_LOCK_INITIAL_POLL_MS = 25;
const CACHE_LOCK_MAX_POLL_MS = 500;
const CACHE_LOCK_BACKOFF_FACTOR = 1.5;
const LIMIT_INPUT_PIXELS = 100_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutputRecord(value: unknown): value is { path: string; size: number } {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size)
  );
}

function isVariantRecord(value: unknown): value is ImageForgeVariant {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    typeof value.path === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size)
  );
}

function collectEntryOutputs(entry: ImageForgeEntry): { path: string; size: number }[] {
  const outputs = new Map<string, { path: string; size: number }>();
  for (const output of Object.values(entry.outputs)) {
    outputs.set(output.path, output);
  }
  for (const variants of Object.values(entry.variants ?? {})) {
    for (const variant of variants) {
      outputs.set(variant.path, {
        path: variant.path,
        size: variant.size,
      });
    }
  }
  return [...outputs.values()];
}

function isManifestEntry(value: unknown): value is ImageForgeEntry {
  if (!isRecord(value)) return false;
  if (typeof value.width !== "number" || !Number.isFinite(value.width)) return false;
  if (typeof value.height !== "number" || !Number.isFinite(value.height)) return false;
  if (typeof value.aspectRatio !== "number" || !Number.isFinite(value.aspectRatio)) return false;
  if (typeof value.blurDataURL !== "string") return false;
  if (typeof value.originalSize !== "number" || !Number.isFinite(value.originalSize)) return false;
  if (typeof value.hash !== "string") return false;
  if (!isRecord(value.outputs)) return false;
  for (const output of Object.values(value.outputs)) {
    if (!isOutputRecord(output)) return false;
  }
  if ("variants" in value && value.variants !== undefined) {
    if (!isRecord(value.variants)) return false;
    for (const variants of Object.values(value.variants)) {
      if (!Array.isArray(variants)) return false;
      for (const variant of variants) {
        if (!isVariantRecord(variant)) return false;
      }
    }
  }
  return true;
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return isRecord(value) && typeof value.hash === "string" && isManifestEntry(value.result);
}

function parseDurationFromEnv(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readLockOwnerPid(lockPath: string): number | null {
  try {
    const lockContents = fs.readFileSync(lockPath, "utf-8");
    const firstLine = lockContents.split(/\r?\n/u, 1)[0]?.trim();
    if (!firstLine) return null;
    if (!/^\d+$/u.test(firstLine)) return null;
    const pid = Number.parseInt(firstLine, 10);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function acquireCacheLock(lockPath: string): Promise<number> {
  const timeoutMs = parseDurationFromEnv(
    "IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS",
    DEFAULT_CACHE_LOCK_TIMEOUT_MS
  );
  const staleMs = parseDurationFromEnv(
    "IMAGEFORGE_CACHE_LOCK_STALE_MS",
    DEFAULT_CACHE_LOCK_STALE_MS
  );
  const startedAt = Date.now();
  let pollMs = CACHE_LOCK_INITIAL_POLL_MS;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid.toString()}\n${new Date().toISOString()}\n`);
      return fd;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          const ownerPid = readLockOwnerPid(lockPath);
          if (ownerPid !== null && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
            // The lock owner is still alive; keep waiting instead of stealing the lock.
          } else {
            try {
              fs.rmSync(lockPath);
            } catch (removeErr) {
              const removeCode = (removeErr as NodeJS.ErrnoException).code;
              if (removeCode !== "ENOENT") {
                throw removeErr;
              }
            }
            continue;
          }
        }
      } catch (statErr) {
        const statCode = (statErr as NodeJS.ErrnoException).code;
        if (statCode === "ENOENT") {
          // Lock disappeared between attempts, retry immediately.
          continue;
        }
        throw statErr;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for cache lock: ${lockPath}`);
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      const delayMs = Math.max(1, Math.min(pollMs, remainingMs));
      await sleep(delayMs);
      pollMs = Math.min(CACHE_LOCK_MAX_POLL_MS, Math.ceil(pollMs * CACHE_LOCK_BACKOFF_FACTOR));
    }
  }
}

function startCacheLockHeartbeat(lockFd: number, lockPath: string): NodeJS.Timeout {
  const heartbeatMs = Math.max(
    250,
    parseDurationFromEnv("IMAGEFORGE_CACHE_LOCK_HEARTBEAT_MS", DEFAULT_CACHE_LOCK_HEARTBEAT_MS)
  );
  const timer = setInterval(() => {
    const now = new Date();
    try {
      fs.futimesSync(lockFd, now, now);
      return;
    } catch {
      // Fallback for filesystems that do not support futimes on this descriptor.
    }

    try {
      fs.utimesSync(lockPath, now, now);
    } catch {
      // Best-effort heartbeat.
    }
  }, heartbeatMs);
  timer.unref();
  return timer;
}

function releaseCacheLock(lockFd: number, lockPath: string, heartbeatTimer: NodeJS.Timeout | null) {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  try {
    fs.closeSync(lockFd);
  } catch {
    // Best-effort close.
  }
  fs.rmSync(lockPath, { force: true });
}

function loadCache(cachePath: string): Map<string, CacheEntry> {
  try {
    if (!fs.existsSync(cachePath)) return new Map();
    const content = fs.readFileSync(cachePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) return new Map();

    let entriesRecord: Record<string, unknown>;
    if ("entries" in parsed) {
      if ("version" in parsed) {
        if (typeof parsed.version !== "number" || !Number.isInteger(parsed.version)) {
          return new Map();
        }
      }
      if (!isRecord(parsed.entries)) return new Map();
      entriesRecord = parsed.entries;
    } else {
      // Legacy cache shape from v0.1.0.
      entriesRecord = parsed;
    }

    const entries: [string, CacheEntry][] = [];
    for (const [key, value] of Object.entries(entriesRecord)) {
      if (!isCacheEntry(value)) {
        return new Map();
      }
      entries.push([key, value]);
    }
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveCacheAtomic(cachePath: string, cache: Map<string, CacheEntry>) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const randomSuffix = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  const tempPath = `${cachePath}.${process.pid.toString()}.${randomSuffix}.tmp`;
  fs.writeFileSync(
    tempPath,
    JSON.stringify(
      {
        version: CACHE_SCHEMA_VERSION,
        entries: Object.fromEntries(cache),
      },
      null,
      2
    )
  );

  try {
    fs.renameSync(tempPath, cachePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function totalProcessedSizeForEntry(entry: ImageForgeEntry): number {
  return collectEntryOutputs(entry).reduce((sum, output) => sum + output.size, 0);
}

function totalProcessedSizeForResult(result: ImageResult): number {
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

function cacheOutputsExist(entry: CacheEntry, inputDir: string): boolean {
  for (const output of collectEntryOutputs(entry.result)) {
    const fullPath = path.resolve(inputDir, fromPosix(output.path));
    if (!fs.existsSync(fullPath)) return false;
  }
  return true;
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
) {
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

async function preflightCollisions(
  items: ImageWorkItem[],
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
            `  • ${item.relativePath}`,
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
              `  • ${existingSource.source} -> ${existingSource.outputPath}`,
              `  • ${item.relativePath} -> ${outputPath}`,
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
              `  • ${item.relativePath} -> ${outputPath}`,
              "Fix: remove existing outputs or rerun with --force-overwrite.",
            ],
          };
        }

        const owner = cacheOwners.get(outputKey);
        if (!owner) {
          return {
            message: "Output path already exists and is not cache-owned:",
            details: [
              `  • ${item.relativePath} -> ${outputPath}`,
              "Fix: remove or rename the existing output, or use --out-dir.",
            ],
          };
        }

        if (owner.source !== item.relativePath) {
          return {
            message: "Output path already exists and is owned by a different cached source:",
            details: [
              `  • ${owner.source} -> ${owner.outputPath}`,
              `  • ${item.relativePath} -> ${outputPath}`,
              "Fix: rename the source file, remove conflicting output, or use --out-dir.",
            ],
          };
        }
      }
    }
  }

  return null;
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

function buildRerunCommand(options: RunOptions, outputDir: string): string {
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
  if (options.outDir) {
    command.push("--out-dir", displayPath(outputDir));
  }

  return command.map(shellQuote).join(" ");
}

function defaultParallelism(): number {
  const available =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(8, available));
}

export function getDefaultConcurrency(): number {
  return defaultParallelism();
}

function createInitialReport(options: RunOptions, outputDir: string, cachePath: string): RunReport {
  return {
    version: "1.0",
    checkMode: options.checkMode,
    inputDir: options.inputDir,
    outputDir,
    outputPath: options.outputPath,
    cachePath,
    options: {
      formats: options.formats,
      quality: options.quality,
      blur: options.blur,
      blurSize: options.blurSize,
      widths: options.widths,
      cache: options.useCache,
      forceOverwrite: options.forceOverwrite,
      concurrency: options.concurrency,
      json: options.json,
      verbose: options.verbose,
      quiet: options.quiet,
    },
    summary: {
      total: 0,
      processed: 0,
      cached: 0,
      failed: 0,
      needsProcessing: 0,
      totalOriginalSize: 0,
      totalProcessedSize: 0,
      durationMs: 0,
    },
    rerunCommand: null,
    images: [],
    errors: [],
  };
}

function addError(report: RunReport, code: string, message: string, file?: string) {
  report.errors.push({ code, message, file });
}

export async function runImageforge(options: RunOptions): Promise<RunResult> {
  const startTime = Date.now();
  const inputDir = path.resolve(options.inputDir);
  const outputDir = options.outDir ? path.resolve(options.outDir) : inputDir;
  const outputPath = path.resolve(options.outputPath);
  const cachePath = path.join(outputDir, CACHE_FILE);
  const report = createInitialReport(
    {
      ...options,
      inputDir,
      outputPath,
      outDir: options.outDir ? outputDir : null,
    },
    outputDir,
    cachePath
  );

  const printInfo = (message: string) => {
    if (!options.json) {
      console.log(message);
    }
  };

  const printError = (message: string) => {
    if (!options.json) {
      console.error(message);
    }
  };

  const printPerFile = (message: string, isError = false) => {
    if (options.json) return;
    if (options.quiet && !isError) return;
    if (isError) {
      console.error(message);
      return;
    }
    console.log(message);
  };

  if (!fs.existsSync(inputDir)) {
    const message = `Directory not found: ${inputDir}`;
    addError(report, "INPUT_NOT_FOUND", message);
    printError(chalk.red(message));
    report.summary.durationMs = Date.now() - startTime;
    return { exitCode: 1, report, manifest: null };
  }

  const processOptions: ProcessOptions = {
    formats: options.formats,
    quality: options.quality,
    blur: options.blur,
    blurSize: options.blurSize,
    widths: options.widths ?? undefined,
  };

  const cacheLockPath = `${cachePath}.lock`;
  let cacheLockFd: number | null = null;
  let cacheLockHeartbeat: NodeJS.Timeout | null = null;

  try {
    if (options.useCache) {
      try {
        cacheLockFd = await acquireCacheLock(cacheLockPath);
        cacheLockHeartbeat = startCacheLockHeartbeat(cacheLockFd, cacheLockPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to acquire cache lock.";
        addError(report, "CACHE_LOCK_FAILED", message);
        printError(chalk.red(message));
        report.summary.durationMs = Date.now() - startTime;
        return { exitCode: 1, report, manifest: null };
      }
    }

    const discoveryWarnings: DiscoveryWarning[] = [];
    const images = discoverImages(inputDir, (warning) => {
      discoveryWarnings.push(warning);
    });
    report.summary.total = images.length;

    for (const warning of discoveryWarnings) {
      const warningMessage = `Skipping "${warning.path}" during discovery: ${warning.message}`;
      addError(report, "DISCOVERY_WARNING", warningMessage, warning.path);
      printError(chalk.yellow(`Warning: ${warningMessage}`));
    }

    if (images.length === 0) {
      printInfo(chalk.yellow(`No images found in ${inputDir}`));
      report.summary.durationMs = Date.now() - startTime;
      return { exitCode: 0, report, manifest: null };
    }

    if (!options.json) {
      printInfo(chalk.bold(`\nimageforge v${options.version}\n`));
      printInfo(
        `Processing ${chalk.cyan(images.length.toString())} images in ${chalk.dim(inputDir)}`
      );
      printInfo(
        `Formats: ${options.formats.map((f) => chalk.cyan(f)).join(", ")}  Quality: ${chalk.cyan(options.quality.toString())}  Blur: ${options.blur ? chalk.green("yes") : chalk.dim("no")}`
      );
      if (options.widths && options.widths.length > 0) {
        printInfo(
          `Requested widths: ${options.widths.map((width) => chalk.cyan(width.toString())).join(", ")}`
        );
        printInfo(
          chalk.dim("Generated widths are effective values and never upscale source images.")
        );
      }
      printInfo(
        `Output root: ${chalk.dim(outputDir)}  Cache: ${options.useCache ? chalk.green("enabled") : chalk.dim("disabled")}`
      );
      printInfo(`Concurrency: ${chalk.cyan(options.concurrency.toString())}\n`);
    }

    if (options.verbose && !options.json) {
      printInfo(chalk.dim(`Cache file: ${cachePath}`));
      printInfo(chalk.dim(`Manifest output: ${outputPath}`));
      printInfo(chalk.dim(`Check mode: ${options.checkMode ? "yes" : "no"}`));
    }

    const cache = options.useCache ? loadCache(cachePath) : new Map<string, CacheEntry>();
    const writableCache = cache;

    const items = images.map((imagePath) => {
      const relativePath = toPosix(path.relative(inputDir, imagePath));
      return {
        imagePath,
        relativePath,
        hash: fileHash(imagePath, processOptions),
      };
    });

    if (options.useCache) {
      const sourceKeys = new Set(items.map((item) => item.relativePath));
      let prunedEntries = 0;
      for (const key of writableCache.keys()) {
        if (!sourceKeys.has(key)) {
          writableCache.delete(key);
          prunedEntries += 1;
        }
      }
      if (prunedEntries > 0 && options.verbose && !options.json) {
        printInfo(
          chalk.dim(
            `Pruned ${prunedEntries.toString()} stale cache entr${prunedEntries === 1 ? "y" : "ies"}.`
          )
        );
      }
    }

    const collisionIssue = await preflightCollisions(
      items,
      processOptions,
      inputDir,
      outputDir,
      cache,
      options.useCache,
      options.forceOverwrite
    );

    if (collisionIssue) {
      addError(report, "PREFLIGHT_COLLISION", collisionIssue.message);
      printError(chalk.red(`\n${collisionIssue.message}`));
      for (const line of collisionIssue.details) {
        printError(chalk.red(line));
      }
      report.summary.durationMs = Date.now() - startTime;
      return { exitCode: 1, report, manifest: null };
    }

    const manifest: ImageForgeManifest = {
      version: "1.0",
      generated: new Date().toISOString(),
      images: {},
    };

    function formatOutputSummary(result: ImageResult): string {
      return Object.entries(result.outputs)
        .map(([fmt, output]) => {
          const variants = result.variants?.[fmt];
          if (variants && variants.length > 0) {
            const smallest = variants[0];
            const largest = variants[variants.length - 1];
            const totalSize = variants.reduce((sum, variant) => sum + variant.size, 0);
            return `${fmt} (${variants.length.toString()} variants: ${smallest.width.toString()}w-${largest.width.toString()}w, total ${formatSize(totalSize)})`;
          }

          const saving = Math.round((1 - output.size / result.originalSize) * 100);
          const savingLabel =
            saving >= 0
              ? chalk.green(`-${saving.toString()}%`)
              : chalk.yellow(`+${Math.abs(saving).toString()}%`);
          return `${fmt} (${formatSize(result.originalSize)} → ${formatSize(output.size)}, ${savingLabel})`;
        })
        .join(", ");
    }

    function logOutcome(progress: string, outcome: WorkOutcome) {
      if (outcome.kind === "cached") {
        if (!options.quiet) {
          printPerFile(
            `  ${chalk.dim(progress)} ${chalk.dim("○")} ${chalk.dim(outcome.item.relativePath)} ${chalk.dim("(cached)")}`
          );
        }
        if (options.verbose && !options.json) {
          printInfo(chalk.dim(`    hash=${outcome.item.hash}`));
        }
        return;
      }

      if (outcome.kind === "needs-processing") {
        if (!options.quiet) {
          printPerFile(
            `  ${chalk.dim(progress)} ${chalk.red("✗")} ${outcome.item.relativePath} ${chalk.red("(needs processing)")}`
          );
        }
        return;
      }

      if (outcome.kind === "failed") {
        printPerFile(
          `  ${chalk.dim(progress)} ${chalk.red("✗")} ${outcome.item.relativePath} — ${chalk.red(outcome.message)}`,
          true
        );
        return;
      }

      if (!options.quiet) {
        const outputSummary = formatOutputSummary(outcome.result);
        printPerFile(
          `  ${chalk.dim(progress)} ${chalk.green("✓")} ${outcome.item.relativePath} → ${outputSummary}`
        );
      }
      if (options.verbose && !options.json) {
        printInfo(chalk.dim(`    hash=${outcome.item.hash}`));
      }
    }

    async function processWorkItem(item: ImageWorkItem): Promise<WorkOutcome> {
      const cacheEntry = cache.get(item.relativePath);
      if (
        options.useCache &&
        cacheEntry?.hash === item.hash &&
        cacheOutputsExist(cacheEntry, inputDir)
      ) {
        return {
          kind: "cached",
          item,
          entry: cacheEntry.result,
        };
      }

      if (options.checkMode) {
        return {
          kind: "needs-processing",
          item,
        };
      }

      try {
        const result = await processImage(item.imagePath, inputDir, processOptions, outputDir);
        const entry: ImageForgeEntry = {
          width: result.width,
          height: result.height,
          aspectRatio: result.aspectRatio,
          blurDataURL: result.blurDataURL,
          originalSize: result.originalSize,
          outputs: result.outputs,
          variants: result.variants,
          hash: item.hash,
        };
        return {
          kind: "processed",
          item,
          result,
          entry,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return {
          kind: "failed",
          item,
          message,
        };
      }
    }

    const limiter = pLimit(Math.max(1, options.concurrency));
    const outcomes = new Array<WorkOutcome | undefined>(items.length);
    let completed = 0;
    await Promise.all(
      items.map((item, index) =>
        limiter(async () => {
          const outcome = await processWorkItem(item);
          outcomes[index] = outcome;
          completed += 1;
          const progress = `[${completed.toString()}/${items.length.toString()}]`;
          logOutcome(progress, outcome);
        })
      )
    );

    for (const outcome of outcomes) {
      if (!outcome) {
        continue;
      }

      if (outcome.kind === "cached") {
        manifest.images[outcome.item.relativePath] = outcome.entry;
        report.summary.cached += 1;
        report.summary.totalOriginalSize += outcome.entry.originalSize;
        report.summary.totalProcessedSize += totalProcessedSizeForEntry(outcome.entry);
        report.images.push({
          file: outcome.item.relativePath,
          hash: outcome.item.hash,
          status: "cached",
          outputs: outcome.entry.outputs,
          variants: outcome.entry.variants,
        });
        continue;
      }

      if (outcome.kind === "needs-processing") {
        report.summary.needsProcessing += 1;
        report.images.push({
          file: outcome.item.relativePath,
          hash: outcome.item.hash,
          status: "needs-processing",
        });
        continue;
      }

      if (outcome.kind === "failed") {
        report.summary.failed += 1;
        addError(report, "PROCESS_IMAGE_FAILED", outcome.message, outcome.item.relativePath);
        report.images.push({
          file: outcome.item.relativePath,
          hash: outcome.item.hash,
          status: "failed",
          message: outcome.message,
        });
        continue;
      }

      manifest.images[outcome.item.relativePath] = outcome.entry;
      writableCache.set(outcome.item.relativePath, {
        hash: outcome.item.hash,
        result: outcome.entry,
      });
      report.summary.processed += 1;
      report.summary.totalOriginalSize += outcome.result.originalSize;
      report.summary.totalProcessedSize += totalProcessedSizeForResult(outcome.result);

      report.images.push({
        file: outcome.item.relativePath,
        hash: outcome.item.hash,
        status: "processed",
        outputs: outcome.entry.outputs,
        variants: outcome.entry.variants,
      });
    }

    report.summary.durationMs = Date.now() - startTime;

    if (options.checkMode) {
      report.rerunCommand = buildRerunCommand(
        {
          ...options,
          inputDir,
          outputPath,
          outDir: options.outDir ? outputDir : null,
        },
        outputDir
      );

      if (report.summary.needsProcessing > 0) {
        printInfo(
          chalk.red(
            `\n${report.summary.needsProcessing.toString()} image(s) need processing. Run: ${report.rerunCommand}`
          )
        );
        return { exitCode: 1, report, manifest: null };
      }

      printInfo(chalk.green("\nAll images up to date."));
      return { exitCode: 0, report, manifest: null };
    }

    if (options.useCache) {
      saveCacheAtomic(cachePath, writableCache);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

    if (!options.json) {
      const duration = (report.summary.durationMs / 1000).toFixed(1);
      const totalSaving =
        report.summary.totalOriginalSize > 0
          ? Math.round(
              (1 - report.summary.totalProcessedSize / report.summary.totalOriginalSize) * 100
            )
          : 0;
      const totalSavingLabel =
        totalSaving >= 0
          ? chalk.green(`-${totalSaving.toString()}%`)
          : chalk.yellow(`+${Math.abs(totalSaving).toString()}%`);

      printInfo(chalk.dim("\n" + "─".repeat(50)));
      printInfo(`\nDone in ${chalk.bold(`${duration}s`)}`);
      printInfo(
        `  ${chalk.green(report.summary.processed.toString())} processed, ${chalk.dim(report.summary.cached.toString())} cached${report.summary.failed > 0 ? `, ${chalk.red(report.summary.failed.toString())} failed` : ""}`
      );
      if (report.summary.totalOriginalSize > 0) {
        printInfo(
          `  Total: ${formatSize(report.summary.totalOriginalSize)} → ${formatSize(report.summary.totalProcessedSize)} (${totalSavingLabel})`
        );
      }
      printInfo(`  Manifest: ${chalk.cyan(path.relative(process.cwd(), outputPath))}\n`);
    }

    return {
      exitCode: report.summary.failed > 0 ? 1 : 0,
      report,
      manifest,
    };
  } finally {
    if (cacheLockFd !== null) {
      releaseCacheLock(cacheLockFd, cacheLockPath, cacheLockHeartbeat);
    }
  }
}
