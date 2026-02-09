import sharp from "sharp";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import * as crypto from "crypto";

export type OutputFormat = "webp" | "avif";

export interface ImageResult {
  file: string;
  width: number;
  height: number;
  aspectRatio: number;
  blurDataURL: string;
  originalSize: number;
  outputs: Record<string, { path: string; size: number }>;
}

export interface ProcessOptions {
  formats: OutputFormat[];
  quality: number;
  blur: boolean;
  blurSize: number;
}

const LIMIT_INPUT_PIXELS = 100_000_000;
const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo"]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".tiff", ".tif"]);

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/").split(path.sep).join("/");
}

export function fromPosix(filePath: string): string {
  return filePath.split("/").join(path.sep);
}

export function outputPathFor(relativePath: string, format: OutputFormat): string {
  const parsed = path.posix.parse(toPosix(relativePath));
  return path.posix.join(parsed.dir, `${parsed.name}.${format}`);
}

export function discoverImages(dir: string): string[] {
  const discovered: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current);
    for (const entry of entries) {
      const fullPath = path.join(current, entry);
      const stat = fs.lstatSync(fullPath);
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
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(content);

  if (options) {
    hash.update(
      JSON.stringify({
        formats: [...options.formats].sort(),
        quality: options.quality,
        blur: options.blur,
        blurSize: options.blurSize,
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
  quality: number
): Promise<Buffer> {
  let pipeline = sharp(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS }).rotate();

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
  const baseWidth = metadata.width;
  const baseHeight = metadata.height;
  const orientation = metadata.orientation ?? 1;
  const isQuarterTurn = orientation >= 5 && orientation <= 8;
  const width = isQuarterTurn ? baseHeight : baseWidth;
  const height = isQuarterTurn ? baseWidth : baseHeight;

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

  // Convert to output formats
  for (const format of options.formats) {
    const outputBuffer = await convertImage(buffer, format, options.quality);
    const outputInOutputDir = outputPathFor(relativePath, format);
    const outputFullPath = path.resolve(outputDir, fromPosix(outputInOutputDir));
    const outputRelPath = toPosix(path.relative(inputDir, outputFullPath));

    result.outputs[format] = {
      path: outputRelPath,
      size: outputBuffer.length,
    };

    // Write output file in the configured output root.
    await fsp.mkdir(path.dirname(outputFullPath), { recursive: true });
    await fsp.writeFile(outputFullPath, outputBuffer);
  }

  return result;
}
