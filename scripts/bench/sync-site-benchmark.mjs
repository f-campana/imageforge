#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parseArgs, readJson, resolvePath, writeJson } from "./common.mjs";
import { assertValid, validateSiteSnapshot } from "./contracts.mjs";

let activeRedact = (value) => String(value ?? "");

function usage() {
  console.log(`Usage: node scripts/bench/sync-site-benchmark.mjs \\
  --snapshot <path> \\
  [--site-repo <owner/repo>] \\
  [--site-default-branch <branch>] \\
  [--site-branch <branch>] \\
  [--retention <n>] \\
  [--workspace <path>] \\
  [--token-env <name>] \\
  [--pr-title <title>]`);
}

function createRedactor(secretValues) {
  const secrets = secretValues
    .filter((value) => typeof value === "string" && value.length > 0)
    .flatMap((value) => [value, encodeURIComponent(value)]);

  return (value) => {
    let text = String(value ?? "");
    for (const secret of secrets) {
      text = text.split(secret).join("[REDACTED]");
    }
    return text;
  };
}

function formatCommand(command, args, redact) {
  return [command, ...args].map((part) => redact(part)).join(" ");
}

function runChecked(command, args, options = {}, redact = activeRedact) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options,
  });

  if (result.error) {
    throw new Error(redact(result.error.message));
  }

  if ((result.status ?? 1) !== 0) {
    const stderr = redact(result.stderr ?? "").trim();
    const stdout = redact(result.stdout ?? "").trim();
    const details = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(
      `${formatCommand(command, args, redact)} failed with exit code ${(result.status ?? 1).toString()}${details ? `\n${details}` : ""}`
    );
  }

  return result;
}

function runAllowFailure(command, args, options = {}, redact = activeRedact) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options,
  });

  if (result.error) {
    throw new Error(redact(result.error.message));
  }

  return result;
}

function createGitCredentialEnv(token) {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-git-auth-"));
  const askpassPath = path.join(authDir, "askpass.sh");
  const askpassScript = `#!/bin/sh
case "$1" in
  *Username*|*username*)
    printf "%s\\n" "\${GIT_ASKPASS_USERNAME:-x-access-token}"
    ;;
  *Password*|*password*)
    printf "%s\\n" "\${GIT_ASKPASS_PASSWORD}"
    ;;
  *)
    printf "\\n"
    ;;
esac
`;
  fs.writeFileSync(askpassPath, askpassScript, { encoding: "utf-8", mode: 0o700 });
  fs.chmodSync(askpassPath, 0o700);

  return {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: askpassPath,
      GIT_ASKPASS_USERNAME: "x-access-token",
      GIT_ASKPASS_PASSWORD: token,
    },
    cleanup: () => {
      fs.rmSync(authDir, { recursive: true, force: true });
    },
  };
}

function parseRepoSlug(value) {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo slug '${value}', expected owner/repo.`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function buildPrBody(snapshot, siteRepo, siteBranch, siteDefaultBranch) {
  const thresholds = snapshot.thresholds;
  return [
    "## Summary",
    "Automated benchmark snapshot sync from ImageForge benchmark CI.",
    "",
    "## Source",
    `- Workflow run: ${snapshot.source.runUrl}`,
    `- Commit: ${snapshot.source.sha}`,
    `- Tier: ${snapshot.source.tier}`,
    `- Dataset version: ${snapshot.source.datasetVersion}`,
    `- Run count: ${snapshot.source.runCount.toString()}`,
    `- Snapshot ID: ${snapshot.snapshotId}`,
    "",
    "## Thresholds (Advisory)",
    `- Warm p50: +${thresholds.warmThresholdPct.toString()}%`,
    `- Cold wall: +${thresholds.coldThresholdPct.toString()}%`,
    `- Warm p95: +${thresholds.p95ThresholdPct.toString()}%`,
    "",
    "## Result",
    `- Compared pairs: ${snapshot.summary.totalPairs.toString()}`,
    `- Alerts: ${snapshot.summary.alertCount.toString()}`,
    `- Head validation passed: ${snapshot.summary.headValidationPassed ? "yes" : "no"}`,
    `- Base validation passed: ${snapshot.summary.baseValidationPassed ? "yes" : "no"}`,
    "",
    "## Notes",
    `- Target repo: ${siteRepo}`,
    `- Target branch: ${siteBranch}`,
    `- Base branch: ${siteDefaultBranch}`,
    "- Approval gate only: no auto-merge.",
  ].join("\n");
}

async function githubRequest({ token, method = "GET", url, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status.toString()} ${url}: ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function createOrUpdatePr({
  token,
  siteRepo,
  siteDefaultBranch,
  siteBranch,
  prTitle,
  prBody,
}) {
  const { owner, repo } = parseRepoSlug(siteRepo);

  const listUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(
    siteBranch
  )}&base=${encodeURIComponent(siteDefaultBranch)}`;
  const pulls = await githubRequest({ token, url: listUrl });

  if (Array.isArray(pulls) && pulls.length > 0) {
    const existing = pulls[0];
    const updateUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${existing.number.toString()}`;
    const updated = await githubRequest({
      token,
      method: "PATCH",
      url: updateUrl,
      body: {
        title: prTitle,
        body: prBody,
      },
    });
    console.log(`Updated PR #${updated.number.toString()}: ${updated.html_url}`);
    return;
  }

  const createUrl = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const created = await githubRequest({
    token,
    method: "POST",
    url: createUrl,
    body: {
      title: prTitle,
      head: siteBranch,
      base: siteDefaultBranch,
      body: prBody,
      maintainer_can_modify: true,
    },
  });

  console.log(`Created PR #${created.number.toString()}: ${created.html_url}`);
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const snapshotPath = args.snapshot ? resolvePath(args.snapshot) : "";
  if (!snapshotPath) {
    usage();
    throw new Error("--snapshot is required.");
  }

  const tokenEnv =
    typeof args["token-env"] === "string" && args["token-env"].trim().length > 0
      ? args["token-env"].trim()
      : "IMAGEFORGE_SITE_SYNC_TOKEN";
  const token = process.env[tokenEnv]?.trim();
  if (!token) {
    throw new Error(`Missing required token env '${tokenEnv}'.`);
  }
  const redact = createRedactor([token]);
  activeRedact = redact;

  const siteRepo =
    typeof args["site-repo"] === "string" && args["site-repo"].trim().length > 0
      ? args["site-repo"].trim()
      : "f-campana/imageforge-site";
  const siteDefaultBranch =
    typeof args["site-default-branch"] === "string" && args["site-default-branch"].trim().length > 0
      ? args["site-default-branch"].trim()
      : "main";
  const siteBranch =
    typeof args["site-branch"] === "string" && args["site-branch"].trim().length > 0
      ? args["site-branch"].trim()
      : "codex/benchmark-sync-nightly";

  const retention = typeof args.retention === "string" ? Number.parseInt(args.retention, 10) : 20;
  if (!Number.isInteger(retention) || retention < 1) {
    throw new Error("--retention must be an integer >= 1.");
  }

  const prTitle =
    typeof args["pr-title"] === "string" && args["pr-title"].trim().length > 0
      ? args["pr-title"].trim()
      : "chore(benchmark): sync nightly benchmark snapshot";

  const snapshot = readJson(snapshotPath);
  assertValid(validateSiteSnapshot(snapshot), "site benchmark snapshot");

  const workspace =
    typeof args.workspace === "string" && args.workspace.trim().length > 0
      ? resolvePath(args.workspace)
      : fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-site-sync-"));

  fs.mkdirSync(workspace, { recursive: true });
  const cloneDir = path.join(workspace, "imageforge-site");
  fs.rmSync(cloneDir, { recursive: true, force: true });

  const remoteUrl = `https://github.com/${siteRepo}.git`;
  const gitCredential = createGitCredentialEnv(token);

  try {
    runChecked(
      "git",
      ["clone", "--depth", "1", "--branch", siteDefaultBranch, remoteUrl, cloneDir],
      { env: gitCredential.env },
      redact
    );

    const existingBranch = runAllowFailure(
      "git",
      ["ls-remote", "--exit-code", "--heads", "origin", siteBranch],
      { cwd: cloneDir, env: gitCredential.env },
      redact
    );

    let pushLeaseArg = "--force-with-lease";
    if ((existingBranch.status ?? 1) === 0) {
      const remoteBranchSha = existingBranch.stdout.trim().split(/\s+/)[0];
      if (!remoteBranchSha) {
        throw new Error(`Unable to determine remote SHA for branch '${siteBranch}'.`);
      }

      runChecked(
        "git",
        ["fetch", "--depth", "1", "origin", `${siteBranch}:refs/remotes/origin/${siteBranch}`],
        {
          cwd: cloneDir,
          env: gitCredential.env,
        },
        redact
      );
      runChecked(
        "git",
        ["checkout", "-B", siteBranch, `origin/${siteBranch}`],
        {
          cwd: cloneDir,
          env: gitCredential.env,
        },
        redact
      );

      pushLeaseArg = `--force-with-lease=refs/heads/${siteBranch}:${remoteBranchSha}`;
    } else {
      runChecked(
        "git",
        ["checkout", "-B", siteBranch, `origin/${siteDefaultBranch}`],
        {
          cwd: cloneDir,
          env: gitCredential.env,
        },
        redact
      );
    }

    const localSnapshotPath = path.join(cloneDir, ".tmp", "site-benchmark-snapshot.json");
    writeJson(localSnapshotPath, snapshot);

    runChecked(
      "node",
      [
        "scripts/benchmark/upsert-snapshot.mjs",
        "--snapshot",
        localSnapshotPath,
        "--retention",
        retention.toString(),
      ],
      { cwd: cloneDir },
      redact
    );

    runChecked(
      "pnpm",
      [
        "exec",
        "prettier",
        "--write",
        "data/benchmarks/latest.json",
        "data/benchmarks/history.json",
      ],
      { cwd: cloneDir },
      redact
    );

    const status = runChecked("git", ["status", "--porcelain"], { cwd: cloneDir }, redact);
    if (status.stdout.trim().length === 0) {
      console.log("No site changes detected; skipping commit and PR update.");
      return;
    }

    runChecked(
      "git",
      ["config", "user.name", "imageforge-benchmark-bot"],
      { cwd: cloneDir },
      redact
    );
    runChecked(
      "git",
      ["config", "user.email", "imageforge-benchmark-bot@users.noreply.github.com"],
      { cwd: cloneDir },
      redact
    );

    runChecked("git", ["add", "-A"], { cwd: cloneDir }, redact);

    const commitMessage = `chore(benchmark): sync snapshot ${snapshot.snapshotId}`;
    runChecked("git", ["commit", "-m", commitMessage], { cwd: cloneDir }, redact);

    runChecked(
      "git",
      ["push", pushLeaseArg, "origin", siteBranch],
      {
        cwd: cloneDir,
        env: gitCredential.env,
      },
      redact
    );

    const prBody = buildPrBody(snapshot, siteRepo, siteBranch, siteDefaultBranch);
    await createOrUpdatePr({
      token,
      siteRepo,
      siteDefaultBranch,
      siteBranch,
      prTitle,
      prBody,
    });
  } finally {
    gitCredential.cleanup();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(activeRedact(message));
  process.exitCode = 1;
});
