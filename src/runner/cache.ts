import * as fs from "fs";
import * as path from "path";
import { fromPosix } from "../processor.js";
import { isRecord } from "../shared.js";
import type { ImageForgeEntry, ImageForgeVariant } from "../types.js";

export interface CacheEntry {
  hash: string;
  result: ImageForgeEntry;
}

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_LOCK_STALE_MS = 120_000;
const DEFAULT_CACHE_LOCK_HEARTBEAT_MS = 5_000;
const CACHE_LOCK_INITIAL_POLL_MS = 25;
const CACHE_LOCK_MAX_POLL_MS = 500;
const CACHE_LOCK_BACKOFF_FACTOR = 1.5;

export const CACHE_FILE = ".imageforge-cache.json";

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

    try {
      fs.utimesSync(lockPath, now, now);
    } catch {
      // Best-effort heartbeat.
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
  try {
    fs.closeSync(lockFd);
  } catch {
    // Best-effort close.
  }
  fs.rmSync(lockPath, { force: true });
}

export function loadCache(cachePath: string): Map<string, CacheEntry> {
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

export function saveCacheAtomic(cachePath: string, cache: Map<string, CacheEntry>): void {
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

export function cacheOutputsExist(entry: CacheEntry, inputDir: string): boolean {
  for (const output of collectEntryOutputs(entry.result)) {
    const fullPath = path.resolve(inputDir, fromPosix(output.path));
    if (!fs.existsSync(fullPath)) return false;
  }
  return true;
}
