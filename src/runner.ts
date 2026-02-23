import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import pLimit from "p-limit";
import { compileGlobPatterns, matchesAnyGlob } from "./glob.js";
import { discoverImages, fileHash, processImage, toPosix } from "./processor.js";
import type { DiscoveryWarning, ImageResult, OutputFormat, ProcessOptions } from "./processor.js";
import {
  CACHE_FILE,
  acquireCacheLock,
  cacheOutputsExist,
  loadCache,
  releaseCacheLock,
  saveCacheAtomic,
  startCacheLockHeartbeat,
} from "./runner/cache.js";
import type { CacheEntry } from "./runner/cache.js";
import { preflightCollisions, sanitizeForTerminal } from "./runner/preflight.js";
import {
  buildRerunCommand,
  formatSize,
  getDefaultConcurrency as getDefaultConcurrencyFromReporting,
  totalProcessedSizeForEntry,
  totalProcessedSizeForResult,
} from "./runner/reporting.js";
import type { ImageForgeEntry, ImageForgeManifest, ImageForgeVariant } from "./types.js";

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
  dryRun: boolean;
  includePatterns: string[];
  excludePatterns: string[];
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
    dryRun: boolean;
    include: string[];
    exclude: string[];
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

export function getDefaultConcurrency(): number {
  return getDefaultConcurrencyFromReporting();
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
      dryRun: options.dryRun,
      include: options.includePatterns,
      exclude: options.excludePatterns,
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
    const discoveredImages = discoverImages(inputDir, (warning) => {
      discoveryWarnings.push(warning);
    });
    const includeMatchers = compileGlobPatterns(options.includePatterns);
    const excludeMatchers = compileGlobPatterns(options.excludePatterns);
    const images = discoveredImages.filter((imagePath) => {
      const relativePath = toPosix(path.relative(inputDir, imagePath));
      const included =
        includeMatchers.length === 0 || matchesAnyGlob(relativePath, includeMatchers);
      if (!included) return false;
      const excluded = excludeMatchers.length > 0 && matchesAnyGlob(relativePath, excludeMatchers);
      return !excluded;
    });
    const filteredOutCount = discoveredImages.length - images.length;
    report.summary.total = images.length;

    for (const warning of discoveryWarnings) {
      const warningMessage = `Skipping "${sanitizeForTerminal(warning.path)}" during discovery: ${sanitizeForTerminal(warning.message)}`;
      addError(report, "DISCOVERY_WARNING", warningMessage, warning.path);
      printError(chalk.yellow(`Warning: ${warningMessage}`));
    }

    if (images.length === 0) {
      const message =
        filteredOutCount > 0
          ? `No images matched include/exclude patterns in ${sanitizeForTerminal(inputDir)}`
          : `No images found in ${sanitizeForTerminal(inputDir)}`;
      printInfo(chalk.yellow(message));
      report.summary.durationMs = Date.now() - startTime;
      return { exitCode: 0, report, manifest: null };
    }

    if (!options.json) {
      printInfo(chalk.bold(`\nimageforge v${options.version}\n`));
      printInfo(
        `Processing ${chalk.cyan(images.length.toString())} images in ${chalk.dim(sanitizeForTerminal(inputDir))}`
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
        `Output root: ${chalk.dim(sanitizeForTerminal(outputDir))}  Cache: ${options.useCache ? chalk.green("enabled") : chalk.dim("disabled")}`
      );
      if (options.includePatterns.length > 0) {
        printInfo(
          `Include: ${options.includePatterns.map((pattern) => chalk.cyan(pattern)).join(", ")}`
        );
      }
      if (options.excludePatterns.length > 0) {
        printInfo(
          `Exclude: ${options.excludePatterns.map((pattern) => chalk.cyan(pattern)).join(", ")}`
        );
      }
      if (options.dryRun) {
        printInfo(chalk.yellow("Dry run: no outputs, manifest, or cache writes will occur."));
      }
      printInfo(`Concurrency: ${chalk.cyan(options.concurrency.toString())}\n`);
    }

    if (options.verbose && !options.json) {
      printInfo(chalk.dim(`Cache file: ${sanitizeForTerminal(cachePath)}`));
      printInfo(chalk.dim(`Manifest output: ${sanitizeForTerminal(outputPath)}`));
      printInfo(chalk.dim(`Check mode: ${options.checkMode ? "yes" : "no"}`));
      printInfo(chalk.dim(`Discovered images: ${discoveredImages.length.toString()}`));
      if (filteredOutCount > 0) {
        printInfo(chalk.dim(`Filtered out by include/exclude: ${filteredOutCount.toString()}`));
      }
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
      const sourceKeys = new Set(
        discoveredImages.map((imagePath) => toPosix(path.relative(inputDir, imagePath)))
      );
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
      const safeRelativePath = sanitizeForTerminal(outcome.item.relativePath);
      if (outcome.kind === "cached") {
        if (!options.quiet) {
          printPerFile(
            `  ${chalk.dim(progress)} ${chalk.dim("○")} ${chalk.dim(safeRelativePath)} ${chalk.dim("(cached)")}`
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
            `  ${chalk.dim(progress)} ${chalk.red("✗")} ${safeRelativePath} ${chalk.red("(needs processing)")}`
          );
        }
        return;
      }

      if (outcome.kind === "failed") {
        const safeMessage = sanitizeForTerminal(outcome.message);
        printPerFile(
          `  ${chalk.dim(progress)} ${chalk.red("✗")} ${safeRelativePath} — ${chalk.red(safeMessage)}`,
          true
        );
        return;
      }

      if (!options.quiet) {
        const outputSummary = formatOutputSummary(outcome.result);
        printPerFile(
          `  ${chalk.dim(progress)} ${chalk.green("✓")} ${safeRelativePath} → ${outputSummary}`
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

      if (options.dryRun) {
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

    if (options.dryRun) {
      report.rerunCommand = buildRerunCommand(
        {
          ...options,
          outputPath,
          outDir: options.outDir ? outputDir : null,
          dryRun: false,
        },
        outputDir
      );

      if (!options.json) {
        printInfo(
          chalk.yellow(
            `\nDry run complete: ${report.summary.needsProcessing.toString()} image(s) would be processed.`
          )
        );
        if (report.rerunCommand) {
          printInfo(chalk.dim(`Run without --dry-run to apply: ${report.rerunCommand}`));
        }
      }

      return {
        exitCode: report.summary.failed > 0 ? 1 : 0,
        report,
        manifest: null,
      };
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
