import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { loadCacheState } from "../src/runner/cache.js";

const workspaces: string[] = [];

interface MutableCacheFixture {
  result: {
    width: unknown;
    height: unknown;
    aspectRatio: unknown;
    blurDataURL: unknown;
    originalSize: unknown;
    outputs: Record<string, { path: unknown; size: unknown }>;
    variants: Record<string, { width: unknown; height: unknown; path: unknown; size: unknown }[]>;
    hash: unknown;
  };
  outputHashes: Record<string, unknown>;
  generator: unknown;
  blurHash: unknown;
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function cachePath(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-cache-load-"));
  workspaces.push(workspace);
  return path.join(workspace, ".imageforge-cache.json");
}

describe("cache load state", () => {
  it("distinguishes a missing cache from valid empty current and legacy caches", () => {
    const target = cachePath();
    expect(loadCacheState(target)).toEqual({
      entries: new Map(),
      status: "missing",
      schemaVersion: null,
    });

    fs.writeFileSync(target, JSON.stringify({ version: 2, entries: {} }));
    expect(loadCacheState(target)).toEqual({
      entries: new Map(),
      status: "valid",
      schemaVersion: 2,
    });

    fs.writeFileSync(target, JSON.stringify({}));
    expect(loadCacheState(target)).toEqual({
      entries: new Map(),
      status: "valid",
      schemaVersion: 1,
    });
  });

  it("loads a complete current cache entry without changing its key or value", () => {
    const target = cachePath();
    const entry = {
      hash: "source-and-options-hash",
      result: {
        width: 32,
        height: 16,
        aspectRatio: 2,
        blurDataURL: "data:image/png;base64,AA==",
        originalSize: 123,
        outputs: { webp: { path: "hero.webp", size: 45 } },
        hash: "source-and-options-hash",
      },
    };
    const currentEntry = {
      ...entry,
      outputHashes: { "hero.webp": "a".repeat(64) },
      generator: "imageforge:0.2.0;sharp:0.34.5;vips:8.17.3",
      blurHash: "b".repeat(64),
    };
    fs.writeFileSync(target, JSON.stringify({ version: 2, entries: { "hero.jpg": currentEntry } }));

    const result = loadCacheState(target);
    expect(result.status).toBe("valid");
    expect(result.schemaVersion).toBe(2);
    expect(result.entries).toEqual(new Map([["hero.jpg", currentEntry]]));
  });

  it("reads v1 as migration input but requires digests in v2", () => {
    const target = cachePath();
    const entry = {
      hash: "source-and-options-hash",
      result: {
        width: 32,
        height: 16,
        aspectRatio: 2,
        blurDataURL: "",
        originalSize: 123,
        outputs: { webp: { path: "hero.webp", size: 45 } },
        hash: "source-and-options-hash",
      },
    };

    fs.writeFileSync(target, JSON.stringify({ version: 1, entries: { "hero.jpg": entry } }));
    expect(loadCacheState(target)).toEqual({
      status: "valid",
      schemaVersion: 1,
      entries: new Map([["hero.jpg", entry]]),
    });

    fs.writeFileSync(target, JSON.stringify({ version: 2, entries: { "hero.jpg": entry } }));
    expect(loadCacheState(target).status).toBe("invalid");
  });

  it("rejects a cache entry whose outer and manifest hashes disagree", () => {
    const target = cachePath();
    fs.writeFileSync(
      target,
      JSON.stringify({
        version: 2,
        entries: {
          "hero.jpg": {
            hash: "current-source-hash",
            outputHashes: { "hero.webp": "a".repeat(64) },
            generator: "imageforge:0.2.0;sharp:0.34.5;vips:8.17.3",
            blurHash: "b".repeat(64),
            result: {
              width: 32,
              height: 16,
              aspectRatio: 2,
              blurDataURL: "",
              originalSize: 123,
              outputs: { webp: { path: "hero.webp", size: 45 } },
              hash: "forged-result-hash",
            },
          },
        },
      })
    );

    expect(loadCacheState(target).status).toBe("invalid");
  });

  it("rejects an array root instead of treating it as an empty legacy cache", () => {
    const target = cachePath();
    fs.writeFileSync(target, "[]");
    expect(loadCacheState(target).status).toBe("invalid");
  });

  it.each([
    ["manifest width", (entry: MutableCacheFixture) => (entry.result.width = "32")],
    ["manifest height", (entry: MutableCacheFixture) => (entry.result.height = Number.NaN)],
    [
      "manifest aspect ratio",
      (entry: MutableCacheFixture) => (entry.result.aspectRatio = Number.POSITIVE_INFINITY),
    ],
    [
      "manifest blur placeholder",
      (entry: MutableCacheFixture) => (entry.result.blurDataURL = null),
    ],
    ["manifest original size", (entry: MutableCacheFixture) => (entry.result.originalSize = "123")],
    ["manifest hash", (entry: MutableCacheFixture) => (entry.result.hash = 123)],
    [
      "outputs record",
      (entry: MutableCacheFixture) =>
        (entry.result.outputs = [] as unknown as MutableCacheFixture["result"]["outputs"]),
    ],
    ["output path", (entry: MutableCacheFixture) => (entry.result.outputs.webp.path = 42)],
    ["output size", (entry: MutableCacheFixture) => (entry.result.outputs.webp.size = Number.NaN)],
    [
      "variants record",
      (entry: MutableCacheFixture) =>
        (entry.result.variants = [] as unknown as MutableCacheFixture["result"]["variants"]),
    ],
    [
      "variant list",
      (entry: MutableCacheFixture) =>
        (entry.result.variants.webp =
          {} as unknown as MutableCacheFixture["result"]["variants"]["webp"]),
    ],
    ["variant width", (entry: MutableCacheFixture) => (entry.result.variants.webp[0].width = "16")],
    [
      "variant height",
      (entry: MutableCacheFixture) => (entry.result.variants.webp[0].height = Number.NaN),
    ],
    ["variant path", (entry: MutableCacheFixture) => (entry.result.variants.webp[0].path = false)],
    [
      "variant size",
      (entry: MutableCacheFixture) => (entry.result.variants.webp[0].size = Number.NaN),
    ],
    [
      "output digests record",
      (entry: MutableCacheFixture) =>
        (entry.outputHashes = [] as unknown as MutableCacheFixture["outputHashes"]),
    ],
    [
      "output digest",
      (entry: MutableCacheFixture) => (entry.outputHashes["hero.webp"] = "not-a-digest"),
    ],
    ["generator", (entry: MutableCacheFixture) => (entry.generator = 123)],
    ["blur digest", (entry: MutableCacheFixture) => (entry.blurHash = "A".repeat(64))],
  ])("rejects an invalid %s field", (_field, mutate) => {
    const target = cachePath();
    const entry: MutableCacheFixture & { hash: string } = {
      hash: "source-and-options-hash",
      result: {
        width: 32,
        height: 16,
        aspectRatio: 2,
        blurDataURL: "",
        originalSize: 123,
        outputs: { webp: { path: "hero.webp", size: 45 } },
        variants: {
          webp: [{ width: 16, height: 8, path: "hero.w16.webp", size: 20 }],
        },
        hash: "source-and-options-hash",
      },
      outputHashes: {
        "hero.webp": "a".repeat(64),
        "hero.w16.webp": "b".repeat(64),
      },
      generator: "imageforge:0.2.0;sharp:0.34.5;vips:8.17.3",
      blurHash: "c".repeat(64),
    };
    mutate(entry);
    fs.writeFileSync(target, JSON.stringify({ version: 2, entries: { "hero.jpg": entry } }));

    expect(loadCacheState(target)).toEqual({
      entries: new Map(),
      status: "invalid",
      schemaVersion: null,
    });
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["missing version", JSON.stringify({ entries: {} })],
    ["unsupported version", JSON.stringify({ version: 3, entries: {} })],
    ["unexpected root field", JSON.stringify({ version: 2, entries: {}, extra: true })],
    ["invalid entries", JSON.stringify({ version: 2, entries: [] })],
    ["invalid entry", JSON.stringify({ version: 2, entries: { "hero.jpg": {} } })],
  ])("classifies %s as invalid", (_case, content) => {
    const target = cachePath();
    fs.writeFileSync(target, content);
    expect(loadCacheState(target)).toEqual({
      entries: new Map(),
      status: "invalid",
      schemaVersion: null,
    });
  });
});
