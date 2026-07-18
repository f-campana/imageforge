import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import sharp from "sharp";
import { assertSafeOutputParents, fromPosix, resolveOutputPath } from "../output-paths.js";
import type { ProcessOptions } from "../processor.js";
import { resolveEffectiveWidths, resolveOrientedDimensions } from "../responsive.js";
import { isRecord, LIMIT_INPUT_PIXELS } from "../shared.js";
import type { ImageForgeEntry, ImageForgeVariant } from "../types.js";

export interface CacheEntry {
  hash: string;
  result: ImageForgeEntry;
  outputHashes?: Record<string, string>;
  generator?: string;
  blurHash?: string;
}

export interface CacheLoadResult {
  entries: Map<string, CacheEntry>;
  status: "missing" | "valid" | "invalid";
  schemaVersion: 1 | 2 | null;
}

const CACHE_SCHEMA_VERSION = 2;
const DEFAULT_CACHE_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_LOCK_STALE_MS = 120_000;
const DEFAULT_CACHE_LOCK_HEARTBEAT_MS = 5_000;
const CACHE_LOCK_INITIAL_POLL_MS = 25;
const CACHE_LOCK_MAX_POLL_MS = 500;
const CACHE_LOCK_BACKOFF_FACTOR = 1.5;
const DIGEST_CHUNK_SIZE = 1024 * 1024;
const PNG_IEND = Buffer.from("0000000049454e44ae426082", "hex");

interface CacheLockIdentity {
  dev: number;
  ino: number;
  token: string;
}

const cacheLockIdentities = new Map<number, CacheLockIdentity>();

export const CACHE_FILE = ".imageforge-cache.json";

export function generatorFingerprint(cliVersion: string): string {
  return `imageforge:${cliVersion};sharp:${sharp.versions.sharp};vips:${sharp.versions.vips}`;
}

export function hashBlurDataURL(blurDataURL: string): string {
  return crypto.createHash("sha256").update(blurDataURL).digest("hex");
}

async function isCurrentBlurDataURL(
  blurDataURL: string,
  blurSize: number,
  sourceWidth: number,
  sourceHeight: number
): Promise<boolean> {
  const prefix = "data:image/png;base64,";
  if (!blurDataURL.startsWith(prefix)) return false;
  const encoded = blurDataURL.slice(prefix.length);
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
  ) {
    return false;
  }
  const png = Buffer.from(encoded, "base64");
  if (
    png.length < 36 ||
    png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    png.subarray(12, 16).toString("ascii") !== "IHDR" ||
    !png.subarray(-PNG_IEND.length).equals(PNG_IEND)
  ) {
    return false;
  }
  try {
    const decoded = await sharp(png, { limitInputPixels: LIMIT_INPUT_PIXELS })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = decoded.info;
    const aspectError = Math.abs(width * sourceHeight - height * sourceWidth);
    return (
      width > 0 &&
      height > 0 &&
      width <= blurSize &&
      height <= blurSize &&
      Math.max(width, height) === blurSize &&
      aspectError <= Math.max(sourceWidth, sourceHeight)
    );
  } catch {
    return false;
  }
}

function sha256File(filePath: string): string {
  const digest = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(DIGEST_CHUNK_SIZE);
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest("hex");
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
  if (!(
    isRecord(value) &&
    typeof value.hash === "string" &&
    isManifestEntry(value.result) &&
    value.result.hash === value.hash
  ))
    return false;
  if ("outputHashes" in value && value.outputHashes !== undefined) {
    if (!isRecord(value.outputHashes)) return false;
    for (const digest of Object.values(value.outputHashes)) {
      if (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)) return false;
    }
  }
  if (
    "generator" in value &&
    value.generator !== undefined &&
    typeof value.generator !== "string"
  ) {
    return false;
  }
  if (
    "blurHash" in value &&
    value.blurHash !== undefined &&
    (typeof value.blurHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.blurHash))
  ) {
    return false;
  }
  return true;
}

function isCurrentCacheEntry(entry: CacheEntry): boolean {
  return (
    entry.outputHashes !== undefined &&
    entry.generator !== undefined &&
    entry.blurHash !== undefined
  );
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

function sameLockFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function lockPathMatchesFd(lockFd: number, lockPath: string): boolean {
  try {
    const descriptorStat = fs.fstatSync(lockFd);
    const pathStat = fs.lstatSync(lockPath);
    if (!sameLockFile(descriptorStat, pathStat)) return false;

    const identity = cacheLockIdentities.get(lockFd);
    if (!identity) return true;
    if (identity.dev !== pathStat.dev || identity.ino !== pathStat.ino) return false;
    const token = fs.readFileSync(lockPath, "utf-8").split(/\r?\n/u, 3)[1];
    return token === identity.token;
  } catch {
    return false;
  }
}

function removeStaleLockIfUnchanged(lockPath: string, observed: fs.Stats): boolean {
  try {
    const current = fs.lstatSync(lockPath);
    if (
      !sameLockFile(observed, current) ||
      observed.size !== current.size ||
      observed.mtimeMs !== current.mtimeMs
    ) {
      return false;
    }
    fs.rmSync(lockPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function acquireCacheLock(lockPath: string): Promise<number> {
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
      const token = crypto.randomUUID();
      try {
        fs.writeFileSync(fd, `${process.pid.toString()}\n${token}\n${new Date().toISOString()}\n`);
        const stat = fs.fstatSync(fd);
        cacheLockIdentities.set(fd, { dev: stat.dev, ino: stat.ino, token });
        return fd;
      } catch (writeErr) {
        const stillOwnsLockPath = lockPathMatchesFd(fd, lockPath);
        try {
          fs.closeSync(fd);
        } finally {
          if (stillOwnsLockPath) {
            fs.rmSync(lockPath, { force: true });
          }
        }
        throw writeErr;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          const ownerPid = readLockOwnerPid(lockPath);
          if (ownerPid !== null && isProcessAlive(ownerPid)) {
            // The lock owner is still alive; keep waiting instead of stealing the lock.
          } else if (removeStaleLockIfUnchanged(lockPath, stat)) {
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

export function startCacheLockHeartbeat(lockFd: number, lockPath: string): NodeJS.Timeout {
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

    if (lockPathMatchesFd(lockFd, lockPath)) {
      try {
        fs.utimesSync(lockPath, now, now);
      } catch {
        // Best-effort heartbeat.
      }
    }
  }, heartbeatMs);
  timer.unref();
  return timer;
}

export function releaseCacheLock(
  lockFd: number,
  lockPath: string,
  heartbeatTimer: NodeJS.Timeout | null
): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  const ownsPath = lockPathMatchesFd(lockFd, lockPath);
  try {
    fs.closeSync(lockFd);
  } catch {
    // Best-effort close.
  } finally {
    cacheLockIdentities.delete(lockFd);
  }
  if (ownsPath) {
    fs.rmSync(lockPath, { force: true });
  }
}

export function loadCacheState(cachePath: string): CacheLoadResult {
  try {
    if (!fs.existsSync(cachePath)) {
      return { entries: new Map(), status: "missing", schemaVersion: null };
    }
    const content = fs.readFileSync(cachePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) {
      return { entries: new Map(), status: "invalid", schemaVersion: null };
    }

    let entriesRecord: Record<string, unknown>;
    let schemaVersion: 1 | 2;
    if ("entries" in parsed) {
      if (
        (parsed.version !== 1 && parsed.version !== CACHE_SCHEMA_VERSION) ||
        Object.keys(parsed).some((key) => key !== "version" && key !== "entries")
      ) {
        return { entries: new Map(), status: "invalid", schemaVersion: null };
      }
      if (!isRecord(parsed.entries)) {
        return { entries: new Map(), status: "invalid", schemaVersion: null };
      }
      entriesRecord = parsed.entries;
      schemaVersion = parsed.version;
    } else {
      // Legacy cache shape from v0.1.0.
      entriesRecord = parsed;
      schemaVersion = 1;
    }

    const entries: [string, CacheEntry][] = [];
    for (const [key, value] of Object.entries(entriesRecord)) {
      if (
        !isCacheEntry(value) ||
        (schemaVersion === CACHE_SCHEMA_VERSION && !isCurrentCacheEntry(value))
      ) {
        return { entries: new Map(), status: "invalid", schemaVersion: null };
      }
      entries.push([key, value]);
    }
    return { entries: new Map(entries), status: "valid", schemaVersion };
  } catch {
    return { entries: new Map(), status: "invalid", schemaVersion: null };
  }
}

export function loadCache(cachePath: string): Map<string, CacheEntry> {
  return loadCacheState(cachePath).entries;
}

export function saveCacheAtomic(cachePath: string, cache: Map<string, CacheEntry>): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const randomSuffix = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  const tempPath = `${cachePath}.${process.pid.toString()}.${randomSuffix}.tmp`;
  const schemaVersion = [...cache.values()].every(isCurrentCacheEntry) ? 2 : 1;
  fs.writeFileSync(
    tempPath,
    JSON.stringify(
      {
        version: schemaVersion,
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

export function collectEntryOutputs(entry: ImageForgeEntry): { path: string; size: number }[] {
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

export function calculateOutputHashes(
  entry: ImageForgeEntry,
  inputDir: string
): Record<string, string> {
  return Object.fromEntries(
    collectEntryOutputs(entry).map((output) => {
      const fullPath = path.resolve(inputDir, fromPosix(output.path));
      const digest = sha256File(fullPath);
      return [output.path, digest];
    })
  );
}

export async function cacheOutputsAreCurrent(
  entry: CacheEntry,
  sourcePath: string,
  sourceRelativePath: string,
  inputDir: string,
  outputDir: string,
  processOptions: ProcessOptions,
  expectedGenerator: string
): Promise<boolean> {
  if (entry.generator !== expectedGenerator) return false;
  let sourceWidth: number;
  let sourceHeight: number;
  let sourceSize: number;
  try {
    const metadata = await sharp(sourcePath, { limitInputPixels: LIMIT_INPUT_PIXELS }).metadata();
    ({ width: sourceWidth, height: sourceHeight } = resolveOrientedDimensions(
      metadata.width,
      metadata.height,
      metadata.orientation
    ));
    sourceSize = fs.statSync(sourcePath).size;
  } catch {
    return false;
  }
  if (entry.blurHash !== hashBlurDataURL(entry.result.blurDataURL)) {
    return false;
  }
  const expectedAspectRatio = +(sourceWidth / sourceHeight).toFixed(3);
  if (
    entry.result.width !== sourceWidth ||
    entry.result.height !== sourceHeight ||
    entry.result.aspectRatio !== expectedAspectRatio ||
    entry.result.originalSize !== sourceSize ||
    (!processOptions.blur && entry.result.blurDataURL !== "") ||
    (processOptions.blur &&
      !(await isCurrentBlurDataURL(
        entry.result.blurDataURL,
        processOptions.blurSize,
        sourceWidth,
        sourceHeight
      )))
  ) {
    return false;
  }

  const expectedFormats = [...new Set(processOptions.formats)];
  if (
    Object.keys(entry.result.outputs).length !== expectedFormats.length ||
    expectedFormats.some((format) => !Object.hasOwn(entry.result.outputs, format))
  )
    return false;
  const responsive = processOptions.widths !== undefined && processOptions.widths.length > 0;
  const expectedWidths = responsive
    ? resolveEffectiveWidths(sourceWidth, processOptions.widths)
    : null;
  const variantsByFormat = entry.result.variants ?? {};
  if (responsive) {
    if (
      Object.keys(variantsByFormat).length !== expectedFormats.length ||
      expectedFormats.some((format) => !Object.hasOwn(variantsByFormat, format))
    ) {
      return false;
    }
  } else if (Object.keys(variantsByFormat).length > 0) {
    return false;
  }

  const expectedPaths = new Set<string>();
  for (const format of expectedFormats) {
    const output = entry.result.outputs[format];
    const variants = variantsByFormat[format];
    if (
      expectedWidths &&
      variants.some((variant, index) => variant.width !== expectedWidths[index])
    ) {
      return false;
    }
    const selectedWidth = expectedWidths?.at(-1);
    const expectedPath = resolveOutputPath(
      sourceRelativePath,
      format,
      inputDir,
      outputDir,
      selectedWidth
    );
    expectedPaths.add(expectedPath);
    if (output.path !== expectedPath) return false;
    const selectedVariant = expectedWidths ? variants.at(-1) : undefined;
    if (
      expectedWidths &&
      (selectedVariant === undefined ||
        selectedVariant.width !== selectedWidth ||
        selectedVariant.size !== output.size)
    ) {
      return false;
    }
  }

  for (const format of expectedFormats) {
    const variants = variantsByFormat[format] ?? [];
    for (const variant of variants) {
      const expectedPath = resolveOutputPath(
        sourceRelativePath,
        format,
        inputDir,
        outputDir,
        variant.width
      );
      if (variant.path !== expectedPath) return false;
      const expectedHeight = Math.max(1, Math.round((variant.width / sourceWidth) * sourceHeight));
      if (variant.height !== expectedHeight) return false;
      expectedPaths.add(expectedPath);
    }
  }

  if (expectedPaths.size === 0) return false;
  const logicalRoot = path.resolve(outputDir);
  const verifiedDirectories = new Set<string>([logicalRoot]);
  const outputHashes = entry.outputHashes;
  if (
    outputHashes === undefined ||
    Object.keys(outputHashes).length !== expectedPaths.size ||
    [...expectedPaths].some((outputPath) => !Object.hasOwn(outputHashes, outputPath))
  ) {
    return false;
  }

  for (const output of collectEntryOutputs(entry.result)) {
    const fullPath = path.resolve(inputDir, fromPosix(output.path));
    try {
      assertSafeOutputParents(fullPath, logicalRoot, {
        requireRoot: true,
        verifiedDirectories,
      });

      const stat = fs.lstatSync(fullPath);
      if (!stat.isFile() || stat.size !== output.size) return false;
      const digest = sha256File(fullPath);
      if (outputHashes[output.path] !== digest) return false;
    } catch {
      return false;
    }
  }
  return true;
}
