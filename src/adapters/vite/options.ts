import * as path from "node:path";
import type { OutputFormat } from "../../processor.js";
import { MAX_WIDTH, MAX_WIDTH_COUNT, MIN_WIDTH } from "../../responsive.js";

export interface ImageForgeVitePluginOptions {
  inputDir: string;
  outDir: string;
  publicBasePath: string;
  formats?: OutputFormat[];
  quality?: number;
  blur?: boolean;
  blurSize?: number;
  widths?: number[];
  cache?: boolean;
}

export interface ResolvedImageForgeViteOptions {
  inputDir: string;
  outDir: string;
  publicBasePath: string;
  formats: OutputFormat[];
  quality: number;
  blur: boolean;
  blurSize: number;
  widths: number[] | null;
  cache: boolean;
}

export type ImageForgeViteErrorCode =
  | "INVALID_OPTIONS"
  | "UNSAFE_OUTPUT_LAYOUT"
  | "UNSUPPORTED_VITE_BASE"
  | "PUBLIC_BASE_PATH_MISMATCH"
  | "BUILD_FAILED"
  | "NO_IMAGES"
  | "INVALID_GENERATED_PATH";

export class ImageForgeViteError extends Error {
  readonly code: ImageForgeViteErrorCode;
  readonly imageforgeCode: ImageForgeViteErrorCode;

  constructor(code: ImageForgeViteErrorCode, message: string) {
    super(message);
    this.name = "ImageForgeViteError";
    this.code = code;
    this.imageforgeCode = code;
  }
}

const SUPPORTED_FORMATS: readonly string[] = ["webp", "avif"];

function optionError(message: string): ImageForgeViteError {
  return new ImageForgeViteError("INVALID_OPTIONS", message);
}

function validateRelativeDirectory(value: string, label: "inputDir" | "outDir"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw optionError(`ImageForge Vite ${label} must be a non-empty relative directory.`);
  }
  if (path.isAbsolute(value) || value.includes("\\")) {
    throw optionError(`ImageForge Vite ${label} must be a relative POSIX directory.`);
  }

  const segments = value.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw optionError(`ImageForge Vite ${label} contains an invalid path segment.`);
  }
  return segments.join("/");
}

function validatePublicBasePath(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw optionError("ImageForge Vite publicBasePath must be a non-empty URL path.");
  }
  if (value.includes("\\") || value.includes("?") || value.includes("#")) {
    throw optionError("ImageForge Vite publicBasePath must contain URL path segments only.");
  }
  if (value.includes("%")) {
    throw optionError("ImageForge Vite publicBasePath must use unencoded URL path segments.");
  }
  if (value === "/") return value;

  const segments = value.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw optionError("ImageForge Vite publicBasePath contains an invalid path segment.");
  }
  return `/${segments.join("/")}`;
}

function validateIntegerRange(
  value: number,
  label: string,
  minimum: number,
  maximum: number
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw optionError(
      `ImageForge Vite ${label} must be an integer between ${minimum.toString()} and ${maximum.toString()}.`
    );
  }
}

export function resolveImageForgeViteOptions(
  options: ImageForgeVitePluginOptions
): ResolvedImageForgeViteOptions {
  const formats = options.formats ?? ["webp", "avif"];
  if (
    formats.length === 0 ||
    formats.some((format) => !SUPPORTED_FORMATS.includes(format)) ||
    new Set(formats).size !== formats.length
  ) {
    throw optionError("ImageForge Vite formats must contain unique webp and/or avif values.");
  }

  const quality = options.quality ?? 80;
  const blurSize = options.blurSize ?? 4;
  validateIntegerRange(quality, "quality", 1, 100);
  validateIntegerRange(blurSize, "blurSize", 1, 256);

  let widths: number[] | null = null;
  if (options.widths !== undefined) {
    widths = Array.from(new Set(options.widths)).sort((left, right) => left - right);
    if (widths.length === 0 || widths.length > MAX_WIDTH_COUNT) {
      throw optionError(
        `ImageForge Vite widths must contain 1 to ${MAX_WIDTH_COUNT.toString()} unique values.`
      );
    }
    for (const width of widths) {
      validateIntegerRange(width, "width", MIN_WIDTH, MAX_WIDTH);
    }
  }

  return {
    inputDir: validateRelativeDirectory(options.inputDir, "inputDir"),
    outDir: validateRelativeDirectory(options.outDir, "outDir"),
    publicBasePath: validatePublicBasePath(options.publicBasePath),
    formats: [...formats],
    quality,
    blur: options.blur ?? true,
    blurSize,
    widths,
    cache: options.cache ?? true,
  };
}
