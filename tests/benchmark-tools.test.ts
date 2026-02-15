import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");
const COMPARE = path.join(ROOT, "scripts", "bench", "compare-benchmark.mjs");

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
});
