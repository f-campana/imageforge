import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
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
} from "../src/processor.js";
import { resolveOrientedDimensions } from "../src/responsive.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, "processor-fixtures");
const OUTPUT = path.join(__dirname, "processor-test-output");

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

  it("skips unreadable directories and continues discovery", async () => {
    if (process.platform === "win32") {
      return;
    }

    const unreadableDir = path.join(FIXTURES, "unreadable");
    fs.rmSync(unreadableDir, { recursive: true, force: true });
    fs.mkdirSync(unreadableDir, { recursive: true });
    await createJpeg(path.join(unreadableDir, "hidden.jpg"), 16, 16, { r: 3, g: 3, b: 3 });

    try {
      fs.chmodSync(unreadableDir, 0o000);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        return;
      }
      throw err;
    }

    try {
      const warnings: { path: string; message: string }[] = [];
      const names = discoverImages(FIXTURES, (warning) => warnings.push(warning)).map((filePath) =>
        path.basename(filePath)
      );

      expect(names).not.toContain("hidden.jpg");
      expect(warnings.some((warning) => warning.path.includes("unreadable"))).toBe(true);
    } finally {
      fs.chmodSync(unreadableDir, 0o755);
      fs.rmSync(unreadableDir, { recursive: true, force: true });
    }
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
    const optionsWithWidths = {
      formats: ["webp" as const],
      quality: 80,
      blur: true,
      blurSize: 4,
      widths: [320, 640],
    };

    expect(fileHash(filePath, options80)).not.toBe(fileHash(filePath, options60));
    expect(fileHash(filePath, options80)).not.toBe(fileHash(filePath, optionsWithWidths));
  });

  it("uses content hashing independent of file path", () => {
    const source = path.join(FIXTURES, "photo.jpg");
    const copy = path.join(FIXTURES, "photo-copy.jpg");
    fs.copyFileSync(source, copy);

    expect(fileHash(source)).toBe(fileHash(copy));

    fs.rmSync(copy, { force: true });
  });

  it("hashes large files correctly with chunked reads", () => {
    const largeFile = path.join(FIXTURES, "large-hash.bin");
    fs.writeFileSync(largeFile, crypto.randomBytes(6 * 1024 * 1024));

    try {
      const expected = crypto
        .createHash("sha256")
        .update(fs.readFileSync(largeFile))
        .digest("hex")
        .slice(0, 16);
      expect(fileHash(largeFile)).toBe(expected);
    } finally {
      fs.rmSync(largeFile, { force: true });
    }
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
  it("defaults outputDir to inputDir when not provided", async () => {
    const result = await processImage(path.join(FIXTURES, "photo.jpg"), FIXTURES, {
      formats: ["webp"],
      quality: 80,
      blur: false,
      blurSize: 4,
    });

    expect(result.outputs.webp.path).toBe("photo.webp");
    expect(fs.existsSync(path.join(FIXTURES, "photo.webp"))).toBe(true);
    fs.rmSync(path.join(FIXTURES, "photo.webp"), { force: true });
  });

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
      path.posix.join("..", "processor-test-output", "processor-out", "subdir", "nested.webp")
    );
    expect(fs.existsSync(path.join(outDir, "subdir", "nested.webp"))).toBe(true);
  });

  it("generates responsive variants and keeps outputs as largest variant", async () => {
    const result = await processImage(
      path.join(FIXTURES, "photo.jpg"),
      FIXTURES,
      {
        formats: ["webp"],
        quality: 80,
        blur: false,
        blurSize: 4,
        widths: [320, 640, 1200],
      },
      FIXTURES
    );

    expect(result.outputs.webp.path).toBe("photo.w640.webp");
    expect(result.variants?.webp.map((variant) => variant.width)).toEqual([320, 640]);
    expect(fs.existsSync(path.join(FIXTURES, "photo.w320.webp"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, "photo.w640.webp"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, "photo.w1200.webp"))).toBe(false);

    fs.rmSync(path.join(FIXTURES, "photo.w320.webp"), { force: true });
    fs.rmSync(path.join(FIXTURES, "photo.w640.webp"), { force: true });
  });

  it("normalizes unsorted API widths before selecting outputs", async () => {
    const result = await processImage(
      path.join(FIXTURES, "photo.jpg"),
      FIXTURES,
      {
        formats: ["webp"],
        quality: 80,
        blur: false,
        blurSize: 4,
        widths: [640, 320, 1200, 320],
      },
      FIXTURES
    );

    expect(result.outputs.webp.path).toBe("photo.w640.webp");
    expect(result.variants?.webp.map((variant) => variant.width)).toEqual([320, 640]);

    fs.rmSync(path.join(FIXTURES, "photo.w320.webp"), { force: true });
    fs.rmSync(path.join(FIXTURES, "photo.w640.webp"), { force: true });
  });

  it("falls back to source width when all requested widths are larger", async () => {
    const result = await processImage(
      path.join(FIXTURES, "subdir", "nested.jpg"),
      FIXTURES,
      {
        formats: ["webp"],
        quality: 80,
        blur: false,
        blurSize: 4,
        widths: [320, 640],
      },
      FIXTURES
    );

    expect(result.outputs.webp.path).toBe(path.posix.join("subdir", "nested.w100.webp"));
    expect(result.variants?.webp.map((variant) => variant.width)).toEqual([100]);
    expect(fs.existsSync(path.join(FIXTURES, "subdir", "nested.w100.webp"))).toBe(true);

    fs.rmSync(path.join(FIXTURES, "subdir", "nested.w100.webp"), { force: true });
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

describe("resolveOrientedDimensions", () => {
  it("falls back to source dimensions when orientation is outside 1-8", () => {
    expect(resolveOrientedDimensions(320, 180, 0)).toEqual({
      width: 320,
      height: 180,
    });
    expect(resolveOrientedDimensions(320, 180, 9)).toEqual({
      width: 320,
      height: 180,
    });
  });
});
