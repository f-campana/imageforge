#!/usr/bin/env node

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateTierManifest(value) {
  const errors = [];
  if (!isRecord(value)) {
    return ["Tier manifest must be an object."];
  }

  if (value.version !== "1.0") {
    errors.push('tier manifest version must be "1.0".');
  }
  if (typeof value.tierId !== "string" || value.tierId.length === 0) {
    errors.push("tierId must be a non-empty string.");
  }
  if (typeof value.imageRoot !== "string" || value.imageRoot.length === 0) {
    errors.push("imageRoot must be a non-empty string.");
  }
  if (!Array.isArray(value.files) || value.files.some((entry) => typeof entry !== "string")) {
    errors.push("files must be an array of strings.");
  }

  if (!isRecord(value.singleScenarios)) {
    errors.push("singleScenarios must be an object.");
  } else {
    for (const key of ["small", "median", "large"]) {
      if (
        typeof value.singleScenarios[key] !== "string" ||
        value.singleScenarios[key].length === 0
      ) {
        errors.push(`singleScenarios.${key} must be a non-empty string.`);
      }
    }
  }

  return errors;
}

export function validateRawRunRecord(value) {
  const errors = [];
  if (!isRecord(value)) {
    return ["raw run record must be an object."];
  }

  const requiredString = [
    "timestamp",
    "profileId",
    "scenario",
    "phase",
    "inputDir",
    "outDir",
    "manifestPath",
  ];
  for (const key of requiredString) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      errors.push(`${key} must be a non-empty string.`);
    }
  }

  if (!Number.isInteger(value.run) || value.run < 1) {
    errors.push("run must be an integer >= 1.");
  }
  if (value.phase !== "cold" && value.phase !== "warm") {
    errors.push("phase must be cold or warm.");
  }
  if (!Number.isInteger(value.exitCode)) {
    errors.push("exitCode must be an integer.");
  }

  for (const key of [
    "wallMs",
    "reportDurationMs",
    "total",
    "processed",
    "cached",
    "failed",
    "totalOriginalSize",
    "totalProcessedSize",
    "errorsLength",
  ]) {
    if (!hasFiniteNumber(value[key])) {
      errors.push(`${key} must be a finite number.`);
    }
  }

  return errors;
}

function validateSummaryShape(entry, label, errors) {
  if (!isRecord(entry)) {
    errors.push(`${label} must be an object.`);
    return;
  }

  if (!isRecord(entry.cold)) {
    errors.push(`${label}.cold must be an object.`);
  }
  if (!isRecord(entry.warm)) {
    errors.push(`${label}.warm must be an object.`);
  }

  const cold = entry.cold;
  if (isRecord(cold)) {
    for (const key of [
      "wallMs",
      "reportDurationMs",
      "total",
      "processed",
      "cached",
      "failed",
      "imagesPerSec",
      "perImageMs",
    ]) {
      if (!hasFiniteNumber(cold[key])) {
        errors.push(`${label}.cold.${key} must be a finite number.`);
      }
    }

    if (cold.originalBytes !== undefined && !hasFiniteNumber(cold.originalBytes)) {
      errors.push(`${label}.cold.originalBytes must be a finite number.`);
    }
    if (cold.processedBytes !== undefined && !hasFiniteNumber(cold.processedBytes)) {
      errors.push(`${label}.cold.processedBytes must be a finite number.`);
    }
  }

  const warm = entry.warm;
  if (isRecord(warm)) {
    if (!Number.isInteger(warm.count) || warm.count < 1) {
      errors.push(`${label}.warm.count must be an integer >= 1.`);
    }

    for (const family of ["wallMs", "reportDurationMs"]) {
      const obj = warm[family];
      if (!isRecord(obj)) {
        errors.push(`${label}.warm.${family} must be an object.`);
        continue;
      }

      for (const key of ["mean", "p50", "p95", "stddev"]) {
        if (!hasFiniteNumber(obj[key])) {
          errors.push(`${label}.warm.${family}.${key} must be a finite number.`);
        }
      }
    }
  }

  if (!isRecord(entry.speedup)) {
    errors.push(`${label}.speedup must be an object.`);
  } else {
    for (const key of ["coldVsWarmWallMean", "coldVsWarmReportMean"]) {
      if (!hasFiniteNumber(entry.speedup[key])) {
        errors.push(`${label}.speedup.${key} must be a finite number.`);
      }
    }
  }

  if (!isRecord(entry.validation) || typeof entry.validation.passed !== "boolean") {
    errors.push(`${label}.validation.passed must be boolean.`);
  }
}

export function validateSummary(value) {
  const errors = [];
  if (!isRecord(value)) {
    return ["summary must be an object."];
  }

  if (value.version !== "1.0") {
    errors.push('summary version must be "1.0".');
  }

  if (!isRecord(value.validation) || typeof value.validation.passed !== "boolean") {
    errors.push("validation.passed must be boolean.");
  }

  if (!isRecord(value.benchmark)) {
    errors.push("benchmark must be an object.");
  }

  if (!isRecord(value.profileScenarioSummaries)) {
    errors.push("profileScenarioSummaries must be an object.");
  } else {
    for (const [profileId, scenarios] of Object.entries(value.profileScenarioSummaries)) {
      if (!isRecord(scenarios)) {
        errors.push(`profileScenarioSummaries.${profileId} must be an object.`);
        continue;
      }

      for (const [scenarioName, summaryEntry] of Object.entries(scenarios)) {
        validateSummaryShape(
          summaryEntry,
          `profileScenarioSummaries.${profileId}.${scenarioName}`,
          errors
        );
      }
    }
  }

  return errors;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validateSnapshotMetricEntry(entry, label, errors) {
  if (!isRecord(entry)) {
    errors.push(`${label} must be an object.`);
    return;
  }

  for (const key of [
    "runCount",
    "imageCount",
    "coldWallMs",
    "warmMeanMs",
    "warmP50Ms",
    "warmP95Ms",
    "warmStddevMs",
    "speedup",
    "coldImagesPerSec",
    "warmImagesPerSec",
    "coldPerImageMs",
    "warmPerImageMs",
    "coldOriginalBytes",
    "coldProcessedBytes",
  ]) {
    if (!hasFiniteNumber(entry[key])) {
      errors.push(`${label}.${key} must be a finite number.`);
    }
  }

  if (typeof entry.validationPassed !== "boolean") {
    errors.push(`${label}.validationPassed must be boolean.`);
  }
}

export function validateSiteSnapshot(value) {
  const errors = [];
  if (!isRecord(value)) {
    return ["site snapshot must be an object."];
  }

  if (value.schemaVersion !== "1.0") {
    errors.push('schemaVersion must be "1.0".');
  }
  if (!isNonEmptyString(value.snapshotId)) {
    errors.push("snapshotId must be a non-empty string.");
  }
  if (!isNonEmptyString(value.generatedAt)) {
    errors.push("generatedAt must be a non-empty string.");
  }
  if (!isNonEmptyString(value.asOfDate)) {
    errors.push("asOfDate must be a non-empty string.");
  }
  if (!isNonEmptyString(value.owner)) {
    errors.push("owner must be a non-empty string.");
  }

  if (!isRecord(value.source)) {
    errors.push("source must be an object.");
  } else {
    const stringKeys = [
      "repository",
      "workflowName",
      "workflowPath",
      "runUrl",
      "eventName",
      "refName",
      "sha",
      "tier",
      "datasetVersion",
      "runner",
      "nodeVersion",
    ];
    for (const key of stringKeys) {
      if (!isNonEmptyString(value.source[key])) {
        errors.push(`source.${key} must be a non-empty string.`);
      }
    }
    for (const key of ["runId", "runAttempt", "runCount"]) {
      if (!hasFiniteNumber(value.source[key])) {
        errors.push(`source.${key} must be a finite number.`);
      }
    }
  }

  if (!isRecord(value.thresholds)) {
    errors.push("thresholds must be an object.");
  } else {
    for (const key of [
      "warmThresholdPct",
      "coldThresholdPct",
      "p95ThresholdPct",
      "smallBaselineMs",
      "minAbsoluteDeltaMs",
    ]) {
      if (!hasFiniteNumber(value.thresholds[key])) {
        errors.push(`thresholds.${key} must be a finite number.`);
      }
    }
  }

  if (!isRecord(value.summary)) {
    errors.push("summary must be an object.");
  } else {
    for (const key of ["totalPairs", "alertCount"]) {
      if (!hasFiniteNumber(value.summary[key])) {
        errors.push(`summary.${key} must be a finite number.`);
      }
    }
    for (const key of ["hasAlerts", "headValidationPassed", "baseValidationPassed"]) {
      if (typeof value.summary[key] !== "boolean") {
        errors.push(`summary.${key} must be boolean.`);
      }
    }
  }

  if (!isRecord(value.benchmark)) {
    errors.push("benchmark must be an object.");
  } else {
    if (!Array.isArray(value.benchmark.profiles)) {
      errors.push("benchmark.profiles must be an array.");
    }
    if (!Array.isArray(value.benchmark.scenarios)) {
      errors.push("benchmark.scenarios must be an array.");
    }

    if (!isRecord(value.benchmark.headline)) {
      errors.push("benchmark.headline must be an object.");
    } else {
      if (!isNonEmptyString(value.benchmark.headline.profileId)) {
        errors.push("benchmark.headline.profileId must be a non-empty string.");
      }
      if (!isNonEmptyString(value.benchmark.headline.scenario)) {
        errors.push("benchmark.headline.scenario must be a non-empty string.");
      }
    }
  }

  if (!isRecord(value.profileScenarioMetrics)) {
    errors.push("profileScenarioMetrics must be an object.");
  } else {
    for (const [profileId, scenarios] of Object.entries(value.profileScenarioMetrics)) {
      if (!isRecord(scenarios)) {
        errors.push(`profileScenarioMetrics.${profileId} must be an object.`);
        continue;
      }
      for (const [scenarioName, entry] of Object.entries(scenarios)) {
        validateSnapshotMetricEntry(
          entry,
          `profileScenarioMetrics.${profileId}.${scenarioName}`,
          errors
        );
      }
    }
  }

  if (!Array.isArray(value.deltas)) {
    errors.push("deltas must be an array.");
  } else {
    for (const [index, delta] of value.deltas.entries()) {
      const label = `deltas[${index.toString()}]`;
      if (!isRecord(delta)) {
        errors.push(`${label} must be an object.`);
        continue;
      }
      if (!isNonEmptyString(delta.profileId)) {
        errors.push(`${label}.profileId must be a non-empty string.`);
      }
      if (!isNonEmptyString(delta.scenario)) {
        errors.push(`${label}.scenario must be a non-empty string.`);
      }
      for (const key of ["warmP50Pct", "warmP95Pct", "coldPct"]) {
        if (!hasFiniteNumber(delta[key])) {
          errors.push(`${label}.${key} must be a finite number.`);
        }
      }
      if (!Array.isArray(delta.alerts) || delta.alerts.some((entry) => !isNonEmptyString(entry))) {
        errors.push(`${label}.alerts must be an array of non-empty strings.`);
      }
    }
  }

  return errors;
}

export function assertValid(errors, label) {
  if (errors.length > 0) {
    throw new Error(`${label} validation failed:\n- ${errors.join("\n- ")}`);
  }
}
