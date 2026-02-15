#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ensureDir,
  formatIsoNow,
  mean,
  parseArgs,
  percentile,
  readJson,
  resolvePath,
  round,
  stddev,
  writeJson,
} from "./common.mjs";
import {
  assertValid,
  validateRawRunRecord,
  validateSummary,
  validateTierManifest,
} from "./contracts.mjs";

const PROFILE_MAP = {
  P1: {
    id: "P1",
    formats: "webp",
    quality: 80,
    blur: true,
    widths: null,
    description: "webp + blur + q80",
  },
  P2: {
    id: "P2",
    formats: "webp,avif",
    quality: 80,
    blur: true,
    widths: null,
    description: "webp,avif + blur + q80",
  },
  P3: {
    id: "P3",
    formats: "webp,avif",
    quality: 80,
    blur: true,
    widths: "320,640,960,1280",
    description: "webp,avif + blur + q80 + responsive widths",
  },
};

function usage() {
  console.log(`Usage: node scripts/bench/run-benchmark.mjs \
  --cli-path <path> \
  --tier-manifest <path> \
  --workspace <path> \
  [--run-count <n>] \
  [--profiles <P1,P2,P3>]`);
}

function profileIdsFromArg(value) {
  if (!value) return ["P1", "P2", "P3"];
  const ids = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  const unique = [...new Set(ids)];
  for (const id of unique) {
    if (!PROFILE_MAP[id]) {
      throw new Error(`Unknown profile id: ${id}`);
    }
  }

  return unique;
}

function assertCondition(condition, failures, message, context) {
  if (!condition) {
    failures.push({ message, context });
  }
}

function buildScenarios(tierManifestPath, tierManifest, workspace) {
  const tierDir = path.dirname(tierManifestPath);
  const imageRoot = path.resolve(tierDir, tierManifest.imageRoot);
  const scenarioInputs = path.join(workspace, "scenario-inputs");
  ensureDir(scenarioInputs);

  const singles = {
    "single-small": tierManifest.singleScenarios.small,
    "single-median": tierManifest.singleScenarios.median,
    "single-large": tierManifest.singleScenarios.large,
  };

  const scenarios = [];

  for (const [scenarioName, relativeFile] of Object.entries(singles)) {
    const sourcePath = path.resolve(imageRoot, relativeFile);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Single scenario source not found: ${sourcePath}`);
    }

    const scenarioInputDir = path.join(scenarioInputs, scenarioName);
    fs.rmSync(scenarioInputDir, { recursive: true, force: true });
    ensureDir(scenarioInputDir);
    const destination = path.join(scenarioInputDir, path.basename(relativeFile));
    fs.copyFileSync(sourcePath, destination);

    scenarios.push({
      name: scenarioName,
      inputDir: scenarioInputDir,
      expectedTotal: 1,
    });
  }

  scenarios.push({
    name: "batch-all",
    inputDir: imageRoot,
    expectedTotal: tierManifest.files.length,
  });

  return scenarios;
}

function summarizeProfileScenario(records, expectedTotal) {
  const cold = records.find((entry) => entry.phase === "cold");
  const warm = records.filter((entry) => entry.phase === "warm");

  const warmWallValues = warm.map((entry) => entry.wallMs);
  const warmReportValues = warm.map((entry) => entry.reportDurationMs);

  const coldWall = cold ? cold.wallMs : 0;
  const coldReport = cold ? cold.reportDurationMs : 0;
  const warmWallMean = mean(warmWallValues);
  const warmReportMean = mean(warmReportValues);

  return {
    runCount: records.length,
    imageCount: expectedTotal,
    cold: {
      wallMs: round(coldWall),
      reportDurationMs: round(coldReport),
      total: cold?.total ?? 0,
      processed: cold?.processed ?? 0,
      cached: cold?.cached ?? 0,
      failed: cold?.failed ?? 0,
      errorsLength: cold?.errorsLength ?? 0,
      imagesPerSec: round(coldWall > 0 ? (expectedTotal * 1000) / coldWall : 0),
      perImageMs: round(expectedTotal > 0 ? coldWall / expectedTotal : 0),
    },
    warm: {
      count: warm.length,
      wallMs: {
        mean: round(warmWallMean),
        p50: round(percentile(warmWallValues, 50)),
        p95: round(percentile(warmWallValues, 95)),
        stddev: round(stddev(warmWallValues)),
      },
      reportDurationMs: {
        mean: round(warmReportMean),
        p50: round(percentile(warmReportValues, 50)),
        p95: round(percentile(warmReportValues, 95)),
        stddev: round(stddev(warmReportValues)),
      },
      imagesPerSecMean: round(warmWallMean > 0 ? (expectedTotal * 1000) / warmWallMean : 0),
      perImageMsMean: round(expectedTotal > 0 ? warmWallMean / expectedTotal : 0),
    },
    speedup: {
      coldVsWarmWallMean: round(warmWallMean > 0 ? coldWall / warmWallMean : 0),
      coldVsWarmReportMean: round(warmReportMean > 0 ? coldReport / warmReportMean : 0),
    },
    validation: {
      passed: records.every(
        (entry) =>
          entry.exitCode === 0 &&
          entry.failed === 0 &&
          entry.errorsLength === 0 &&
          entry.total === expectedTotal &&
          (entry.phase === "cold"
            ? entry.processed === entry.total && entry.cached === 0
            : entry.cached === entry.total && entry.processed === 0)
      ),
    },
  };
}

function runOneIteration({ cliPath, inputDir, outDir, manifestPath, profile }) {
  const commandArgs = [
    cliPath,
    inputDir,
    "--formats",
    profile.formats,
    "--quality",
    profile.quality.toString(),
    "--out-dir",
    outDir,
    "--output",
    manifestPath,
    "--json",
  ];

  if (profile.blur) {
    commandArgs.push("--blur");
  } else {
    commandArgs.push("--no-blur");
  }

  if (profile.widths) {
    commandArgs.push("--widths", profile.widths);
  }

  const startedAt = formatIsoNow();
  const startNs = process.hrtime.bigint();

  const result = spawnSync("node", commandArgs, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });

  const durationNs = process.hrtime.bigint() - startNs;
  const wallMs = Number(durationNs) / 1_000_000;

  if (result.error) {
    throw result.error;
  }

  let report = null;
  let parseError = null;
  if (typeof result.stdout === "string" && result.stdout.trim() !== "") {
    try {
      report = JSON.parse(result.stdout);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }

  const summary = report?.summary ?? {};
  const errors = Array.isArray(report?.errors) ? report.errors : [];

  return {
    timestamp: startedAt,
    command: ["node", ...commandArgs],
    exitCode: result.status ?? 1,
    wallMs: round(wallMs),
    reportDurationMs: typeof summary.durationMs === "number" ? summary.durationMs : 0,
    total: typeof summary.total === "number" ? summary.total : 0,
    processed: typeof summary.processed === "number" ? summary.processed : 0,
    cached: typeof summary.cached === "number" ? summary.cached : 0,
    failed: typeof summary.failed === "number" ? summary.failed : 0,
    errorsLength: errors.length,
    stderr: (result.stderr ?? "").trim(),
    jsonParseError: parseError,
  };
}

function printProgress(record) {
  console.log(
    `[${record.profileId}:${record.scenario}] run ${record.run}/${record.runCount} ${record.phase} ` +
      `wall=${record.wallMs.toFixed(1)}ms total=${record.total.toString()} ` +
      `processed=${record.processed.toString()} cached=${record.cached.toString()} failed=${record.failed.toString()}`
  );
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const cliPath = args["cli-path"] ? resolvePath(args["cli-path"]) : "";
  const tierManifestPath = args["tier-manifest"] ? resolvePath(args["tier-manifest"]) : "";
  const workspace = args.workspace ? resolvePath(args.workspace) : "";
  const runCount = Number.parseInt(String(args["run-count"] ?? "10"), 10);
  const profileIds = profileIdsFromArg(typeof args.profiles === "string" ? args.profiles : null);

  if (!cliPath || !tierManifestPath || !workspace) {
    usage();
    throw new Error("--cli-path, --tier-manifest, and --workspace are required.");
  }

  if (!Number.isInteger(runCount) || runCount < 2) {
    throw new Error("--run-count must be an integer >= 2.");
  }

  if (!fs.existsSync(cliPath)) {
    throw new Error(`CLI path not found: ${cliPath}`);
  }

  const tierManifest = readJson(tierManifestPath);
  assertValid(validateTierManifest(tierManifest), "tier manifest");

  ensureDir(workspace);
  const scenarios = buildScenarios(tierManifestPath, tierManifest, workspace);

  const rawRecords = [];
  const validationFailures = [];

  for (const profileId of profileIds) {
    const profile = PROFILE_MAP[profileId];

    for (const scenario of scenarios) {
      const scenarioBaseDir = path.join(workspace, "runs", profile.id, scenario.name);
      const outDir = path.join(scenarioBaseDir, "out");
      const outputManifest = path.join(scenarioBaseDir, "manifest.json");
      ensureDir(scenarioBaseDir);

      for (let run = 1; run <= runCount; run += 1) {
        const phase = run === 1 ? "cold" : "warm";
        if (run === 1) {
          fs.rmSync(outDir, { recursive: true, force: true });
          fs.rmSync(outputManifest, { recursive: true, force: true });
        }

        const result = runOneIteration({
          cliPath,
          inputDir: scenario.inputDir,
          outDir,
          manifestPath: outputManifest,
          profile,
        });

        const record = {
          timestamp: result.timestamp,
          profileId: profile.id,
          scenario: scenario.name,
          run,
          runCount,
          phase,
          command: result.command,
          inputDir: scenario.inputDir,
          outDir,
          manifestPath: outputManifest,
          exitCode: result.exitCode,
          wallMs: result.wallMs,
          reportDurationMs: result.reportDurationMs,
          total: result.total,
          processed: result.processed,
          cached: result.cached,
          failed: result.failed,
          errorsLength: result.errorsLength,
          stderr: result.stderr,
          jsonParseError: result.jsonParseError,
        };

        rawRecords.push(record);
        printProgress(record);

        assertCondition(
          record.exitCode === 0,
          validationFailures,
          "Run exit code must be 0.",
          record
        );
        assertCondition(
          !record.jsonParseError,
          validationFailures,
          "JSON output must parse.",
          record
        );
        assertCondition(
          record.failed === 0,
          validationFailures,
          "summary.failed must be 0.",
          record
        );
        assertCondition(
          record.errorsLength === 0,
          validationFailures,
          "errors.length must be 0.",
          record
        );
        assertCondition(
          record.total === scenario.expectedTotal,
          validationFailures,
          `summary.total must equal ${scenario.expectedTotal.toString()}.`,
          record
        );

        if (phase === "cold") {
          assertCondition(
            record.processed === record.total,
            validationFailures,
            "Cold run must process all images.",
            record
          );
          assertCondition(
            record.cached === 0,
            validationFailures,
            "Cold run must have cached=0.",
            record
          );
        } else {
          assertCondition(
            record.cached === record.total,
            validationFailures,
            "Warm run must have cached=total.",
            record
          );
          assertCondition(
            record.processed === 0,
            validationFailures,
            "Warm run must process 0 files.",
            record
          );
        }
      }
    }
  }

  for (const record of rawRecords) {
    assertValid(
      validateRawRunRecord(record),
      `raw run record (${record.profileId}/${record.scenario}/run-${record.run.toString()})`
    );
  }

  const profileScenarioSummaries = {};
  for (const profileId of profileIds) {
    profileScenarioSummaries[profileId] = {};
    for (const scenario of scenarios) {
      const records = rawRecords.filter(
        (entry) => entry.profileId === profileId && entry.scenario === scenario.name
      );

      profileScenarioSummaries[profileId][scenario.name] = summarizeProfileScenario(
        records,
        scenario.expectedTotal
      );
    }
  }

  const resultsDir = path.join(workspace, "results");
  ensureDir(resultsDir);
  const rawRunsPath = path.join(resultsDir, "raw-runs.jsonl");
  const summaryPath = path.join(resultsDir, "summary.json");

  fs.writeFileSync(
    rawRunsPath,
    `${rawRecords.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf-8"
  );

  const summary = {
    version: "1.0",
    generatedAt: formatIsoNow(),
    benchmark: {
      cliPath,
      tierManifestPath,
      runCount,
      profiles: profileIds.map((profileId) => PROFILE_MAP[profileId]),
      scenarios,
    },
    files: {
      rawRunsJsonl: rawRunsPath,
      summaryJson: summaryPath,
    },
    validation: {
      passed: validationFailures.length === 0,
      failureCount: validationFailures.length,
      failures: validationFailures,
    },
    profileScenarioSummaries,
  };

  assertValid(validateSummary(summary), "benchmark summary");
  writeJson(summaryPath, summary);

  console.log(`RAW_RUNS_JSONL=${rawRunsPath}`);
  console.log(`SUMMARY_JSON=${summaryPath}`);
  console.log(`VALIDATION_PASSED=${summary.validation.passed ? "1" : "0"}`);

  if (!summary.validation.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
