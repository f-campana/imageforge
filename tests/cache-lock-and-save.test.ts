import fs from "fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireCacheLock,
  releaseCacheLock,
  saveCacheAtomic,
  type CacheEntry,
} from "../src/runner/cache.js";

const workspaces: string[] = [];
const originalTimeout = process.env.IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS;
const originalStale = process.env.IMAGEFORGE_CACHE_LOCK_STALE_MS;

afterEach(() => {
  if (originalTimeout === undefined) delete process.env.IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS;
  else process.env.IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS = originalTimeout;
  if (originalStale === undefined) delete process.env.IMAGEFORGE_CACHE_LOCK_STALE_MS;
  else process.env.IMAGEFORGE_CACHE_LOCK_STALE_MS = originalStale;
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-cache-lock-"));
  workspaces.push(directory);
  return directory;
}

function cacheEntry(current: boolean): CacheEntry {
  const entry: CacheEntry = {
    hash: "source-hash",
    result: {
      width: 32,
      height: 16,
      aspectRatio: 2,
      blurDataURL: "",
      originalSize: 123,
      outputs: { webp: { path: "hero.webp", size: 45 } },
      hash: "source-hash",
    },
  };
  if (current) {
    entry.outputHashes = { "hero.webp": "a".repeat(64) };
    entry.generator = "imageforge:0.2.0;sharp:0.34.5;vips:8.17.3";
    entry.blurHash = "b".repeat(64);
  }
  return entry;
}

describe("cache lock lifecycle", () => {
  it("creates missing parent directories and releases the exact lock", async () => {
    const lockPath = path.join(workspace(), "nested", ".imageforge-cache.lock");
    const fd = await acquireCacheLock(lockPath);

    expect(fs.readFileSync(lockPath, "utf8").split("\n")[0]).toBe(process.pid.toString());
    releaseCacheLock(fd, lockPath, null);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("reclaims a stale lock whose recorded owner is not alive", async () => {
    const lockPath = path.join(workspace(), ".imageforge-cache.lock");
    fs.writeFileSync(lockPath, "2147483647\nold\n");
    fs.utimesSync(lockPath, new Date(0), new Date(0));
    process.env.IMAGEFORGE_CACHE_LOCK_STALE_MS = "0";
    process.env.IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS = "100";

    const fd = await acquireCacheLock(lockPath);
    expect(fs.readFileSync(lockPath, "utf8").split("\n")[0]).toBe(process.pid.toString());
    releaseCacheLock(fd, lockPath, null);
  });

  it("times out instead of stealing a fresh lock", async () => {
    const lockPath = path.join(workspace(), ".imageforge-cache.lock");
    fs.writeFileSync(lockPath, `${process.pid.toString()}\ncurrent\n`);
    process.env.IMAGEFORGE_CACHE_LOCK_STALE_MS = "60000";
    process.env.IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS = "0";

    await expect(acquireCacheLock(lockPath)).rejects.toThrow(
      `Timed out waiting for cache lock: ${lockPath}`
    );
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("does not steal a stale-threshold lock held by the current process", async () => {
    const lockPath = path.join(workspace(), ".imageforge-cache.lock");
    process.env.IMAGEFORGE_CACHE_LOCK_STALE_MS = "0";
    process.env.IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS = "0";
    const firstFd = await acquireCacheLock(lockPath);

    try {
      await expect(acquireCacheLock(lockPath)).rejects.toThrow(
        `Timed out waiting for cache lock: ${lockPath}`
      );
      expect(fs.existsSync(lockPath)).toBe(true);
    } finally {
      releaseCacheLock(firstFd, lockPath, null);
    }
  });

  it("does not remove a replacement lock when an old descriptor is released", async () => {
    const lockPath = path.join(workspace(), ".imageforge-cache.lock");
    const oldFd = await acquireCacheLock(lockPath);
    fs.rmSync(lockPath);
    fs.writeFileSync(lockPath, "999999\nreplacement-token\nreplacement\n");

    releaseCacheLock(oldFd, lockPath, null);

    expect(fs.readFileSync(lockPath, "utf8")).toBe("999999\nreplacement-token\nreplacement\n");
  });

  it("does not remove a replacement lock after the original lock write fails", async () => {
    const lockPath = path.join(workspace(), ".imageforge-cache.lock");
    const replacement = "999999\nreplacement-token\nreplacement\n";
    const writeFileSync = fs.writeFileSync;
    fs.writeFileSync = (target, data, options) => {
      if (typeof target === "number") {
        fs.rmSync(lockPath);
        writeFileSync(lockPath, replacement);
        throw Object.assign(new Error("injected lock write failure"), { code: "EIO" });
      }
      writeFileSync(target, data, options);
    };
    syncBuiltinESMExports();

    try {
      await expect(acquireCacheLock(lockPath)).rejects.toThrow("injected lock write failure");
      expect(fs.readFileSync(lockPath, "utf8")).toBe(replacement);
    } finally {
      fs.writeFileSync = writeFileSync;
      syncBuiltinESMExports();
    }
  });

  it("uses safe duration fallbacks for malformed and negative environment values", async () => {
    const lockPath = path.join(workspace(), ".imageforge-cache.lock");
    process.env.IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS = "not-a-duration";
    process.env.IMAGEFORGE_CACHE_LOCK_STALE_MS = "-1";

    const fd = await acquireCacheLock(lockPath);
    releaseCacheLock(fd, lockPath, null);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("atomic cache serialization", () => {
  it("writes schema v2 only when every retained entry is current", () => {
    const directory = workspace();
    const currentPath = path.join(directory, "current.json");
    const mixedPath = path.join(directory, "mixed.json");

    saveCacheAtomic(currentPath, new Map([["hero.jpg", cacheEntry(true)]]));
    expect(JSON.parse(fs.readFileSync(currentPath, "utf8"))).toMatchObject({ version: 2 });

    saveCacheAtomic(
      mixedPath,
      new Map([
        ["hero.jpg", cacheEntry(true)],
        ["legacy.jpg", cacheEntry(false)],
      ])
    );
    expect(JSON.parse(fs.readFileSync(mixedPath, "utf8"))).toMatchObject({ version: 1 });
  });

  it("atomically replaces existing cache content without leaving temporary files", () => {
    const directory = workspace();
    const target = path.join(directory, ".imageforge-cache.json");
    fs.writeFileSync(target, "old");

    saveCacheAtomic(target, new Map([["hero.jpg", cacheEntry(true)]]));

    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toMatchObject({
      version: 2,
      entries: { "hero.jpg": { hash: "source-hash" } },
    });
    expect(fs.readdirSync(directory)).toEqual([".imageforge-cache.json"]);
  });
});
