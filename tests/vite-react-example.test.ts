import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageForgePicture } from "../examples/vite-react/src/ImageForgePicture.js";
import { getPictureProps } from "../src/render/index.js";
import type { ImageForgeManifest } from "../src/types.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_ROOT = path.join(ROOT, "examples/vite-react");

let browserBundle = "";
let browserModuleIds: string[] = [];
let generatedAssetPaths: string[] = [];
let renderedPicture = "";

function runExampleTypecheck(): void {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules/typescript/bin/tsc"),
      "-p",
      path.join(EXAMPLE_ROOT, "tsconfig.json"),
      "--noEmit",
    ],
    { cwd: ROOT, encoding: "utf-8" }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`React/Vite example typecheck failed:\n${result.stdout}${result.stderr}`);
  }
}

beforeAll(async () => {
  const prepare = spawnSync(process.execPath, [path.join(EXAMPLE_ROOT, "scripts/prepare.mjs")], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  if (prepare.error) throw prepare.error;
  if (prepare.status !== 0) {
    throw new Error(`React/Vite example preparation failed:\n${prepare.stdout}${prepare.stderr}`);
  }

  runExampleTypecheck();
  const result = await build({
    root: EXAMPLE_ROOT,
    configFile: path.join(EXAMPLE_ROOT, "vite.config.ts"),
    logLevel: "silent",
  });
  if ("on" in result) {
    throw new Error("React/Vite example unexpectedly started a watch build.");
  }

  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((output) => output.output.filter((item) => item.type === "chunk"));
  browserBundle = chunks.map((chunk) => chunk.code).join("\n");
  browserModuleIds = chunks.flatMap((chunk) => Object.keys(chunk.modules));

  const manifest = JSON.parse(
    fs.readFileSync(path.join(EXAMPLE_ROOT, "public/imageforge/imageforge.json"), "utf-8")
  ) as ImageForgeManifest;
  const manifestEntry = manifest.images["hero.jpg"];
  generatedAssetPaths = [
    ...Object.values(manifestEntry.outputs).map((output) => output.path),
    ...Object.values(manifestEntry.variants ?? {}).flatMap((variants) =>
      variants.map((variant) => variant.path)
    ),
  ];
  const picture = getPictureProps(manifest, "hero.jpg", {
    alt: "Blue ImageForge fixture",
    sizes: "(max-width: 720px) 100vw, 960px",
    publicBasePath: "/imageforge",
    fallbackFormat: "webp",
  });
  renderedPicture = renderToStaticMarkup(createElement(ImageForgePicture, picture));
});

afterAll(() => {
  fs.rmSync(path.join(EXAMPLE_ROOT, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(EXAMPLE_ROOT, "node_modules"), { recursive: true, force: true });
  fs.rmSync(path.join(EXAMPLE_ROOT, "public/imageforge"), { recursive: true, force: true });
  fs.rmSync(path.join(EXAMPLE_ROOT, "src/assets/images/hero.jpg"), { force: true });
});

describe("typed React/Vite consumer example", () => {
  it("typechecks and builds through the experimental virtual module", () => {
    expect(fs.existsSync(path.join(EXAMPLE_ROOT, "dist/index.html"))).toBe(true);
    expect(browserModuleIds).toContain("\0virtual:imageforge");
    expect(browserModuleIds.some((id) => id.endsWith("/dist/render/getPictureProps.js"))).toBe(
      true
    );
  });

  it("keeps Node-only compiler and adapter modules out of the browser bundle", () => {
    const moduleGraph = browserModuleIds.join("\n");
    for (const forbidden of [
      "node:fs",
      "node:path",
      "/dist/adapters/",
      "/dist/cli.js",
      "/dist/processor.js",
      "/dist/runner",
    ]) {
      expect(moduleGraph).not.toContain(forbidden);
      expect(browserBundle).not.toContain(forbidden);
    }
    expect(moduleGraph).not.toMatch(/[\\/]sharp(?:@|[\\/])/u);
  });

  it("references generated assets and renders AVIF/WebP sources with a WebP fallback", () => {
    expect(browserBundle).toContain("/imageforge");
    expect(generatedAssetPaths.some((assetPath) => assetPath.endsWith(".avif"))).toBe(true);
    expect(generatedAssetPaths.some((assetPath) => assetPath.endsWith(".webp"))).toBe(true);
    for (const assetPath of generatedAssetPaths) {
      expect(browserBundle).toContain(assetPath);
      expect(fs.existsSync(path.join(EXAMPLE_ROOT, "dist/imageforge", assetPath))).toBe(true);
    }
    expect(renderedPicture).toContain('<source type="image/avif"');
    expect(renderedPicture).toContain('<source type="image/webp"');
    expect(renderedPicture).toMatch(/<img[^>]+src="\/imageforge\/hero[^" ]*\.webp"/u);
    expect(renderedPicture.indexOf("image/avif")).toBeLessThan(
      renderedPicture.indexOf("image/webp")
    );
  });
});
