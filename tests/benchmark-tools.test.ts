import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "..");
const COMPARE = path.join(ROOT, "scripts", "bench", "compare-benchmark.mjs");
const EXPORT_SNAPSHOT = path.join(ROOT, "scripts", "bench", "export-site-snapshot.mjs");
const FETCH_SOURCES = path.join(ROOT, "scripts", "bench", "fetch-sources.mjs");
const ASSERT_DATASET_TAG_ABSENT = path.join(
  ROOT,
  "scripts",
  "bench",
  "assert-dataset-tag-absent.mjs"
);
const SYNC_SITE_BENCHMARK = path.join(ROOT, "scripts", "bench", "sync-site-benchmark.mjs");

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

function readOutputVar(output: string, key: string): string | null {
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith(`${key}=`)) {
      return line.slice(key.length + 1).trim();
    }
  }
  return null;
}

function toDataUrl(contents: string) {
  return `data:application/octet-stream;base64,${Buffer.from(contents, "utf-8").toString("base64")}`;
}

function makeSiteSnapshot() {
  return {
    schemaVersion: "1.0",
    snapshotId: "123.1",
    generatedAt: "2026-02-19T00:00:00.000Z",
    asOfDate: "February 19, 2026",
    owner: "ImageForge Maintainers",
    source: {
      repository: "f-campana/imageforge",
      workflowName: "Benchmark CI",
      workflowPath: ".github/workflows/benchmark-ci.yml",
      runId: 123,
      runAttempt: 1,
      runUrl: "https://example.com/runs/123",
      eventName: "schedule",
      refName: "main",
      sha: "abcdef123456",
      tier: "tier200",
      runCount: 10,
      datasetVersion: "1.0.0",
      runner: "ubuntu-24.04",
      nodeVersion: "22",
    },
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
      headValidationPassed: true,
      baseValidationPassed: true,
    },
    benchmark: {
      profiles: ["P2"],
      scenarios: ["batch-all"],
      headline: {
        profileId: "P2",
        scenario: "batch-all",
      },
    },
    profileScenarioMetrics: {
      P2: {
        "batch-all": {
          runCount: 10,
          imageCount: 30,
          coldWallMs: 1000,
          warmMeanMs: 120,
          warmP50Ms: 118,
          warmP95Ms: 135,
          warmStddevMs: 6,
          speedup: 8.3,
          coldImagesPerSec: 30,
          warmImagesPerSec: 250,
          coldPerImageMs: 33.3,
          warmPerImageMs: 4,
          coldOriginalBytes: 31960154,
          coldProcessedBytes: 57833285,
          validationPassed: true,
        },
      },
    },
    deltas: [],
  };
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

describe("benchmark source fetch integrity", () => {
  it("fails when an enabled source has a blank sha256", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-fetch-"));
    const sourcesPath = path.join(tempDir, "dataset-sources.json");
    const outDir = path.join(tempDir, "out");

    try {
      writeJson(sourcesPath, {
        version: "1.0",
        updatedAt: "2026-02-19T00:00:00.000Z",
        policy: "open-license-plus-synthetic",
        sources: [
          {
            id: "unpinned-source",
            url: toDataUrl("fixture-ok"),
            license: "CC0",
            attribution: "test",
            filename: "ok.bin",
            sha256: "",
            enabled: true,
          },
        ],
      });

      const result = spawnSync(
        "node",
        [FETCH_SOURCES, "--sources-file", sourcesPath, "--out-dir", outDir],
        { cwd: ROOT, encoding: "utf-8" }
      );

      expect(result.status).toBe(1);
      const reportPath = readOutputVar(result.stdout, "FETCH_REPORT_JSON");
      expect(reportPath).toBe(path.join(outDir, "fetch-report.json"));
      if (!reportPath) {
        throw new Error("Missing FETCH_REPORT_JSON output.");
      }

      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as {
        failed: number;
        integrity: { missingHash: number };
      };
      expect(report.failed).toBe(1);
      expect(report.integrity.missingHash).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails on checksum mismatch by default", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-fetch-"));
    const sourcesPath = path.join(tempDir, "dataset-sources.json");
    const outDir = path.join(tempDir, "out");

    try {
      writeJson(sourcesPath, {
        version: "1.0",
        updatedAt: "2026-02-19T00:00:00.000Z",
        policy: "open-license-plus-synthetic",
        sources: [
          {
            id: "checksum-mismatch",
            url: toDataUrl("fixture-mismatch"),
            license: "CC0",
            attribution: "test",
            filename: "mismatch.bin",
            sha256: "a".repeat(64),
            enabled: true,
          },
        ],
      });

      const result = spawnSync(
        "node",
        [FETCH_SOURCES, "--sources-file", sourcesPath, "--out-dir", outDir],
        { cwd: ROOT, encoding: "utf-8" }
      );

      expect(result.status).toBe(1);
      const report = JSON.parse(
        fs.readFileSync(path.join(outDir, "fetch-report.json"), "utf-8")
      ) as {
        failed: number;
        integrity: { checksumMismatch: number };
      };
      expect(report.failed).toBe(1);
      expect(report.integrity.checksumMismatch).toBe(1);
      expect(fs.existsSync(path.join(outDir, "mismatch.bin"))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails on source download errors by default", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-fetch-"));
    const sourcesPath = path.join(tempDir, "dataset-sources.json");
    const outDir = path.join(tempDir, "out");

    try {
      writeJson(sourcesPath, {
        version: "1.0",
        updatedAt: "2026-02-19T00:00:00.000Z",
        policy: "open-license-plus-synthetic",
        sources: [
          {
            id: "download-fail",
            url: "http://127.0.0.1:1/fail.bin",
            license: "CC0",
            attribution: "test",
            filename: "fail.bin",
            sha256: "b".repeat(64),
            enabled: true,
          },
        ],
      });

      const result = spawnSync(
        "node",
        [FETCH_SOURCES, "--sources-file", sourcesPath, "--out-dir", outDir],
        { cwd: ROOT, encoding: "utf-8" }
      );

      expect(result.status).toBe(1);
      const report = JSON.parse(
        fs.readFileSync(path.join(outDir, "fetch-report.json"), "utf-8")
      ) as {
        failed: number;
        integrity: { downloadFailed: number };
      };
      expect(report.failed).toBe(1);
      expect(report.integrity.downloadFailed).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("supports controlled waiver mode with allow-partial and allow-unpinned-sources", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-fetch-"));
    const sourcesPath = path.join(tempDir, "dataset-sources.json");
    const outDir = path.join(tempDir, "out");

    try {
      writeJson(sourcesPath, {
        version: "1.0",
        updatedAt: "2026-02-19T00:00:00.000Z",
        policy: "open-license-plus-synthetic",
        sources: [
          {
            id: "unpinned-allowed",
            url: toDataUrl("fixture-ok"),
            license: "CC0",
            attribution: "test",
            filename: "ok.bin",
            sha256: "",
            enabled: true,
          },
          {
            id: "checksum-mismatch",
            url: toDataUrl("fixture-mismatch"),
            license: "CC0",
            attribution: "test",
            filename: "mismatch.bin",
            sha256: "c".repeat(64),
            enabled: true,
          },
          {
            id: "download-fail",
            url: "http://127.0.0.1:1/fail.bin",
            license: "CC0",
            attribution: "test",
            filename: "fail.bin",
            sha256: "d".repeat(64),
            enabled: true,
          },
        ],
      });

      const result = spawnSync(
        "node",
        [
          FETCH_SOURCES,
          "--sources-file",
          sourcesPath,
          "--out-dir",
          outDir,
          "--allow-unpinned-sources",
          "--allow-partial",
        ],
        { cwd: ROOT, encoding: "utf-8" }
      );

      expect(result.status).toBe(0);
      const report = JSON.parse(
        fs.readFileSync(path.join(outDir, "fetch-report.json"), "utf-8")
      ) as {
        hasIntegrityFailures: boolean;
        failed: number;
        integrity: {
          missingHash: number;
          checksumMismatch: number;
          downloadFailed: number;
        };
      };
      expect(report.hasIntegrityFailures).toBe(true);
      expect(report.failed).toBe(2);
      expect(report.integrity.missingHash).toBe(1);
      expect(report.integrity.checksumMismatch).toBe(1);
      expect(report.integrity.downloadFailed).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("dataset tag immutability preflight", () => {
  it("exits nonzero when dataset tag already exists", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-tag-"));
    const binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const ghPath = path.join(binDir, "gh");
    fs.writeFileSync(
      ghPath,
      `#!/bin/sh
if [ "$1" = "release" ] && [ "$2" = "view" ]; then
  echo "existing release"
  exit 0
fi
echo "unexpected args" >&2
exit 2
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(ghPath, 0o755);

    try {
      const result = spawnSync(
        "node",
        [ASSERT_DATASET_TAG_ABSENT, "--repo", "f-campana/imageforge", "--dataset-version", "1.2.3"],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("already exists");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exits zero when dataset tag is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-bench-tag-"));
    const binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const ghPath = path.join(binDir, "gh");
    fs.writeFileSync(
      ghPath,
      `#!/bin/sh
echo "release not found" >&2
exit 1
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(ghPath, 0o755);

    try {
      const result = spawnSync(
        "node",
        [ASSERT_DATASET_TAG_ABSENT, "--repo", "f-campana/imageforge", "--dataset-version", "9.9.9"],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("DATASET_TAG_ABSENT=bench-dataset-v9.9.9");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("sync-site benchmark secret redaction", () => {
  it("redacts token material from failing git command output", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-sync-redact-"));
    const binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const gitPath = path.join(binDir, "git");
    fs.writeFileSync(
      gitPath,
      `#!/bin/sh
echo "simulated git failure token=$GIT_ASKPASS_PASSWORD" >&2
exit 1
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(gitPath, 0o755);

    const snapshotPath = path.join(tempDir, "snapshot.json");
    writeJson(snapshotPath, makeSiteSnapshot());
    const sentinelToken = "phase1-secret-token-abc123";

    try {
      const result = spawnSync(
        "node",
        [
          SYNC_SITE_BENCHMARK,
          "--snapshot",
          snapshotPath,
          "--site-repo",
          "f-campana/imageforge-site",
          "--site-default-branch",
          "main",
          "--site-branch",
          "codex/benchmark-sync-nightly",
          "--workspace",
          tempDir,
          "--token-env",
          "TEST_SYNC_TOKEN",
        ],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            TEST_SYNC_TOKEN: sentinelToken,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        }
      );

      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      expect(result.status).toBe(1);
      expect(combinedOutput).toContain("[REDACTED]");
      expect(combinedOutput).not.toContain(sentinelToken);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("sync-site benchmark formatting normalization", () => {
  const installCommand = "pnpm install --frozen-lockfile";
  const formatterCommand =
    "pnpm exec prettier --write data/benchmarks/latest.json data/benchmarks/history.json";
  const gitStatusCommand = "git status --porcelain";

  const writeTemplateRepo = (templateRepoDir: string): void => {
    fs.mkdirSync(path.join(templateRepoDir, "scripts", "benchmark"), { recursive: true });
    fs.writeFileSync(
      path.join(templateRepoDir, "scripts", "benchmark", "upsert-snapshot.mjs"),
      `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const latestPath = path.resolve("data/benchmarks/latest.json");
const historyPath = path.resolve("data/benchmarks/history.json");
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(latestPath, '{"snapshotId":"raw"}', "utf-8");
fs.writeFileSync(historyPath, '{"items":[{"snapshotId":"raw"}]}', "utf-8");
`,
      "utf-8"
    );
  };

  const writeGitStub = (binDir: string): void => {
    const gitPath = path.join(binDir, "git");
    fs.writeFileSync(
      gitPath,
      `#!/bin/sh
printf "git %s\\n" "$*" >> "$IMAGEFORGE_TEST_OPS_LOG"

if [ "$1" = "clone" ]; then
  target=""
  for arg in "$@"; do
    target="$arg"
  done
  mkdir -p "$target"
  cp -R "$IMAGEFORGE_TEST_SITE_TEMPLATE"/. "$target"
  exit 0
fi

if [ "$1" = "ls-remote" ]; then
  exit 1
fi

if [ "$1" = "status" ]; then
  exit 0
fi

exit 0
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(gitPath, 0o755);
  };

  it("installs dependencies and invokes formatter before checking git status", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-sync-format-order-"));
    const binDir = path.join(tempDir, "bin");
    const templateRepoDir = path.join(tempDir, "site-template");
    const opsLogPath = path.join(tempDir, "ops.log");
    fs.mkdirSync(binDir, { recursive: true });
    writeTemplateRepo(templateRepoDir);
    writeGitStub(binDir);

    const pnpmPath = path.join(binDir, "pnpm");
    fs.writeFileSync(
      pnpmPath,
      `#!/bin/sh
printf "pnpm %s\\n" "$*" >> "$IMAGEFORGE_TEST_OPS_LOG"
exit 0
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(pnpmPath, 0o755);

    const snapshotPath = path.join(tempDir, "snapshot.json");
    const workspace = path.join(tempDir, "workspace");
    writeJson(snapshotPath, makeSiteSnapshot());

    try {
      const result = spawnSync(
        "node",
        [
          SYNC_SITE_BENCHMARK,
          "--snapshot",
          snapshotPath,
          "--site-repo",
          "f-campana/imageforge-site",
          "--site-default-branch",
          "main",
          "--site-branch",
          "codex/benchmark-sync-nightly",
          "--workspace",
          workspace,
          "--token-env",
          "TEST_SYNC_TOKEN",
        ],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            TEST_SYNC_TOKEN: "sync-format-token",
            IMAGEFORGE_TEST_OPS_LOG: opsLogPath,
            IMAGEFORGE_TEST_SITE_TEMPLATE: templateRepoDir,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        }
      );

      expect(result.status).toBe(0);
      const operations = fs.readFileSync(opsLogPath, "utf-8");
      expect(operations).toContain(installCommand);
      expect(operations).toContain(formatterCommand);
      expect(operations).toContain(gitStatusCommand);
      expect(operations.indexOf(installCommand)).toBeLessThan(operations.indexOf(formatterCommand));
      expect(operations.indexOf(formatterCommand)).toBeLessThan(
        operations.indexOf(gitStatusCommand)
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails before git status when formatter exits nonzero", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-sync-format-failure-"));
    const binDir = path.join(tempDir, "bin");
    const templateRepoDir = path.join(tempDir, "site-template");
    const opsLogPath = path.join(tempDir, "ops.log");
    fs.mkdirSync(binDir, { recursive: true });
    writeTemplateRepo(templateRepoDir);
    writeGitStub(binDir);

    const pnpmPath = path.join(binDir, "pnpm");
    fs.writeFileSync(
      pnpmPath,
      `#!/bin/sh
printf "pnpm %s\\n" "$*" >> "$IMAGEFORGE_TEST_OPS_LOG"

if [ "$1" = "install" ]; then
  exit 0
fi

echo "formatter failed" >&2
exit 42
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(pnpmPath, 0o755);

    const snapshotPath = path.join(tempDir, "snapshot.json");
    const workspace = path.join(tempDir, "workspace");
    writeJson(snapshotPath, makeSiteSnapshot());

    try {
      const result = spawnSync(
        "node",
        [
          SYNC_SITE_BENCHMARK,
          "--snapshot",
          snapshotPath,
          "--site-repo",
          "f-campana/imageforge-site",
          "--site-default-branch",
          "main",
          "--site-branch",
          "codex/benchmark-sync-nightly",
          "--workspace",
          workspace,
          "--token-env",
          "TEST_SYNC_TOKEN",
        ],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            TEST_SYNC_TOKEN: "sync-format-token",
            IMAGEFORGE_TEST_OPS_LOG: opsLogPath,
            IMAGEFORGE_TEST_SITE_TEMPLATE: templateRepoDir,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        }
      );

      expect(result.status).toBe(1);
      const operations = fs.readFileSync(opsLogPath, "utf-8");
      expect(operations).toContain(installCommand);
      expect(operations).toContain(formatterCommand);
      expect(operations).not.toContain(gitStatusCommand);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "pnpm exec prettier --write data/benchmarks/latest.json data/benchmarks/history.json failed"
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
