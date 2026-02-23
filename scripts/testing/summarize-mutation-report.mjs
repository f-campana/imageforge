import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    report: ".tmp/mutation/report.json",
    summaryFile: process.env.GITHUB_STEP_SUMMARY ?? "",
    outJson: ".tmp/mutation/summary.json",
    baseline: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--report" && typeof next === "string") {
      args.report = next;
      index += 1;
      continue;
    }
    if (current === "--summary-file" && typeof next === "string") {
      args.summaryFile = next;
      index += 1;
      continue;
    }
    if (current === "--out-json" && typeof next === "string") {
      args.outJson = next;
      index += 1;
      continue;
    }
    if (current === "--baseline" && typeof next === "string") {
      args.baseline = next;
      index += 1;
      continue;
    }
  }

  return args;
}

function normalizeStatus(status) {
  return status.toLowerCase();
}

function collectMutantCounts(value, counts) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMutantCounts(entry, counts);
    }
    return;
  }

  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    const status = record.status;
    if (
      typeof status === "string" &&
      ("id" in record || "replacement" in record || "location" in record)
    ) {
      const normalized = normalizeStatus(status);
      counts[normalized] = (counts[normalized] ?? 0) + 1;
    }
    for (const nested of Object.values(record)) {
      collectMutantCounts(nested, counts);
    }
  }
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMetricScore(report) {
  if (!report || typeof report !== "object") {
    return null;
  }
  const metrics = /** @type {Record<string, unknown>} */ (report).metrics;
  if (!metrics || typeof metrics !== "object") {
    return null;
  }
  const metricRecord = /** @type {Record<string, unknown>} */ (metrics);
  return (
    asNumber(metricRecord.mutationScore) ??
    asNumber((metricRecord.mutationScore ?? {})?.["value"]) ??
    asNumber((metricRecord.total ?? {})?.["mutationScore"]) ??
    null
  );
}

function summarize(reportPath) {
  if (!fs.existsSync(reportPath)) {
    return {
      ok: false,
      reason: `Report not found at ${reportPath}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse failure";
    return {
      ok: false,
      reason: `Unable to parse report at ${reportPath}: ${message}`,
    };
  }

  /** @type {Record<string, number>} */
  const counts = {};
  collectMutantCounts(parsed, counts);

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const killed = (counts.killed ?? 0) + (counts.timeout ?? 0);
  const survived = counts.survived ?? 0;
  const noCoverage = counts.nocoverage ?? 0;
  const ignored = counts.ignored ?? 0;
  const detectable = Math.max(0, total - noCoverage - ignored);
  const computedOverallScore = total > 0 ? (killed / total) * 100 : 0;
  const computedDetectableScore = detectable > 0 ? (killed / detectable) * 100 : 0;
  const score = readMetricScore(parsed) ?? computedOverallScore;

  return {
    ok: true,
    reportPath,
    total,
    killed,
    survived,
    noCoverage,
    ignored,
    detectable,
    mutationScore: Number(score.toFixed(2)),
    mutationScoreDetectable: Number(computedDetectableScore.toFixed(2)),
    counts,
  };
}

function readBaseline(baselinePath) {
  if (!baselinePath || !fs.existsSync(baselinePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = /** @type {Record<string, unknown>} */ (parsed);
    const overall = asNumber(record.overallMutationScore);
    const detectable = asNumber(record.detectableMutationScore);
    if (overall === null || detectable === null) {
      return null;
    }
    return {
      path: baselinePath,
      overallMutationScore: overall,
      detectableMutationScore: detectable,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function toSignedDelta(value) {
  if (value > 0) return `+${value.toFixed(2)}%`;
  if (value < 0) return `${value.toFixed(2)}%`;
  return "0.00%";
}

function applyTrend(summary, baselinePath) {
  if (!summary.ok) {
    return summary;
  }

  const baseline = readBaseline(baselinePath);
  if (!baseline) {
    return {
      ...summary,
      trend: {
        baselineFound: false,
        baselinePath: baselinePath || null,
      },
    };
  }

  const overallDelta = summary.mutationScore - baseline.overallMutationScore;
  const detectableDelta = summary.mutationScoreDetectable - baseline.detectableMutationScore;

  return {
    ...summary,
    trend: {
      baselineFound: true,
      baselinePath: baseline.path,
      baselineUpdatedAt: baseline.updatedAt,
      baselineOverallMutationScore: baseline.overallMutationScore,
      baselineDetectableMutationScore: baseline.detectableMutationScore,
      overallDelta: Number(overallDelta.toFixed(2)),
      detectableDelta: Number(detectableDelta.toFixed(2)),
      overallDeltaLabel: toSignedDelta(overallDelta),
      detectableDeltaLabel: toSignedDelta(detectableDelta),
    },
  };
}

function buildSummaryMarkdown(result) {
  if (!result.ok) {
    return `### Mutation Advisory\n\n- Status: report unavailable\n- Detail: ${result.reason}\n- Mode: advisory (non-blocking)\n`;
  }

  const lines = [
    "### Mutation Advisory",
    "",
    `- Status: ${result.survived > 0 ? "survived mutants detected" : "no survived mutants detected"}`,
    "- Mode: advisory (non-blocking)",
    `- Mutation score: ${result.mutationScore}%`,
    `- Mutation score (detectable-only): ${result.mutationScoreDetectable}%`,
    `- Killed: ${result.killed}`,
    `- Survived: ${result.survived}`,
    `- No coverage: ${result.noCoverage}`,
    `- Ignored: ${result.ignored}`,
    `- Detectable mutants: ${result.detectable}`,
    `- Total mutants: ${result.total}`,
  ];

  if (result.trend?.baselineFound === true) {
    lines.push(
      `- Trend vs baseline overall: ${result.trend.overallDeltaLabel}`,
      `- Trend vs baseline detectable-only: ${result.trend.detectableDeltaLabel}`
    );
  } else {
    lines.push("- Trend: baseline not available");
  }

  return lines.join("\n");
}

function writeSummary(summaryFile, markdown) {
  if (!summaryFile) {
    return;
  }
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  fs.appendFileSync(summaryFile, `${markdown}\n`);
}

function writeJson(outFile, payload) {
  if (!outFile) {
    return;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv);
const summary = applyTrend(summarize(args.report), args.baseline);
const markdown = buildSummaryMarkdown(summary);

console.log(markdown);
writeSummary(args.summaryFile, markdown);
writeJson(args.outJson, summary);
