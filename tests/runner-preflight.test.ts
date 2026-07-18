import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import type { CacheEntry } from "../src/runner/cache.js";
import { preflightCollisions, sanitizeForTerminal } from "../src/runner/preflight.js";
import type { PreflightItem } from "../src/runner/preflight.js";
import type { ProcessOptions } from "../src/processor.js";

const roots: string[] = [];
const options: ProcessOptions = {
  formats: ["webp"],
  quality: 80,
  blur: false,
  blurSize: 4,
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(name = "hero.jpg"): Promise<{
  root: string;
  inputDir: string;
  outputDir: string;
  item: PreflightItem;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-preflight-"));
  roots.push(root);
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  fs.mkdirSync(inputDir);
  fs.mkdirSync(outputDir);
  const imagePath = path.join(inputDir, name);
  await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } })
    .jpeg()
    .toFile(imagePath);
  return { root, inputDir, outputDir, item: { imagePath, relativePath: name } };
}

function cacheEntry(source: string, outputPath: string): CacheEntry {
  return {
    hash: "hash",
    result: {
      width: 40,
      height: 20,
      aspectRatio: 2,
      blurDataURL: "",
      originalSize: 1,
      hash: "hash",
      outputs: { webp: { path: outputPath, size: 1 } },
    },
  };
}

describe("preflight contracts", () => {
  it("escapes terminal control characters without altering printable Unicode", () => {
    expect(sanitizeForTerminal("hé\n\r\t\u0000\u007f")).toBe("hé\\n\\r\\t\\x00\\x7f");
  });

  it("detects case-insensitive planned output collisions", async () => {
    const first = await fixture("Hero.jpg");
    const secondPath = path.join(first.inputDir, "hero.png");
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "blue" } })
      .png()
      .toFile(secondPath);

    const issue = await preflightCollisions(
      [first.item, { imagePath: secondPath, relativePath: "hero.png" }],
      options,
      first.inputDir,
      first.outputDir,
      new Map(),
      true,
      false
    );
    expect(issue?.message).toBe("Output collision detected:");
    expect(issue?.details.join("\n")).toContain("Hero.jpg");
    expect(issue?.details.join("\n")).toContain("hero.png");
  });

  it("reports unreadable responsive sources during width planning", async () => {
    const { inputDir, outputDir, item } = await fixture();
    fs.writeFileSync(item.imagePath, "not-an-image");
    const issue = await preflightCollisions(
      [item],
      { ...options, widths: [20] },
      inputDir,
      outputDir,
      new Map(),
      true,
      false
    );
    expect(issue?.message).toBe("Failed preflight width planning:");
    expect(issue?.details.at(-1)).toContain("Fix:");
  });

  it("distinguishes no-cache, unowned, differently owned, and owned outputs", async () => {
    const { inputDir, outputDir, item } = await fixture();
    const relativeOutput = path.posix.join("..", "output", "hero.webp");
    fs.writeFileSync(path.join(outputDir, "hero.webp"), "x");

    const noCache = await preflightCollisions(
      [item],
      options,
      inputDir,
      outputDir,
      new Map(),
      false,
      false
    );
    expect(noCache?.message).toContain("--no-cache");

    const unowned = await preflightCollisions(
      [item],
      options,
      inputDir,
      outputDir,
      new Map(),
      true,
      false
    );
    expect(unowned?.message).toContain("not cache-owned");

    const otherCache = new Map([["other.jpg", cacheEntry("other.jpg", relativeOutput)]]);
    const differentlyOwned = await preflightCollisions(
      [item],
      options,
      inputDir,
      outputDir,
      otherCache,
      true,
      false
    );
    expect(differentlyOwned?.message).toContain("different cached source");

    const ownedCache = new Map([["hero.jpg", cacheEntry("hero.jpg", relativeOutput)]]);
    await expect(
      preflightCollisions([item], options, inputDir, outputDir, ownedCache, true, false)
    ).resolves.toBeNull();
  });

  it("allows explicit force overwrite without requiring cache ownership", async () => {
    const { inputDir, outputDir, item } = await fixture();
    fs.writeFileSync(path.join(outputDir, "hero.webp"), "x");
    await expect(
      preflightCollisions([item], options, inputDir, outputDir, new Map(), false, true)
    ).resolves.toBeNull();
  });
});
