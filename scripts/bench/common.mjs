#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function parseArgs(argv) {
  const args = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return { args, positionals };
}

export function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function formatIsoNow() {
  return new Date().toISOString();
}

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

export async function downloadFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  ensureDir(path.dirname(destinationPath));
  const output = fs.createWriteStream(destinationPath);

  await new Promise((resolve, reject) => {
    response.body
      .pipeTo(
        new WritableStream({
          write(chunk) {
            output.write(Buffer.from(chunk));
          },
          close() {
            output.end();
            resolve();
          },
          abort(error) {
            output.destroy(error);
            reject(error);
          },
        })
      )
      .catch((error) => {
        output.destroy(error);
        reject(error);
      });
  });
}

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export function stddev(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

export function listFilesRecursive(rootDir, predicate = () => true) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

export function resolvePath(inputPath, cwd = process.cwd()) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
}

export function isSupportedImageExtension(filePath) {
  return /\.(?:jpe?g|png|gif|tiff?)$/iu.test(filePath);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes.toString()}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
