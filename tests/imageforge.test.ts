import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import {
  isImageFile,
  discoverImages,
  fileHash,
  generateBlurDataURL,
  convertImage,
  processImage,
} from "../src/processor";

const FIXTURES = path.join(__dirname, "fixtures");
const OUTPUT = path.join(__dirname, "test-output");
const CLI = path.join(__dirname, "..", "dist", "cli.js");

beforeAll(async () => {
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.mkdirSync(path.join(FIXTURES, "subdir"), { recursive: true });
  fs.mkdirSync(OUTPUT, { recursive: true });

  await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .jpeg({ quality: 90 })
    .toFile(path.join(FIXTURES, "photo.jpg"));

  await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 128 },
    },
  })
    .png()
    .toFile(path.join(FIXTURES, "transparent.png"));

  await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 50, g: 50, b: 50 },
    },
  })
    .jpeg()
    .toFile(path.join(FIXTURES, "subdir", "nested.jpg"));

  await sharp({
    create: {
      width: 60,
      height: 40,
      channels: 3,
      background: { r: 0, g: 50, b: 200 },
    },
  })
    .jpeg()
    .toFile(path.join(FIXTURES, "UPPER.JPG"));

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

describe("discoverImages", () => {
  it("finds source images recursively", () => {
    const images = discoverImages(FIXTURES);
    const names = images.map((f) => path.relative(FIXTURES, f));

    expect(names).toContain("photo.jpg");
    expect(names).toContain("transparent.png");
    expect(names).toContain(path.join("subdir", "nested.jpg"));
  });

  it("supports uppercase source extensions", () => {
    const names = discoverImages(FIXTURES).map((f) => path.basename(f));
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

    const names = discoverImages(FIXTURES).map((f) => path.basename(f));
    expect(names).not.toContain("readme.txt");
    expect(names).not.toContain("photo.webp");

    fs.unlinkSync(path.join(FIXTURES, "photo.webp"));
  });

  it("skips ignored directories", async () => {
    const nested = path.join(FIXTURES, "node_modules");
    fs.mkdirSync(nested, { recursive: true });
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 255, g: 255, b: 0 },
      },
    })
      .jpeg()
      .toFile(path.join(nested, "ignored.jpg"));

    const names = discoverImages(FIXTURES).map((f) => path.basename(f));
    expect(names).not.toContain("ignored.jpg");
  });

  it("skips symlinks without recursing into them", async () => {
    const targetDir = path.join(FIXTURES, "symlink-target");
    const linkPath = path.join(FIXTURES, "symlink-loop");
    fs.mkdirSync(targetDir, { recursive: true });
    await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 3,
        background: { r: 10, g: 10, b: 10 },
      },
    })
      .jpeg()
      .toFile(path.join(targetDir, "inside.jpg"));

    try {
      fs.symlinkSync(targetDir, linkPath, "dir");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        return;
      }
      throw err;
    }

    const names = discoverImages(FIXTURES).map((f) => path.basename(f));
    expect(names).toContain("inside.jpg");
    // If symlink was followed we'd get duplicated entries or recursion issues.
    expect(names.filter((n) => n === "inside.jpg")).toHaveLength(1);
  });
});

describe("fileHash", () => {
  it("returns consistent hash for same file", () => {
    const h1 = fileHash(path.join(FIXTURES, "photo.jpg"));
    const h2 = fileHash(path.join(FIXTURES, "photo.jpg"));
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  it("returns different hash when options change", () => {
    const file = path.join(FIXTURES, "photo.jpg");
    const opts80 = { formats: ["webp" as const], quality: 80, blur: true, blurSize: 4 };
    const opts60 = { formats: ["webp" as const], quality: 60, blur: true, blurSize: 4 };

    const h80 = fileHash(file, opts80);
    const h60 = fileHash(file, opts60);

    expect(h80).not.toBe(h60);
  });
});

describe("generateBlurDataURL", () => {
  it("returns valid png data URI", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, "photo.jpg"));
    const blur = await generateBlurDataURL(buffer, 4);
    expect(blur).toMatch(/^data:image\/png;base64,/);
  });
});

describe("convertImage", () => {
  it("converts to webp", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, "photo.jpg"));
    const webp = await convertImage(buffer, "webp", 80);
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
  });

  it("converts to avif", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, "photo.jpg"));
    const avif = await convertImage(buffer, "avif", 80);
    const meta = await sharp(avif).metadata();
    expect(meta.format).toBe("heif");
  });
});

describe("processImage", () => {
  it("returns complete result and writes output", async () => {
    const result = await processImage(path.join(FIXTURES, "photo.jpg"), FIXTURES, {
      formats: ["webp"],
      quality: 80,
      blur: true,
      blurSize: 4,
    });

    expect(result.file).toBe("photo.jpg");
    expect(result.outputs.webp.path).toBe("photo.webp");
    expect(fs.existsSync(path.join(FIXTURES, "photo.webp"))).toBe(true);

    fs.unlinkSync(path.join(FIXTURES, "photo.webp"));
  });

  it("throws on corrupt image input", async () => {
    await expect(
      processImage(path.join(FIXTURES, "corrupt.jpg"), FIXTURES, {
        formats: ["webp"],
        quality: 80,
        blur: true,
        blurSize: 4,
      })
    ).rejects.toThrow();
  });

  it("uses EXIF orientation for reported dimensions", async () => {
    const result = await processImage(path.join(FIXTURES, "oriented.jpg"), FIXTURES, {
      formats: ["webp"],
      quality: 80,
      blur: false,
      blurSize: 4,
    });

    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
    fs.unlinkSync(path.join(FIXTURES, "oriented.webp"));
  });
});

describe("CLI integration", () => {
  const cliDir = path.join(__dirname, "cli-fixtures");
  const manifestPath = path.join(OUTPUT, "manifest.json");

  beforeAll(async () => {
    fs.rmSync(cliDir, { recursive: true, force: true });
    fs.mkdirSync(cliDir, { recursive: true });
    await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .jpeg()
      .toFile(path.join(cliDir, "test.jpg"));
  });

  afterAll(() => {
    fs.rmSync(cliDir, { recursive: true, force: true });
  });

  it("handles empty directories gracefully", () => {
    const emptyDir = path.join(cliDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const output = execSync(`node ${CLI} ${emptyDir} -o ${manifestPath}`, {
      encoding: "utf-8",
    });

    expect(output).toContain("No images found");
  });

  it("processes images and writes manifest", () => {
    execSync(`node ${CLI} ${cliDir} -o ${manifestPath}`, { encoding: "utf-8" });

    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.images["test.jpg"]).toBeDefined();
    expect(manifest.images["test.jpg"].outputs.webp.path).toBe("test.webp");
  });

  it("uses cache on second run", () => {
    const output = execSync(`node ${CLI} ${cliDir} -o ${manifestPath}`, {
      encoding: "utf-8",
    });
    expect(output).toContain("(cached)");
    expect(output).toContain("0 processed");
  });

  it("reprocesses when cached output file is deleted", () => {
    fs.unlinkSync(path.join(cliDir, "test.webp"));
    const output = execSync(`node ${CLI} ${cliDir} -o ${manifestPath}`, {
      encoding: "utf-8",
    });

    expect(output).toContain("1 processed");
  });

  it("reprocesses when quality changes", () => {
    const output = execSync(
      `node ${CLI} ${cliDir} -o ${manifestPath} --quality 60`,
      { encoding: "utf-8" }
    );

    expect(output).toContain("1 processed");
    expect(output).not.toContain("0 processed");

    // Restore default options cache for subsequent check-mode test.
    execSync(`node ${CLI} ${cliDir} -o ${manifestPath}`, { encoding: "utf-8" });
  });

  it("blocks reruns with --no-cache unless --force-overwrite is set", () => {
    const noCacheDir = path.join(cliDir, "no-cache");
    fs.mkdirSync(noCacheDir, { recursive: true });

    execSync(
      `node -e "const sharp=require('sharp'); sharp({create:{width:64,height:48,channels:3,background:{r:10,g:20,b:30}}}).jpeg().toFile(process.argv[1]).then(()=>{}).catch((e)=>{console.error(e);process.exit(1);});" "${path.join(noCacheDir, "a.jpg")}"`,
      { stdio: "ignore" }
    );

    const first = execSync(
      `node ${CLI} ${noCacheDir} --no-cache -o ${path.join(OUTPUT, "no-cache.json")}`,
      { encoding: "utf-8" }
    );
    expect(first).toContain("1 processed");
    try {
      execSync(
        `node ${CLI} ${noCacheDir} --no-cache -o ${path.join(OUTPUT, "no-cache.json")}`,
        { encoding: "utf-8" }
      );
      expect.fail("Expected second --no-cache run to fail without force");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("--no-cache is enabled");
    }

    const forced = execSync(
      `node ${CLI} ${noCacheDir} --no-cache --force-overwrite -o ${path.join(OUTPUT, "no-cache.json")}`,
      { encoding: "utf-8" }
    );
    expect(forced).toContain("1 processed");

    fs.rmSync(noCacheDir, { recursive: true, force: true });
  });

  it("ignores stale cache ownership when --no-cache is set", () => {
    const dir = path.join(cliDir, "no-cache-stale");
    fs.mkdirSync(dir, { recursive: true });

    execSync(
      `node -e "const sharp=require('sharp'); sharp({create:{width:30,height:20,channels:3,background:{r:1,g:2,b:3}}}).jpeg().toFile(process.argv[1]).then(()=>{}).catch((e)=>{console.error(e);process.exit(1);});" "${path.join(dir, "a.jpg")}"`,
      { stdio: "ignore" }
    );

    fs.writeFileSync(
      path.join(dir, ".imageforge-cache.json"),
      JSON.stringify({
        "other.jpg": {
          hash: "deadbeef",
          result: {
            outputs: {
              webp: { path: "a.webp", size: 1 },
            },
          },
        },
      })
    );

    const output = execSync(
      `node ${CLI} ${dir} --no-cache -o ${path.join(OUTPUT, "no-cache-stale.json")}`,
      { encoding: "utf-8" }
    );

    expect(output).toContain("1 processed");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats malformed cache schema as corrupt and continues", () => {
    const dir = path.join(cliDir, "bad-cache");
    fs.mkdirSync(dir, { recursive: true });

    execSync(
      `node -e "const sharp=require('sharp'); sharp({create:{width:32,height:32,channels:3,background:{r:9,g:9,b:9}}}).jpeg().toFile(process.argv[1]).then(()=>{}).catch((e)=>{console.error(e);process.exit(1);});" "${path.join(dir, "a.jpg")}"`,
      { stdio: "ignore" }
    );

    fs.writeFileSync(
      path.join(dir, ".imageforge-cache.json"),
      JSON.stringify({
        "a.jpg": { hash: "x" },
      })
    );

    const output = execSync(
      `node ${CLI} ${dir} -o ${path.join(OUTPUT, "bad-cache.json")}`,
      { encoding: "utf-8" }
    );

    expect(output).toContain("1 processed");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails when output already exists and is not cache-owned", () => {
    const dir = path.join(cliDir, "existing-output");
    fs.mkdirSync(dir, { recursive: true });

    execSync(
      `node -e "const sharp=require('sharp'); sharp({create:{width:40,height:40,channels:3,background:{r:200,g:100,b:50}}}).jpeg().toFile(process.argv[1]).then(()=>{}).catch((e)=>{console.error(e);process.exit(1);});" "${path.join(dir, "hero.jpg")}"`,
      { stdio: "ignore" }
    );
    execSync(
      `node -e "const sharp=require('sharp'); sharp({create:{width:40,height:40,channels:3,background:{r:5,g:5,b:5}}}).webp().toFile(process.argv[1]).then(()=>{}).catch((e)=>{console.error(e);process.exit(1);});" "${path.join(dir, "hero.webp")}"`,
      { stdio: "ignore" }
    );

    try {
      execSync(`node ${CLI} ${dir} -o ${path.join(OUTPUT, "existing-output.json")}`, {
        encoding: "utf-8",
      });
      expect.fail("Expected existing non-cache-owned output to fail");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("not cache-owned");
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("--check passes when all processed", () => {
    const result = execSync(
      `node ${CLI} ${cliDir} --check -o ${manifestPath}`,
      { encoding: "utf-8" }
    );
    expect(result).toContain("All images up to date");
  });

  it("--check fails for new images", async () => {
    await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 0, g: 255, b: 0 },
      },
    })
      .png()
      .toFile(path.join(cliDir, "new.png"));

    try {
      execSync(`node ${CLI} ${cliDir} --check -o ${manifestPath}`, {
        encoding: "utf-8",
      });
      expect.fail("Expected --check to exit with code 1");
    } catch (err: unknown) {
      const error = err as { status: number; stdout: string };
      expect(error.status).toBe(1);
      expect(error.stdout).toContain("needs processing");
    }

    fs.unlinkSync(path.join(cliDir, "new.png"));
  });

  it("returns non-zero when at least one file fails in normal mode", () => {
    const dir = path.join(cliDir, "with-failure");
    fs.mkdirSync(dir, { recursive: true });

    execSync(
      `node -e "const sharp=require('sharp'); sharp({create:{width:50,height:30,channels:3,background:{r:10,g:120,b:220}}}).jpeg().toFile(process.argv[1]).then(()=>{}).catch((e)=>{console.error(e);process.exit(1);});" "${path.join(dir, "good.jpg")}"`,
      { stdio: "ignore" }
    );
    fs.writeFileSync(path.join(dir, "bad.jpg"), "not an image");

    try {
      execSync(`node ${CLI} ${dir} -o ${path.join(OUTPUT, "with-failure.json")}`, {
        encoding: "utf-8",
      });
      expect.fail("Expected run with corrupt file to exit non-zero");
    } catch (err: unknown) {
      const error = err as { status: number; stdout: string };
      expect(error.status).toBe(1);
      expect(error.stdout).toContain("failed");
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails fast for invalid --blur-size values", () => {
    try {
      execSync(
        `node ${CLI} ${cliDir} -o ${manifestPath} --blur-size -1`,
        { encoding: "utf-8" }
      );
      expect.fail("Expected invalid blur-size to exit with code 1");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("Invalid blur size");
    }
  });

  it("fails fast on output collisions", async () => {
    const collisionDir = path.join(cliDir, "collision");
    fs.mkdirSync(collisionDir, { recursive: true });

    await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toFile(path.join(collisionDir, "hero.jpg"));

    await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toFile(path.join(collisionDir, "hero.png"));

    try {
      execSync(`node ${CLI} ${collisionDir} -o ${manifestPath}`, {
        encoding: "utf-8",
      });
      expect.fail("Expected collision to exit with code 1");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("Output collision detected");
    }
  });
});
