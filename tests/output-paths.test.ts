import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeOutputParents,
  inspectOutputRoot,
  resolveOutputPath,
  resolveOutputPaths,
} from "../src/output-paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-output-paths-"));
  roots.push(root);
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  fs.mkdirSync(inputDir);
  fs.mkdirSync(outputDir);
  return { root, inputDir, outputDir };
}

describe("canonical output paths", () => {
  it("resolves regular, responsive, nested, and disjoint outputs input-relatively", () => {
    const { root, inputDir, outputDir } = workspace();
    expect(resolveOutputPath("nested/hero.jpg", "webp", inputDir, outputDir)).toBe(
      "../output/nested/hero.webp"
    );
    expect(resolveOutputPaths("hero.jpg", "avif", inputDir, outputDir, [320, 640])).toEqual([
      "../output/hero.w320.avif",
      "../output/hero.w640.avif",
    ]);
    expect(resolveOutputPaths("hero.jpg", "webp", inputDir, outputDir, [])).toEqual([
      "../output/hero.webp",
    ]);
    expect(
      resolveOutputPath("hero.jpg", "webp", inputDir, path.join(root, "other", "generated"))
    ).toBe("../other/generated/hero.webp");
  });

  it("classifies missing, directory, and regular-file roots", () => {
    const { root, outputDir } = workspace();
    expect(inspectOutputRoot(outputDir)).toBe("directory");
    expect(inspectOutputRoot(path.join(root, "missing"))).toBe("missing");
    const fileRoot = path.join(root, "file-root");
    fs.writeFileSync(fileRoot, "x");
    expect(inspectOutputRoot(fileRoot)).toBe("other");
    expect(() => {
      assertSafeOutputParents(path.join(fileRoot, "hero.webp"), fileRoot);
    }).toThrow("not a directory");
  });

  it("does not collapse unexpected root inspection errors into missing state", () => {
    const overlongRoot = path.join(os.tmpdir(), "x".repeat(1024));
    expect(() => inspectOutputRoot(overlongRoot)).toThrow(
      expect.objectContaining({ code: "ENAMETOOLONG" })
    );
  });

  it("accepts safe parents, rejects escapes, and memoizes verified directories", () => {
    const { root, outputDir } = workspace();
    const nested = path.join(outputDir, "nested");
    fs.mkdirSync(nested);
    const verifiedDirectories = new Set<string>();
    expect(() => {
      assertSafeOutputParents(path.join(nested, "hero.webp"), outputDir, {
        requireRoot: true,
        verifiedDirectories,
      });
    }).not.toThrow();
    expect(verifiedDirectories).toEqual(new Set([outputDir, nested]));
    expect(() => {
      assertSafeOutputParents(path.join(root, "outside.webp"), outputDir);
    }).toThrow("outside the configured output root");
  });

  it("allows a missing root for generation but not current-state validation", () => {
    const { root } = workspace();
    const missingRoot = path.join(root, "new-output");
    const output = path.join(missingRoot, "hero.webp");
    const verifiedDirectories = new Set<string>();
    expect(() => {
      assertSafeOutputParents(output, missingRoot, { verifiedDirectories });
    }).not.toThrow();
    expect(verifiedDirectories.size).toBe(0);
    expect(() => {
      assertSafeOutputParents(output, missingRoot, { requireRoot: true });
    }).toThrow("Output root does not exist");
  });

  it.runIf(process.platform !== "win32")(
    "rejects symlinked roots and nested output directories",
    () => {
      const { root, outputDir } = workspace();
      const external = path.join(root, "external");
      fs.mkdirSync(external);
      const rootLink = path.join(root, "root-link");
      fs.symlinkSync(external, rootLink);
      expect(inspectOutputRoot(rootLink)).toBe("symlink");
      expect(() => {
        assertSafeOutputParents(path.join(rootLink, "hero.webp"), rootLink);
      }).toThrow("symlinked output root");

      const nestedLink = path.join(outputDir, "nested");
      fs.symlinkSync(external, nestedLink);
      expect(() => {
        assertSafeOutputParents(path.join(nestedLink, "hero.webp"), outputDir);
      }).toThrow("symlinked output directory");
    }
  );

  it("rejects a regular file used as an output parent", () => {
    const { outputDir } = workspace();
    const parent = path.join(outputDir, "not-a-directory");
    fs.writeFileSync(parent, "x");
    expect(() => {
      assertSafeOutputParents(path.join(parent, "hero.webp"), outputDir);
    }).toThrow("non-directory output path");
  });
});
