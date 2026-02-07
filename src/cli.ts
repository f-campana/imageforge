#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import {
  discoverImages,
  processImage,
  fileHash,
  outputPathFor,
  fromPosix,
  toPosix,
  ProcessOptions,
} from "./processor";

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8")
);

interface ManifestEntry {
  width: number;
  height: number;
  aspectRatio: number;
  blurDataURL: string;
  originalSize: number;
  outputs: Record<string, { path: string; size: number }>;
  hash: string;
}

interface Manifest {
  version: string;
  generated: string;
  images: Record<string, ManifestEntry>;
}

interface CacheEntry {
  hash: string;
  result: ManifestEntry;
}

interface ImageWorkItem {
  imagePath: string;
  relativePath: string;
  hash: string;
}

function loadCache(cachePath: string): Map<string, CacheEntry> {
  try {
    if (fs.existsSync(cachePath)) {
      const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      return new Map(Object.entries(raw));
    }
  } catch {
    // Corrupt cache — start fresh
  }
  return new Map();
}

function saveCache(cachePath: string, cache: Map<string, CacheEntry>) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify(Object.fromEntries(cache), null, 2)
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function cacheOutputsExist(entry: CacheEntry, inputDir: string): boolean {
  for (const output of Object.values(entry.result.outputs)) {
    const fullPath = path.resolve(inputDir, fromPosix(output.path));
    if (!fs.existsSync(fullPath)) return false;
  }
  return true;
}

function preflightCollisions(
  items: ImageWorkItem[],
  options: ProcessOptions,
  inputDir: string,
  cache: Map<string, CacheEntry>,
  useCache: boolean
) {
  const planned = new Map<string, string>();

  for (const item of items) {
    for (const format of options.formats) {
      const outputPath = outputPathFor(item.relativePath, format);
      const existingSource = planned.get(outputPath);

      if (existingSource && existingSource !== item.relativePath) {
        console.error(chalk.red("\nOutput collision detected:"));
        console.error(
          chalk.red(`  • ${existingSource} -> ${outputPath}`)
        );
        console.error(
          chalk.red(`  • ${item.relativePath} -> ${outputPath}`)
        );
        console.error(
          chalk.yellow("Fix: rename one source file. In v0.2.0, use --out-dir.")
        );
        process.exit(1);
      }

      planned.set(outputPath, item.relativePath);

      const fullOutputPath = path.resolve(inputDir, fromPosix(outputPath));
      if (!fs.existsSync(fullOutputPath)) continue;

      const cacheEntry = cache.get(item.relativePath);
      const attributableBySource =
        useCache &&
        !!cacheEntry &&
        cacheEntry.result.outputs[format]?.path === outputPath;

      if (!attributableBySource) {
        console.error(chalk.red("\nOutput path already exists and is not attributable to this source in cache:"));
        console.error(
          chalk.red(`  • ${item.relativePath} -> ${outputPath}`)
        );
        console.error(
          chalk.yellow("Fix: rename the source file, remove conflicting output, or use --out-dir in v0.2.0.")
        );
        process.exit(1);
      }
    }
  }
}

const program = new Command();

program
  .name("imageforge")
  .description("Image optimization pipeline for Next.js developers")
  .version(pkg.version)
  .argument("<directory>", "Directory containing images to process")
  .option("-o, --output <path>", "Manifest output path", "imageforge.json")
  .option(
    "-f, --formats <formats>",
    "Output formats (comma-separated: webp,avif)",
    "webp"
  )
  .option("-q, --quality <number>", "Output quality (1-100)", "80")
  .option("--no-blur", "Skip blur placeholder generation")
  .option("--blur-size <number>", "Blur placeholder dimensions", "4")
  .option("--no-cache", "Disable file hash caching")
  .option("--check", "Check mode: exit 1 if unprocessed images exist")
  .action(async (directory: string, opts: Record<string, unknown>) => {
    const inputDir = path.resolve(directory as string);
    const outputPath = path.resolve(opts.output as string);
    const qualityRaw = parseInt(opts.quality as string, 10);
    if (isNaN(qualityRaw) || qualityRaw < 1 || qualityRaw > 100) {
      console.error(
        chalk.red(`Invalid quality: "${opts.quality}". Must be a number between 1 and 100.`)
      );
      process.exit(1);
    }
    const quality = qualityRaw;
    const formatParts = (opts.formats as string)
      .split(",")
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean);
    const validFormats = new Set(["webp", "avif"]);
    const unknownFormats = formatParts.filter((f) => !validFormats.has(f));
    if (unknownFormats.length > 0) {
      console.error(
        chalk.yellow(`Unknown format(s) ignored: ${unknownFormats.join(", ")}. Valid: webp, avif`)
      );
    }
    const formats = formatParts.filter(
      (f): f is "webp" | "avif" => f === "webp" || f === "avif"
    );
    const blur = opts.blur !== false;
    const blurSize = parseInt(opts.blurSize as string, 10) || 4;
    const useCache = opts.cache !== false;
    const checkMode = opts.check === true;

    // Validate input
    if (!fs.existsSync(inputDir)) {
      console.error(chalk.red(`Directory not found: ${inputDir}`));
      process.exit(1);
    }

    if (formats.length === 0) {
      console.error(chalk.red("No valid formats specified. Use: webp, avif"));
      process.exit(1);
    }

    const options: ProcessOptions = { formats, quality, blur, blurSize };

    // Discover images
    const images = discoverImages(inputDir);
    if (images.length === 0) {
      console.log(chalk.yellow("No images found in " + inputDir));
      process.exit(0);
    }

    console.log(
      chalk.bold(`\nimageforge v${pkg.version}\n`)
    );
    console.log(
      `Processing ${chalk.cyan(images.length.toString())} images in ${chalk.dim(inputDir)}`
    );
    console.log(
      `Formats: ${formats.map((f) => chalk.cyan(f)).join(", ")}  Quality: ${chalk.cyan(quality.toString())}  Blur: ${blur ? chalk.green("yes") : chalk.dim("no")}\n`
    );

    // Load cache
    const cachePath = path.join(inputDir, ".imageforge-cache.json");
    const cache = loadCache(cachePath);
    const writableCache = useCache ? cache : new Map<string, CacheEntry>(cache);

    const items: ImageWorkItem[] = images.map((imagePath) => {
      const relativePath = toPosix(path.relative(inputDir, imagePath));
      return {
        imagePath,
        relativePath,
        hash: fileHash(imagePath, options),
      };
    });

    preflightCollisions(items, options, inputDir, cache, useCache);

    const manifest: Manifest = {
      version: "1.0",
      generated: new Date().toISOString(),
      images: {},
    };

    let processed = 0;
    let cached = 0;
    let failed = 0;
    let totalOriginal = 0;
    let totalProcessed = 0;
    const startTime = Date.now();

    for (const item of items) {
      const { imagePath, relativePath, hash } = item;

      // Check cache
      const cacheEntry = cache.get(relativePath);
      if (
        useCache &&
        cacheEntry &&
        cacheEntry.hash === hash &&
        cacheOutputsExist(cacheEntry, inputDir)
      ) {
        manifest.images[relativePath] = cacheEntry.result;
        cached++;
        totalOriginal += cacheEntry.result.originalSize;
        for (const out of Object.values(cacheEntry.result.outputs)) {
          totalProcessed += out.size;
        }
        console.log(`  ${chalk.dim("○")} ${chalk.dim(relativePath)} ${chalk.dim("(cached)")}`);
        continue;
      }

      // Check mode: if we get here, something needs processing
      if (checkMode) {
        console.log(`  ${chalk.red("✗")} ${relativePath} ${chalk.red("(needs processing)")}`);
        failed++;
        continue;
      }

      try {
        const result = await processImage(imagePath, inputDir, options);

        const entry: ManifestEntry = {
          width: result.width,
          height: result.height,
          aspectRatio: result.aspectRatio,
          blurDataURL: result.blurDataURL,
          originalSize: result.originalSize,
          outputs: result.outputs,
          hash,
        };

        manifest.images[relativePath] = entry;
        writableCache.set(relativePath, { hash, result: entry });
        processed++;
        totalOriginal += result.originalSize;

        const outputSummary = Object.entries(result.outputs)
          .map(([fmt, out]) => {
            totalProcessed += out.size;
            const saving = Math.round(
              (1 - out.size / result.originalSize) * 100
            );
            return `${fmt} (${formatSize(result.originalSize)} → ${formatSize(out.size)}, ${chalk.green(`-${saving}%`)})`;
          })
          .join(", ");

        console.log(`  ${chalk.green("✓")} ${relativePath} → ${outputSummary}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.log(`  ${chalk.red("✗")} ${relativePath} — ${chalk.red(msg)}`);
        failed++;
      }
    }

    // Check mode: exit with appropriate code
    if (checkMode) {
      if (failed > 0) {
        console.log(
          chalk.red(`\n${failed} image(s) need processing. Run: imageforge ${directory}`)
        );
        process.exit(1);
      } else {
        console.log(chalk.green("\nAll images up to date."));
        process.exit(0);
      }
    }

    // Save cache
    if (useCache) {
      saveCache(cachePath, writableCache);
    }

    // Write manifest
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalSaving =
      totalOriginal > 0
        ? Math.round((1 - totalProcessed / totalOriginal) * 100)
        : 0;

    console.log(chalk.dim("\n" + "─".repeat(50)));
    console.log(
      `\nDone in ${chalk.bold(duration + "s")}`
    );
    console.log(
      `  ${chalk.green(processed.toString())} processed, ${chalk.dim(cached.toString())} cached${failed > 0 ? `, ${chalk.red(failed.toString())} failed` : ""}`
    );
    if (totalOriginal > 0) {
      console.log(
        `  Total: ${formatSize(totalOriginal)} → ${formatSize(totalProcessed)} (${chalk.green(`-${totalSaving}%`)})`
      );
    }
    console.log(`  Manifest: ${chalk.cyan(path.relative(process.cwd(), outputPath))}\n`);
  });

program.parse();
