import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  cacheOutputsAreCurrent,
  calculateOutputHashes,
  generatorFingerprint,
  type CacheEntry,
} from "../src/runner/cache.js";
import type { ProcessOptions } from "../src/processor.js";
import { generateBlurDataURL } from "../src/processor.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

const options: ProcessOptions = {
  formats: ["webp"],
  quality: 80,
  blur: false,
  blurSize: 4,
};

async function workspace(width = 300, height = 150) {
  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-cache-current-"));
  workspaces.push(inputDir);
  const outputDir = path.join(inputDir, "generated");
  fs.mkdirSync(outputDir);
  await sharp({
    create: { width, height, channels: 3, background: "red" },
  })
    .jpeg()
    .toFile(path.join(inputDir, "hero.jpg"));
  return { inputDir, outputDir };
}

function baseEntry(
  inputDir: string,
  outputPath = "generated/hero.webp",
  size = 4,
  width = 300,
  height = 150
): CacheEntry {
  return {
    hash: "source-hash",
    generator: generatorFingerprint("test"),
    blurHash: crypto.createHash("sha256").update("").digest("hex"),
    result: {
      width,
      height,
      aspectRatio: +(width / height).toFixed(3),
      blurDataURL: "",
      originalSize: fs.statSync(path.join(inputDir, "hero.jpg")).size,
      outputs: { webp: { path: outputPath, size } },
      hash: "source-hash",
    },
  };
}

function check(
  entry: CacheEntry,
  sourceRelativePath: string,
  inputDir: string,
  outputDir: string,
  processOptions: ProcessOptions = options
) {
  if (entry.outputHashes === undefined) {
    entry.outputHashes = {};
    const paths = new Set([
      ...Object.values(entry.result.outputs).map((output) => output.path),
      ...Object.values(entry.result.variants ?? {}).flatMap((variants) =>
        variants.map((variant) => variant.path)
      ),
    ]);
    for (const outputPath of paths) {
      const fullPath = path.join(inputDir, outputPath);
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
        entry.outputHashes[outputPath] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(fullPath))
          .digest("hex");
      }
    }
  }
  return cacheOutputsAreCurrent(
    entry,
    path.join(inputDir, sourceRelativePath),
    sourceRelativePath,
    inputDir,
    outputDir,
    processOptions,
    generatorFingerprint("test")
  );
}

function writeOutput(inputDir: string, relativePath: string, content = "data") {
  const target = path.join(inputDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

describe("cached output ownership", () => {
  it("fingerprints the CLI and exact Sharp/libvips generator identity", () => {
    expect(generatorFingerprint("0.2.0")).toBe(
      `imageforge:0.2.0;sharp:${sharp.versions.sharp};vips:${sharp.versions.vips}`
    );
  });

  it("accepts the exact deterministic regular output with its observed size", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    await expect(check(baseEntry(inputDir), "hero.jpg", inputDir, outputDir)).resolves.toBe(true);
  });

  it("rejects outputs created by a different generator identity", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    entry.generator = "imageforge:old;sharp:old;vips:old";
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("rejects same-size derivative corruption against the cached digest", async () => {
    const { inputDir, outputDir } = await workspace();
    const output = writeOutput(inputDir, "generated/hero.webp", "data");
    const entry = baseEntry(inputDir);
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(true);
    fs.writeFileSync(output, "xxxx");
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "fails closed when a recorded derivative cannot be opened for hashing",
    async () => {
      const { inputDir, outputDir } = await workspace();
      const output = writeOutput(inputDir, "generated/hero.webp");
      const entry = baseEntry(inputDir);
      await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(true);
      fs.chmodSync(output, 0o000);
      try {
        await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
      } finally {
        fs.chmodSync(output, 0o600);
      }
    }
  );

  it("hashes every distinct regular output and responsive variant", async () => {
    const { inputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.w100.webp", "small");
    writeOutput(inputDir, "generated/hero.w200.webp", "largest");
    const entry = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    entry.result.variants = {
      webp: [
        { width: 100, height: 50, path: "generated/hero.w100.webp", size: 5 },
        { width: 200, height: 100, path: "generated/hero.w200.webp", size: 7 },
      ],
    };

    expect(calculateOutputHashes(entry.result, inputDir)).toEqual({
      "generated/hero.w100.webp": crypto.createHash("sha256").update("small").digest("hex"),
      "generated/hero.w200.webp": crypto.createHash("sha256").update("largest").digest("hex"),
    });
  });

  it("rejects unowned digest records even when all expected files are current", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(true);
    entry.outputHashes ??= {};
    entry.outputHashes["generated/unowned.webp"] = "a".repeat(64);
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("accepts responsive outputs only when the public output aliases the final variant", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.w100.webp", "small");
    writeOutput(inputDir, "generated/hero.w200.webp", "largest");
    const entry = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    entry.result.variants = {
      webp: [
        { width: 100, height: 50, path: "generated/hero.w100.webp", size: 5 },
        { width: 200, height: 100, path: "generated/hero.w200.webp", size: 7 },
      ],
    };

    const responsiveOptions = { ...options, widths: [100, 200] };
    await expect(check(entry, "hero.jpg", inputDir, outputDir, responsiveOptions)).resolves.toBe(
      true
    );
    entry.result.outputs.webp.size = 6;
    await expect(check(entry, "hero.jpg", inputDir, outputDir, responsiveOptions)).resolves.toBe(
      false
    );

    writeOutput(inputDir, "generated/hero.w150.webp", "largest");
    entry.result.outputs.webp = { path: "generated/hero.w150.webp", size: 7 };
    entry.result.variants.webp[1] = {
      width: 150,
      height: 75,
      path: "generated/hero.w150.webp",
      size: 7,
    };
    await expect(check(entry, "hero.jpg", inputDir, outputDir, responsiveOptions)).resolves.toBe(
      false
    );
  });

  it("rejects same-size corruption of a non-selected responsive variant", async () => {
    const { inputDir, outputDir } = await workspace();
    const smaller = writeOutput(inputDir, "generated/hero.w100.webp", "small");
    writeOutput(inputDir, "generated/hero.w200.webp", "largest");
    const entry = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    entry.result.variants = {
      webp: [
        { width: 100, height: 50, path: "generated/hero.w100.webp", size: 5 },
        { width: 200, height: 100, path: "generated/hero.w200.webp", size: 7 },
      ],
    };
    const responsiveOptions = { ...options, widths: [100, 200] };
    await expect(check(entry, "hero.jpg", inputDir, outputDir, responsiveOptions)).resolves.toBe(
      true
    );
    fs.writeFileSync(smaller, "xxxxx");
    await expect(check(entry, "hero.jpg", inputDir, outputDir, responsiveOptions)).resolves.toBe(
      false
    );
  });

  it.each([
    ["width", (entry: CacheEntry) => (entry.result.width += 1)],
    ["height", (entry: CacheEntry) => (entry.result.height += 1)],
    ["aspect ratio", (entry: CacheEntry) => (entry.result.aspectRatio += 0.1)],
    ["original size", (entry: CacheEntry) => (entry.result.originalSize += 1)],
    ["blur-off placeholder", (entry: CacheEntry) => (entry.result.blurDataURL = "forged")],
  ])("rejects forged source-derived %s metadata", async (_label, mutate) => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    mutate(entry);
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("accepts both configured formats regardless of record insertion order", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    writeOutput(inputDir, "generated/hero.avif");
    const entry = baseEntry(inputDir);
    entry.result.outputs = {
      avif: { path: "generated/hero.avif", size: 4 },
      webp: entry.result.outputs.webp,
    };
    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, formats: ["webp", "avif"] })
    ).resolves.toBe(true);
  });

  it("rejects extra output and variant formats even when every extra file exists", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    writeOutput(inputDir, "generated/hero.avif");
    const extraOutput = baseEntry(inputDir);
    extraOutput.result.outputs.avif = { path: "generated/hero.avif", size: 4 };
    await expect(check(extraOutput, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);

    writeOutput(inputDir, "generated/hero.w100.webp", "small");
    writeOutput(inputDir, "generated/hero.w200.webp", "largest");
    writeOutput(inputDir, "generated/hero.w100.avif", "small");
    const extraVariant = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    extraVariant.result.variants = {
      webp: [
        { width: 100, height: 50, path: "generated/hero.w100.webp", size: 5 },
        { width: 200, height: 100, path: "generated/hero.w200.webp", size: 7 },
      ],
      avif: [{ width: 100, height: 50, path: "generated/hero.w100.avif", size: 5 }],
    };
    await expect(
      check(extraVariant, "hero.jpg", inputDir, outputDir, { ...options, widths: [100, 200] })
    ).resolves.toBe(false);
  });

  it("rejects same-cardinality output and variant key substitution", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    writeOutput(inputDir, "generated/hero.avif");
    const substitutedOutput = baseEntry(inputDir);
    substitutedOutput.result.outputs.png = { path: "generated/hero.avif", size: 4 };
    await expect(
      check(substitutedOutput, "hero.jpg", inputDir, outputDir, {
        ...options,
        formats: ["webp", "avif"],
      })
    ).resolves.toBe(false);

    writeOutput(inputDir, "generated/hero.w100.webp", "small");
    writeOutput(inputDir, "generated/hero.w200.webp", "largest");
    writeOutput(inputDir, "generated/hero.w100.avif", "small");
    writeOutput(inputDir, "generated/hero.w200.avif", "largest");
    const substitutedVariant = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    substitutedVariant.result.outputs.avif = { path: "generated/hero.w200.avif", size: 7 };
    substitutedVariant.result.variants = {
      webp: [
        { width: 100, height: 50, path: "generated/hero.w100.webp", size: 5 },
        { width: 200, height: 100, path: "generated/hero.w200.webp", size: 7 },
      ],
      png: [
        { width: 100, height: 50, path: "generated/hero.w100.avif", size: 5 },
        { width: 200, height: 100, path: "generated/hero.w200.avif", size: 7 },
      ],
    };
    await expect(
      check(substitutedVariant, "hero.jpg", inputDir, outputDir, {
        ...options,
        formats: ["webp", "avif"],
        widths: [100, 200],
      })
    ).resolves.toBe(false);
  });

  it("treats an explicit empty width list as non-responsive", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    await expect(
      check(baseEntry(inputDir), "hero.jpg", inputDir, outputDir, { ...options, widths: [] })
    ).resolves.toBe(true);
  });

  it("rejects responsive variant length, leading width, and non-selected path drift", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.w100.webp", "small");
    writeOutput(inputDir, "generated/hero.w200.webp", "largest");
    const createEntry = () => {
      const entry = baseEntry(inputDir, "generated/hero.w200.webp", 7);
      entry.result.variants = {
        webp: [
          { width: 100, height: 50, path: "generated/hero.w100.webp", size: 5 },
          { width: 200, height: 100, path: "generated/hero.w200.webp", size: 7 },
        ],
      };
      return entry;
    };
    const responsiveOptions = { ...options, widths: [100, 200] };

    const missing = createEntry();
    const missingVariants = missing.result.variants?.webp;
    if (!missingVariants) throw new Error("responsive fixture is missing variants");
    missingVariants.splice(-1, 1);
    missing.result.outputs.webp = { path: "generated/hero.w100.webp", size: 5 };
    await expect(check(missing, "hero.jpg", inputDir, outputDir, responsiveOptions)).resolves.toBe(
      false
    );

    const wrongFirstWidth = createEntry();
    const wrongWidthVariants = wrongFirstWidth.result.variants?.webp;
    if (!wrongWidthVariants) throw new Error("responsive fixture is missing variants");
    wrongWidthVariants[0].width = 90;
    await expect(
      check(wrongFirstWidth, "hero.jpg", inputDir, outputDir, responsiveOptions)
    ).resolves.toBe(false);

    const wrongFirstPath = createEntry();
    const wrongPathVariants = wrongFirstPath.result.variants?.webp;
    if (!wrongPathVariants) throw new Error("responsive fixture is missing variants");
    writeOutput(inputDir, "generated/decoy.w100.webp", "small");
    wrongPathVariants[0].path = "generated/decoy.w100.webp";
    await expect(
      check(wrongFirstPath, "hero.jpg", inputDir, outputDir, responsiveOptions)
    ).resolves.toBe(false);

    writeOutput(inputDir, "generated/hero.w90.webp", "small");
    const coordinatedFirstVariant = createEntry();
    const coordinatedVariants = coordinatedFirstVariant.result.variants?.webp;
    if (!coordinatedVariants) throw new Error("responsive fixture is missing variants");
    coordinatedVariants[0] = {
      width: 90,
      height: 45,
      path: "generated/hero.w90.webp",
      size: 5,
    };
    await expect(
      check(coordinatedFirstVariant, "hero.jpg", inputDir, outputDir, responsiveOptions)
    ).resolves.toBe(false);

    const missingVariantSet = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    await expect(
      check(missingVariantSet, "hero.jpg", inputDir, outputDir, responsiveOptions)
    ).resolves.toBe(false);

    const emptyVariantSet = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    emptyVariantSet.result.variants = { webp: [] };
    await expect(
      check(emptyVariantSet, "hero.jpg", inputDir, outputDir, responsiveOptions)
    ).resolves.toBe(false);
  });

  it("selects the final variant from a three-width responsive contract", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.w50.webp", "tiny");
    writeOutput(inputDir, "generated/hero.w100.webp", "small");
    writeOutput(inputDir, "generated/hero.w200.webp", "largest");
    const entry = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    entry.result.variants = {
      webp: [
        { width: 50, height: 25, path: "generated/hero.w50.webp", size: 4 },
        { width: 100, height: 50, path: "generated/hero.w100.webp", size: 5 },
        { width: 200, height: 100, path: "generated/hero.w200.webp", size: 7 },
      ],
    };
    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, widths: [50, 100, 200] })
    ).resolves.toBe(true);
  });

  it("rejects coordinated responsive height drift", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.w100.webp", "small");
    const entry = baseEntry(inputDir, "generated/hero.w100.webp", 5);
    entry.result.variants = {
      webp: [{ width: 100, height: 51, path: "generated/hero.w100.webp", size: 5 }],
    };
    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, widths: [100] })
    ).resolves.toBe(false);
  });

  it("validates blur placeholders instead of trusting cache metadata", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    entry.result.blurDataURL = await generateBlurDataURL(
      fs.readFileSync(path.join(inputDir, "hero.jpg")),
      options.blurSize
    );
    entry.blurHash = crypto.createHash("sha256").update(entry.result.blurDataURL).digest("hex");
    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, blur: true })
    ).resolves.toBe(true);
    entry.result.blurDataURL = await generateBlurDataURL(
      fs.readFileSync(path.join(inputDir, "hero.jpg")),
      2
    );
    entry.blurHash = crypto.createHash("sha256").update(entry.result.blurDataURL).digest("hex");
    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, blur: true })
    ).resolves.toBe(false);
    entry.result.blurDataURL = "not-a-data-url";
    entry.blurHash = crypto.createHash("sha256").update(entry.result.blurDataURL).digest("hex");
    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, blur: true })
    ).resolves.toBe(false);
  });

  it("rejects a valid blur placeholder when its independent digest is wrong", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    entry.result.blurDataURL = await generateBlurDataURL(
      fs.readFileSync(path.join(inputDir, "hero.jpg")),
      options.blurSize
    );
    entry.blurHash = "0".repeat(64);

    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, blur: true })
    ).resolves.toBe(false);
  });

  it("rejects a coordinated non-empty placeholder when blur is disabled", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    entry.result.blurDataURL = "coordinated-but-disabled";
    entry.blurHash = crypto.createHash("sha256").update(entry.result.blurDataURL).digest("hex");

    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("returns false instead of throwing when integrity digests are absent", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);

    await expect(
      cacheOutputsAreCurrent(
        entry,
        path.join(inputDir, "hero.jpg"),
        "hero.jpg",
        inputDir,
        outputDir,
        options,
        generatorFingerprint("test")
      )
    ).resolves.toBe(false);
  });

  it("rejects a truncated PNG blur placeholder even when its digest is coordinated", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    const truncated = Buffer.concat([
      Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
      Buffer.from([0, 0, 0, 4, 0, 0, 0, 3]),
    ]);
    entry.result.blurDataURL = `data:image/png;base64,${truncated.toString("base64")}`;
    entry.blurHash = crypto.createHash("sha256").update(entry.result.blurDataURL).digest("hex");

    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, blur: true })
    ).resolves.toBe(false);
  });

  it.each([
    [300, 150],
    [9, 18],
  ])("accepts Sharp's generated blur dimensions for a %i x %i source", async (width, height) => {
    const { inputDir, outputDir } = await workspace(width, height);
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir, "generated/hero.webp", 4, width, height);
    entry.result.blurDataURL = await generateBlurDataURL(
      fs.readFileSync(path.join(inputDir, "hero.jpg")),
      7
    );
    entry.blurHash = crypto.createHash("sha256").update(entry.result.blurDataURL).digest("hex");

    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, blur: true, blurSize: 7 })
    ).resolves.toBe(true);
  });

  it.each(["missing IEND", "corrupt IDAT"])(
    "rejects a fully parseable blur PNG with %s",
    async (corruption) => {
      const { inputDir, outputDir } = await workspace();
      writeOutput(inputDir, "generated/hero.webp");
      const entry = baseEntry(inputDir);
      const validDataURL = await generateBlurDataURL(
        fs.readFileSync(path.join(inputDir, "hero.jpg")),
        options.blurSize
      );
      const png = Buffer.from(validDataURL.slice("data:image/png;base64,".length), "base64");
      const corrupted = Buffer.from(png);
      if (corruption === "missing IEND") {
        entry.result.blurDataURL = `data:image/png;base64,${corrupted.subarray(0, -12).toString("base64")}`;
      } else {
        const idatType = corrupted.indexOf(Buffer.from("IDAT"));
        expect(idatType).toBeGreaterThan(0);
        corrupted[idatType + 4] ^= 0xff;
        entry.result.blurDataURL = `data:image/png;base64,${corrupted.toString("base64")}`;
      }
      entry.blurHash = crypto.createHash("sha256").update(entry.result.blurDataURL).digest("hex");

      await expect(
        check(entry, "hero.jpg", inputDir, outputDir, { ...options, blur: true })
      ).resolves.toBe(false);
    }
  );

  it("requires the selected variant to represent the final independently expected width", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.w100.webp", "1234567");
    writeOutput(inputDir, "generated/hero.w200.webp", "7654321");
    const entry = baseEntry(inputDir, "generated/hero.w200.webp", 7);
    entry.result.variants = {
      webp: [{ width: 100, height: 50, path: "generated/hero.w100.webp", size: 7 }],
    };

    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, widths: [100, 200] })
    ).resolves.toBe(false);
  });

  it("fails closed when current source metadata cannot be read", async () => {
    const { inputDir, outputDir } = await workspace();
    const entry = baseEntry(inputDir);
    fs.rmSync(path.join(inputDir, "hero.jpg"));
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("retains the configured input-pixel safety limit during cache validation", async () => {
    const { inputDir, outputDir } = await workspace();
    const oversized = path.join(inputDir, "oversized.svg");
    fs.writeFileSync(
      oversized,
      '<svg xmlns="http://www.w3.org/2000/svg" width="10001" height="10000"></svg>'
    );
    writeOutput(inputDir, "generated/oversized.webp");
    const entry = baseEntry(inputDir, "generated/oversized.webp");
    entry.result.width = 10_001;
    entry.result.height = 10_000;
    entry.result.aspectRatio = 1;
    entry.result.originalSize = fs.statSync(oversized).size;
    await expect(check(entry, "oversized.svg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("rejects a coordinated non-deterministic output path even when the decoy exists", async () => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/decoy.webp");
    const entry = baseEntry(inputDir, "generated/decoy.webp");
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("rejects empty configured output state", async () => {
    const { inputDir, outputDir } = await workspace();
    const entry = baseEntry(inputDir);
    entry.result.outputs = {};
    await expect(
      check(entry, "hero.jpg", inputDir, outputDir, { ...options, formats: [] })
    ).resolves.toBe(false);
  });

  it("rejects a deterministic name that resolves outside the logical output root", async () => {
    const { inputDir, outputDir } = await workspace();
    const outsideName = `${path.basename(inputDir)}-outside.jpg`;
    const outsideSource = path.join(path.dirname(inputDir), outsideName);
    fs.copyFileSync(path.join(inputDir, "hero.jpg"), outsideSource);
    workspaces.push(outsideSource);
    const outsideOutput = `${path.parse(outsideName).name}.webp`;
    writeOutput(inputDir, outsideOutput);
    const entry = baseEntry(inputDir, outsideOutput);
    await expect(check(entry, `../${outsideName}`, inputDir, outputDir)).resolves.toBe(false);
  });

  it("accepts a regular nested output path", async () => {
    const { inputDir, outputDir } = await workspace();
    fs.mkdirSync(path.join(inputDir, "nested"));
    fs.copyFileSync(path.join(inputDir, "hero.jpg"), path.join(inputDir, "nested", "hero.jpg"));
    writeOutput(inputDir, "generated/nested/hero.webp");
    const entry = baseEntry(inputDir, "generated/nested/hero.webp");
    await expect(check(entry, "nested/hero.jpg", inputDir, outputDir)).resolves.toBe(true);
  });

  it.each([
    [
      "unexpected format",
      (entry: CacheEntry) => {
        entry.result.outputs.png = entry.result.outputs.webp;
        delete entry.result.outputs.webp;
      },
    ],
    [
      "non-deterministic path",
      (entry: CacheEntry) => {
        entry.result.outputs.webp.path = "generated/decoy.webp";
      },
    ],
    [
      "wrong size",
      (entry: CacheEntry) => {
        entry.result.outputs.webp.size = 5;
      },
    ],
    [
      "empty generated set",
      (entry: CacheEntry) => {
        entry.result.outputs = {};
      },
    ],
    [
      "empty variant list",
      (entry: CacheEntry) => {
        entry.result.variants = { webp: [] };
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const { inputDir, outputDir } = await workspace();
    writeOutput(inputDir, "generated/hero.webp");
    const entry = baseEntry(inputDir);
    mutate(entry);
    await expect(check(entry, "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it("rejects missing paths, directories, and symlinked leaves", async () => {
    const { inputDir, outputDir } = await workspace();
    await expect(check(baseEntry(inputDir), "hero.jpg", inputDir, outputDir)).resolves.toBe(false);

    fs.mkdirSync(path.join(outputDir, "hero.webp"));
    await expect(check(baseEntry(inputDir), "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
    fs.rmSync(path.join(outputDir, "hero.webp"), { recursive: true });

    if (process.platform !== "win32") {
      const target = writeOutput(inputDir, "target.webp");
      fs.symlinkSync(target, path.join(outputDir, "hero.webp"));
      await expect(check(baseEntry(inputDir), "hero.jpg", inputDir, outputDir)).resolves.toBe(
        false
      );
    }
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked parent directory", async () => {
    const { inputDir, outputDir } = await workspace();
    fs.mkdirSync(path.join(inputDir, "nested"));
    fs.copyFileSync(path.join(inputDir, "hero.jpg"), path.join(inputDir, "nested", "hero.jpg"));
    const external = path.join(inputDir, "external");
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "hero.webp"), "data");
    fs.symlinkSync(external, path.join(outputDir, "nested"));
    const entry = baseEntry(inputDir, "generated/nested/hero.webp");

    await expect(check(entry, "nested/hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked output root", async () => {
    const { inputDir, outputDir } = await workspace();
    const external = path.join(inputDir, "external-root");
    fs.rmSync(outputDir, { recursive: true });
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "hero.webp"), "data");
    fs.symlinkSync(external, outputDir);

    await expect(check(baseEntry(inputDir), "hero.jpg", inputDir, outputDir)).resolves.toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "rejects a symlink below a regular first output directory",
    async () => {
      const { inputDir, outputDir } = await workspace();
      fs.mkdirSync(path.join(inputDir, "level-one", "level-two"), { recursive: true });
      fs.copyFileSync(
        path.join(inputDir, "hero.jpg"),
        path.join(inputDir, "level-one", "level-two", "hero.jpg")
      );
      const external = path.join(inputDir, "deep-external");
      fs.mkdirSync(external);
      fs.writeFileSync(path.join(external, "hero.webp"), "data");
      fs.mkdirSync(path.join(outputDir, "level-one"));
      fs.symlinkSync(external, path.join(outputDir, "level-one", "level-two"));
      const entry = baseEntry(inputDir, "generated/level-one/level-two/hero.webp");

      await expect(check(entry, "level-one/level-two/hero.jpg", inputDir, outputDir)).resolves.toBe(
        false
      );
    }
  );
});
