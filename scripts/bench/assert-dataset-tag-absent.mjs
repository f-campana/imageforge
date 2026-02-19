#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { parseArgs } from "./common.mjs";

function usage() {
  console.log(`Usage: node scripts/bench/assert-dataset-tag-absent.mjs \
  --repo <owner/repo> \
  --dataset-version <x.y.z>`);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeSemver(value) {
  return /^\d+\.\d+\.\d+$/u.test(value);
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const repo = isNonEmptyString(args.repo) ? args.repo.trim() : "f-campana/imageforge";
  const datasetVersion = isNonEmptyString(args["dataset-version"])
    ? args["dataset-version"].trim()
    : "";
  if (!datasetVersion) {
    usage();
    throw new Error("--dataset-version is required.");
  }
  if (!looksLikeSemver(datasetVersion)) {
    throw new Error(`Invalid dataset version '${datasetVersion}'. Expected X.Y.Z.`);
  }

  const tag = `bench-dataset-v${datasetVersion}`;
  const check = spawnSync("gh", ["release", "view", tag, "--repo", repo], {
    encoding: "utf-8",
  });
  if (check.error) {
    throw check.error;
  }

  if ((check.status ?? 1) === 0) {
    console.error(`Dataset tag already exists and is immutable: ${tag}`);
    process.exitCode = 1;
    return;
  }

  const output = `${check.stdout ?? ""}\n${check.stderr ?? ""}`;
  if (/(not found|http 404|status code: 404|could not resolve to a release)/iu.test(output)) {
    console.log(`DATASET_TAG_ABSENT=${tag}`);
    console.log(`DATASET_REPO=${repo}`);
    return;
  }

  throw new Error(
    `Unable to verify dataset tag '${tag}' in '${repo}'. gh exited ${(check.status ?? 1).toString()}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
