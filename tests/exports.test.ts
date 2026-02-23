import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getDefaultConcurrency, runImageforge } from "../src/runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(__dirname, "exports-test-output");
describe("package exports", () => {
  it("exposes CJS require exports for root, processor, and runner subpaths", () => {
    const consumerDir = path.join(OUTPUT, "consumer");
    const scopeDir = path.join(consumerDir, "node_modules", "@imageforge");
    const packageLink = path.join(scopeDir, "cli");

    fs.rmSync(consumerDir, { recursive: true, force: true });
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(ROOT, packageLink, "dir");

    const script = [
      "const root = require('@imageforge/cli');",
      "const processor = require('@imageforge/cli/processor');",
      "const runner = require('@imageforge/cli/runner');",
      "if (typeof root.processImage !== 'function') throw new Error('missing root processImage export');",
      "if ('runImageforge' in root) throw new Error('runner should not be exported from root');",
      "if (typeof processor.convertImage !== 'function') throw new Error('missing processor convertImage export');",
      "if (typeof runner.runImageforge !== 'function') throw new Error('missing runner runImageforge export');",
      "if (typeof runner.getDefaultConcurrency !== 'function') throw new Error('missing runner getDefaultConcurrency export');",
      "console.log('ok');",
    ].join(" ");

    const result = spawnSync("node", ["-e", script], {
      cwd: consumerDir,
      encoding: "utf-8",
    });

    if (result.error) {
      throw result.error;
    }

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });

  it("exposes ESM import exports for root, processor, and runner subpaths", () => {
    const consumerDir = path.join(OUTPUT, "consumer-esm");
    const scopeDir = path.join(consumerDir, "node_modules", "@imageforge");
    const packageLink = path.join(scopeDir, "cli");

    fs.rmSync(consumerDir, { recursive: true, force: true });
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(ROOT, packageLink, "dir");

    const script = [
      "import * as root from '@imageforge/cli';",
      "import * as processor from '@imageforge/cli/processor';",
      "import * as runner from '@imageforge/cli/runner';",
      "if (typeof root.processImage !== 'function') throw new Error('missing root processImage export');",
      "if ('runImageforge' in root) throw new Error('runner should not be exported from root');",
      "if (typeof processor.convertImage !== 'function') throw new Error('missing processor convertImage export');",
      "if (typeof runner.runImageforge !== 'function') throw new Error('missing runner runImageforge export');",
      "if (typeof runner.getDefaultConcurrency !== 'function') throw new Error('missing runner getDefaultConcurrency export');",
      "console.log('ok');",
    ].join(" ");

    const result = spawnSync("node", ["--input-type=module", "-e", script], {
      cwd: consumerDir,
      encoding: "utf-8",
    });

    if (result.error) {
      throw result.error;
    }

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });
});

describe("runner defaults", () => {
  it("uses a bounded default concurrency", () => {
    const concurrency = getDefaultConcurrency();
    expect(concurrency).toBeGreaterThanOrEqual(1);
    expect(concurrency).toBeLessThanOrEqual(8);
  });
});

describe("cache atomic writes", () => {
  it("removes temporary cache files when atomic rename fails", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-cache-atomic-"));
    const inputDir = path.join(workspace, "images");
    fs.mkdirSync(inputDir, { recursive: true });
    await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: 50, g: 80, b: 120 },
      },
    })
      .jpeg()
      .toFile(path.join(inputDir, "asset.jpg"));

    const outputPath = path.join(workspace, "manifest.json");
    const cachePath = path.join(inputDir, ".imageforge-cache.json");
    fs.mkdirSync(cachePath, { recursive: true });

    try {
      await expect(
        runImageforge({
          version: "test",
          inputDir,
          outputPath,
          directoryArg: inputDir,
          commandName: "imageforge",
          formats: ["webp"],
          quality: 75,
          blur: true,
          blurSize: 4,
          widths: null,
          useCache: true,
          forceOverwrite: false,
          checkMode: false,
          outDir: null,
          concurrency: 1,
          json: true,
          verbose: false,
          quiet: false,
        })
      ).rejects.toThrow("EISDIR");
    } finally {
      const leakedTemps = fs
        .readdirSync(inputDir)
        .filter((entry) => entry.startsWith(".imageforge-cache.json.") && entry.endsWith(".tmp"));
      expect(leakedTemps).toHaveLength(0);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
