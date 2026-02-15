#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, resolvePath, round, writeJson } from "./common.mjs";
import { assertValid, validateSummary } from "./contracts.mjs";

function usage() {
  console.log(`Usage: node scripts/bench/compare-benchmark.mjs \
  --base-summary <path> \
  --head-summary <path> \
  [--out-json <path>] \
  [--out-md <path>] \
  [--warm-threshold-pct <n>] \
  [--cold-threshold-pct <n>] \
  [--p95-threshold-pct <n>] \
  [--small-baseline-ms <n>] \
  [--min-absolute-delta-ms <n>]`);
}

function metricDelta(headValue, baseValue) {
  if (baseValue <= 0) {
    return {
      deltaMs: headValue - baseValue,
      regressionPct: 0,
    };
  }

  return {
    deltaMs: headValue - baseValue,
    regressionPct: ((headValue - baseValue) / baseValue) * 100,
  };
}

function shouldIgnoreSmallBaseline(baseValue, deltaMs, thresholds) {
  return (
    baseValue < thresholds.smallBaselineMs && Math.abs(deltaMs) < thresholds.minAbsoluteDeltaMs
  );
}

function toMarkdown(result) {
  const lines = [];
  lines.push("# Benchmark Comparison");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Advisory mode: ${result.advisory ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Thresholds");
  lines.push("");
  lines.push(`- Warm p50: +${result.thresholds.warmThresholdPct.toString()}%`);
  lines.push(`- Cold duration: +${result.thresholds.coldThresholdPct.toString()}%`);
  lines.push(`- Warm p95: +${result.thresholds.p95ThresholdPct.toString()}%`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Compared pairs: ${result.summary.totalPairs.toString()}`);
  lines.push(`- Alerts: ${result.summary.alertCount.toString()}`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push(
    "| Profile | Scenario | Base warm p50 (ms) | Head warm p50 (ms) | Warm delta | Base cold (ms) | Head cold (ms) | Cold delta | Alerts |"
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");

  for (const pair of result.pairs) {
    const alertLabels = pair.alerts.map((alert) => alert.metric).join(", ") || "none";
    const warmDelta = `${pair.deltas.warmP50.regressionPct >= 0 ? "+" : ""}${pair.deltas.warmP50.regressionPct.toFixed(2)}%`;
    const coldDelta = `${pair.deltas.cold.regressionPct >= 0 ? "+" : ""}${pair.deltas.cold.regressionPct.toFixed(2)}%`;

    lines.push(
      `| ${pair.profileId} | ${pair.scenario} | ${pair.base.warmP50Ms.toFixed(3)} | ${pair.head.warmP50Ms.toFixed(3)} | ${warmDelta} | ${pair.base.coldMs.toFixed(3)} | ${pair.head.coldMs.toFixed(3)} | ${coldDelta} | ${alertLabels} |`
    );
  }

  if (result.summary.alertCount > 0) {
    lines.push("");
    lines.push("## Alerts");
    lines.push("");
    for (const pair of result.pairs) {
      for (const alert of pair.alerts) {
        lines.push(
          `- ${pair.profileId}/${pair.scenario}: ${alert.metric} regressed by ${alert.regressionPct.toFixed(2)}% ` +
            `(base ${alert.baseMs.toFixed(3)}ms -> head ${alert.headMs.toFixed(3)}ms, threshold +${alert.thresholdPct.toString()}%)`
        );
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function compareSummaries(baseSummary, headSummary, thresholdOptions = {}) {
  assertValid(validateSummary(baseSummary), "base summary");
  assertValid(validateSummary(headSummary), "head summary");

  const thresholds = {
    warmThresholdPct: Number(thresholdOptions.warmThresholdPct ?? 10),
    coldThresholdPct: Number(thresholdOptions.coldThresholdPct ?? 15),
    p95ThresholdPct: Number(thresholdOptions.p95ThresholdPct ?? 20),
    smallBaselineMs: Number(thresholdOptions.smallBaselineMs ?? 100),
    minAbsoluteDeltaMs: Number(thresholdOptions.minAbsoluteDeltaMs ?? 15),
  };

  const pairs = [];

  for (const [profileId, baseScenarios] of Object.entries(baseSummary.profileScenarioSummaries)) {
    const headScenarios = headSummary.profileScenarioSummaries[profileId];
    if (!headScenarios) continue;

    for (const [scenarioName, baseEntry] of Object.entries(baseScenarios)) {
      const headEntry = headScenarios[scenarioName];
      if (!headEntry) continue;

      const baseMetrics = {
        warmP50Ms: baseEntry.warm.wallMs.p50,
        warmP95Ms: baseEntry.warm.wallMs.p95,
        coldMs: baseEntry.cold.wallMs,
      };
      const headMetrics = {
        warmP50Ms: headEntry.warm.wallMs.p50,
        warmP95Ms: headEntry.warm.wallMs.p95,
        coldMs: headEntry.cold.wallMs,
      };

      const deltas = {
        warmP50: metricDelta(headMetrics.warmP50Ms, baseMetrics.warmP50Ms),
        warmP95: metricDelta(headMetrics.warmP95Ms, baseMetrics.warmP95Ms),
        cold: metricDelta(headMetrics.coldMs, baseMetrics.coldMs),
      };

      const alerts = [];

      if (
        !shouldIgnoreSmallBaseline(baseMetrics.warmP50Ms, deltas.warmP50.deltaMs, thresholds) &&
        deltas.warmP50.regressionPct > thresholds.warmThresholdPct
      ) {
        alerts.push({
          metric: "warm-p50",
          baseMs: baseMetrics.warmP50Ms,
          headMs: headMetrics.warmP50Ms,
          regressionPct: round(deltas.warmP50.regressionPct),
          thresholdPct: thresholds.warmThresholdPct,
        });
      }

      if (
        !shouldIgnoreSmallBaseline(baseMetrics.coldMs, deltas.cold.deltaMs, thresholds) &&
        deltas.cold.regressionPct > thresholds.coldThresholdPct
      ) {
        alerts.push({
          metric: "cold",
          baseMs: baseMetrics.coldMs,
          headMs: headMetrics.coldMs,
          regressionPct: round(deltas.cold.regressionPct),
          thresholdPct: thresholds.coldThresholdPct,
        });
      }

      if (
        !shouldIgnoreSmallBaseline(baseMetrics.warmP95Ms, deltas.warmP95.deltaMs, thresholds) &&
        deltas.warmP95.regressionPct > thresholds.p95ThresholdPct
      ) {
        alerts.push({
          metric: "warm-p95",
          baseMs: baseMetrics.warmP95Ms,
          headMs: headMetrics.warmP95Ms,
          regressionPct: round(deltas.warmP95.regressionPct),
          thresholdPct: thresholds.p95ThresholdPct,
        });
      }

      pairs.push({
        profileId,
        scenario: scenarioName,
        base: baseMetrics,
        head: headMetrics,
        deltas: {
          warmP50: {
            deltaMs: round(deltas.warmP50.deltaMs),
            regressionPct: round(deltas.warmP50.regressionPct),
          },
          warmP95: {
            deltaMs: round(deltas.warmP95.deltaMs),
            regressionPct: round(deltas.warmP95.regressionPct),
          },
          cold: {
            deltaMs: round(deltas.cold.deltaMs),
            regressionPct: round(deltas.cold.regressionPct),
          },
        },
        alerts,
      });
    }
  }

  const alertCount = pairs.reduce((sum, pair) => sum + pair.alerts.length, 0);

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    advisory: true,
    thresholds,
    summary: {
      totalPairs: pairs.length,
      alertCount,
      hasAlerts: alertCount > 0,
    },
    pairs,
  };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const baseSummaryPath = args["base-summary"] ? resolvePath(args["base-summary"]) : "";
  const headSummaryPath = args["head-summary"] ? resolvePath(args["head-summary"]) : "";

  if (!baseSummaryPath || !headSummaryPath) {
    usage();
    throw new Error("--base-summary and --head-summary are required.");
  }

  const baseSummary = readJson(baseSummaryPath);
  const headSummary = readJson(headSummaryPath);

  const comparison = compareSummaries(baseSummary, headSummary, {
    warmThresholdPct: args["warm-threshold-pct"],
    coldThresholdPct: args["cold-threshold-pct"],
    p95ThresholdPct: args["p95-threshold-pct"],
    smallBaselineMs: args["small-baseline-ms"],
    minAbsoluteDeltaMs: args["min-absolute-delta-ms"],
  });

  const outJson = args["out-json"] ? resolvePath(args["out-json"]) : null;
  const outMd = args["out-md"] ? resolvePath(args["out-md"]) : null;

  if (outJson) {
    writeJson(outJson, comparison);
  }

  const markdown = toMarkdown(comparison);
  if (outMd) {
    fs.mkdirSync(path.dirname(outMd), { recursive: true });
    fs.writeFileSync(outMd, markdown, "utf-8");
  }

  console.log(JSON.stringify(comparison, null, 2));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
