import sharp from "sharp";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { assertSafeOutputParents, fromPosix, outputPathFor, toPosix } from "./output-paths.js";
import {
  normalizeRequestedWidths,
  resolveEffectiveWidths,
  resolveOrientedDimensions,
} from "./responsive.js";
import { LIMIT_INPUT_PIXELS } from "./shared.js";

export type OutputFormat = "webp" | "avif";
export { fromPosix, outputPathFor, toPosix } from "./output-paths.js";

export interface ImageResult {
  file: string;
  width: number;
  height: number;
  aspectRatio: number;
  blurDataURL: string;
  originalSize: number;
  outputs: Record<string, { path: string; size: number }>;
  variants?: Record<string, ImageVariant[]>;
}

export interface ImageVariant {
  width: number;
  height: number;
  path: string;
  size: number;
}

export interface ProcessOptions {
  formats: OutputFormat[];
  quality: number;
  blur: boolean;
  blurSize: number;
  widths?: number[];
}

export interface DiscoveryWarning {
  path: string;
  message: string;
}

const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo"]);
const HASH_CHUNK_SIZE = 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".tiff", ".tif"]);

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function writeOutputAtomic(
  outputFullPath: string,
  outputDir: string,
  outputBuffer: Buffer
): Promise<void> {
  assertSafeOutputParents(outputFullPath, outputDir);
  await fsp.mkdir(path.dirname(outputFullPath), { recursive: true });
  assertSafeOutputParents(outputFullPath, outputDir);
  const suffix = `${process.pid.toString()}-${crypto.randomBytes(8).toString("hex")}`;
  const tempPath = path.join(
    path.dirname(outputFullPath),
    `.${path.basename(outputFullPath)}.${suffix}.tmp`
  );
  await fsp.writeFile(tempPath, outputBuffer, { flag: "wx" });
  try {
    try {
      await fsp.rename(tempPath, outputFullPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM") throw error;
      const backupPath = `${tempPath}.previous`;
      try {
        await fsp.rename(outputFullPath, backupPath);
      } catch (moveError) {
        if ((moveError as NodeJS.ErrnoException).code === "ENOENT") {
          await fsp.rename(tempPath, outputFullPath);
          return;
        }
        throw moveError;
      }
      try {
        await fsp.rename(tempPath, outputFullPath);
      } catch (replaceError) {
        try {
          await fsp.rename(backupPath, outputFullPath);
        } catch (restoreError) {
          throw new AggregateError(
            [replaceError, restoreError],
            `Failed to replace and restore output: ${outputFullPath}`
          );
        }
        throw replaceError;
      }
      await fsp.rm(backupPath, { force: true });
    }
  } finally {
    await fsp.rm(tempPath, { force: true });
  }
}

export function discoverImages(
  dir: string,
  onWarning?: (warning: DiscoveryWarning) => void
): string[] {
  const discovered: string[] = [];

  function walk(current: string) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(current);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      onWarning?.({
        path: toPosix(current),
        message,
      });
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(fullPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        onWarning?.({
          path: toPosix(fullPath),
          message,
        });
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory() && !entry.startsWith(".") && !IGNORED_DIRS.has(entry)) {
        walk(fullPath);
      } else if (stat.isFile() && isImageFile(entry)) {
        discovered.push(fullPath);
      }
    }
  }

  walk(dir);
  return discovered.sort();
}

export function fileHash(filePath: string, options?: ProcessOptions): string {
  const hash = crypto.createHash("sha256");
  const fileDescriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);

  try {
    for (;;) {
      const bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }

  if (options) {
    const normalizedWidths =
      options.widths === undefined ? null : normalizeRequestedWidths(options.widths);
    hash.update(
      JSON.stringify({
        formats: [...options.formats].sort(),
        quality: options.quality,
        blur: options.blur,
        blurSize: options.blurSize,
        widths: normalizedWidths,
      })
    );
  }

  return hash.digest("hex").slice(0, 16);
}

export async function generateBlurDataURL(buffer: Buffer, size = 4): Promise<string> {
  const resized = await sharp(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS })
    .rotate()
    .resize(size, size, { fit: "inside" })
    .toFormat("png")
    .toBuffer();

  return `data:image/png;base64,${resized.toString("base64")}`;
}

export async function convertImage(
  buffer: Buffer,
  format: OutputFormat,
  quality: number,
  width?: number
): Promise<Buffer> {
  let pipeline = sharp(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS }).rotate();
  if (width !== undefined) {
    pipeline = pipeline.resize({
      width,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  if (format === "webp") {
    pipeline = pipeline.webp({
      quality,
      effort: 4,
      lossless: quality === 100,
      nearLossless: quality > 90,
    });
  } else {
    pipeline = pipeline.avif({
      quality,
      effort: 4,
      lossless: quality === 100,
    });
  }

  return pipeline.toBuffer();
}

export async function processImage(
  filePath: string,
  inputDir: string,
  options: ProcessOptions,
  outputDir = inputDir
): Promise<ImageResult> {
  const buffer = await fsp.readFile(filePath);
  const metadata = await sharp(buffer, {
    limitInputPixels: LIMIT_INPUT_PIXELS,
  }).metadata();
  const relativePath = toPosix(path.relative(inputDir, filePath));

  // Keep metadata extraction separate from conversion pipeline and normalize
  // dimensions from EXIF orientation here so manifest width/height match the
  // rotated outputs without depending on pipeline order side effects.
  const { width, height } = resolveOrientedDimensions(
    metadata.width,
    metadata.height,
    metadata.orientation
  );

  const result: ImageResult = {
    file: relativePath,
    width,
    height,
    aspectRatio: height > 0 ? +(width / height).toFixed(3) : 0,
    blurDataURL: "",
    originalSize: buffer.length,
    outputs: {},
  };

  // Generate blur placeholder
  if (options.blur) {
    result.blurDataURL = await generateBlurDataURL(buffer, options.blurSize);
  }

  const normalizedRequestedWidths =
    options.widths === undefined ? undefined : normalizeRequestedWidths(options.widths);

  // Convert to output formats
  for (const format of options.formats) {
    if (normalizedRequestedWidths === undefined || normalizedRequestedWidths.length === 0) {
      const outputBuffer = await convertImage(buffer, format, options.quality);
      const outputInOutputDir = outputPathFor(relativePath, format);
      const outputFullPath = path.resolve(outputDir, fromPosix(outputInOutputDir));
      const outputRelPath = toPosix(path.relative(inputDir, outputFullPath));

      result.outputs[format] = {
        path: outputRelPath,
        size: outputBuffer.length,
      };

      await writeOutputAtomic(outputFullPath, outputDir, outputBuffer);
      continue;
    }

    const variantWidths = resolveEffectiveWidths(width, normalizedRequestedWidths);
    const variants: ImageVariant[] = [];

    for (const variantWidth of variantWidths) {
      const outputBuffer = await convertImage(buffer, format, options.quality, variantWidth);
      const outputInOutputDir = outputPathFor(relativePath, format, variantWidth);
      const outputFullPath = path.resolve(outputDir, fromPosix(outputInOutputDir));
      const outputRelPath = toPosix(path.relative(inputDir, outputFullPath));
      const variantHeight =
        height > 0 ? Math.max(1, Math.round((variantWidth / width) * height)) : 0;

      variants.push({
        width: variantWidth,
        height: variantHeight,
        path: outputRelPath,
        size: outputBuffer.length,
      });

      // Write output file in the configured output root.
      await writeOutputAtomic(outputFullPath, outputDir, outputBuffer);
    }

    result.variants ??= {};
    result.variants[format] = variants;

    const selectedOutput = variants[variants.length - 1];
    result.outputs[format] = {
      path: selectedOutput.path,
      size: selectedOutput.size,
    };
  }

  return result;
}
