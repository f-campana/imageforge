import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as { version: string }
).version;

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {}
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("packaged install e2e", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-pack-e2e-"));
  const tarballDir = path.join(tempRoot, "tarball");
  const consumerDir = path.join(tempRoot, "consumer");
  const oneShotDir = path.join(tempRoot, "oneshot");
  const npmCacheDir = path.join(tempRoot, "npm-cache");
  const inputDir = path.join(consumerDir, "images");
  const oneShotInputDir = path.join(oneShotDir, "images");
  const manifestPath = path.join(consumerDir, "imageforge.json");
  const oneShotManifestPath = path.join(oneShotDir, "imageforge.json");

  beforeAll(async () => {
    fs.mkdirSync(tarballDir, { recursive: true });
    fs.mkdirSync(consumerDir, { recursive: true });
    fs.mkdirSync(oneShotDir, { recursive: true });
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(oneShotInputDir, { recursive: true });

    await sharp({
      create: {
        width: 96,
        height: 64,
        channels: 3,
        background: { r: 90, g: 120, b: 150 },
      },
    })
      .jpeg({ quality: 90 })
      .toFile(path.join(inputDir, "fixture.jpg"));

    await sharp({
      create: {
        width: 88,
        height: 66,
        channels: 3,
        background: { r: 120, g: 100, b: 80 },
      },
    })
      .jpeg({ quality: 90 })
      .toFile(path.join(oneShotInputDir, "oneshot.jpg"));
  });

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("packs, installs from tarball, and runs through npx", () => {
    const pack = runCommand("pnpm", ["pack", "--pack-destination", tarballDir], ROOT, {
      npm_config_cache: npmCacheDir,
    });
    expect(pack.status).toBe(0);

    const tarballPath = path.join(tarballDir, `imageforge-cli-${PACKAGE_VERSION}.tgz`);
    expect(fs.existsSync(tarballPath)).toBe(true);

    const oneShot = runCommand(
      "npm",
      [
        "exec",
        "--yes",
        "--package",
        tarballPath,
        "--",
        "imageforge",
        oneShotInputDir,
        "-o",
        oneShotManifestPath,
      ],
      oneShotDir,
      {
        npm_config_cache: npmCacheDir,
      }
    );
    expect(oneShot.status).toBe(0);
    expect(fs.existsSync(oneShotManifestPath)).toBe(true);
    expect(fs.existsSync(path.join(oneShotInputDir, "oneshot.webp"))).toBe(true);

    const init = runCommand("npm", ["init", "-y"], consumerDir, {
      npm_config_cache: npmCacheDir,
    });
    expect(init.status).toBe(0);

    const install = runCommand("npm", ["install", tarballPath], consumerDir, {
      npm_config_cache: npmCacheDir,
    });
    expect(install.status).toBe(0);

    const requireMatrixScript = [
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
    const requireMatrix = runCommand("node", ["-e", requireMatrixScript], consumerDir, {
      npm_config_cache: npmCacheDir,
    });
    expect(requireMatrix.status).toBe(0);
    expect(requireMatrix.stdout.trim()).toBe("ok");

    const importMatrixScript = [
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
    const importMatrix = runCommand(
      "node",
      ["--input-type=module", "-e", importMatrixScript],
      consumerDir,
      {
        npm_config_cache: npmCacheDir,
      }
    );
    expect(importMatrix.status).toBe(0);
    expect(importMatrix.stdout.trim()).toBe("ok");

    const version = runCommand("npx", ["imageforge", "--version"], consumerDir, {
      npm_config_cache: npmCacheDir,
    });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(PACKAGE_VERSION);

    const run = runCommand(
      "npx",
      ["imageforge", inputDir, "-o", manifestPath, "-f", "webp,avif", "--widths", "48,96,160"],
      consumerDir,
      {
        npm_config_cache: npmCacheDir,
      }
    );

    expect(run.status).toBe(0);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(inputDir, "fixture.w48.webp"))).toBe(true);
    expect(fs.existsSync(path.join(inputDir, "fixture.w96.webp"))).toBe(true);
    expect(fs.existsSync(path.join(inputDir, "fixture.w160.webp"))).toBe(false);
    expect(fs.existsSync(path.join(inputDir, "fixture.w48.avif"))).toBe(true);
    expect(fs.existsSync(path.join(inputDir, "fixture.w96.avif"))).toBe(true);
    expect(fs.existsSync(path.join(inputDir, "fixture.w160.avif"))).toBe(false);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      images: Record<
        string,
        {
          outputs: Record<string, { path: string }>;
          variants?: Partial<Record<string, { width: number }[]>>;
        }
      >;
    };
    expect(manifest.images["fixture.jpg"]).toBeDefined();
    expect(Object.keys(manifest.images["fixture.jpg"].outputs)).toEqual(["webp", "avif"]);
    expect(manifest.images["fixture.jpg"].outputs.webp.path).toBe("fixture.w96.webp");
    expect(manifest.images["fixture.jpg"].outputs.avif.path).toBe("fixture.w96.avif");
    expect(manifest.images["fixture.jpg"].variants?.webp?.map((variant) => variant.width)).toEqual([
      48, 96,
    ]);
    expect(manifest.images["fixture.jpg"].variants?.avif?.map((variant) => variant.width)).toEqual([
      48, 96,
    ]);
  }, 180_000);
});
