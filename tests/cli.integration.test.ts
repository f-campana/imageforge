import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "cli-fixtures");
const OUTPUT = path.join(__dirname, "cli-test-output");
const CLI = path.join(ROOT, "dist", "cli.js");
const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as { version: string }
).version;

interface CliRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd = ROOT, extraEnv: Record<string, string> = {}): CliRunResult {
  const result = spawnSync("node", [CLI, ...args], {
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

function runCliAsync(
  args: string[],
  cwd = ROOT,
  extraEnv: Record<string, string> = {}
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI, ...args], {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        status: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

async function waitForPath(filePath: string, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (fs.existsSync(filePath)) return;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for path: ${filePath}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

async function createJpeg(
  filePath: string,
  width: number,
  height: number,
  background: { r: number; g: number; b: number }
) {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background,
    },
  })
    .jpeg({ quality: 90 })
    .toFile(filePath);
}

async function createPng(
  filePath: string,
  width: number,
  height: number,
  background: { r: number; g: number; b: number; alpha?: number }
) {
  await sharp({
    create: {
      width,
      height,
      channels: background.alpha === undefined ? 3 : 4,
      background,
    },
  })
    .png()
    .toFile(filePath);
}

beforeAll(async () => {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  fs.rmSync(OUTPUT, { recursive: true, force: true });

  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.mkdirSync(path.join(FIXTURES, "subdir"), { recursive: true });
  fs.mkdirSync(OUTPUT, { recursive: true });

  await createJpeg(path.join(FIXTURES, "photo.jpg"), 800, 600, {
    r: 100,
    g: 150,
    b: 200,
  });

  await createPng(path.join(FIXTURES, "transparent.png"), 200, 200, {
    r: 255,
    g: 0,
    b: 0,
    alpha: 128,
  });

  await createJpeg(path.join(FIXTURES, "subdir", "nested.jpg"), 100, 100, {
    r: 50,
    g: 50,
    b: 50,
  });

  await createJpeg(path.join(FIXTURES, "UPPER.JPG"), 60, 40, {
    r: 0,
    g: 50,
    b: 200,
  });

  await sharp({
    create: {
      width: 10,
      height: 20,
      channels: 3,
      background: { r: 10, g: 200, b: 100 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(path.join(FIXTURES, "oriented.jpg"));

  await sharp({
    create: {
      width: 48,
      height: 32,
      channels: 3,
      background: { r: 80, g: 100, b: 120 },
    },
  })
    .gif()
    .toFile(path.join(FIXTURES, "sample.gif"));

  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 140, g: 120, b: 100 },
    },
  })
    .tiff()
    .toFile(path.join(FIXTURES, "sample.tiff"));

  fs.writeFileSync(path.join(FIXTURES, "readme.txt"), "not an image");
  fs.writeFileSync(path.join(FIXTURES, "corrupt.jpg"), "");
});

afterAll(() => {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  fs.rmSync(OUTPUT, { recursive: true, force: true });
});
describe("CLI integration", () => {
  const cliDir = path.join(__dirname, "cli-fixtures");
  const manifestPath = path.join(OUTPUT, "manifest.json");

  beforeAll(async () => {
    fs.rmSync(cliDir, { recursive: true, force: true });
    fs.mkdirSync(cliDir, { recursive: true });
    await createJpeg(path.join(cliDir, "test.jpg"), 400, 300, { r: 200, g: 100, b: 50 });
  });

  afterAll(() => {
    fs.rmSync(cliDir, { recursive: true, force: true });
  });

  it("handles empty directories gracefully", () => {
    const emptyDir = path.join(cliDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = runCli([emptyDir, "-o", manifestPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No images found");
  });

  it("processes images and writes a valid manifest schema", () => {
    const result = runCli([cliDir, "-o", manifestPath]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(result.stdout).toContain(`imageforge v${PACKAGE_VERSION}`);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      version: string;
      generated: string;
      images: Record<string, unknown>;
    };

    expect(manifest.version).toBe("1.0");
    expect(new Date(manifest.generated).toISOString()).toBe(manifest.generated);
    expect(manifest.images["test.jpg"]).toBeDefined();

    expect(result.stdout).toContain("[1/1]");
  });

  it("uses cache on second run", () => {
    const result = runCli([cliDir, "-o", manifestPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("(cached)");
    expect(result.stdout).toContain("0 processed");
  });

  it("reprocesses when cached output file is deleted", () => {
    const outputFile = path.join(cliDir, "test.webp");
    fs.rmSync(outputFile, { force: true });

    const result = runCli([cliDir, "-o", manifestPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 processed");
  });

  it("reprocesses when quality changes", () => {
    fs.rmSync(path.join(cliDir, ".imageforge-cache.json"), { force: true });
    fs.rmSync(path.join(cliDir, "test.webp"), { force: true });

    const first = runCli([cliDir, "-o", manifestPath]);
    expect(first.status).toBe(0);

    const second = runCli([cliDir, "-o", manifestPath, "--quality", "60"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("1 processed");
  });

  it("creates both webp and avif with -f webp,avif", () => {
    const dir = path.join(cliDir, "dual-formats");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "dual.jpg"));

    const result = runCli([dir, "-f", "webp,avif", "-o", path.join(OUTPUT, "dual.json")]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, "dual.webp"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "dual.avif"))).toBe(true);
  });

  it("supports --widths with deduped ascending variants", () => {
    const dir = path.join(cliDir, "widths-dedupe");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "asset.jpg"));

    const outputManifest = path.join(OUTPUT, "widths-dedupe.json");
    const result = runCli([dir, "--widths", "300,100,300,200", "-o", outputManifest]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Requested widths:");
    expect(result.stdout).toContain("never upscale source images");

    expect(fs.existsSync(path.join(dir, "asset.w100.webp"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "asset.w200.webp"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "asset.w300.webp"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<
        string,
        {
          outputs: { webp: { path: string } };
          variants?: { webp?: { width: number }[] };
        }
      >;
    };

    expect(manifest.images["asset.jpg"].outputs.webp.path).toBe("asset.w300.webp");
    expect(manifest.images["asset.jpg"].variants?.webp?.map((variant) => variant.width)).toEqual([
      100, 200, 300,
    ]);
  });

  it("invalidates cache when widths set changes", () => {
    const dir = path.join(cliDir, "widths-cache");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "asset.jpg"));

    const outputManifest = path.join(OUTPUT, "widths-cache.json");
    const first = runCli([dir, "--widths", "100,200", "-o", outputManifest]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("1 processed");

    const second = runCli([dir, "--widths", "100,200", "-o", outputManifest]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("(cached)");

    const third = runCli([dir, "--widths", "100,150", "-o", outputManifest]);
    expect(third.status).toBe(0);
    expect(third.stdout).toContain("1 processed");
    expect(fs.existsSync(path.join(dir, "asset.w150.webp"))).toBe(true);
  });

  it("rejects more than 16 unique requested widths", () => {
    const widths = Array.from({ length: 17 }, (_, index) => (index + 1).toString()).join(",");
    const result = runCli([cliDir, "-o", manifestPath, "--widths", widths]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Maximum is 16");
  });

  it("accepts exactly 16 unique requested widths", async () => {
    const dir = path.join(cliDir, "widths-cap-16");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "asset.jpg"), 64, 48, { r: 1, g: 2, b: 3 });

    const widths = Array.from({ length: 16 }, (_, index) => (index + 1).toString()).join(",");
    const outputManifest = path.join(OUTPUT, "widths-cap-16.json");
    const result = runCli([dir, "--widths", widths, "-o", outputManifest]);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<string, { variants?: { webp?: { width: number }[] } }>;
    };
    expect(manifest.images["asset.jpg"].variants?.webp).toHaveLength(16);
  });

  it("normalizes duplicate and edge width values deterministically", async () => {
    const dir = path.join(cliDir, "widths-extremes");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "asset.jpg"), 64, 48, { r: 9, g: 8, b: 7 });

    const outputManifest = path.join(OUTPUT, "widths-extremes.json");
    const result = runCli([dir, "--widths", "64,1,16384,1,64", "-o", outputManifest]);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<
        string,
        { outputs: { webp: { path: string } }; variants?: { webp?: { width: number }[] } }
      >;
    };
    expect(manifest.images["asset.jpg"].outputs.webp.path).toBe("asset.w64.webp");
    expect(manifest.images["asset.jpg"].variants?.webp?.map((variant) => variant.width)).toEqual([
      1, 64,
    ]);
  });

  it("falls back to source width when all requested widths are larger", async () => {
    const dir = path.join(cliDir, "widths-fallback");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "tiny.jpg"), 80, 60, { r: 12, g: 34, b: 56 });

    const outputManifest = path.join(OUTPUT, "widths-fallback.json");
    const result = runCli([dir, "--widths", "320,640", "-o", outputManifest]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, "tiny.w80.webp"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<
        string,
        { outputs: { webp: { path: string } }; variants?: { webp?: { width: number }[] } }
      >;
    };

    expect(manifest.images["tiny.jpg"].outputs.webp.path).toBe("tiny.w80.webp");
    expect(manifest.images["tiny.jpg"].variants?.webp?.map((variant) => variant.width)).toEqual([
      80,
    ]);
  });

  it("processes files with spaces and unicode names", async () => {
    const dir = path.join(cliDir, "unicode-spaces");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const fileName = "ete photo 01 - café.JPG";
    await createJpeg(path.join(dir, fileName), 64, 48, { r: 120, g: 80, b: 40 });

    const outputManifest = path.join(OUTPUT, "unicode-spaces-manifest.json");
    const result = runCli([dir, "-o", outputManifest]);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<string, { outputs: { webp: { path: string } } }>;
    };

    expect(manifest.images[fileName]).toBeDefined();
    expect(manifest.images[fileName].outputs.webp.path).toBe("ete photo 01 - café.webp");
    expect(fs.existsSync(path.join(dir, "ete photo 01 - café.webp"))).toBe(true);
  });

  it("supports --no-blur", () => {
    const dir = path.join(cliDir, "no-blur");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "asset.jpg"));

    const outputManifest = path.join(OUTPUT, "no-blur-manifest.json");
    const result = runCli([dir, "--no-blur", "-o", outputManifest]);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<string, { blurDataURL: string }>;
    };

    expect(manifest.images["asset.jpg"].blurDataURL).toBe("");
  });

  it("blocks reruns with --no-cache unless --force-overwrite is set", () => {
    const dir = path.join(cliDir, "no-cache");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "a.jpg"));

    const first = runCli([dir, "--no-cache", "-o", path.join(OUTPUT, "no-cache.json")]);
    expect(first.status).toBe(0);

    const second = runCli([dir, "--no-cache", "-o", path.join(OUTPUT, "no-cache.json")]);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("--no-cache is enabled");

    const forced = runCli([
      dir,
      "--no-cache",
      "--force-overwrite",
      "-o",
      path.join(OUTPUT, "no-cache.json"),
    ]);
    expect(forced.status).toBe(0);
  });

  it("ignores stale cache ownership when --no-cache is set", () => {
    const dir = path.join(cliDir, "no-cache-stale");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "a.jpg"));

    fs.writeFileSync(
      path.join(dir, ".imageforge-cache.json"),
      JSON.stringify({
        "other.jpg": {
          hash: "deadbeef",
          result: {
            width: 1,
            height: 1,
            aspectRatio: 1,
            blurDataURL: "",
            originalSize: 1,
            outputs: {
              webp: { path: "a.webp", size: 1 },
            },
            hash: "deadbeef",
          },
        },
      })
    );

    const result = runCli([dir, "--no-cache", "-o", path.join(OUTPUT, "no-cache-stale.json")]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 processed");
  });

  it("treats malformed cache schema as corrupt and continues", () => {
    const dir = path.join(cliDir, "bad-cache");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "a.jpg"));

    fs.writeFileSync(
      path.join(dir, ".imageforge-cache.json"),
      JSON.stringify({
        "a.jpg": { hash: "x" },
      })
    );

    const result = runCli([dir, "-o", path.join(OUTPUT, "bad-cache.json")]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 processed");
  });

  it("writes versioned cache files", () => {
    const dir = path.join(cliDir, "versioned-cache");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "a.jpg"));

    const result = runCli([dir, "-o", path.join(OUTPUT, "versioned-cache.json")]);
    expect(result.status).toBe(0);

    const cache = JSON.parse(
      fs.readFileSync(path.join(dir, ".imageforge-cache.json"), "utf-8")
    ) as {
      version: number;
      entries: Record<string, unknown>;
    };
    expect(cache.version).toBe(1);
    expect(cache.entries["a.jpg"]).toBeDefined();
  });

  it("prunes cache entries for deleted source files", () => {
    const dir = path.join(cliDir, "cache-prune");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "a.jpg"));
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "b.jpg"));

    const manifestPath = path.join(OUTPUT, "cache-prune.json");
    const first = runCli([dir, "-o", manifestPath]);
    expect(first.status).toBe(0);

    fs.rmSync(path.join(dir, "b.jpg"), { force: true });
    const second = runCli([dir, "-o", manifestPath]);
    expect(second.status).toBe(0);

    const cache = JSON.parse(
      fs.readFileSync(path.join(dir, ".imageforge-cache.json"), "utf-8")
    ) as {
      version: number;
      entries: Record<string, unknown>;
    };

    expect(cache.version).toBe(1);
    expect(Object.keys(cache.entries).sort()).toEqual(["a.jpg"]);
  });

  it("fails when cache lock cannot be acquired in time", () => {
    const dir = path.join(cliDir, "cache-lock-timeout");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "a.jpg"));

    const lockPath = path.join(dir, ".imageforge-cache.json.lock");
    fs.writeFileSync(lockPath, "locked");

    const result = runCli([dir, "-o", path.join(OUTPUT, "cache-lock-timeout.json")], ROOT, {
      IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS: "50",
      IMAGEFORGE_CACHE_LOCK_STALE_MS: "60000",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Timed out waiting for cache lock");

    fs.rmSync(lockPath, { force: true });
  });

  it("reclaims stale cache lock files", () => {
    const dir = path.join(cliDir, "cache-lock-stale");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "a.jpg"));

    const lockPath = path.join(dir, ".imageforge-cache.json.lock");
    fs.writeFileSync(lockPath, "stale lock");
    const staleTime = new Date(Date.now() - 5_000);
    fs.utimesSync(lockPath, staleTime, staleTime);

    const result = runCli([dir, "-o", path.join(OUTPUT, "cache-lock-stale.json")], ROOT, {
      IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS: "500",
      IMAGEFORGE_CACHE_LOCK_STALE_MS: "100",
    });
    expect(result.status).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("does not reclaim an active lock even with aggressive stale settings", async () => {
    const dir = path.join(cliDir, "cache-lock-heartbeat");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (let index = 0; index < 20; index += 1) {
      await createJpeg(path.join(dir, `img-${index.toString()}.jpg`), 1200, 900, {
        r: (index * 13) % 255,
        g: 60,
        b: 120,
      });
    }

    const manifestPath = path.join(OUTPUT, "cache-lock-heartbeat.json");
    const lockPath = path.join(dir, ".imageforge-cache.json.lock");
    const firstRun = runCliAsync([dir, "-o", manifestPath, "--concurrency", "1"], ROOT, {
      IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS: "10000",
      IMAGEFORGE_CACHE_LOCK_STALE_MS: "100",
      IMAGEFORGE_CACHE_LOCK_HEARTBEAT_MS: "25",
    });

    await waitForPath(lockPath);
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });

    const secondRun = runCli([dir, "-o", manifestPath], ROOT, {
      IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS: "100",
      IMAGEFORGE_CACHE_LOCK_STALE_MS: "100",
      IMAGEFORGE_CACHE_LOCK_HEARTBEAT_MS: "25",
    });

    const firstResult = await firstRun;
    expect(firstResult.status).toBe(0);
    expect(secondRun.status).toBe(1);
    expect(secondRun.stderr).toContain("Timed out waiting for cache lock");
  });

  it("serializes concurrent runs with a shared cache lock", async () => {
    const dir = path.join(cliDir, "cache-lock-concurrent");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (let index = 0; index < 3; index += 1) {
      await createJpeg(path.join(dir, `img-${index.toString()}.jpg`), 120, 90, {
        r: 20 * index,
        g: 80,
        b: 140,
      });
    }

    const manifestPath = path.join(OUTPUT, "cache-lock-concurrent.json");
    const args = [dir, "-o", manifestPath, "-f", "webp,avif"];

    const [first, second] = await Promise.all([
      runCliAsync(args, ROOT, {
        IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS: "10000",
      }),
      runCliAsync(args, ROOT, {
        IMAGEFORGE_CACHE_LOCK_TIMEOUT_MS: "10000",
      }),
    ]);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    const combinedOutput = `${first.stdout}\n${second.stdout}`;
    expect(combinedOutput).toContain("3 processed");
    expect(combinedOutput).toContain("(cached)");

    const cachePath = path.join(dir, ".imageforge-cache.json");
    expect(fs.existsSync(cachePath)).toBe(true);
    expect(fs.existsSync(`${cachePath}.lock`)).toBe(false);

    const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
      version: number;
      entries: Record<string, unknown>;
    };
    expect(cache.version).toBe(1);
    expect(Object.keys(cache.entries)).toHaveLength(3);

    for (let index = 0; index < 3; index += 1) {
      expect(fs.existsSync(path.join(dir, `img-${index.toString()}.webp`))).toBe(true);
      expect(fs.existsSync(path.join(dir, `img-${index.toString()}.avif`))).toBe(true);
    }
  });

  it("fails when output already exists and is not cache-owned", () => {
    const dir = path.join(cliDir, "existing-output");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    fs.copyFileSync(path.join(cliDir, "test.jpg"), path.join(dir, "hero.jpg"));
    fs.copyFileSync(path.join(cliDir, "test.webp"), path.join(dir, "hero.webp"));

    const result = runCli([dir, "-o", path.join(OUTPUT, "existing-output.json")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not cache-owned");
  });

  it("supports --out-dir and keeps manifest output paths relative to input root", async () => {
    const dir = path.join(cliDir, "out-dir");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, "nested"), { recursive: true });

    await createJpeg(path.join(dir, "root.jpg"), 20, 20, { r: 1, g: 2, b: 3 });
    await createPng(path.join(dir, "nested", "icon.png"), 20, 20, { r: 3, g: 2, b: 1 });

    const outDir = path.join(dir, "generated");
    const outputManifest = path.join(OUTPUT, "out-dir-manifest.json");
    const result = runCli([dir, "--out-dir", outDir, "-o", outputManifest]);
    expect(result.status).toBe(0);

    expect(fs.existsSync(path.join(outDir, "root.webp"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "nested", "icon.webp"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<string, { outputs: { webp: { path: string } } }>;
    };

    expect(manifest.images["root.jpg"].outputs.webp.path).toBe("generated/root.webp");
    expect(manifest.images["nested/icon.png"].outputs.webp.path).toBe("generated/nested/icon.webp");

    expect(fs.existsSync(path.join(outDir, ".imageforge-cache.json"))).toBe(true);
  });

  it("supports disjoint --out-dir paths and keeps manifest paths input-relative", async () => {
    const dir = path.join(cliDir, "out-dir-disjoint");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "asset.jpg"), 32, 24, { r: 9, g: 8, b: 7 });

    const outDir = path.join(OUTPUT, "external-generated");
    fs.rmSync(outDir, { recursive: true, force: true });
    const outputManifest = path.join(OUTPUT, "out-dir-disjoint-manifest.json");
    const result = runCli([dir, "--out-dir", outDir, "-o", outputManifest]);
    expect(result.status).toBe(0);

    const generated = path.join(outDir, "asset.webp");
    expect(fs.existsSync(generated)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<string, { outputs: { webp: { path: string } } }>;
    };
    const expectedManifestPath = path.relative(dir, generated).split(path.sep).join("/");
    expect(expectedManifestPath.startsWith("..")).toBe(true);
    expect(manifest.images["asset.jpg"].outputs.webp.path).toBe(expectedManifestPath);
  });

  it("fails preflight width planning for corrupt images when responsive widths are enabled", () => {
    const dir = path.join(cliDir, "preflight-corrupt");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.jpg"), "not-a-valid-image");

    const result = runCli([
      dir,
      "--widths",
      "320,640",
      "-o",
      path.join(OUTPUT, "preflight-corrupt-manifest.json"),
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed preflight width planning");
    expect(result.stderr).toContain("broken.jpg");
  });

  it("rejects output collisions case-insensitively", async () => {
    const dir = path.join(cliDir, "collision-case-insensitive");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    await createJpeg(path.join(dir, "hero.jpg"), 40, 40, { r: 255, g: 0, b: 0 });
    await createPng(path.join(dir, "Hero.png"), 40, 40, { r: 0, g: 0, b: 255 });

    const result = runCli([dir, "-o", path.join(OUTPUT, "collision-case.json")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Output collision detected");
  });

  it("rejects responsive output collisions case-insensitively", async () => {
    const dir = path.join(cliDir, "collision-case-insensitive-widths");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    await createJpeg(path.join(dir, "hero.jpg"), 40, 40, { r: 255, g: 0, b: 0 });
    await createPng(path.join(dir, "Hero.png"), 40, 40, { r: 0, g: 0, b: 255 });

    const result = runCli([
      dir,
      "--widths",
      "20,40",
      "-o",
      path.join(OUTPUT, "collision-case-widths.json"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Output collision detected");
  });

  it("does not raise responsive collisions when effective widths differ", async () => {
    const dir = path.join(cliDir, "collision-case-effective-widths");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    await createJpeg(path.join(dir, "hero.jpg"), 240, 160, { r: 255, g: 0, b: 0 });
    await createPng(path.join(dir, "Hero.png"), 40, 40, { r: 0, g: 0, b: 255 });

    const outputManifest = path.join(OUTPUT, "collision-case-effective-widths.json");
    const result = runCli([dir, "--widths", "160,320", "-o", outputManifest]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("Output collision detected");

    expect(fs.existsSync(path.join(dir, "hero.w160.webp"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "Hero.w40.webp"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<
        string,
        {
          outputs: { webp: { path: string } };
          variants?: { webp?: { width: number }[] };
        }
      >;
    };

    expect(manifest.images["hero.jpg"].outputs.webp.path).toBe("hero.w160.webp");
    expect(manifest.images["Hero.png"].outputs.webp.path).toBe("Hero.w40.webp");
    expect(manifest.images["hero.jpg"].variants?.webp?.map((variant) => variant.width)).toEqual([
      160,
    ]);
    expect(manifest.images["Hero.png"].variants?.webp?.map((variant) => variant.width)).toEqual([
      40,
    ]);
  });

  it("--check passes when all files are up to date", async () => {
    const dir = path.join(cliDir, "check-clean");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "clean.jpg"), 64, 64, { r: 4, g: 5, b: 6 });

    const checkManifestPath = path.join(OUTPUT, "check-clean.json");
    const initial = runCli([dir, "-o", checkManifestPath]);
    expect(initial.status).toBe(0);

    const result = runCli([dir, "--check", "-o", checkManifestPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("All images up to date");
  });

  it("--check fails with exact rerun command including effective options", async () => {
    const dir = path.join(cliDir, "check-rerun");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    await createPng(path.join(dir, "new.png"), 30, 30, { r: 0, g: 255, b: 0 });

    const outDir = path.join(dir, "generated");
    const manifest = path.join(OUTPUT, "check-rerun.json");
    const result = runCli([
      dir,
      "--check",
      "-o",
      manifest,
      "--formats",
      "webp,avif",
      "--quality",
      "70",
      "--no-blur",
      "--blur-size",
      "8",
      "--widths",
      "120,240",
      "--concurrency",
      "3",
      "--out-dir",
      outDir,
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Run: imageforge");
    expect(result.stdout).toContain("--formats webp,avif");
    expect(result.stdout).toContain("--quality 70");
    expect(result.stdout).toContain("--no-blur");
    expect(result.stdout).toContain("--blur-size 8");
    expect(result.stdout).toContain("--widths 120,240");
    expect(result.stdout).toContain("--concurrency 3");
    expect(result.stdout).toContain("--out-dir");
  });

  it("--check sanitizes control characters in logged file paths", async () => {
    if (process.platform === "win32") {
      return;
    }

    const dir = path.join(cliDir, "check-control-chars");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const rawName = `ansi-\u001b[31m-red.jpg`;
    await createJpeg(path.join(dir, rawName), 30, 30, { r: 120, g: 20, b: 20 });

    const manifest = path.join(OUTPUT, "check-control-chars.json");
    const result = runCli([dir, "--check", "-o", manifest], ROOT, { FORCE_COLOR: "0" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("ansi-\\x1b[31m-red.jpg");
    expect(result.stdout).not.toContain(rawName);
  });

  it("supports --dry-run without writing outputs, manifest, or cache", async () => {
    const dir = path.join(cliDir, "dry-run");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "preview.jpg"), 90, 60, { r: 50, g: 80, b: 110 });

    const outputManifest = path.join(OUTPUT, "dry-run.json");
    fs.rmSync(outputManifest, { force: true });

    const result = runCli([dir, "--dry-run", "--json", "-o", outputManifest]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, "preview.webp"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".imageforge-cache.json"))).toBe(false);
    expect(fs.existsSync(outputManifest)).toBe(false);

    const report = JSON.parse(result.stdout) as {
      summary: { needsProcessing: number; processed: number };
      options: { dryRun: boolean };
      rerunCommand: string | null;
    };

    expect(report.options.dryRun).toBe(true);
    expect(report.summary.processed).toBe(0);
    expect(report.summary.needsProcessing).toBe(1);
    expect(report.rerunCommand).toContain("imageforge");
    expect(report.rerunCommand).not.toContain("--dry-run");
  });

  it("rejects combining --check with --dry-run", () => {
    const result = runCli([
      cliDir,
      "--check",
      "--dry-run",
      "-o",
      path.join(OUTPUT, "invalid.json"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--check and --dry-run cannot be used together");
  });

  it("filters processing with include/exclude globs and applies exclude precedence", async () => {
    const dir = path.join(cliDir, "include-exclude");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, "nested"), { recursive: true });

    await createJpeg(path.join(dir, "a.jpg"), 40, 40, { r: 10, g: 10, b: 10 });
    await createJpeg(path.join(dir, "b.jpg"), 40, 40, { r: 20, g: 20, b: 20 });
    await createJpeg(path.join(dir, "nested", "c.jpg"), 40, 40, { r: 30, g: 30, b: 30 });

    const outputManifest = path.join(OUTPUT, "include-exclude.json");
    const result = runCli([
      dir,
      "--include",
      "**/*.jpg",
      "--exclude",
      "**/b.jpg",
      "--exclude",
      "**/nested/**",
      "-o",
      outputManifest,
    ]);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf-8")) as {
      images: Record<string, unknown>;
    };
    expect(Object.keys(manifest.images)).toEqual(["a.jpg"]);
    expect(fs.existsSync(path.join(dir, "a.webp"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "b.webp"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "nested", "c.webp"))).toBe(false);
  });

  it("supports --json output mode", async () => {
    const dir = path.join(cliDir, "json-mode");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "json.jpg"), 42, 24, { r: 20, g: 30, b: 40 });

    const outputManifest = path.join(OUTPUT, "json-manifest.json");
    const result = runCli([dir, "--json", "-o", outputManifest]);
    expect(result.status).toBe(0);

    const report = JSON.parse(result.stdout) as {
      summary: { total: number; processed: number };
      options: { json: boolean };
      images: { file: string; status: string }[];
    };

    expect(report.options.json).toBe(true);
    expect(report.summary.total).toBe(1);
    expect(report.summary.processed).toBe(1);
    expect(report.images[0].file).toBe("json.jpg");
    expect(report.images[0].status).toBe("processed");
  });

  it("supports --verbose and --quiet log controls", async () => {
    const dir = path.join(cliDir, "verbosity");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "one.jpg"), 20, 20, { r: 1, g: 1, b: 1 });

    const verbose = runCli([dir, "--verbose", "-o", path.join(OUTPUT, "verbosity-v.json")]);
    expect(verbose.status).toBe(0);
    expect(verbose.stdout).toContain("Cache file:");

    const quiet = runCli([dir, "--quiet", "-o", path.join(OUTPUT, "verbosity-q.json")]);
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toContain("Done in");
    expect(quiet.stdout).not.toContain("[1/1]");
  });

  it("rejects --verbose with --quiet together", async () => {
    const dir = path.join(cliDir, "verbosity-conflict");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "one.jpg"), 20, 20, { r: 1, g: 1, b: 1 });

    const result = runCli([
      dir,
      "--verbose",
      "--quiet",
      "-o",
      path.join(OUTPUT, "verbosity-conflict.json"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--verbose and --quiet cannot be used together");
  });

  it("processes with configurable concurrency", async () => {
    const dir = path.join(cliDir, "concurrency");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (let index = 0; index < 5; index += 1) {
      await createJpeg(path.join(dir, `img-${index.toString()}.jpg`), 80, 80, {
        r: 10 * index,
        g: 20,
        b: 40,
      });
    }

    const result = runCli([dir, "--concurrency", "2", "-o", path.join(OUTPUT, "concurrency.json")]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("5 processed");
  });

  it("fails for non-existent directories", () => {
    const missingDir = path.join(cliDir, "does-not-exist");
    const result = runCli([missingDir, "-o", path.join(OUTPUT, "missing.json")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Directory not found");
  });

  it("prints version with --version", () => {
    const result = runCli(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
  });

  it("documents requested width target behavior in --help output", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Requested responsive width targets");
    expect(result.stdout).toContain("generated widths are source-bounded");
  });

  it("fails fast for invalid --blur-size values", () => {
    const result = runCli([cliDir, "-o", manifestPath, "--blur-size", "-1"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid blur size");
  });

  it("fails fast for invalid --quality values", () => {
    const result = runCli([cliDir, "-o", manifestPath, "--quality", "0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid quality");
  });

  it("fails fast for invalid --widths ranges", () => {
    const tooSmall = runCli([cliDir, "-o", manifestPath, "--widths", "0,200"]);
    expect(tooSmall.status).toBe(1);
    expect(tooSmall.stderr).toContain("Invalid width");

    const tooLarge = runCli([cliDir, "-o", manifestPath, "--widths", "320,20000"]);
    expect(tooLarge.status).toBe(1);
    expect(tooLarge.stderr).toContain("Invalid width");
  });

  it("rejects malformed numeric CLI values", () => {
    const malformedQuality = runCli([cliDir, "-o", manifestPath, "--quality", "80abc"]);
    expect(malformedQuality.status).toBe(1);
    expect(malformedQuality.stderr).toContain("Invalid quality");
    expect(malformedQuality.stderr).toContain("valid integer");

    const malformedBlurSize = runCli([cliDir, "-o", manifestPath, "--blur-size", "4abc"]);
    expect(malformedBlurSize.status).toBe(1);
    expect(malformedBlurSize.stderr).toContain("Invalid blur size");
    expect(malformedBlurSize.stderr).toContain("valid integer");

    const malformedConcurrency = runCli([cliDir, "-o", manifestPath, "--concurrency", "2abc"]);
    expect(malformedConcurrency.status).toBe(1);
    expect(malformedConcurrency.stderr).toContain("Invalid concurrency");
    expect(malformedConcurrency.stderr).toContain("valid integer");

    const malformedWidths = runCli([cliDir, "-o", manifestPath, "--widths", "320,2abc"]);
    expect(malformedWidths.status).toBe(1);
    expect(malformedWidths.stderr).toContain("Invalid width");
    expect(malformedWidths.stderr).toContain("valid integer");

    const emptyWidthsToken = runCli([cliDir, "-o", manifestPath, "--widths", "320,,640"]);
    expect(emptyWidthsToken.status).toBe(1);
    expect(emptyWidthsToken.stderr).toContain("Invalid widths: empty value");
  });

  it("validates idempotency of manifest content except generated timestamp", async () => {
    const dir = path.join(cliDir, "idempotency");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await createJpeg(path.join(dir, "same.jpg"), 64, 32, { r: 1, g: 2, b: 3 });

    const manifestAPath = path.join(OUTPUT, "idempotency-a.json");
    const manifestBPath = path.join(OUTPUT, "idempotency-b.json");

    const first = runCli([dir, "-o", manifestAPath]);
    expect(first.status).toBe(0);
    const second = runCli([dir, "-o", manifestBPath]);
    expect(second.status).toBe(0);

    const normalize = (raw: string) => {
      const parsed = JSON.parse(raw) as { generated: string; images: unknown; version: string };
      return {
        version: parsed.version,
        images: parsed.images,
      };
    };

    expect(normalize(fs.readFileSync(manifestAPath, "utf-8"))).toEqual(
      normalize(fs.readFileSync(manifestBPath, "utf-8"))
    );
  });
});
