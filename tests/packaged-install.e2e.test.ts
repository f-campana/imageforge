import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";

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
  const npmCacheDir = path.join(tempRoot, "npm-cache");
  const inputDir = path.join(consumerDir, "images");
  const manifestPath = path.join(consumerDir, "imageforge.json");

  beforeAll(async () => {
    fs.mkdirSync(tarballDir, { recursive: true });
    fs.mkdirSync(consumerDir, { recursive: true });
    fs.mkdirSync(inputDir, { recursive: true });

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

    const init = runCommand("npm", ["init", "-y"], consumerDir, {
      npm_config_cache: npmCacheDir,
    });
    expect(init.status).toBe(0);

    const install = runCommand("npm", ["install", tarballPath], consumerDir, {
      npm_config_cache: npmCacheDir,
    });
    expect(install.status).toBe(0);

    const version = runCommand("npx", ["imageforge", "--version"], consumerDir, {
      npm_config_cache: npmCacheDir,
    });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(PACKAGE_VERSION);

    const run = runCommand(
      "npx",
      ["imageforge", inputDir, "-o", manifestPath, "-f", "webp,avif"],
      consumerDir,
      {
        npm_config_cache: npmCacheDir,
      }
    );

    expect(run.status).toBe(0);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(inputDir, "fixture.webp"))).toBe(true);
    expect(fs.existsSync(path.join(inputDir, "fixture.avif"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      images: Record<string, { outputs: Record<string, unknown> }>;
    };
    expect(manifest.images["fixture.jpg"]).toBeDefined();
    expect(Object.keys(manifest.images["fixture.jpg"].outputs)).toEqual(["webp", "avif"]);
  }, 180_000);
});
