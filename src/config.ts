import * as fs from "fs";
import * as path from "path";
import { MAX_WIDTH_COUNT, normalizeRequestedWidths } from "./responsive";

export interface ImageForgeConfig {
  output?: string;
  formats?: string | string[];
  quality?: number;
  blur?: boolean;
  blurSize?: number;
  widths?: number[];
  cache?: boolean;
  forceOverwrite?: boolean;
  check?: boolean;
  outDir?: string;
  concurrency?: number;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

export interface LoadedConfig {
  config: ImageForgeConfig;
  sourcePath: string | null;
}

export class ConfigError extends Error {}

const ALLOWED_KEYS = new Set([
  "output",
  "formats",
  "quality",
  "blur",
  "blurSize",
  "widths",
  "cache",
  "forceOverwrite",
  "check",
  "outDir",
  "concurrency",
  "json",
  "verbose",
  "quiet",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseString(
  value: unknown,
  key: keyof ImageForgeConfig,
  sourcePath: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ConfigError(`Invalid "${key}" in ${sourcePath}: expected string.`);
  }
  return value;
}

function parseNumber(
  value: unknown,
  key: keyof ImageForgeConfig,
  sourcePath: string
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError(`Invalid "${key}" in ${sourcePath}: expected number.`);
  }
  return value;
}

function parseBoolean(
  value: unknown,
  key: keyof ImageForgeConfig,
  sourcePath: string
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ConfigError(`Invalid "${key}" in ${sourcePath}: expected boolean.`);
  }
  return value;
}

function parseFormats(value: unknown, sourcePath: string): string | string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`Invalid "formats" in ${sourcePath}: expected string or string array.`);
  }
  if (!value.every((entry) => typeof entry === "string")) {
    throw new ConfigError(`Invalid "formats" in ${sourcePath}: array must contain only strings.`);
  }
  return value;
}

function parseWidths(value: unknown, sourcePath: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ConfigError(`Invalid "widths" in ${sourcePath}: expected number array.`);
  }
  if (value.length === 0) {
    throw new ConfigError(`Invalid "widths" in ${sourcePath}: must include at least one width.`);
  }

  const parsed: number[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new ConfigError(
        `Invalid "widths" in ${sourcePath}: expected number at index ${index.toString()}.`
      );
    }
    if (!Number.isInteger(entry)) {
      throw new ConfigError(
        `Invalid "widths" in ${sourcePath}: expected integer at index ${index.toString()}.`
      );
    }
    parsed.push(entry);
  }

  const normalized = normalizeRequestedWidths(parsed);
  if (normalized.length > MAX_WIDTH_COUNT) {
    throw new ConfigError(
      `Invalid "widths" in ${sourcePath}: received ${normalized.length.toString()} unique widths, maximum is ${MAX_WIDTH_COUNT.toString()}.`
    );
  }
  return normalized;
}

function parseConfig(value: unknown, sourcePath: string): ImageForgeConfig {
  if (!isRecord(value)) {
    throw new ConfigError(`Invalid config in ${sourcePath}: expected a JSON object.`);
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new ConfigError(`Unknown config key "${key}" in ${sourcePath}.`);
    }
  }

  return {
    output: parseString(value.output, "output", sourcePath),
    formats: parseFormats(value.formats, sourcePath),
    quality: parseNumber(value.quality, "quality", sourcePath),
    blur: parseBoolean(value.blur, "blur", sourcePath),
    blurSize: parseNumber(value.blurSize, "blurSize", sourcePath),
    widths: parseWidths(value.widths, sourcePath),
    cache: parseBoolean(value.cache, "cache", sourcePath),
    forceOverwrite: parseBoolean(value.forceOverwrite, "forceOverwrite", sourcePath),
    check: parseBoolean(value.check, "check", sourcePath),
    outDir: parseString(value.outDir, "outDir", sourcePath),
    concurrency: parseNumber(value.concurrency, "concurrency", sourcePath),
    json: parseBoolean(value.json, "json", sourcePath),
    verbose: parseBoolean(value.verbose, "verbose", sourcePath),
    quiet: parseBoolean(value.quiet, "quiet", sourcePath),
  };
}

function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new ConfigError(`Failed to read config file ${filePath}: ${message}`);
  }
}

export function loadConfig(cwd: string, explicitConfigPath?: string): LoadedConfig {
  if (explicitConfigPath) {
    const configPath = path.resolve(cwd, explicitConfigPath);
    if (!fs.existsSync(configPath)) {
      throw new ConfigError(`Config file not found: ${configPath}`);
    }
    return {
      config: parseConfig(readJsonFile(configPath), configPath),
      sourcePath: configPath,
    };
  }

  const configJsonPath = path.join(cwd, "imageforge.config.json");
  if (fs.existsSync(configJsonPath)) {
    return {
      config: parseConfig(readJsonFile(configJsonPath), configJsonPath),
      sourcePath: configJsonPath,
    };
  }

  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = readJsonFile(packageJsonPath);
    if (isRecord(packageJson) && packageJson.imageforge !== undefined) {
      return {
        config: parseConfig(packageJson.imageforge, `${packageJsonPath}#imageforge`),
        sourcePath: `${packageJsonPath}#imageforge`,
      };
    }
  }

  return {
    config: {},
    sourcePath: null,
  };
}
