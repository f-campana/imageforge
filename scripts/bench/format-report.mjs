#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, resolvePath } from "./common.mjs";
import { assertValid, validateSummary } from "./contracts.mjs";

function usage() {
  console.log(
    `Usage: node scripts/bench/format-report.mjs --head-summary <path> [--base-summary <path>] [--compare <path>] [--out <path>]`
  );
}

function summaryTable(title, summary) {
  const lines = [];
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(
    "| Profile | Scenario | Cold wall (ms) | Warm p50 (ms) | Warm p95 (ms) | Warm stddev (ms) | Speedup | Validation |"
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");

  for (const [profileId, scenarios] of Object.entries(summary.profileScenarioSummaries)) {
    for (const [scenarioName, entry] of Object.entries(scenarios)) {
      lines.push(
        `| ${profileId} | ${scenarioName} | ${entry.cold.wallMs.toFixed(3)} | ` +
          `${entry.warm.wallMs.p50.toFixed(3)} | ${entry.warm.wallMs.p95.toFixed(3)} | ` +
          `${entry.warm.wallMs.stddev.toFixed(3)} | ${entry.speedup.coldVsWarmWallMean.toFixed(2)}x | ` +
          `${entry.validation.passed ? "pass" : "fail"} |`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function compareSection(compare) {
  const lines = [];
  lines.push("## Regression Comparison (Head vs Base)");
  lines.push("");
  lines.push(`- Compared pairs: ${compare.summary.totalPairs.toString()}`);
  lines.push(`- Alerts: ${compare.summary.alertCount.toString()}`);
  lines.push("");

  lines.push("| Profile | Scenario | Warm p50 delta | Warm p95 delta | Cold delta | Alerts |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- |");
  for (const pair of compare.pairs) {
    const alerts = pair.alerts.map((alert) => alert.metric).join(", ") || "none";
    const warmP50 = `${pair.deltas.warmP50.regressionPct >= 0 ? "+" : ""}${pair.deltas.warmP50.regressionPct.toFixed(2)}%`;
    const warmP95 = `${pair.deltas.warmP95.regressionPct >= 0 ? "+" : ""}${pair.deltas.warmP95.regressionPct.toFixed(2)}%`;
    const cold = `${pair.deltas.cold.regressionPct >= 0 ? "+" : ""}${pair.deltas.cold.regressionPct.toFixed(2)}%`;
    lines.push(
      `| ${pair.profileId} | ${pair.scenario} | ${warmP50} | ${warmP95} | ${cold} | ${alerts} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const headSummaryPath = args["head-summary"] ? resolvePath(args["head-summary"]) : "";
  if (!headSummaryPath) {
    usage();
    throw new Error("--head-summary is required.");
  }

  const headSummary = readJson(headSummaryPath);
  assertValid(validateSummary(headSummary), "head summary");

  const baseSummaryPath = args["base-summary"] ? resolvePath(args["base-summary"]) : null;
  const comparePath = args.compare ? resolvePath(args.compare) : null;

  let baseSummary = null;
  if (baseSummaryPath) {
    baseSummary = readJson(baseSummaryPath);
    assertValid(validateSummary(baseSummary), "base summary");
  }

  const compare = comparePath ? readJson(comparePath) : null;

  const lines = [];
  lines.push("# ImageForge Benchmark Report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  lines.push(summaryTable("Head Summary", headSummary));

  if (baseSummary) {
    lines.push(summaryTable("Base Summary", baseSummary));
  }

  if (compare) {
    lines.push(compareSection(compare));
  }

  const report = lines.join("\n");
  const outPath = args.out ? resolvePath(args.out) : null;

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report, "utf-8");
  }

  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
