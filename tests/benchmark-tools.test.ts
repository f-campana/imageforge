import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");
const COMPARE = path.join(ROOT, "scripts", "bench", "compare-benchmark.mjs");
const EXPORT_SNAPSHOT = path.join(ROOT, "scripts", "bench", "export-site-snapshot.mjs");

interface Metrics {
  cold: number;
  warmP50: number;
  warmP95: number;
}

function makeSummary(metrics: Metrics) {
  return {
    version: "1.0",
    generatedAt: "2026-02-15T00:00:00.000Z",
    benchmark: {
      cliPath: "/tmp/cli.js",
      tierManifestPath: "/tmp/tier-manifest.json",
      runCount: 4,
      profiles: [],
      scenarios: [],
    },
    validation: {
      passed: true,
      failureCount: 0,
      failures: [],
    },
    profileScenarioSummaries: {
      P2: {
        "batch-all": {
          runCount: 4,
          imageCount: 30,
          cold: {
            wallMs: metrics.cold,
            reportDurationMs: 100,
            total: 30,
            processed: 30,
            cached: 0,
            failed: 0,
            errorsLength: 0,
            imagesPerSec: 1,
            perImageMs: metrics.cold / 30,
            originalBytes: 1200000,
            processedBytes: 900000,
          },
          warm: {
            count: 3,
            wallMs: {
              mean: metrics.warmP50,
              p50: metrics.warmP50,
              p95: metrics.warmP95,
              stddev: 1,
            },
            reportDurationMs: {
              mean: 10,
              p50: 10,
              p95: 12,
              stddev: 1,
            },
            imagesPerSecMean: 10,
            perImageMsMean: metrics.warmP50 / 30,
          },
          speedup: {
            coldVsWarmWallMean: 2,
            coldVsWarmReportMean: 5,
          },
          validation: {
            passed: true,
          },
        },
      },
    },
  };
}

function makeCompare() {
  return {
    version: "1.0",
    generatedAt: "2026-02-15T00:00:00.000Z",
    advisory: true,
    thresholds: {
      warmThresholdPct: 10,
      coldThresholdPct: 15,
      p95ThresholdPct: 20,
      smallBaselineMs: 100,
      minAbsoluteDeltaMs: 15,
    },
    summary: {
      totalPairs: 1,
      alertCount: 0,
      hasAlerts: false,
    },
    pairs: [
      {
        profileId: "P2",
        scenario: "batch-all",
        base: {
          warmP50Ms: 200,
          warmP95Ms: 230,
          coldMs: 1000,
        },
        head: {
          warmP50Ms: 190,
          warmP95Ms: 220,
          coldMs: 990,
        },
        deltas: {
          warmP50: { deltaMs: -10, regressionPct: -5 },
          warmP95: { deltaMs: -10, regressionPct: -4.35 },
          cold: { deltaMs: -10, regressionPct: -1 },
        },
        alerts: [],
      },
    ],
  };
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("benchmark compare script", () => {
  it("reports advisory alerts when thresholds are exceeded", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-test-"));
    const basePath = path.join(tempDir, "base-summary.json");
    const headPath = path.join(tempDir, "head-summary.json");
    const outPath = path.join(tempDir, "compare.json");

    writeJson(basePath, makeSummary({ cold: 1000, warmP50: 200, warmP95: 240 }));
    writeJson(headPath, makeSummary({ cold: 1250, warmP50: 230, warmP95: 310 }));

    const result = spawnSync(
      "node",
      [
        COMPARE,
        "--base-summary",
        basePath,
        "--head-summary",
        headPath,
        "--out-json",
        outPath,
        "--warm-threshold-pct",
        "10",
        "--cold-threshold-pct",
        "15",
        "--p95-threshold-pct",
        "20",
      ],
      { encoding: "utf-8" }
    );

    expect(result.status).toBe(0);

    const compare = JSON.parse(fs.readFileSync(outPath, "utf-8")) as {
      summary: { alertCount: number };
      pairs: { alerts: { metric: string }[] }[];
    };

    expect(compare.summary.alertCount).toBeGreaterThan(0);
    expect(compare.pairs[0]?.alerts.map((alert) => alert.metric)).toContain("warm-p50");
    expect(compare.pairs[0]?.alerts.map((alert) => alert.metric)).toContain("warm-p95");
    expect(compare.pairs[0]?.alerts.map((alert) => alert.metric)).toContain("cold");
  });

  it("ignores tiny absolute deltas when base metric is under the small-baseline threshold", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-test-"));
    const basePath = path.join(tempDir, "base-summary.json");
    const headPath = path.join(tempDir, "head-summary.json");
    const outPath = path.join(tempDir, "compare.json");

    writeJson(basePath, makeSummary({ cold: 90, warmP50: 50, warmP95: 70 }));
    writeJson(headPath, makeSummary({ cold: 100, warmP50: 60, warmP95: 80 }));

    const result = spawnSync(
      "node",
      [
        COMPARE,
        "--base-summary",
        basePath,
        "--head-summary",
        headPath,
        "--out-json",
        outPath,
        "--small-baseline-ms",
        "100",
        "--min-absolute-delta-ms",
        "15",
      ],
      { encoding: "utf-8" }
    );

    expect(result.status).toBe(0);

    const compare = JSON.parse(fs.readFileSync(outPath, "utf-8")) as {
      summary: { alertCount: number };
    };

    expect(compare.summary.alertCount).toBe(0);
  });
});

describe("benchmark contract validators", () => {
  it("validates summary shape", async () => {
    const contractsPath = path.join(ROOT, "scripts", "bench", "contracts.mjs");
    const contracts = (await import(pathToFileURL(contractsPath).href)) as {
      validateSummary: (value: unknown) => string[];
    };

    const validErrors = contracts.validateSummary(
      makeSummary({ cold: 1000, warmP50: 200, warmP95: 240 })
    );
    expect(validErrors).toHaveLength(0);

    const invalidErrors = contracts.validateSummary({
      version: "1.0",
      profileScenarioSummaries: {
        P1: {
          "batch-all": {
            warm: {
              wallMs: {
                mean: 10,
              },
            },
          },
        },
      },
    });
    expect(invalidErrors.length).toBeGreaterThan(0);
  });

  it("exports a valid site benchmark snapshot", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-test-"));
    const headPath = path.join(tempDir, "head-summary.json");
    const basePath = path.join(tempDir, "base-summary.json");
    const comparePath = path.join(tempDir, "compare.json");
    const outPath = path.join(tempDir, "site-snapshot.json");

    writeJson(headPath, makeSummary({ cold: 990, warmP50: 190, warmP95: 220 }));
    writeJson(basePath, makeSummary({ cold: 1000, warmP50: 200, warmP95: 230 }));
    writeJson(comparePath, makeCompare());

    const result = spawnSync(
      "node",
      [
        EXPORT_SNAPSHOT,
        "--head-summary",
        headPath,
        "--base-summary",
        basePath,
        "--compare",
        comparePath,
        "--out",
        outPath,
        "--repository",
        "f-campana/imageforge",
        "--workflow-name",
        "Benchmark CI",
        "--workflow-path",
        ".github/workflows/benchmark-ci.yml",
        "--run-id",
        "12345",
        "--run-attempt",
        "1",
        "--run-url",
        "https://github.com/f-campana/imageforge/actions/runs/12345",
        "--event-name",
        "schedule",
        "--ref-name",
        "main",
        "--sha",
        "abcdef123456",
        "--tier",
        "tier200",
        "--run-count",
        "10",
        "--dataset-version",
        "1.0.0",
        "--runner",
        "ubuntu-24.04",
        "--node-version",
        "22",
        "--headline-profile",
        "P2",
        "--headline-scenario",
        "batch-all",
      ],
      { encoding: "utf-8" }
    );

    expect(result.status).toBe(0);

    const snapshot = JSON.parse(fs.readFileSync(outPath, "utf-8")) as {
      schemaVersion: string;
      snapshotId: string;
      summary: { alertCount: number };
    };

    const contractsPath = path.join(ROOT, "scripts", "bench", "contracts.mjs");
    const contracts = (await import(pathToFileURL(contractsPath).href)) as {
      validateSiteSnapshot: (value: unknown) => string[];
    };

    expect(contracts.validateSiteSnapshot(snapshot)).toHaveLength(0);
    expect(snapshot.schemaVersion).toBe("1.0");
    expect(snapshot.snapshotId).toBe("12345.1");
    expect(snapshot.summary.alertCount).toBe(0);
  });
});
