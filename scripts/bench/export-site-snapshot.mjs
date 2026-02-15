#!/usr/bin/env node

import { formatIsoNow, parseArgs, readJson, resolvePath, writeJson } from "./common.mjs";
import { assertValid, validateSiteSnapshot, validateSummary } from "./contracts.mjs";

function usage() {
  console.log(`Usage: node scripts/bench/export-site-snapshot.mjs \\
  --head-summary <path> \\
  --base-summary <path> \\
  --compare <path> \\
  --out <path> \\
  --repository <owner/repo> \\
  --workflow-name <name> \\
  --workflow-path <path> \\
  --run-id <id> \\
  --run-attempt <n> \\
  --run-url <url> \\
  --event-name <name> \\
  --ref-name <ref> \\
  --sha <sha> \\
  --tier <tier-id> \\
  --dataset-version <x.y.z> \\
  --runner <label> \\
  --node-version <version> \\
  [--run-count <n>] \\
  [--owner <name>] \\
  [--as-of-date <date>] \\
  [--headline-profile <id>] \\
  [--headline-scenario <id>]`);
}

function numberArg(value, key) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a finite number.`);
  }
  return parsed;
}

function formatAsOfDate(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date());
}

function coerceScenarioMap(entry) {
  if (typeof entry !== "object" || entry === null) {
    return {};
  }
  return entry;
}

function pickHeadline(headSummary, requestedProfile, requestedScenario) {
  const allProfiles = Object.keys(headSummary.profileScenarioSummaries ?? {});
  const firstProfile = allProfiles[0] ?? "P2";
  const profileId =
    requestedProfile && headSummary.profileScenarioSummaries?.[requestedProfile]
      ? requestedProfile
      : headSummary.profileScenarioSummaries?.P2
        ? "P2"
        : firstProfile;

  const scenarioMap = coerceScenarioMap(headSummary.profileScenarioSummaries?.[profileId]);
  const scenarios = Object.keys(scenarioMap);
  const firstScenario = scenarios[0] ?? "batch-all";
  const scenario =
    requestedScenario && scenarioMap[requestedScenario]
      ? requestedScenario
      : scenarioMap["batch-all"]
        ? "batch-all"
        : firstScenario;

  return { profileId, scenario };
}

function buildProfileScenarioMetrics(headSummary) {
  const output = {};

  for (const [profileId, scenarioMap] of Object.entries(
    headSummary.profileScenarioSummaries ?? {}
  )) {
    output[profileId] = {};

    for (const [scenarioName, entry] of Object.entries(coerceScenarioMap(scenarioMap))) {
      output[profileId][scenarioName] = {
        runCount: entry.runCount ?? 0,
        imageCount: entry.imageCount ?? 0,
        coldWallMs: entry.cold?.wallMs ?? 0,
        warmMeanMs: entry.warm?.wallMs?.mean ?? 0,
        warmP50Ms: entry.warm?.wallMs?.p50 ?? 0,
        warmP95Ms: entry.warm?.wallMs?.p95 ?? 0,
        warmStddevMs: entry.warm?.wallMs?.stddev ?? 0,
        speedup: entry.speedup?.coldVsWarmWallMean ?? 0,
        coldImagesPerSec: entry.cold?.imagesPerSec ?? 0,
        warmImagesPerSec: entry.warm?.imagesPerSecMean ?? 0,
        coldPerImageMs: entry.cold?.perImageMs ?? 0,
        warmPerImageMs: entry.warm?.perImageMsMean ?? 0,
        coldOriginalBytes: entry.cold?.originalBytes ?? 0,
        coldProcessedBytes: entry.cold?.processedBytes ?? 0,
        validationPassed: Boolean(entry.validation?.passed),
      };
    }
  }

  return output;
}

function buildSnapshot({ headSummary, baseSummary, compare, metadata, headline, owner, asOfDate }) {
  return {
    schemaVersion: "1.0",
    snapshotId: `${metadata.runId.toString()}.${metadata.runAttempt.toString()}`,
    generatedAt: formatIsoNow(),
    asOfDate,
    owner,
    source: {
      repository: metadata.repository,
      workflowName: metadata.workflowName,
      workflowPath: metadata.workflowPath,
      runId: metadata.runId,
      runAttempt: metadata.runAttempt,
      runUrl: metadata.runUrl,
      eventName: metadata.eventName,
      refName: metadata.refName,
      sha: metadata.sha,
      tier: metadata.tier,
      runCount: metadata.runCount,
      datasetVersion: metadata.datasetVersion,
      runner: metadata.runner,
      nodeVersion: metadata.nodeVersion,
    },
    thresholds: {
      warmThresholdPct: compare.thresholds.warmThresholdPct,
      coldThresholdPct: compare.thresholds.coldThresholdPct,
      p95ThresholdPct: compare.thresholds.p95ThresholdPct,
      smallBaselineMs: compare.thresholds.smallBaselineMs,
      minAbsoluteDeltaMs: compare.thresholds.minAbsoluteDeltaMs,
    },
    summary: {
      totalPairs: compare.summary.totalPairs,
      alertCount: compare.summary.alertCount,
      hasAlerts: compare.summary.hasAlerts,
      headValidationPassed: Boolean(headSummary.validation?.passed),
      baseValidationPassed: Boolean(baseSummary.validation?.passed),
    },
    benchmark: {
      profiles: headSummary.benchmark?.profiles ?? [],
      scenarios: (headSummary.benchmark?.scenarios ?? []).map((entry) => ({
        name: entry.name,
        expectedTotal: entry.expectedTotal,
      })),
      headline,
    },
    profileScenarioMetrics: buildProfileScenarioMetrics(headSummary),
    deltas: (compare.pairs ?? []).map((pair) => ({
      profileId: pair.profileId,
      scenario: pair.scenario,
      warmP50Pct: pair.deltas?.warmP50?.regressionPct ?? 0,
      warmP95Pct: pair.deltas?.warmP95?.regressionPct ?? 0,
      coldPct: pair.deltas?.cold?.regressionPct ?? 0,
      alerts: Array.isArray(pair.alerts) ? pair.alerts.map((alert) => alert.metric) : [],
    })),
  };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const headSummaryPath = args["head-summary"] ? resolvePath(args["head-summary"]) : "";
  const baseSummaryPath = args["base-summary"] ? resolvePath(args["base-summary"]) : "";
  const comparePath = args.compare ? resolvePath(args.compare) : "";
  const outPath = args.out ? resolvePath(args.out) : "";

  if (!headSummaryPath || !baseSummaryPath || !comparePath || !outPath) {
    usage();
    throw new Error("--head-summary, --base-summary, --compare, and --out are required.");
  }

  const requiredStrings = [
    "repository",
    "workflow-name",
    "workflow-path",
    "run-url",
    "event-name",
    "ref-name",
    "sha",
    "tier",
    "dataset-version",
    "runner",
    "node-version",
  ];

  for (const key of requiredStrings) {
    if (typeof args[key] !== "string" || args[key].trim().length === 0) {
      throw new Error(`--${key} is required.`);
    }
  }

  const metadata = {
    repository: args["repository"].trim(),
    workflowName: args["workflow-name"].trim(),
    workflowPath: args["workflow-path"].trim(),
    runId: numberArg(args["run-id"], "--run-id"),
    runAttempt: numberArg(args["run-attempt"], "--run-attempt"),
    runUrl: args["run-url"].trim(),
    eventName: args["event-name"].trim(),
    refName: args["ref-name"].trim(),
    sha: args.sha.trim(),
    tier: args.tier.trim(),
    runCount: 0,
    datasetVersion: args["dataset-version"].trim(),
    runner: args.runner.trim(),
    nodeVersion: args["node-version"].trim(),
  };

  const headSummary = readJson(headSummaryPath);
  const baseSummary = readJson(baseSummaryPath);
  const compare = readJson(comparePath);

  assertValid(validateSummary(headSummary), "head summary");
  assertValid(validateSummary(baseSummary), "base summary");

  if (typeof compare !== "object" || compare === null) {
    throw new Error("compare payload must be an object.");
  }
  const compareHasFields =
    typeof compare.summary === "object" &&
    compare.summary !== null &&
    typeof compare.thresholds === "object" &&
    compare.thresholds !== null &&
    Array.isArray(compare.pairs);
  if (!compareHasFields) {
    throw new Error("compare payload must include summary, thresholds, and pairs.");
  }

  metadata.runCount =
    args["run-count"] !== undefined
      ? numberArg(args["run-count"], "--run-count")
      : Number(headSummary.benchmark?.runCount ?? 0);

  const headline = pickHeadline(
    headSummary,
    typeof args["headline-profile"] === "string" ? args["headline-profile"] : undefined,
    typeof args["headline-scenario"] === "string" ? args["headline-scenario"] : undefined
  );

  const snapshot = buildSnapshot({
    headSummary,
    baseSummary,
    compare,
    metadata,
    headline,
    owner:
      typeof args.owner === "string" && args.owner.trim().length > 0
        ? args.owner.trim()
        : "ImageForge Maintainers (CLI + Growth)",
    asOfDate: formatAsOfDate(args["as-of-date"]),
  });

  assertValid(validateSiteSnapshot(snapshot), "site benchmark snapshot");
  writeJson(outPath, snapshot);

  console.log(`SITE_BENCHMARK_SNAPSHOT=${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
