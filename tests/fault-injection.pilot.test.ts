import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const SYNC_SITE_BENCHMARK = path.join(ROOT, "scripts", "bench", "sync-site-benchmark.mjs");

const installCommand = "pnpm install --frozen-lockfile";
const formatterCommand =
  "pnpm exec prettier --write data/benchmarks/latest.json data/benchmarks/history.json";
const gitAddCommand = "git add -A";
const gitPushCommand = "git push --force-with-lease origin codex/benchmark-sync-nightly";

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function makeSiteSnapshot() {
  return {
    schemaVersion: "1.0",
    snapshotId: "123.1",
    generatedAt: "2026-02-23T00:00:00.000Z",
    asOfDate: "February 23, 2026",
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

function writeTemplateRepo(templateRepoDir: string): void {
  fs.mkdirSync(path.join(templateRepoDir, "scripts", "benchmark"), {
    recursive: true,
  });
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
}

function writeGitStub(binDir: string): void {
  const gitPath = path.join(binDir, "git");
  fs.writeFileSync(
    gitPath,
    `#!/bin/sh
printf "git %s\\n" "$*" >> "$IMAGEFORGE_TEST_GIT_OPS_LOG"

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
  printf " M data/benchmarks/latest.json\\n"
  exit 0
fi

if [ "$1" = "push" ]; then
  echo "git push failed token=$GIT_ASKPASS_PASSWORD" >&2
  exit 42
fi

exit 0
`,
    { encoding: "utf-8", mode: 0o755 }
  );
  fs.chmodSync(gitPath, 0o755);
}

describe("fault-injection pilot: benchmark site sync", () => {
  it("fails closed and redacts token on git push failure", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-fault-redact-"));
    const binDir = path.join(tempDir, "bin");
    const templateRepoDir = path.join(tempDir, "site-template");
    const gitOpsLogPath = path.join(tempDir, "git-ops.log");
    fs.mkdirSync(binDir, { recursive: true });
    writeTemplateRepo(templateRepoDir);
    writeGitStub(binDir);

    const pnpmPath = path.join(binDir, "pnpm");
    fs.writeFileSync(
      pnpmPath,
      `#!/bin/sh
printf "pnpm %s\\n" "$*" >> "$IMAGEFORGE_TEST_PNPM_OPS_LOG"
exit 0
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(pnpmPath, 0o755);

    const pnpmOpsLogPath = path.join(tempDir, "pnpm-ops.log");
    const snapshotPath = path.join(tempDir, "snapshot.json");
    const workspace = path.join(tempDir, "workspace");
    writeJson(snapshotPath, makeSiteSnapshot());
    const sentinelToken = "fault-injection-sentinel-token";

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
            TEST_SYNC_TOKEN: sentinelToken,
            IMAGEFORGE_TEST_GIT_OPS_LOG: gitOpsLogPath,
            IMAGEFORGE_TEST_PNPM_OPS_LOG: pnpmOpsLogPath,
            IMAGEFORGE_TEST_SITE_TEMPLATE: templateRepoDir,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        }
      );

      expect(result.status).toBe(1);
      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      expect(combinedOutput).toContain("[REDACTED]");
      expect(combinedOutput).not.toContain(sentinelToken);

      const gitOperations = fs.readFileSync(gitOpsLogPath, "utf-8");
      expect(gitOperations).toContain(gitAddCommand);
      expect(gitOperations).toContain(gitPushCommand);
      const pnpmOperations = fs.readFileSync(pnpmOpsLogPath, "utf-8");
      expect(pnpmOperations).toContain(installCommand);
      expect(pnpmOperations).toContain(formatterCommand);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exits nonzero and stops before formatter when dependency install fails", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-fault-install-"));
    const binDir = path.join(tempDir, "bin");
    const templateRepoDir = path.join(tempDir, "site-template");
    const gitOpsLogPath = path.join(tempDir, "git-ops.log");
    const pnpmOpsLogPath = path.join(tempDir, "pnpm-ops.log");
    fs.mkdirSync(binDir, { recursive: true });
    writeTemplateRepo(templateRepoDir);

    const gitPath = path.join(binDir, "git");
    fs.writeFileSync(
      gitPath,
      `#!/bin/sh
printf "git %s\\n" "$*" >> "$IMAGEFORGE_TEST_GIT_OPS_LOG"

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
  printf " M data/benchmarks/latest.json\\n"
  exit 0
fi

exit 0
`,
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(gitPath, 0o755);

    const pnpmPath = path.join(binDir, "pnpm");
    fs.writeFileSync(
      pnpmPath,
      `#!/bin/sh
printf "pnpm %s\\n" "$*" >> "$IMAGEFORGE_TEST_PNPM_OPS_LOG"

if [ "$1" = "install" ]; then
  echo "simulated install failure" >&2
  exit 65
fi

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
            TEST_SYNC_TOKEN: "fault-install-token",
            IMAGEFORGE_TEST_GIT_OPS_LOG: gitOpsLogPath,
            IMAGEFORGE_TEST_PNPM_OPS_LOG: pnpmOpsLogPath,
            IMAGEFORGE_TEST_SITE_TEMPLATE: templateRepoDir,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        }
      );

      expect(result.status).toBe(1);
      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      expect(combinedOutput).toContain("pnpm install --frozen-lockfile failed");

      const gitOperations = fs.readFileSync(gitOpsLogPath, "utf-8");
      expect(gitOperations).not.toContain("git status --porcelain");

      const pnpmOperations = fs.readFileSync(pnpmOpsLogPath, "utf-8");
      expect(pnpmOperations).toContain(installCommand);
      expect(pnpmOperations).not.toContain(formatterCommand);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
