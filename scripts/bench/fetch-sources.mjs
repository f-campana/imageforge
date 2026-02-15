#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, resolvePath, sha256File, writeJson } from "./common.mjs";

function usage() {
  console.log(
    `Usage: node scripts/bench/fetch-sources.mjs [--sources-file <path>] [--out-dir <path>]`
  );
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const sourcesFile = resolvePath(
    typeof args["sources-file"] === "string"
      ? args["sources-file"]
      : path.join("scripts", "bench", "dataset-sources.json")
  );
  const outDir = resolvePath(
    typeof args["out-dir"] === "string" ? args["out-dir"] : path.join(".tmp", "bench", "sources")
  );

  const config = readJson(sourcesFile);
  const sources = Array.isArray(config.sources) ? config.sources : [];
  fs.mkdirSync(outDir, { recursive: true });

  const report = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    sourcesFile,
    outDir,
    totalSources: sources.length,
    downloaded: 0,
    skippedDisabled: 0,
    failed: 0,
    results: [],
  };

  for (const source of sources) {
    if (!source.enabled) {
      report.skippedDisabled += 1;
      report.results.push({
        id: source.id,
        status: "skipped-disabled",
      });
      continue;
    }

    const filename =
      typeof source.filename === "string" && source.filename.length > 0
        ? source.filename
        : `${source.id}.bin`;
    const destination = path.join(outDir, filename);

    try {
      const data = await download(source.url);
      fs.writeFileSync(destination, data);

      const actualSha = sha256File(destination);
      const expectedSha =
        typeof source.sha256 === "string" ? source.sha256.trim().toLowerCase() : "";
      const checksumMatch = expectedSha === "" ? null : expectedSha === actualSha;

      report.downloaded += 1;
      report.results.push({
        id: source.id,
        status: "downloaded",
        file: destination,
        sizeBytes: data.length,
        checksum: {
          expected: expectedSha || null,
          actual: actualSha,
          match: checksumMatch,
        },
      });
    } catch (error) {
      report.failed += 1;
      report.results.push({
        id: source.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const reportPath = path.join(outDir, "fetch-report.json");
  writeJson(reportPath, report);

  console.log(JSON.stringify(report, null, 2));
  console.log(`FETCH_REPORT_JSON=${reportPath}`);

  if (report.failed > 0) {
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
