#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parseArgs, resolvePath, round, writeJson } from "./common.mjs";

function usage() {
  console.log(
    "Usage: node scripts/bench/generate-synthetic.mjs [--out-dir <path>] [--count <n>] [--seed <n>] [--concurrency <n>]"
  );
}

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pickWeighted(rand, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const value = rand() * total;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (value <= cumulative) {
      return entry.value;
    }
  }
  return entries[entries.length - 1].value;
}

function pickDimensions(rand) {
  const bucket = pickWeighted(rand, [
    { value: "small", weight: 20 },
    { value: "medium", weight: 50 },
    { value: "large", weight: 25 },
    { value: "very-large", weight: 5 },
  ]);

  const options = {
    small: [
      [640, 480],
      [800, 600],
      [1024, 768],
    ],
    medium: [
      [1280, 720],
      [1600, 900],
      [1920, 1080],
      [2048, 1365],
    ],
    large: [
      [2560, 1440],
      [3000, 2000],
      [3200, 2400],
      [4000, 2667],
    ],
    "very-large": [
      [4096, 3072],
      [5000, 3333],
      [5400, 3600],
    ],
  };

  const picks = options[bucket];
  const chosen = picks[Math.floor(rand() * picks.length)] ?? picks[0];
  return { bucket, width: chosen[0], height: chosen[1] };
}

function pickFormat(rand) {
  return pickWeighted(rand, [
    { value: "jpg", weight: 65 },
    { value: "png", weight: 25 },
    { value: "gif", weight: 5 },
    { value: "tiff", weight: 5 },
  ]);
}

async function writeSyntheticImage(filePath, format, width, height, color, alphaMode, orientation) {
  const channels = format === "png" && alphaMode ? 4 : 3;
  const background =
    channels === 4 ? { r: color.r, g: color.g, b: color.b, alpha: alphaMode } : color;

  let pipeline = sharp({
    create: {
      width,
      height,
      channels,
      background,
    },
  });

  if (format === "jpg") {
    pipeline = pipeline.jpeg({ quality: 85, chromaSubsampling: "4:4:4" });
    if (orientation) {
      pipeline = pipeline.withMetadata({ orientation });
    }
  } else if (format === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else if (format === "gif") {
    pipeline = pipeline.gif();
  } else {
    pipeline = pipeline.tiff({ quality: 80 });
  }

  await pipeline.toFile(filePath);
}

async function runWithConcurrency(items, concurrency, worker) {
  let index = 0;
  const slots = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
    for (;;) {
      const nextIndex = index;
      index += 1;
      if (nextIndex >= items.length) {
        return;
      }
      await worker(items[nextIndex], nextIndex);
    }
  });

  await Promise.all(slots);
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const outDir = resolvePath(
    typeof args["out-dir"] === "string" ? args["out-dir"] : path.join(".tmp", "bench", "synthetic")
  );
  const count = Number.parseInt(String(args.count ?? "800"), 10);
  const seed = Number.parseInt(String(args.seed ?? "20260215"), 10);
  const concurrency = Number.parseInt(String(args.concurrency ?? "8"), 10);

  if (!Number.isInteger(count) || count < 1) {
    throw new Error("--count must be an integer >= 1.");
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const rand = createPrng(seed);
  const specs = [];

  for (let idx = 0; idx < count; idx += 1) {
    const format = pickFormat(rand);
    const { bucket, width, height } = pickDimensions(rand);
    const orientation = format === "jpg" && idx % 37 === 0 ? 6 : null;

    specs.push({
      id: idx + 1,
      format,
      bucket,
      width,
      height,
      color: {
        r: Math.floor(rand() * 255),
        g: Math.floor(rand() * 255),
        b: Math.floor(rand() * 255),
      },
      alphaMode: format === "png" && idx % 2 === 0 ? round(0.2 + rand() * 0.7, 2) : null,
      orientation,
    });
  }

  await runWithConcurrency(specs, concurrency, async (spec) => {
    const extension = spec.format === "jpg" ? "jpg" : spec.format;
    const bucketDir = path.join(outDir, spec.bucket);
    fs.mkdirSync(bucketDir, { recursive: true });
    const fileName = `synthetic-${spec.id.toString().padStart(4, "0")}.${extension}`;
    const targetPath = path.join(bucketDir, fileName);

    await writeSyntheticImage(
      targetPath,
      spec.format,
      spec.width,
      spec.height,
      spec.color,
      spec.alphaMode,
      spec.orientation
    );

    spec.file = path.relative(outDir, targetPath).split(path.sep).join("/");
    const stats = fs.statSync(targetPath);
    spec.sizeBytes = stats.size;
  });

  const formatBreakdown = specs.reduce((acc, spec) => {
    acc[spec.format] = (acc[spec.format] ?? 0) + 1;
    return acc;
  }, {});

  const manifest = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    seed,
    count,
    outDir,
    formatBreakdown,
    files: specs.map((spec) => ({
      file: spec.file,
      format: spec.format,
      width: spec.width,
      height: spec.height,
      sizeBytes: spec.sizeBytes,
      bucket: spec.bucket,
      orientation: spec.orientation,
      hasAlpha: Boolean(spec.alphaMode),
    })),
  };

  const manifestPath = path.join(outDir, "synthetic-manifest.json");
  writeJson(manifestPath, manifest);
  console.log(JSON.stringify({ outDir, manifestPath, count, formatBreakdown }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
