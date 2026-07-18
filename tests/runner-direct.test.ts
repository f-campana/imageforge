import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { runImageforge, type RunOptions } from "../src/runner.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): { root: string; inputDir: string; outputDir: string; manifestPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-runner-direct-"));
  roots.push(root);
  const inputDir = path.join(root, "images");
  const outputDir = path.join(root, "generated");
  fs.mkdirSync(inputDir);
  return { root, inputDir, outputDir, manifestPath: path.join(root, "imageforge.json") };
}

function options(
  paths: { inputDir: string; outputDir: string; manifestPath: string },
  overrides: Partial<RunOptions> = {}
): RunOptions {
  return {
    version: "test",
    inputDir: paths.inputDir,
    outputPath: paths.manifestPath,
    directoryArg: paths.inputDir,
    commandName: "imageforge",
    formats: ["webp"],
    quality: 80,
    blur: false,
    blurSize: 4,
    widths: null,
    useCache: true,
    forceOverwrite: false,
    checkMode: false,
    outDir: paths.outputDir,
    concurrency: 2,
    dryRun: false,
    includePatterns: [],
    excludePatterns: [],
    json: true,
    verbose: false,
    quiet: false,
    ...overrides,
  };
}

async function writeJpeg(target: string, color = "red"): Promise<void> {
  await sharp({ create: { width: 40, height: 20, channels: 3, background: color } })
    .jpeg()
    .toFile(target);
}

describe("runner direct contract", () => {
  it("returns structured INPUT_NOT_FOUND evidence without creating state", async () => {
    const paths = fixture();
    fs.rmSync(paths.inputDir, { recursive: true });

    const result = await runImageforge(options(paths));

    expect(result.exitCode).toBe(1);
    expect(result.manifest).toBeNull();
    expect(result.report.errors).toHaveLength(1);
    expect(result.report.errors[0]?.code).toBe("INPUT_NOT_FOUND");
    expect(result.report.errors[0]?.message).toContain(paths.inputDir);
    expect(fs.existsSync(paths.outputDir)).toBe(false);
    expect(fs.existsSync(paths.manifestPath)).toBe(false);
  });

  it("keeps a first dry run pure and reports the exact work to apply", async () => {
    const paths = fixture();
    await writeJpeg(path.join(paths.inputDir, "hero.jpg"));

    const result = await runImageforge(options(paths, { dryRun: true }));

    expect(result.exitCode).toBe(0);
    expect(result.manifest).toBeNull();
    expect(result.report.summary).toMatchObject({
      total: 1,
      processed: 0,
      cached: 0,
      needsProcessing: 1,
      failed: 0,
    });
    expect(result.report.images).toEqual([
      expect.objectContaining({ file: "hero.jpg", status: "needs-processing" }),
    ]);
    expect(result.report.rerunCommand).not.toContain("--dry-run");
    expect(fs.existsSync(paths.outputDir)).toBe(false);
    expect(fs.existsSync(paths.manifestPath)).toBe(false);
  });

  it("closes generate, cached rerun, and current check as one deterministic loop", async () => {
    const paths = fixture();
    await writeJpeg(path.join(paths.inputDir, "hero.jpg"));

    const generated = await runImageforge(options(paths));
    expect(generated.exitCode).toBe(0);
    expect(generated.report.summary).toMatchObject({ processed: 1, cached: 0, failed: 0 });
    expect(generated.manifest?.images["hero.jpg"]?.outputs.webp.path).toContain("hero.webp");
    expect(fs.existsSync(path.join(paths.outputDir, ".imageforge-cache.json"))).toBe(true);
    expect(fs.existsSync(paths.manifestPath)).toBe(true);

    const cached = await runImageforge(options(paths));
    expect(cached.report.summary).toMatchObject({ processed: 0, cached: 1, failed: 0 });
    expect(cached.report.images[0]).toMatchObject({ file: "hero.jpg", status: "cached" });

    const checked = await runImageforge(options(paths, { checkMode: true }));
    expect(checked.exitCode).toBe(0);
    expect(checked.manifest).toBeNull();
    expect(checked.report.summary).toMatchObject({ cached: 1, needsProcessing: 0 });
    expect(checked.report.errors).toEqual([]);
  });

  it.runIf(process.platform !== "win32")(
    "preserves generated state when discovery cannot read a cached source subtree",
    async () => {
      const paths = fixture();
      const restrictedDir = path.join(paths.inputDir, "restricted");
      const source = path.join(restrictedDir, "hero.jpg");
      fs.mkdirSync(restrictedDir);
      await writeJpeg(source);

      const generated = await runImageforge(options(paths));
      expect(generated.exitCode).toBe(0);
      const cachePath = path.join(paths.outputDir, ".imageforge-cache.json");
      const derivative = generated.manifest?.images["restricted/hero.jpg"]?.outputs.webp.path;
      expect(derivative).toBeDefined();
      const originalCache = fs.readFileSync(cachePath);
      const originalManifest = fs.readFileSync(paths.manifestPath);

      fs.chmodSync(restrictedDir, 0o000);
      try {
        const incomplete = await runImageforge(options(paths));

        expect(incomplete.exitCode).toBe(1);
        expect(incomplete.manifest).toBeNull();
        expect(incomplete.report.errors).toHaveLength(1);
        expect(incomplete.report.errors[0]?.code).toBe("DISCOVERY_WARNING");
        expect(incomplete.report.errors[0]?.file).toContain("restricted");
        expect(fs.readFileSync(cachePath)).toEqual(originalCache);
        expect(fs.readFileSync(paths.manifestPath)).toEqual(originalManifest);
        expect(fs.existsSync(path.resolve(paths.inputDir, derivative ?? ""))).toBe(true);
        expect(fs.existsSync(`${cachePath}.lock`)).toBe(false);
      } finally {
        fs.chmodSync(restrictedDir, 0o755);
      }
    }
  );

  it("fails check closed after derivative corruption and supplies a reproducible rerun", async () => {
    const paths = fixture();
    await writeJpeg(path.join(paths.inputDir, "hero.jpg"));
    const generated = await runImageforge(options(paths));
    const derivative = generated.manifest?.images["hero.jpg"]?.outputs.webp.path;
    expect(derivative).toBeDefined();
    fs.writeFileSync(path.resolve(paths.inputDir, derivative ?? ""), "corrupt");

    const checked = await runImageforge(options(paths, { checkMode: true }));

    expect(checked.exitCode).toBe(1);
    expect(checked.report.summary).toMatchObject({ cached: 0, needsProcessing: 1 });
    expect(checked.report.errors.map((error) => error.code)).toEqual(["OUTPUT_STALE"]);
    expect(checked.report.rerunCommand).toContain("--out-dir");
    expect(checked.report.rerunCommand).not.toContain("--check");
  });

  it("warns without deleting derivatives made obsolete by an output-contract change", async () => {
    const paths = fixture();
    await writeJpeg(path.join(paths.inputDir, "hero.jpg"));
    const first = await runImageforge(options(paths));
    const oldDerivative = first.manifest?.images["hero.jpg"]?.outputs.webp.path;
    expect(oldDerivative).toBeDefined();

    const changed = await runImageforge(options(paths, { formats: ["avif"] }));

    expect(changed.exitCode).toBe(0);
    expect(changed.report.warnings).toHaveLength(1);
    expect(changed.report.warnings?.[0]?.code).toBe("OBSOLETE_OUTPUTS");
    expect(changed.report.warnings?.[0]?.file).toBe("hero.jpg");
    expect(changed.report.warnings?.[0]?.message).toContain(oldDerivative);
    expect(fs.existsSync(path.resolve(paths.inputDir, oldDerivative ?? ""))).toBe(true);
    expect(changed.manifest?.images["hero.jpg"]?.outputs).toHaveProperty("avif");
    expect(changed.manifest?.images["hero.jpg"]?.outputs).not.toHaveProperty("webp");
  });

  it("detects deleted-source state in check and reconciles it on the next write run", async () => {
    const paths = fixture();
    const source = path.join(paths.inputDir, "hero.jpg");
    await writeJpeg(source);
    await runImageforge(options(paths));
    fs.rmSync(source);

    const checked = await runImageforge(options(paths, { checkMode: true }));
    expect(checked.exitCode).toBe(1);
    expect(checked.report.errors.map((error) => error.code)).toEqual([
      "MANIFEST_STALE",
      "CACHE_STALE",
    ]);
    expect(checked.report.errors.find((error) => error.code === "CACHE_STALE")?.message).toContain(
      "deleted-source"
    );
    expect(checked.report.warnings).toHaveLength(1);
    expect(checked.report.warnings?.[0]?.code).toBe("OBSOLETE_OUTPUTS");
    expect(checked.report.warnings?.[0]?.file).toBe("hero.jpg");
    expect(checked.report.warnings?.[0]?.message).toContain("hero.webp");

    const reconciled = await runImageforge(options(paths));
    expect(reconciled.exitCode).toBe(0);
    expect(reconciled.manifest?.images).toEqual({});
    expect(reconciled.report.warnings?.[0]?.code).toBe("OBSOLETE_OUTPUTS");
    expect(
      JSON.parse(fs.readFileSync(path.join(paths.outputDir, ".imageforge-cache.json"), "utf8"))
    ).toMatchObject({ version: 2, entries: {} });
  });
});
