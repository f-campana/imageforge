import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import {
  convertImage,
  discoverImages,
  fileHash,
  fromPosix,
  generateBlurDataURL,
  isImageFile,
  outputPathFor,
  processImage,
  toPosix,
} from "../src/processor";
import { getDefaultConcurrency } from "../src/runner";

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");
const OUTPUT = path.join(__dirname, "test-output");
const CLI = path.join(ROOT, "dist", "cli.js");

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

function makeNoiseImage(width: number, height: number): Promise<Buffer> {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
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

describe("isImageFile", () => {
  it("recognizes supported extensions case-insensitively", () => {
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.JPEG")).toBe(true);
    expect(isImageFile("logo.PNG")).toBe(true);
    expect(isImageFile("anim.gif")).toBe(true);
    expect(isImageFile("scan.TIFF")).toBe(true);
  });

  it("rejects unsupported extensions", () => {
    expect(isImageFile("banner.webp")).toBe(false);
    expect(isImageFile("icon.avif")).toBe(false);
    expect(isImageFile("file.txt")).toBe(false);
    expect(isImageFile("noext")).toBe(false);
  });
});

describe("path helpers", () => {
  it("normalizes backslash paths to POSIX", () => {
    expect(toPosix("nested\\child\\photo.jpg")).toBe("nested/child/photo.jpg");
  });

  it("converts POSIX paths to platform separators", () => {
    expect(fromPosix("nested/child/photo.jpg")).toBe(path.join("nested", "child", "photo.jpg"));
  });

  it("creates output paths for nested and multi-dot files", () => {
    expect(outputPathFor("hero.jpg", "webp")).toBe("hero.webp");
    expect(outputPathFor("nested/photo.min.jpg", "avif")).toBe("nested/photo.min.avif");
    expect(outputPathFor("assets/special name.v1.png", "webp")).toBe("assets/special name.v1.webp");
  });
});

describe("discoverImages", () => {
  it("finds source images recursively", () => {
    const images = discoverImages(FIXTURES);
    const names = images.map((filePath) => path.relative(FIXTURES, filePath));

    expect(names).toContain("photo.jpg");
    expect(names).toContain("transparent.png");
    expect(names).toContain(path.join("subdir", "nested.jpg"));
  });

  it("supports uppercase source extensions", () => {
    const names = discoverImages(FIXTURES).map((filePath) => path.basename(filePath));
    expect(names).toContain("UPPER.JPG");
  });

  it("excludes unsupported files including webp/avif", async () => {
    await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .webp()
      .toFile(path.join(FIXTURES, "photo.webp"));

    const names = discoverImages(FIXTURES).map((filePath) => path.basename(filePath));
    expect(names).not.toContain("readme.txt");
    expect(names).not.toContain("photo.webp");

    fs.unlinkSync(path.join(FIXTURES, "photo.webp"));
  });

  it("skips ignored directories", async () => {
    const ignoredDir = path.join(FIXTURES, "node_modules");
    fs.mkdirSync(ignoredDir, { recursive: true });
    await createJpeg(path.join(ignoredDir, "ignored.jpg"), 20, 20, { r: 255, g: 255, b: 0 });

    const names = discoverImages(FIXTURES).map((filePath) => path.basename(filePath));
    expect(names).not.toContain("ignored.jpg");
  });

  it("skips symlinks without recursing into them", async () => {
    const targetDir = path.join(FIXTURES, "symlink-target");
    const linkPath = path.join(FIXTURES, "symlink-loop");

    fs.mkdirSync(targetDir, { recursive: true });
    fs.rmSync(linkPath, { recursive: true, force: true });
    await createJpeg(path.join(targetDir, "inside.jpg"), 24, 24, { r: 10, g: 10, b: 10 });

    try {
      fs.symlinkSync(targetDir, linkPath, "dir");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        return;
      }
      throw err;
    }

    const names = discoverImages(FIXTURES).map((filePath) => path.basename(filePath));
    expect(names).toContain("inside.jpg");
    expect(names.filter((name) => name === "inside.jpg")).toHaveLength(1);
  });
});

describe("fileHash", () => {
  it("returns consistent hash for same file", () => {
    const first = fileHash(path.join(FIXTURES, "photo.jpg"));
    const second = fileHash(path.join(FIXTURES, "photo.jpg"));
    expect(first).toBe(second);
    expect(first).toHaveLength(16);
  });

  it("returns different hash when options change", () => {
    const filePath = path.join(FIXTURES, "photo.jpg");
    const options80 = { formats: ["webp" as const], quality: 80, blur: true, blurSize: 4 };
    const options60 = { formats: ["webp" as const], quality: 60, blur: true, blurSize: 4 };

    expect(fileHash(filePath, options80)).not.toBe(fileHash(filePath, options60));
  });

  it("uses content hashing independent of file path", () => {
    const source = path.join(FIXTURES, "photo.jpg");
    const copy = path.join(FIXTURES, "photo-copy.jpg");
    fs.copyFileSync(source, copy);

    expect(fileHash(source)).toBe(fileHash(copy));

    fs.rmSync(copy, { force: true });
  });
});

describe("generateBlurDataURL", () => {
  it("returns valid png data URI that decodes to a small PNG", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, "photo.jpg"));
    const blur = await generateBlurDataURL(buffer, 8);
    expect(blur).toMatch(/^data:image\/png;base64,/);

    const encoded = blur.split(",")[1];
    expect(encoded).toBeDefined();

    const decoded = Buffer.from(encoded, "base64");
    const metadata = await sharp(decoded).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeLessThanOrEqual(8);
    expect(metadata.height).toBeLessThanOrEqual(8);
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  });
});

describe("convertImage", () => {
  it("converts to webp", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, "photo.jpg"));
    const webp = await convertImage(buffer, "webp", 80);
    const metadata = await sharp(webp).metadata();
    expect(metadata.format).toBe("webp");
  });

  it("converts to avif", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, "photo.jpg"));
    const avif = await convertImage(buffer, "avif", 80);
    const metadata = await sharp(avif).metadata();
    expect(metadata.format).toBe("heif");
  });

  it("quality=1 yields smaller output than quality=80 on noisy input", async () => {
    const noisyPng = await makeNoiseImage(256, 256);

    const low = await convertImage(noisyPng, "webp", 1);
    const high = await convertImage(noisyPng, "webp", 80);

    expect(low.length).toBeLessThan(high.length);
  });
});

describe("processImage", () => {
  it("returns complete result and writes outputs", async () => {
    const result = await processImage(
      path.join(FIXTURES, "photo.jpg"),
      FIXTURES,
      {
        formats: ["webp", "avif"],
        quality: 80,
        blur: true,
        blurSize: 4,
      },
      FIXTURES
    );

    expect(result.file).toBe("photo.jpg");
    expect(result.outputs.webp.path).toBe("photo.webp");
    expect(result.outputs.avif.path).toBe("photo.avif");
    expect(fs.existsSync(path.join(FIXTURES, "photo.webp"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, "photo.avif"))).toBe(true);

    fs.rmSync(path.join(FIXTURES, "photo.webp"), { force: true });
    fs.rmSync(path.join(FIXTURES, "photo.avif"), { force: true });
  });

  it("supports GIF and TIFF source inputs", async () => {
    const gif = await processImage(
      path.join(FIXTURES, "sample.gif"),
      FIXTURES,
      {
        formats: ["webp"],
        quality: 80,
        blur: false,
        blurSize: 4,
      },
      FIXTURES
    );

    const tiff = await processImage(
      path.join(FIXTURES, "sample.tiff"),
      FIXTURES,
      {
        formats: ["webp"],
        quality: 80,
        blur: false,
        blurSize: 4,
      },
      FIXTURES
    );

    expect(gif.outputs.webp.path).toBe("sample.webp");
    expect(tiff.outputs.webp.path).toBe("sample.webp");

    fs.rmSync(path.join(FIXTURES, "sample.webp"), { force: true });
  });

  it("uses EXIF orientation for reported dimensions", async () => {
    const result = await processImage(
      path.join(FIXTURES, "oriented.jpg"),
      FIXTURES,
      {
        formats: ["webp"],
        quality: 80,
        blur: false,
        blurSize: 4,
      },
      FIXTURES
    );

    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
    fs.rmSync(path.join(FIXTURES, "oriented.webp"), { force: true });
  });

  it("supports writing outputs into a separate out-dir", async () => {
    const outDir = path.join(OUTPUT, "processor-out");
    fs.rmSync(outDir, { recursive: true, force: true });

    const result = await processImage(
      path.join(FIXTURES, "subdir", "nested.jpg"),
      FIXTURES,
      {
        formats: ["webp"],
        quality: 80,
        blur: false,
        blurSize: 4,
      },
      outDir
    );

    expect(result.outputs.webp.path).toBe(
      path.posix.join("..", "test-output", "processor-out", "subdir", "nested.webp")
    );
    expect(fs.existsSync(path.join(outDir, "subdir", "nested.webp"))).toBe(true);
  });

  it("throws on corrupt image input", async () => {
    await expect(
      processImage(
        path.join(FIXTURES, "corrupt.jpg"),
        FIXTURES,
        {
          formats: ["webp"],
          quality: 80,
          blur: true,
          blurSize: 4,
        },
        FIXTURES
      )
    ).rejects.toThrow();
  });

  it("enforces the image pixel limit", async () => {
    const hugePath = path.join(FIXTURES, "huge-limit.png");
    const width = 10_001;
    const height = 10_000;
    const raw = Buffer.alloc(width * height, 0);

    await sharp(raw, {
      raw: {
        width,
        height,
        channels: 1,
      },
    })
      .png()
      .toFile(hugePath);

    await expect(
      processImage(
        hugePath,
        FIXTURES,
        {
          formats: ["webp"],
          quality: 80,
          blur: false,
          blurSize: 4,
        },
        FIXTURES
      )
    ).rejects.toThrow();

    fs.rmSync(hugePath, { force: true });
    fs.rmSync(path.join(FIXTURES, "huge-limit.webp"), { force: true });
  });
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
    expect(result.stdout).toContain("imageforge v0.1.0");

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
    expect(result.stdout).toContain("--concurrency 3");
    expect(result.stdout).toContain("--out-dir");
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
    expect(result.stdout.trim()).toMatch(/^0\.1\.0$/);
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

describe("config support", () => {
  const configDir = path.join(__dirname, "config-fixtures");

  beforeAll(async () => {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.mkdirSync(configDir, { recursive: true });
    await createJpeg(path.join(configDir, "cfg.jpg"), 80, 60, { r: 20, g: 40, b: 60 });
  });

  afterAll(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("loads imageforge.config.json with CLI overrides", () => {
    fs.writeFileSync(
      path.join(configDir, "imageforge.config.json"),
      JSON.stringify(
        {
          output: "from-config.json",
          formats: ["webp", "avif"],
          quality: 70,
          blur: false,
          blurSize: 6,
          concurrency: 2,
          quiet: true,
        },
        null,
        2
      )
    );

    const result = runCli(
      [".", "--quality", "90", "--output", path.join(configDir, "from-cli.json")],
      configDir
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(configDir, "from-cli.json"))).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(configDir, "from-cli.json"), "utf-8")
    ) as {
      images: Record<string, { outputs: Record<string, unknown>; blurDataURL: string }>;
    };

    expect(Object.keys(manifest.images["cfg.jpg"].outputs)).toEqual(["webp", "avif"]);
    expect(manifest.images["cfg.jpg"].blurDataURL).toBe("");
  });

  it("lets explicit --verbose override config quiet mode", () => {
    fs.writeFileSync(
      path.join(configDir, "imageforge.config.json"),
      JSON.stringify(
        {
          quiet: true,
        },
        null,
        2
      )
    );

    const outputManifest = path.join(configDir, "verbose-override.json");
    const result = runCli([".", "--verbose", "--output", outputManifest], configDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cache file:");
  });

  it("lets --no-check override check=true from config", () => {
    fs.writeFileSync(
      path.join(configDir, "imageforge.config.json"),
      JSON.stringify(
        {
          check: true,
        },
        null,
        2
      )
    );

    const outputManifest = path.join(configDir, "override-no-check.json");
    const result = runCli([".", "--no-check", "--output", outputManifest], configDir);
    expect(result.status).toBe(0);
    expect(fs.existsSync(outputManifest)).toBe(true);
  });

  it("lets --no-json override json=true from config", () => {
    fs.writeFileSync(
      path.join(configDir, "imageforge.config.json"),
      JSON.stringify(
        {
          json: true,
        },
        null,
        2
      )
    );

    const outputManifest = path.join(configDir, "override-no-json.json");
    const result = runCli([".", "--no-json", "--output", outputManifest], configDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("imageforge v0.1.0");
  });

  it("fails fast on unknown config keys", () => {
    fs.writeFileSync(
      path.join(configDir, "imageforge.config.json"),
      JSON.stringify({
        unknownFlag: true,
      })
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown config key");

    fs.rmSync(path.join(configDir, "imageforge.config.json"), { force: true });
  });

  it("supports explicit --config path", () => {
    const explicitConfig = path.join(configDir, "explicit.json");
    fs.writeFileSync(
      explicitConfig,
      JSON.stringify({
        output: "from-explicit-config.json",
        formats: "webp",
      })
    );

    const result = runCli([".", "--config", explicitConfig], configDir);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(configDir, "from-explicit-config.json"))).toBe(true);
  });
});

describe("package exports", () => {
  it("exposes root and processor subpath exports", () => {
    const consumerDir = path.join(OUTPUT, "consumer");
    const scopeDir = path.join(consumerDir, "node_modules", "@imageforge");
    const packageLink = path.join(scopeDir, "cli");

    fs.rmSync(consumerDir, { recursive: true, force: true });
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(ROOT, packageLink, "dir");

    const script = [
      "const root = require('@imageforge/cli');",
      "const processor = require('@imageforge/cli/processor');",
      "if (typeof root.processImage !== 'function') throw new Error('missing root processImage export');",
      "if (typeof processor.convertImage !== 'function') throw new Error('missing processor convertImage export');",
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
});

describe("runner defaults", () => {
  it("uses a bounded default concurrency", () => {
    const concurrency = getDefaultConcurrency();
    expect(concurrency).toBeGreaterThanOrEqual(1);
    expect(concurrency).toBeLessThanOrEqual(8);
  });
});
