# Benchmark Interfaces

## `tier-manifest.json`

```json
{
  "version": "1.0",
  "datasetVersion": "1.0.0",
  "tierId": "tier30",
  "createdAt": "2026-02-15T00:00:00.000Z",
  "imageRoot": "images",
  "files": ["src-0001.jpg"],
  "singleScenarios": {
    "small": "src-0001.jpg",
    "median": "src-0015.png",
    "large": "src-0030.jpg"
  },
  "formatBreakdown": { "jpg": 20, "png": 7, "gif": 2, "tiff": 1 }
}
```

## `raw-runs.jsonl`

One JSON object per run:

```json
{
  "timestamp": "2026-02-15T00:00:00.000Z",
  "profileId": "P2",
  "scenario": "batch-all",
  "run": 1,
  "runCount": 10,
  "phase": "cold",
  "inputDir": "/tmp/bench/...",
  "outDir": "/tmp/bench/...",
  "manifestPath": "/tmp/bench/.../manifest.json",
  "exitCode": 0,
  "wallMs": 1234.56,
  "reportDurationMs": 1200,
  "total": 30,
  "processed": 30,
  "cached": 0,
  "failed": 0,
  "totalOriginalSize": 31960154,
  "totalProcessedSize": 57833285,
  "errorsLength": 0
}
```

## `summary.json`

```json
{
  "version": "1.0",
  "generatedAt": "2026-02-15T00:00:00.000Z",
  "benchmark": {},
  "validation": {
    "passed": true,
    "failureCount": 0,
    "failures": []
  },
  "profileScenarioSummaries": {
    "P2": {
      "batch-all": {
        "runCount": 10,
        "imageCount": 30,
        "cold": {
          "wallMs": 1000,
          "reportDurationMs": 980,
          "total": 30,
          "processed": 30,
          "cached": 0,
          "failed": 0,
          "errorsLength": 0,
          "imagesPerSec": 30,
          "perImageMs": 33.3,
          "originalBytes": 31960154,
          "processedBytes": 57833285
        },
        "warm": {
          "count": 9,
          "wallMs": { "mean": 120, "p50": 118, "p95": 135, "stddev": 6 },
          "reportDurationMs": { "mean": 24, "p50": 23, "p95": 30, "stddev": 2 },
          "imagesPerSecMean": 250,
          "perImageMsMean": 4
        },
        "speedup": {
          "coldVsWarmWallMean": 8.3,
          "coldVsWarmReportMean": 40.8
        },
        "validation": { "passed": true }
      }
    }
  }
}
```

## `site-benchmark-snapshot.json` (cross-repo sync contract)

```json
{
  "schemaVersion": "1.0",
  "snapshotId": "22036204221.1",
  "generatedAt": "2026-02-15T13:09:45.000Z",
  "asOfDate": "February 15, 2026",
  "owner": "ImageForge Maintainers (CLI + Growth)",
  "source": {
    "repository": "f-campana/imageforge",
    "workflowName": "Benchmark CI",
    "workflowPath": ".github/workflows/benchmark-ci.yml",
    "runId": 22036204221,
    "runAttempt": 1,
    "runUrl": "https://github.com/f-campana/imageforge/actions/runs/22036204221",
    "eventName": "schedule",
    "refName": "main",
    "sha": "4ff596ceb9d3d7e0057d82e071c834505a212868",
    "tier": "tier200",
    "runCount": 10,
    "datasetVersion": "1.0.0",
    "runner": "ubuntu-24.04",
    "nodeVersion": "22"
  },
  "thresholds": {
    "warmThresholdPct": 10,
    "coldThresholdPct": 15,
    "p95ThresholdPct": 20,
    "smallBaselineMs": 100,
    "minAbsoluteDeltaMs": 15
  },
  "summary": {
    "totalPairs": 12,
    "alertCount": 0,
    "hasAlerts": false,
    "headValidationPassed": true,
    "baseValidationPassed": true
  },
  "benchmark": {
    "headline": { "profileId": "P2", "scenario": "batch-all" }
  },
  "profileScenarioMetrics": {},
  "deltas": []
}
```
