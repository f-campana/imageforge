#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, resolvePath, sha256File, writeJson } from "./common.mjs";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;

function usage() {
  console.log(
    `Usage: node scripts/bench/fetch-sources.mjs [--sources-file <path>] [--out-dir <path>] [--allow-unpinned-sources] [--allow-partial]`
  );
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function safeSourceId(source, index) {
  if (isNonEmptyString(source?.id)) {
    return source.id.trim();
  }
  return `source-${(index + 1).toString()}`;
}

function validateEnabledSource(source) {
  const errors = [];
  for (const key of ["id", "url", "license", "attribution", "filename"]) {
    if (!isNonEmptyString(source?.[key])) {
      errors.push(`missing-or-empty-${key}`);
    }
  }
  return errors;
}

function normalizeExpectedSha(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const allowUnpinnedSources = Boolean(args["allow-unpinned-sources"]);
  const allowPartial = Boolean(args["allow-partial"]);

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
    version: "1.1",
    generatedAt: new Date().toISOString(),
    sourcesFile,
    outDir,
    options: {
      allowUnpinnedSources,
      allowPartial,
    },
    totalSources: sources.length,
    downloaded: 0,
    skippedDisabled: 0,
    failed: 0,
    integrity: {
      missingHash: 0,
      checksumMismatch: 0,
      downloadFailed: 0,
      schemaInvalid: 0,
    },
    totals: {
      enabled: 0,
      disabled: 0,
      downloaded: 0,
      failed: 0,
      missingHash: 0,
      checksumMismatch: 0,
      downloadFailed: 0,
      schemaInvalid: 0,
    },
    results: [],
  };

  for (const [index, source] of sources.entries()) {
    const sourceId = safeSourceId(source, index);

    if (!source?.enabled) {
      report.skippedDisabled += 1;
      report.totals.disabled += 1;
      report.results.push({
        id: sourceId,
        status: "skipped-disabled",
      });
      continue;
    }

    report.totals.enabled += 1;

    const schemaErrors = validateEnabledSource(source);
    if (schemaErrors.length > 0) {
      report.failed += 1;
      report.integrity.schemaInvalid += 1;
      report.totals.failed += 1;
      report.results.push({
        id: sourceId,
        status: "failed-validation",
        failureCategory: "schema-invalid",
        errors: schemaErrors,
      });
      continue;
    }

    const expectedSha = normalizeExpectedSha(source.sha256);
    const hasExpectedSha = SHA256_HEX_RE.test(expectedSha);
    const missingHash = !hasExpectedSha;

    if (missingHash) {
      report.integrity.missingHash += 1;
      if (!allowUnpinnedSources) {
        report.failed += 1;
        report.totals.failed += 1;
        report.results.push({
          id: sourceId,
          status: "failed-validation",
          failureCategory: "missing-hash",
          errors: ["missing-or-invalid-sha256"],
        });
        continue;
      }
    }

    const filename = source.filename.trim();
    const destination = path.join(outDir, filename);

    try {
      const data = await download(source.url);
      fs.writeFileSync(destination, data);

      const actualSha = sha256File(destination);
      const checksumMatch = hasExpectedSha ? expectedSha === actualSha : null;

      if (hasExpectedSha && !checksumMatch) {
        fs.rmSync(destination, { force: true });
        report.failed += 1;
        report.integrity.checksumMismatch += 1;
        report.totals.failed += 1;
        report.results.push({
          id: sourceId,
          status: "failed-checksum",
          failureCategory: "checksum-mismatch",
          file: destination,
          sizeBytes: data.length,
          checksum: {
            expected: expectedSha,
            actual: actualSha,
            match: false,
          },
        });
        continue;
      }

      report.downloaded += 1;
      report.totals.downloaded += 1;
      report.results.push({
        id: sourceId,
        status: "downloaded",
        file: destination,
        sizeBytes: data.length,
        missingHash,
        checksum: {
          expected: hasExpectedSha ? expectedSha : null,
          actual: actualSha,
          match: checksumMatch,
        },
      });
    } catch (error) {
      report.failed += 1;
      report.integrity.downloadFailed += 1;
      report.totals.failed += 1;
      report.results.push({
        id: sourceId,
        status: "failed-download",
        failureCategory: "download-failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  report.totals.missingHash = report.integrity.missingHash;
  report.totals.checksumMismatch = report.integrity.checksumMismatch;
  report.totals.downloadFailed = report.integrity.downloadFailed;
  report.totals.schemaInvalid = report.integrity.schemaInvalid;
  report.integrityFailureCount =
    report.integrity.missingHash +
    report.integrity.checksumMismatch +
    report.integrity.downloadFailed +
    report.integrity.schemaInvalid;
  report.hasIntegrityFailures = report.integrityFailureCount > 0;

  const reportPath = path.join(outDir, "fetch-report.json");
  writeJson(reportPath, report);

  console.log(JSON.stringify(report, null, 2));
  console.log(`FETCH_REPORT_JSON=${reportPath}`);

  if (report.failed > 0 && !allowPartial) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
