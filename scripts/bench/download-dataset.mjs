#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolvePath, sha256File, writeJson } from "./common.mjs";

function usage() {
  console.log(`Usage: node scripts/bench/download-dataset.mjs \
  --dataset-version <x.y.z> \
  --tier <tier30|tier200|tier500> \
  --out-dir <path> \
  [--repo <owner/repo>] \
  [--allow-missing]`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
}

function findTier(manifest, tierId) {
  if (!Array.isArray(manifest.tiers)) {
    throw new Error("dataset manifest tiers must be an array.");
  }

  const tier = manifest.tiers.find((entry) => entry.id === tierId);
  if (!tier) {
    throw new Error(`Tier not found in manifest: ${tierId}`);
  }
  return tier;
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const datasetVersion = typeof args["dataset-version"] === "string" ? args["dataset-version"] : "";
  const tierId = typeof args.tier === "string" ? args.tier : "";
  const outDir = typeof args["out-dir"] === "string" ? resolvePath(args["out-dir"]) : "";
  const repo = typeof args.repo === "string" ? args.repo : "f-campana/imageforge";
  const allowMissing = Boolean(args["allow-missing"]);

  if (!datasetVersion || !tierId || !outDir) {
    usage();
    throw new Error("--dataset-version, --tier, and --out-dir are required.");
  }

  const tag = `bench-dataset-v${datasetVersion}`;
  const releaseBase = `https://github.com/${repo}/releases/download/${tag}`;
  const manifestName = `benchmark-dataset-manifest-v${datasetVersion}.json`;
  const manifestUrl = `${releaseBase}/${manifestName}`;

  let manifest;
  try {
    manifest = await fetchJson(manifestUrl);
  } catch (error) {
    if (allowMissing) {
      console.error(
        `dataset-manifest-missing: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const tier = findTier(manifest, tierId);
  if (typeof tier.archiveName !== "string" || tier.archiveName.length === 0) {
    throw new Error(`Tier ${tierId} archiveName missing in manifest.`);
  }
  if (typeof tier.sha256 !== "string" || tier.sha256.length === 0) {
    throw new Error(`Tier ${tierId} sha256 missing in manifest.`);
  }

  const downloadsDir = path.join(outDir, "downloads");
  const extractDir = path.join(outDir, "extracted");
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });

  const archivePath = path.join(downloadsDir, tier.archiveName);
  const archiveUrl = `${releaseBase}/${tier.archiveName}`;
  await download(archiveUrl, archivePath);

  const actualSha = sha256File(archivePath);
  if (actualSha !== tier.sha256) {
    throw new Error(
      `Checksum mismatch for ${tier.archiveName}: expected ${tier.sha256}, got ${actualSha}`
    );
  }

  const tarResult = await import("node:child_process").then(({ spawnSync }) =>
    spawnSync("tar", ["--zstd", "-xf", archivePath, "-C", extractDir], {
      encoding: "utf-8",
    })
  );

  if (tarResult.error) {
    throw tarResult.error;
  }
  if ((tarResult.status ?? 1) !== 0) {
    throw new Error(`tar extraction failed: ${tarResult.stderr ?? "unknown error"}`);
  }

  const tierRoot = path.join(extractDir, tier.id);
  const tierManifestPath = path.join(tierRoot, "tier-manifest.json");
  if (!fs.existsSync(tierManifestPath)) {
    throw new Error(`Tier manifest not found after extraction: ${tierManifestPath}`);
  }

  const resolved = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    datasetVersion,
    tierId,
    repo,
    tag,
    manifestUrl,
    archiveUrl,
    archivePath,
    tierRoot,
    tierManifestPath,
    checksum: {
      expected: tier.sha256,
      actual: actualSha,
    },
  };

  const metadataPath = path.join(outDir, "resolved-dataset.json");
  writeJson(metadataPath, resolved);

  console.log(JSON.stringify(resolved, null, 2));
  console.log(`DATASET_TIER_ROOT=${tierRoot}`);
  console.log(`DATASET_TIER_MANIFEST=${tierManifestPath}`);
  console.log(`DATASET_RESOLVED_JSON=${metadataPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
