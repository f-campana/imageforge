#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ensureDir,
  isSupportedImageExtension,
  listFilesRecursive,
  parseArgs,
  resolvePath,
  sha256File,
  toPosix,
  writeJson,
} from "./common.mjs";

const DEFAULT_TIERS = [30, 200, 500];

function usage() {
  console.log(`Usage: node scripts/bench/build-tiers.mjs \
  --dataset-version <x.y.z> \
  [--sources-dir <path>] \
  [--synthetic-dir <path>] \
  [--out-dir <path>] \
  [--build-dir <path>] \
  [--tiers <30,200,500>] \
  [--seed <n>]`);
}

function createStableScore(seed, input) {
  return crypto.createHash("sha256").update(`${seed.toString()}:${input}`).digest("hex");
}

function detectFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "jpg";
  if (ext === ".png") return "png";
  if (ext === ".gif") return "gif";
  return "tiff";
}

function chooseScenarioFiles(filesWithStats) {
  const sorted = [...filesWithStats].sort((a, b) => a.sizeBytes - b.sizeBytes);
  const small = sorted[0];
  const median = sorted[Math.floor(sorted.length / 2)];
  const large = sorted[sorted.length - 1];

  return {
    small: small.relativePath,
    median: median.relativePath,
    large: large.relativePath,
  };
}

function formatBreakdown(files) {
  return files.reduce(
    (acc, entry) => {
      const key = detectFormat(entry.relativePath);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {
      jpg: 0,
      png: 0,
      gif: 0,
      tiff: 0,
    }
  );
}

function parseTierList(value) {
  if (!value) return DEFAULT_TIERS;
  const parsed = value
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  if (parsed.length === 0) {
    throw new Error("--tiers must include at least one positive integer.");
  }

  return [...new Set(parsed)].sort((left, right) => left - right);
}

function copyTierFiles(selectedFiles, destinationImagesDir, roots) {
  const copied = [];

  for (const [index, sourcePath] of selectedFiles.entries()) {
    const sourceLabel = sourcePath.startsWith(roots.sourcesDir) ? "src" : "syn";
    const extension = path.extname(sourcePath).toLowerCase();
    const targetName = `${sourceLabel}-${(index + 1).toString().padStart(4, "0")}${extension}`;
    const targetPath = path.join(destinationImagesDir, targetName);
    fs.copyFileSync(sourcePath, targetPath);

    const stats = fs.statSync(targetPath);
    copied.push({
      sourcePath,
      relativePath: toPosix(path.relative(destinationImagesDir, targetPath)),
      sizeBytes: stats.size,
    });
  }

  return copied;
}

function packTierArchive(buildDir, tierId, outDir, datasetVersion) {
  const archiveName = `imageforge-bench-${tierId}-v${datasetVersion}.tar.zst`;
  const archivePath = path.join(outDir, archiveName);

  const result = spawnSync("tar", ["--zstd", "-cf", archivePath, "-C", buildDir, tierId], {
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Failed to pack ${tierId}: ${result.stderr ?? "unknown error"}`);
  }

  return { archiveName, archivePath, sha256: sha256File(archivePath) };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const datasetVersion = typeof args["dataset-version"] === "string" ? args["dataset-version"] : "";
  if (!datasetVersion) {
    usage();
    throw new Error("--dataset-version is required.");
  }

  const sourcesDir = resolvePath(
    typeof args["sources-dir"] === "string"
      ? args["sources-dir"]
      : path.join(".tmp", "bench", "sources")
  );
  const syntheticDir = resolvePath(
    typeof args["synthetic-dir"] === "string"
      ? args["synthetic-dir"]
      : path.join(".tmp", "bench", "synthetic")
  );
  const outDir = resolvePath(
    typeof args["out-dir"] === "string"
      ? args["out-dir"]
      : path.join(".tmp", "bench", "release-assets", `v${datasetVersion}`)
  );
  const buildRoot = resolvePath(
    typeof args["build-dir"] === "string" ? args["build-dir"] : path.join(".tmp", "bench", "build")
  );
  const buildDir = path.join(buildRoot, `v${datasetVersion}`);

  const seed = Number.parseInt(String(args.seed ?? "20260215"), 10);
  const tiers = parseTierList(typeof args.tiers === "string" ? args.tiers : undefined);

  ensureDir(outDir);
  fs.rmSync(buildDir, { recursive: true, force: true });
  ensureDir(buildDir);

  const sourceFiles = [
    ...listFilesRecursive(sourcesDir, isSupportedImageExtension),
    ...listFilesRecursive(syntheticDir, isSupportedImageExtension),
  ];

  if (sourceFiles.length === 0) {
    throw new Error(
      "No source images available. Run fetch-sources and/or generate-synthetic first."
    );
  }

  const ranked = sourceFiles
    .map((filePath) => ({ filePath, score: createStableScore(seed, filePath) }))
    .sort((left, right) => left.score.localeCompare(right.score));
  const orderedFiles = ranked.map((entry) => entry.filePath);

  const maxTier = Math.max(...tiers);
  if (orderedFiles.length < maxTier) {
    throw new Error(
      `Insufficient source files (${orderedFiles.length.toString()}) for max tier (${maxTier.toString()}).`
    );
  }

  const tierEntries = [];
  const checksums = [];

  for (const tierSize of tiers) {
    const tierId = `tier${tierSize.toString()}`;
    const tierRoot = path.join(buildDir, tierId);
    const tierImagesDir = path.join(tierRoot, "images");
    ensureDir(tierImagesDir);

    const selected = orderedFiles.slice(0, tierSize);
    const copied = copyTierFiles(selected, tierImagesDir, { sourcesDir, syntheticDir });
    const singleScenarios = chooseScenarioFiles(copied);
    const breakdown = formatBreakdown(copied);

    const tierManifest = {
      version: "1.0",
      datasetVersion,
      tierId,
      createdAt: new Date().toISOString(),
      imageRoot: "images",
      files: copied.map((entry) => entry.relativePath),
      singleScenarios,
      formatBreakdown: breakdown,
      metadata: {
        sourceCount: sourceFiles.length,
        seed,
      },
    };

    const tierManifestPath = path.join(tierRoot, "tier-manifest.json");
    writeJson(tierManifestPath, tierManifest);

    const archive = packTierArchive(buildDir, tierId, outDir, datasetVersion);
    checksums.push(`${archive.sha256}  ${archive.archiveName}`);

    tierEntries.push({
      id: tierId,
      imageCount: tierSize,
      archiveName: archive.archiveName,
      sha256: archive.sha256,
      tierManifestPath: `${tierId}/tier-manifest.json`,
      formatBreakdown: breakdown,
      singleScenarios,
    });
  }

  const manifest = {
    version: "1.0",
    datasetVersion,
    generatedAt: new Date().toISOString(),
    sourcePolicy: "open-license-plus-synthetic",
    retentionPolicy: "keep-all-released-versions",
    tiers: tierEntries,
  };

  const manifestName = `benchmark-dataset-manifest-v${datasetVersion}.json`;
  const manifestPath = path.join(outDir, manifestName);
  writeJson(manifestPath, manifest);

  const manifestSha = sha256File(manifestPath);
  checksums.push(`${manifestSha}  ${manifestName}`);

  const checksumName = `sha256sums-v${datasetVersion}.txt`;
  const checksumsPath = path.join(outDir, checksumName);
  fs.writeFileSync(checksumsPath, `${checksums.join("\n")}\n`, "utf-8");

  const summary = {
    version: "1.0",
    datasetVersion,
    generatedAt: new Date().toISOString(),
    outDir,
    buildRoot,
    buildDir,
    tiers: tierEntries.map((entry) => ({
      id: entry.id,
      imageCount: entry.imageCount,
      archiveName: entry.archiveName,
      formatBreakdown: entry.formatBreakdown,
      smallCandidate: entry.singleScenarios.small,
      medianCandidate: entry.singleScenarios.median,
      largeCandidate: entry.singleScenarios.large,
    })),
    manifestName,
    checksumName,
    sourcePoolSize: sourceFiles.length,
  };

  const summaryPath = path.join(outDir, `build-summary-v${datasetVersion}.json`);
  writeJson(summaryPath, summary);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`DATASET_MANIFEST=${manifestPath}`);
  console.log(`DATASET_CHECKSUMS=${checksumsPath}`);
  console.log(`DATASET_SUMMARY=${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
