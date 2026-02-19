#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, type ImageForgeConfig } from "./config.js";
import type { OutputFormat } from "./processor.js";
import { MAX_WIDTH, MAX_WIDTH_COUNT, MIN_WIDTH } from "./responsive.js";
import { getDefaultConcurrency, runImageforge } from "./runner.js";

interface CliOptions {
  output?: string;
  formats?: string;
  quality?: string;
  blur?: boolean;
  blurSize?: string;
  widths?: string;
  cache?: boolean;
  forceOverwrite?: boolean;
  check?: boolean;
  outDir?: string;
  concurrency?: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  config?: string;
}

interface ResolvedOptions {
  output: string;
  formatsInput: string[];
  quality: number;
  blur: boolean;
  blurSize: number;
  widths: number[] | null;
  cache: boolean;
  forceOverwrite: boolean;
  check: boolean;
  outDir: string | null;
  concurrency: number;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageVersion(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.join(moduleDir, "../package.json");
  try {
    const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed: unknown = JSON.parse(packageJsonContent);
    if (isRecord(parsed) && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch {
    // Fall back to a safe default if package metadata cannot be loaded.
  }
  return "0.0.0";
}

function parseNumberOption(label: string, rawValue: unknown): number {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    throw new Error(`Invalid ${label}: expected a finite number.`);
  }
  if (!Number.isInteger(rawValue)) {
    throw new Error(`Invalid ${label}: must be an integer.`);
  }
  return rawValue;
}

function parseIntegerFromString(label: string, rawValue: string): number {
  const normalized = rawValue.trim();
  if (!/^[+-]?\d+$/u.test(normalized)) {
    throw new Error(`Invalid ${label}: "${rawValue}" is not a valid integer.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${label}: "${rawValue}" is outside supported integer range.`);
  }
  return parsed;
}

function parseFormatsInput(value: string | string[]): string[] {
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeWidths(widths: number[]): number[] {
  if (widths.length === 0) {
    throw new Error("Invalid requested widths: must include at least one width.");
  }

  const uniqueSorted = Array.from(new Set(widths)).sort((left, right) => left - right);
  for (const width of uniqueSorted) {
    if (width < MIN_WIDTH || width > MAX_WIDTH) {
      throw new Error(
        `Invalid width in requested widths: "${width.toString()}". Must be between ${MIN_WIDTH.toString()} and ${MAX_WIDTH.toString()}.`
      );
    }
  }
  return uniqueSorted;
}

function assertWidthCountLimit(widths: number[], sourceHint = "") {
  if (widths.length > MAX_WIDTH_COUNT) {
    throw new Error(
      `Invalid widths${sourceHint}: received ${widths.length.toString()} unique widths. Maximum is ${MAX_WIDTH_COUNT.toString()}.`
    );
  }
}

function parseWidthsInput(value: string): number[] {
  const tokens = value.split(",");
  const parsed: number[] = [];

  for (const [index, token] of tokens.entries()) {
    const normalized = token.trim();
    if (normalized === "") {
      throw new Error(
        `Invalid widths: empty value at position ${(index + 1).toString()} in "${value}".`
      );
    }
    parsed.push(parseIntegerFromString("width", normalized));
  }

  const normalized = normalizeWidths(parsed);
  assertWidthCountLimit(normalized);
  return normalized;
}

function normalizeFormats(
  formatsInput: string[],
  jsonMode: boolean
): { formats: OutputFormat[]; unknown: string[] } {
  const valid = new Set(["webp", "avif"]);
  const unknown = formatsInput.filter((format) => !valid.has(format));
  if (unknown.length > 0 && !jsonMode) {
    console.error(
      chalk.yellow(`Unknown format(s) ignored: ${unknown.join(", ")}. Valid: webp, avif`)
    );
  }
  const formats = formatsInput.filter(
    (format): format is OutputFormat => format === "webp" || format === "avif"
  );
  return { formats, unknown };
}

function applyConfig(target: ResolvedOptions, config: ImageForgeConfig) {
  if (config.output !== undefined) target.output = config.output;
  if (config.formats !== undefined) target.formatsInput = parseFormatsInput(config.formats);
  if (config.quality !== undefined) target.quality = parseNumberOption("quality", config.quality);
  if (config.blur !== undefined) target.blur = config.blur;
  if (config.blurSize !== undefined)
    target.blurSize = parseNumberOption("blurSize", config.blurSize);
  if (config.widths !== undefined) target.widths = [...config.widths];
  if (config.cache !== undefined) target.cache = config.cache;
  if (config.forceOverwrite !== undefined) target.forceOverwrite = config.forceOverwrite;
  if (config.check !== undefined) target.check = config.check;
  if (config.outDir !== undefined) target.outDir = config.outDir;
  if (config.concurrency !== undefined)
    target.concurrency = parseNumberOption("concurrency", config.concurrency);
  if (config.json !== undefined) target.json = config.json;
  if (config.verbose !== undefined) target.verbose = config.verbose;
  if (config.quiet !== undefined) target.quiet = config.quiet;
}

function resolveOptions(
  options: CliOptions,
  command: Command,
  config: ImageForgeConfig,
  configSourcePath: string | null,
  defaultConcurrency: number
): { resolved: ResolvedOptions; formats: OutputFormat[] } {
  const resolved: ResolvedOptions = {
    output: "imageforge.json",
    formatsInput: ["webp"],
    quality: 80,
    blur: true,
    blurSize: 4,
    widths: null,
    cache: true,
    forceOverwrite: false,
    check: false,
    outDir: null,
    concurrency: defaultConcurrency,
    json: false,
    verbose: false,
    quiet: false,
  };

  applyConfig(resolved, config);

  if (command.getOptionValueSource("output") === "cli" && options.output !== undefined) {
    resolved.output = options.output;
  }
  if (command.getOptionValueSource("formats") === "cli" && options.formats !== undefined) {
    resolved.formatsInput = parseFormatsInput(options.formats);
  }
  if (command.getOptionValueSource("quality") === "cli" && options.quality !== undefined) {
    resolved.quality = parseIntegerFromString("quality", options.quality);
  }
  if (command.getOptionValueSource("blur") === "cli" && options.blur !== undefined) {
    resolved.blur = options.blur;
  }
  if (command.getOptionValueSource("blurSize") === "cli" && options.blurSize !== undefined) {
    resolved.blurSize = parseIntegerFromString("blur size", options.blurSize);
  }
  if (command.getOptionValueSource("widths") === "cli" && options.widths !== undefined) {
    resolved.widths = parseWidthsInput(options.widths);
  }
  if (command.getOptionValueSource("cache") === "cli" && options.cache !== undefined) {
    resolved.cache = options.cache;
  }
  if (
    command.getOptionValueSource("forceOverwrite") === "cli" &&
    options.forceOverwrite !== undefined
  ) {
    resolved.forceOverwrite = options.forceOverwrite;
  }
  if (command.getOptionValueSource("check") === "cli" && options.check !== undefined) {
    resolved.check = options.check;
  }
  if (command.getOptionValueSource("outDir") === "cli") {
    resolved.outDir = options.outDir ?? null;
  }
  if (command.getOptionValueSource("concurrency") === "cli" && options.concurrency !== undefined) {
    resolved.concurrency = parseIntegerFromString("concurrency", options.concurrency);
  }
  if (command.getOptionValueSource("json") === "cli" && options.json !== undefined) {
    resolved.json = options.json;
  }
  const verboseFromCli = command.getOptionValueSource("verbose") === "cli";
  const quietFromCli = command.getOptionValueSource("quiet") === "cli";
  if (verboseFromCli && options.verbose !== undefined) {
    resolved.verbose = options.verbose;
  }
  if (quietFromCli && options.quiet !== undefined) {
    resolved.quiet = options.quiet;
  }

  if (verboseFromCli && quietFromCli && resolved.verbose && resolved.quiet) {
    throw new Error("--verbose and --quiet cannot be used together.");
  }

  // Explicit CLI verbosity choice should override config-derived opposite mode.
  if (verboseFromCli && !quietFromCli && resolved.verbose) {
    resolved.quiet = false;
  }
  if (quietFromCli && !verboseFromCli && resolved.quiet) {
    resolved.verbose = false;
  }

  const qualityFromConfig =
    command.getOptionValueSource("quality") !== "cli" && config.quality !== undefined;
  if (resolved.quality < 1 || resolved.quality > 100) {
    const sourceHint = qualityFromConfig && configSourcePath ? ` in ${configSourcePath}` : "";
    throw new Error(
      `Invalid quality${sourceHint}: "${resolved.quality.toString()}". Must be between 1 and 100.`
    );
  }

  const blurSizeFromConfig =
    command.getOptionValueSource("blurSize") !== "cli" && config.blurSize !== undefined;
  if (resolved.blurSize < 1 || resolved.blurSize > 256) {
    const sourceHint = blurSizeFromConfig && configSourcePath ? ` in ${configSourcePath}` : "";
    throw new Error(
      `Invalid blur size${sourceHint}: "${resolved.blurSize.toString()}". Must be between 1 and 256.`
    );
  }

  const widthsFromConfig =
    command.getOptionValueSource("widths") !== "cli" && config.widths !== undefined;
  if (resolved.widths !== null) {
    if (resolved.widths.length === 0) {
      const sourceHint = widthsFromConfig && configSourcePath ? ` in ${configSourcePath}` : "";
      throw new Error(`Invalid requested widths${sourceHint}: must include at least one width.`);
    }
    const invalidWidth = resolved.widths.find((width) => width < 1 || width > 16_384);
    if (invalidWidth !== undefined) {
      const sourceHint = widthsFromConfig && configSourcePath ? ` in ${configSourcePath}` : "";
      throw new Error(
        `Invalid width${sourceHint}: "${invalidWidth.toString()}". Must be between ${MIN_WIDTH.toString()} and ${MAX_WIDTH.toString()} for requested width targets.`
      );
    }
    resolved.widths = normalizeWidths(resolved.widths);
    const sourceHint = widthsFromConfig && configSourcePath ? ` in ${configSourcePath}` : "";
    assertWidthCountLimit(resolved.widths, sourceHint);
  }

  const concurrencyFromConfig =
    command.getOptionValueSource("concurrency") !== "cli" && config.concurrency !== undefined;
  if (resolved.concurrency < 1 || resolved.concurrency > 64) {
    const sourceHint = concurrencyFromConfig && configSourcePath ? ` in ${configSourcePath}` : "";
    throw new Error(
      `Invalid concurrency${sourceHint}: "${resolved.concurrency.toString()}". Must be between 1 and 64.`
    );
  }

  if (resolved.verbose && resolved.quiet) {
    if (!verboseFromCli && !quietFromCli && config.verbose === true && config.quiet === true) {
      const source = configSourcePath ?? "config";
      throw new Error(
        `Invalid verbosity settings in ${source}: "verbose" and "quiet" cannot both be true.`
      );
    }
    throw new Error("--verbose and --quiet cannot be used together.");
  }

  const { formats } = normalizeFormats(resolved.formatsInput, resolved.json);
  if (formats.length === 0) {
    throw new Error("No valid formats specified. Use: webp, avif");
  }

  return {
    resolved,
    formats,
  };
}

const program = new Command();
const packageVersion = readPackageVersion();

program
  .name("imageforge")
  .description("Image optimization pipeline for Next.js developers")
  .version(packageVersion)
  .argument("<directory>", "Directory containing images to process")
  .option("-o, --output <path>", "Manifest output path (default: imageforge.json)")
  .option("-f, --formats <formats>", "Output formats (comma-separated: webp,avif)")
  .option("-q, --quality <number>", "Output quality 1..100 (default: 80)")
  .option("--blur", "Enable blur placeholder generation")
  .option("--no-blur", "Skip blur placeholder generation")
  .option("--blur-size <number>", "Blur placeholder dimensions 1..256 (default: 4)")
  .option(
    "--widths <list>",
    "Requested responsive width targets (comma-separated); generated widths are source-bounded"
  )
  .option("--cache", "Enable file hash caching")
  .option("--no-cache", "Disable file hash caching")
  .option("--force-overwrite", "Allow overwriting existing output files")
  .option("--no-force-overwrite", "Disable overwrite mode")
  .option("--check", "Check mode: exit 1 if unprocessed images exist")
  .option("--no-check", "Disable check mode")
  .option("--out-dir <path>", "Output directory for generated derivatives")
  .option(
    "--concurrency <number>",
    `Number of images to process concurrently (default: ${getDefaultConcurrency().toString()})`
  )
  .option("--json", "Emit machine-readable JSON report to stdout")
  .option("--no-json", "Disable JSON output mode")
  .option("--verbose", "Show additional diagnostics")
  .option("--no-verbose", "Disable verbose diagnostics")
  .option("--quiet", "Suppress per-file logs")
  .option("--no-quiet", "Disable quiet mode")
  .option("--config <path>", "Path to imageforge config file")
  .action(async (directory: string, options: CliOptions, command: Command) => {
    try {
      const configPath =
        command.getOptionValueSource("config") === "cli" && options.config
          ? options.config
          : undefined;
      const loadedConfig = loadConfig(process.cwd(), configPath);

      const { resolved, formats } = resolveOptions(
        options,
        command,
        loadedConfig.config,
        loadedConfig.sourcePath,
        getDefaultConcurrency()
      );

      const result = await runImageforge({
        version: packageVersion,
        inputDir: directory,
        outputPath: resolved.output,
        directoryArg: directory,
        commandName: "imageforge",
        formats,
        quality: resolved.quality,
        blur: resolved.blur,
        blurSize: resolved.blurSize,
        widths: resolved.widths,
        useCache: resolved.cache,
        forceOverwrite: resolved.forceOverwrite,
        checkMode: resolved.check,
        outDir: resolved.outDir,
        concurrency: resolved.concurrency,
        json: resolved.json,
        verbose: resolved.verbose,
        quiet: resolved.quiet,
      });

      if (resolved.json) {
        console.log(JSON.stringify(result.report, null, 2));
      }

      process.exitCode = result.exitCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      if (err instanceof ConfigError) {
        console.error(chalk.red(message));
      } else {
        console.error(chalk.red(`imageforge failed: ${message}`));
      }
      process.exitCode = 1;
    }
  });

program.parse();
