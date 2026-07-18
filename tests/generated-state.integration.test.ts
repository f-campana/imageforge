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
const CLI = path.join(ROOT, "dist", "cli.js");
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-generated-state-"));
const OUTPUT = path.join(WORKSPACE, "manifests");

interface CliRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliRunResult {
  const result = spawnSync("node", [CLI, ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf-8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function createJpeg(
  filePath: string,
  width: number,
  height: number,
  background: { r: number; g: number; b: number }
) {
  await sharp({
    create: { width, height, channels: 3, background },
  })
    .jpeg({ quality: 90 })
    .toFile(filePath);
}

function freshDirectory(name: string): string {
  const directory = path.join(WORKSPACE, name);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

beforeAll(() => {
  fs.mkdirSync(OUTPUT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
});

describe("generated-state CLI contract", () => {
  it("validates the manifest without comparing its generated timestamp", async () => {
    const directory = freshDirectory("check-manifest");
    await createJpeg(path.join(directory, "clean.jpg"), 64, 64, {
      r: 4,
      g: 5,
      b: 6,
    });
    const outputManifest = path.join(OUTPUT, "check-manifest.json");
    expect(runCli([directory, "-o", outputManifest]).status).toBe(0);

    const original = JSON.parse(fs.readFileSync(outputManifest, "utf8")) as {
      generated: string;
      images: Record<string, { hash: string }>;
    };
    original.generated = "2000-01-01T00:00:00.000Z";
    fs.writeFileSync(outputManifest, JSON.stringify(original, null, 2));
    expect(runCli([directory, "--check", "-o", outputManifest]).status).toBe(0);

    fs.writeFileSync(outputManifest, JSON.stringify({ ...original, unexpected: true }, null, 2));
    const unexpectedField = runCli([directory, "--check", "--json", "-o", outputManifest]);
    expect(unexpectedField.status).toBe(1);
    expect(
      (JSON.parse(unexpectedField.stdout) as { errors: { code: string }[] }).errors
    ).toContainEqual(expect.objectContaining({ code: "MANIFEST_STALE" }));

    original.images["clean.jpg"].hash = "stale";
    fs.writeFileSync(outputManifest, JSON.stringify(original, null, 2));
    const stale = runCli([directory, "--check", "--json", "-o", outputManifest]);
    expect(stale.status).toBe(1);
    expect((JSON.parse(stale.stdout) as { errors: { code: string }[] }).errors).toContainEqual(
      expect.objectContaining({ code: "MANIFEST_STALE" })
    );

    fs.rmSync(outputManifest, { force: true });
    const missing = runCli([directory, "--check", "-o", outputManifest]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Manifest is missing or stale");
    expect(fs.existsSync(outputManifest)).toBe(false);

    fs.writeFileSync(outputManifest, "{not-json", "utf8");
    const malformed = runCli([directory, "--check", "--json", "-o", outputManifest]);
    expect(malformed.status).toBe(1);
    expect((JSON.parse(malformed.stdout) as { errors: { code: string }[] }).errors).toContainEqual(
      expect.objectContaining({ code: "MANIFEST_STALE" })
    );
  });

  it("detects and reconciles deletion of the final source", async () => {
    const directory = freshDirectory("check-deleted-source");
    const sourcePath = path.join(directory, "only.jpg");
    await createJpeg(sourcePath, 64, 64, { r: 4, g: 5, b: 6 });
    const outputManifest = path.join(OUTPUT, "check-deleted-source.json");
    expect(runCli([directory, "-o", outputManifest]).status).toBe(0);
    fs.rmSync(sourcePath);

    const stale = runCli([directory, "--check", "--json", "-o", outputManifest]);
    expect(stale.status).toBe(1);
    const staleReport = JSON.parse(stale.stdout) as { errors: { code: string }[] };
    expect(staleReport.errors).toContainEqual(expect.objectContaining({ code: "MANIFEST_STALE" }));

    expect(runCli([directory, "-o", outputManifest]).status).toBe(0);
    expect(
      (JSON.parse(fs.readFileSync(outputManifest, "utf8")) as { images: Record<string, unknown> })
        .images
    ).toEqual({});
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, ".imageforge-cache.json"), "utf8"))
    ).toEqual({
      version: 2,
      entries: {},
    });
    expect(fs.existsSync(path.join(directory, "only.webp"))).toBe(true);
    expect(fs.existsSync(path.join(directory, ".imageforge-cache.json.lock"))).toBe(false);
    expect(runCli([directory, "--check", "-o", outputManifest]).status).toBe(0);
  });

  it("writes and accepts empty generated state for an initially empty workspace", () => {
    const directory = freshDirectory("initially-empty-state");
    const outputManifest = path.join(OUTPUT, "initially-empty-state.json");
    expect(runCli([directory, "-o", outputManifest]).status).toBe(0);
    expect(
      (JSON.parse(fs.readFileSync(outputManifest, "utf8")) as { images: Record<string, unknown> })
        .images
    ).toEqual({});
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, ".imageforge-cache.json"), "utf8"))
    ).toEqual({
      version: 2,
      entries: {},
    });
    expect(runCli([directory, "--check", "-o", outputManifest]).status).toBe(0);
  });

  it.runIf(process.platform !== "win32")(
    "rejects a symlinked output root before cache or derivative writes",
    async () => {
      for (const populated of [false, true]) {
        const directory = freshDirectory(`symlinked-output-root-${populated ? "full" : "empty"}`);
        const input = path.join(directory, "input");
        const external = path.join(directory, "external");
        const outputRoot = path.join(directory, "output-link");
        const outputManifest = path.join(
          OUTPUT,
          `symlinked-output-root-${populated ? "full" : "empty"}.json`
        );
        fs.mkdirSync(input);
        fs.mkdirSync(external);
        fs.symlinkSync(external, outputRoot);
        if (populated) {
          await createJpeg(path.join(input, "hero.jpg"), 40, 20, { r: 1, g: 2, b: 3 });
        }

        const result = runCli([input, "--out-dir", outputRoot, "--json", "-o", outputManifest]);
        expect(result.status).toBe(1);
        expect((JSON.parse(result.stdout) as { errors: { code: string }[] }).errors).toContainEqual(
          expect.objectContaining({ code: "OUTPUT_ROOT_UNSAFE" })
        );
        expect(fs.existsSync(path.join(external, ".imageforge-cache.json"))).toBe(false);
        expect(fs.existsSync(path.join(external, "hero.webp"))).toBe(false);
        expect(fs.existsSync(outputManifest)).toBe(false);
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a missing output root below a symlinked parent before any write",
    async () => {
      const directory = freshDirectory("symlinked-output-root-parent");
      const input = path.join(directory, "input");
      const external = path.join(directory, "external");
      const outputParent = path.join(directory, "public");
      const outputRoot = path.join(outputParent, "generated");
      const outputManifest = path.join(OUTPUT, "symlinked-output-root-parent.json");
      fs.mkdirSync(input);
      fs.mkdirSync(external);
      fs.symlinkSync(external, outputParent);
      await createJpeg(path.join(input, "hero.jpg"), 40, 20, { r: 1, g: 2, b: 3 });

      const result = runCli([input, "--out-dir", outputRoot, "--json", "-o", outputManifest]);

      expect(result.status).toBe(1);
      expect((JSON.parse(result.stdout) as { errors: { code: string }[] }).errors).toContainEqual(
        expect.objectContaining({ code: "OUTPUT_ROOT_UNSAFE" })
      );
      expect(fs.existsSync(path.join(external, "generated"))).toBe(false);
      expect(fs.existsSync(path.join(external, "generated", ".imageforge-cache.json"))).toBe(false);
      expect(fs.existsSync(path.join(external, "generated", ".imageforge-cache.json.lock"))).toBe(
        false
      );
      expect(fs.existsSync(path.join(external, "generated", "hero.webp"))).toBe(false);
      expect(fs.existsSync(outputManifest)).toBe(false);
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects an existing output root below a symlinked parent before any write",
    async () => {
      const directory = freshDirectory("existing-symlinked-output-root-parent");
      const input = path.join(directory, "input");
      const external = path.join(directory, "external");
      const externalRoot = path.join(external, "generated");
      const outputParent = path.join(directory, "public");
      const outputRoot = path.join(outputParent, "generated");
      const outputManifest = path.join(OUTPUT, "existing-symlinked-output-root-parent.json");
      fs.mkdirSync(input);
      fs.mkdirSync(externalRoot, { recursive: true });
      fs.symlinkSync(external, outputParent);
      await createJpeg(path.join(input, "hero.jpg"), 40, 20, { r: 1, g: 2, b: 3 });

      const result = runCli([input, "--out-dir", outputRoot, "--json", "-o", outputManifest]);

      expect(result.status).toBe(1);
      expect((JSON.parse(result.stdout) as { errors: { code: string }[] }).errors).toContainEqual(
        expect.objectContaining({ code: "OUTPUT_ROOT_UNSAFE" })
      );
      expect(fs.existsSync(path.join(externalRoot, ".imageforge-cache.json"))).toBe(false);
      expect(fs.existsSync(path.join(externalRoot, ".imageforge-cache.json.lock"))).toBe(false);
      expect(fs.existsSync(path.join(externalRoot, "hero.webp"))).toBe(false);
      expect(fs.existsSync(outputManifest)).toBe(false);
    }
  );

  it("keeps a partial v1 migration valid until every retained entry reaches v2", async () => {
    const directory = freshDirectory("partial-cache-migration");
    const manifest = path.join(OUTPUT, "partial-cache-migration.json");
    const cachePath = path.join(directory, ".imageforge-cache.json");
    await createJpeg(path.join(directory, "a.jpg"), 48, 32, { r: 1, g: 2, b: 3 });
    await createJpeg(path.join(directory, "b.jpg"), 48, 32, { r: 4, g: 5, b: 6 });
    expect(runCli([directory, "-o", manifest]).status).toBe(0);

    const legacy = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
      version: number;
      entries: Record<string, { outputHashes?: unknown; generator?: unknown; blurHash?: unknown }>;
    };
    legacy.version = 1;
    for (const entry of Object.values(legacy.entries)) {
      delete entry.outputHashes;
      delete entry.generator;
      delete entry.blurHash;
    }
    fs.writeFileSync(cachePath, JSON.stringify(legacy, null, 2));

    expect(runCli([directory, "--include", "a.jpg", "-o", manifest]).status).toBe(0);
    const partial = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
      version: number;
      entries: Record<string, { outputHashes?: unknown; generator?: unknown; blurHash?: unknown }>;
    };
    expect(partial.version).toBe(1);
    expect(partial.entries["a.jpg"].outputHashes).toBeDefined();
    expect(partial.entries["b.jpg"].outputHashes).toBeUndefined();

    const partialCheck = runCli([
      directory,
      "--include",
      "a.jpg",
      "--check",
      "--json",
      "-o",
      manifest,
    ]);
    expect(partialCheck.status).toBe(1);
    expect(
      (JSON.parse(partialCheck.stdout) as { errors: { code: string }[] }).errors
    ).toContainEqual(expect.objectContaining({ code: "CACHE_STALE" }));

    expect(runCli([directory, "-o", manifest]).status).toBe(0);
    const current = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
      version: number;
      entries: Record<string, { outputHashes?: unknown; generator?: unknown; blurHash?: unknown }>;
    };
    expect(current.version).toBe(2);
    expect(
      Object.values(current.entries).every(
        (entry) => entry.outputHashes && entry.generator && entry.blurHash
      )
    ).toBe(true);
    expect(runCli([directory, "--check", "-o", manifest]).status).toBe(0);
  });

  it.each([
    ["missing", null],
    ["malformed", "{not-json"],
    ["unsupported", JSON.stringify({ version: 99, entries: {} })],
  ])("rejects %s cache state in an empty workspace", (name, cacheContent) => {
    const directory = freshDirectory(`empty-${name}-cache`);
    const outputManifest = path.join(OUTPUT, `empty-${name}-cache.json`);
    fs.writeFileSync(
      outputManifest,
      JSON.stringify({ version: "1.0", generated: new Date().toISOString(), images: {} })
    );
    if (cacheContent !== null) {
      fs.writeFileSync(path.join(directory, ".imageforge-cache.json"), cacheContent);
    }

    const result = runCli([directory, "--check", "--json", "-o", outputManifest]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(report.errors.map(({ code }) => code)).toEqual(["CACHE_STALE"]);
  });

  it("gives protected recovery guidance when malformed cache loses output ownership", async () => {
    const directory = freshDirectory("malformed-cache-recovery");
    const outputManifest = path.join(OUTPUT, "malformed-cache-recovery.json");
    await createJpeg(path.join(directory, "hero.jpg"), 40, 20, { r: 4, g: 5, b: 6 });
    expect(runCli([directory, "-o", outputManifest]).status).toBe(0);
    fs.writeFileSync(path.join(directory, ".imageforge-cache.json"), "{not-json");

    const check = runCli([directory, "--check", "--json", "-o", outputManifest]);
    expect(check.status).toBe(1);
    const report = JSON.parse(check.stdout) as {
      rerunCommand: string;
      errors: { code: string; message: string }[];
    };
    expect(report.rerunCommand).not.toContain("--force-overwrite");
    const cacheError = report.errors.find(({ code }) => code === "CACHE_STALE");
    expect(cacheError?.message).toContain("--force-overwrite");

    const protectedRerun = runCli([directory, "-o", outputManifest]);
    expect(protectedRerun.status).toBe(1);
    expect(protectedRerun.stderr).toContain("not cache-owned");

    expect(runCli([directory, "--force-overwrite", "-o", outputManifest]).status).toBe(0);
    expect(runCli([directory, "--check", "-o", outputManifest]).status).toBe(0);
  });

  it("rejects cache entries for deleted sources even when the manifest is empty", async () => {
    const directory = freshDirectory("check-stale-cache-entry");
    const sourcePath = path.join(directory, "deleted.jpg");
    const outputManifest = path.join(OUTPUT, "check-stale-cache-entry.json");
    await createJpeg(sourcePath, 32, 32, { r: 7, g: 8, b: 9 });
    expect(runCli([directory, "-o", outputManifest]).status).toBe(0);
    fs.rmSync(sourcePath);
    fs.writeFileSync(
      outputManifest,
      JSON.stringify({ version: "1.0", generated: new Date().toISOString(), images: {} })
    );

    const result = runCli([directory, "--check", "--json", "-o", outputManifest]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(report.errors.map(({ code }) => code)).toEqual(["CACHE_STALE"]);
  });

  it("keeps nonexistent output directories absent in dry-run and check mode", async () => {
    const directory = freshDirectory("read-only-output-root");
    await createJpeg(path.join(directory, "preview.jpg"), 90, 60, {
      r: 50,
      g: 80,
      b: 110,
    });
    const dryRunOutDir = path.join(directory, "dry-run-generated");
    const checkOutDir = path.join(directory, "check-generated");
    const manifest = path.join(OUTPUT, "read-only-output-root.json");

    expect(runCli([directory, "--dry-run", "--out-dir", dryRunOutDir, "-o", manifest]).status).toBe(
      0
    );
    expect(fs.existsSync(dryRunOutDir)).toBe(false);
    expect(runCli([directory, "--check", "--out-dir", checkOutDir, "-o", manifest]).status).toBe(1);
    expect(fs.existsSync(checkOutDir)).toBe(false);
  });

  it("keeps generated state and sentinel locks byte-for-byte unchanged", async () => {
    const directory = freshDirectory("read-only-existing-state");
    const source = path.join(directory, "existing.jpg");
    const output = path.join(directory, "existing.webp");
    const cache = path.join(directory, ".imageforge-cache.json");
    const lock = `${cache}.lock`;
    const manifest = path.join(OUTPUT, "read-only-existing-state.json");
    await createJpeg(source, 90, 60, { r: 50, g: 80, b: 110 });
    expect(runCli([directory, "-o", manifest]).status).toBe(0);
    fs.writeFileSync(lock, "sentinel-lock\n");

    const files = [source, output, cache, lock, manifest];
    const fixedTime = new Date("2001-02-03T04:05:06.000Z");
    for (const file of files) fs.utimesSync(file, fixedTime, fixedTime);
    const snapshot = () =>
      files.map((file) => ({
        file,
        contents: fs.readFileSync(file).toString("base64"),
        mtimeMs: fs.statSync(file).mtimeMs,
      }));
    const before = snapshot();

    expect(runCli([directory, "--check", "-o", manifest]).status).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(runCli([directory, "--dry-run", "-o", manifest]).status).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it.each(["hash", "path", "size"] as const)(
    "fails closed when coordinated cache and manifest %s metadata is forged",
    async (field) => {
      const directory = freshDirectory(`forged-${field}`);
      await createJpeg(path.join(directory, "forged.jpg"), 64, 48, {
        r: 10,
        g: 20,
        b: 30,
      });
      const outputManifest = path.join(OUTPUT, `forged-${field}.json`);
      const cachePath = path.join(directory, ".imageforge-cache.json");
      expect(runCli([directory, "-o", outputManifest]).status).toBe(0);

      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
        entries: Record<
          string,
          {
            hash: string;
            result: { hash: string; outputs: Record<string, { path: string; size: number }> };
          }
        >;
      };
      const manifest = JSON.parse(fs.readFileSync(outputManifest, "utf8")) as {
        images: Record<
          string,
          { hash: string; outputs: Record<string, { path: string; size: number }> }
        >;
      };
      const cacheEntry = cache.entries["forged.jpg"];
      const manifestEntry = manifest.images["forged.jpg"];

      if (field === "hash") {
        cacheEntry.result.hash = "forged-inner-hash";
        manifestEntry.hash = "forged-inner-hash";
      } else if (field === "path") {
        fs.writeFileSync(path.join(directory, "decoy.webp"), "decoy");
        cacheEntry.result.outputs.webp = { path: "decoy.webp", size: 5 };
        manifestEntry.outputs.webp = { path: "decoy.webp", size: 5 };
      } else {
        cacheEntry.result.outputs.webp.size += 1;
        manifestEntry.outputs.webp.size += 1;
      }
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
      fs.writeFileSync(outputManifest, JSON.stringify(manifest, null, 2));

      const result = runCli([directory, "--check", "--json", "-o", outputManifest]);
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout) as {
        errors: { code: string }[];
        summary: { needsProcessing: number };
      };
      expect(report.summary.needsProcessing > 0 || report.errors.length > 0).toBe(true);
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects symlinked cached outputs and replaces a leaf symlink without touching its target",
    async () => {
      const directory = freshDirectory("symlinked-output");
      const source = path.join(directory, "source.jpg");
      const output = path.join(directory, "source.webp");
      const externalTarget = path.join(WORKSPACE, "external-target.webp");
      const outputManifest = path.join(OUTPUT, "symlinked-output.json");
      await createJpeg(source, 64, 48, { r: 10, g: 20, b: 30 });
      expect(runCli([directory, "-o", outputManifest]).status).toBe(0);

      fs.copyFileSync(output, externalTarget);
      const targetBefore = fs.readFileSync(externalTarget);
      fs.rmSync(output);
      fs.symlinkSync(externalTarget, output);

      expect(runCli([directory, "--check", "-o", outputManifest]).status).toBe(1);
      await createJpeg(source, 64, 48, { r: 30, g: 20, b: 10 });
      expect(runCli([directory, "-o", outputManifest]).status).toBe(0);
      expect(fs.lstatSync(output).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(externalTarget)).toEqual(targetBefore);
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a cached output reached through a symlinked directory",
    async () => {
      const directory = freshDirectory("symlinked-output-parent");
      const input = path.join(directory, "input");
      const nestedInput = path.join(input, "nested");
      const outputRoot = path.join(directory, "generated");
      const outputManifest = path.join(OUTPUT, "symlinked-output-parent.json");
      fs.mkdirSync(nestedInput, { recursive: true });
      await createJpeg(path.join(nestedInput, "source.jpg"), 64, 48, {
        r: 10,
        g: 20,
        b: 30,
      });
      expect(runCli([input, "--out-dir", outputRoot, "-o", outputManifest]).status).toBe(0);

      const externalDirectory = path.join(WORKSPACE, "external-output-parent");
      fs.mkdirSync(externalDirectory, { recursive: true });
      fs.renameSync(
        path.join(outputRoot, "nested", "source.webp"),
        path.join(externalDirectory, "source.webp")
      );
      fs.rmSync(path.join(outputRoot, "nested"), { recursive: true });
      fs.symlinkSync(externalDirectory, path.join(outputRoot, "nested"));

      expect(runCli([input, "--check", "--out-dir", outputRoot, "-o", outputManifest]).status).toBe(
        1
      );
    }
  );
});
