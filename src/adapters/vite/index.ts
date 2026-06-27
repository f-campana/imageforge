import * as fs from "node:fs";
import * as path from "node:path";
import { fromPosix, toPosix } from "../../processor.js";
import { getDefaultConcurrency, runImageforge } from "../../runner.js";
import { CACHE_FILE } from "../../runner/cache.js";
import type { ImageForgeEntry, ImageForgeManifest } from "../../types.js";
import {
  ImageForgeViteError,
  resolveImageForgeViteOptions,
  type ImageForgeVitePluginOptions,
  type ResolvedImageForgeViteOptions,
} from "./options.js";
import { createImageForgeVirtualModule } from "./virtual-module.js";

export {
  ImageForgeViteError,
  type ImageForgeViteErrorCode,
  type ImageForgeVitePluginOptions,
} from "./options.js";

export const IMAGEFORGE_VIRTUAL_MODULE_ID = "virtual:imageforge";
const RESOLVED_VIRTUAL_MODULE_ID = `\0${IMAGEFORGE_VIRTUAL_MODULE_ID}`;

interface ViteBuildPaths {
  inputDir: string;
  outDir: string;
  manifestPath: string;
  publicCachePath: string;
  privateCachePath: string;
}

interface ViteResolvedBuildConfig {
  root: string;
  publicDir: string;
  cacheDir: string;
  base: string;
}

export interface ImageForgeVitePlugin {
  name: string;
  apply: "build";
  enforce: "pre";
  configResolved(config: ViteResolvedBuildConfig): void;
  buildStart(): Promise<void>;
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
}

function isPathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function getViteBaseSegments(base: string): string[] {
  if (
    !base.startsWith("/") ||
    base.startsWith("//") ||
    base.includes("\\") ||
    base.includes("?") ||
    base.includes("#") ||
    base.includes("%")
  ) {
    throw new ImageForgeViteError(
      "UNSUPPORTED_VITE_BASE",
      `ImageForge Vite supports only unencoded root-relative Vite base paths; received "${base}".`
    );
  }
  if (base === "/") return [];

  const segments = base.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new ImageForgeViteError(
      "UNSUPPORTED_VITE_BASE",
      `ImageForge Vite base "${base}" contains an invalid URL path segment.`
    );
  }
  return segments;
}

function resolveBuildPaths(
  config: ViteResolvedBuildConfig,
  options: ResolvedImageForgeViteOptions
): ViteBuildPaths {
  if (!config.publicDir) {
    throw new ImageForgeViteError(
      "UNSAFE_OUTPUT_LAYOUT",
      "ImageForge Vite requires Vite publicDir to be enabled for generated assets."
    );
  }

  const inputDir = path.resolve(config.root, fromPosix(options.inputDir));
  const outDir = path.resolve(config.root, fromPosix(options.outDir));
  if (!isPathWithin(config.publicDir, outDir)) {
    throw new ImageForgeViteError(
      "UNSAFE_OUTPUT_LAYOUT",
      `ImageForge Vite outDir must be inside Vite publicDir (${config.publicDir}).`
    );
  }

  const publicRelativePath = toPosix(path.relative(config.publicDir, outDir));
  const publicSegments = publicRelativePath === "" ? [] : publicRelativePath.split("/");
  const expectedSegments = [...getViteBaseSegments(config.base), ...publicSegments];
  const expectedPublicBasePath =
    expectedSegments.length === 0 ? "/" : `/${expectedSegments.join("/")}`;
  if (options.publicBasePath !== expectedPublicBasePath) {
    throw new ImageForgeViteError(
      "PUBLIC_BASE_PATH_MISMATCH",
      `ImageForge Vite publicBasePath must be "${expectedPublicBasePath}" for outDir "${options.outDir}".`
    );
  }

  return {
    inputDir,
    outDir,
    manifestPath: path.join(outDir, "imageforge.json"),
    publicCachePath: path.join(outDir, CACHE_FILE),
    privateCachePath: path.join(config.cacheDir, "imageforge", CACHE_FILE),
  };
}

function restorePrivateCache(paths: ViteBuildPaths): void {
  if (!fs.existsSync(paths.privateCachePath)) return;
  fs.mkdirSync(paths.outDir, { recursive: true });
  fs.copyFileSync(paths.privateCachePath, paths.publicCachePath);
}

function storePrivateCache(paths: ViteBuildPaths): void {
  if (!fs.existsSync(paths.publicCachePath)) return;
  fs.mkdirSync(path.dirname(paths.privateCachePath), { recursive: true });
  fs.copyFileSync(paths.publicCachePath, paths.privateCachePath);
  fs.rmSync(paths.publicCachePath, { force: true });
}

function mapGeneratedPath(assetPath: string, paths: ViteBuildPaths): string {
  const absolutePath = path.resolve(paths.inputDir, fromPosix(assetPath));
  if (!isPathWithin(paths.outDir, absolutePath)) {
    throw new ImageForgeViteError(
      "INVALID_GENERATED_PATH",
      `ImageForge generated path "${assetPath}" is outside the configured Vite outDir.`
    );
  }

  const relativePath = toPosix(path.relative(paths.outDir, absolutePath));
  if (relativePath === "") {
    throw new ImageForgeViteError(
      "INVALID_GENERATED_PATH",
      `ImageForge generated path "${assetPath}" does not identify a file.`
    );
  }
  return relativePath;
}

function mapEntry(entry: ImageForgeEntry, paths: ViteBuildPaths): ImageForgeEntry {
  return {
    ...entry,
    outputs: Object.fromEntries(
      Object.entries(entry.outputs).map(([format, output]) => [
        format,
        { ...output, path: mapGeneratedPath(output.path, paths) },
      ])
    ),
    ...(entry.variants
      ? {
          variants: Object.fromEntries(
            Object.entries(entry.variants).map(([format, variants]) => [
              format,
              variants.map((variant) => ({
                ...variant,
                path: mapGeneratedPath(variant.path, paths),
              })),
            ])
          ),
        }
      : {}),
  };
}

function mapManifest(manifest: ImageForgeManifest, paths: ViteBuildPaths): ImageForgeManifest {
  return {
    ...manifest,
    images: Object.fromEntries(
      Object.entries(manifest.images).map(([src, entry]) => [src, mapEntry(entry, paths)])
    ),
  };
}

async function compileManifest(
  options: ResolvedImageForgeViteOptions,
  paths: ViteBuildPaths
): Promise<ImageForgeManifest> {
  if (options.cache) {
    restorePrivateCache(paths);
  } else {
    fs.rmSync(paths.publicCachePath, { force: true });
  }
  let result: Awaited<ReturnType<typeof runImageforge>>;
  try {
    result = await runImageforge({
      version: "experimental-vite",
      inputDir: paths.inputDir,
      outputPath: paths.manifestPath,
      directoryArg: options.inputDir,
      commandName: "vite",
      formats: options.formats,
      quality: options.quality,
      blur: options.blur,
      blurSize: options.blurSize,
      widths: options.widths,
      useCache: options.cache,
      forceOverwrite: !options.cache,
      checkMode: false,
      outDir: paths.outDir,
      concurrency: getDefaultConcurrency(),
      dryRun: false,
      includePatterns: [],
      excludePatterns: [],
      json: true,
      verbose: false,
      quiet: true,
    });
  } finally {
    if (options.cache) {
      storePrivateCache(paths);
    } else {
      fs.rmSync(paths.publicCachePath, { force: true });
    }
  }

  if (result.exitCode !== 0) {
    const details = result.report.errors.map((error) => error.message).join("; ");
    throw new ImageForgeViteError(
      "BUILD_FAILED",
      `ImageForge Vite build failed${details ? `: ${details}` : "."}`
    );
  }
  if (!result.manifest || result.report.summary.total === 0) {
    throw new ImageForgeViteError(
      "NO_IMAGES",
      `ImageForge Vite found no images in "${options.inputDir}".`
    );
  }

  const manifest = mapManifest(result.manifest, paths);
  fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function imageforgeVitePlugin(
  pluginOptions: ImageForgeVitePluginOptions
): ImageForgeVitePlugin {
  const options = resolveImageForgeViteOptions(pluginOptions);
  let paths: ViteBuildPaths | undefined;
  let manifest: ImageForgeManifest | undefined;

  return {
    name: "imageforge:experimental-vite",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      paths = resolveBuildPaths(config, options);
    },
    async buildStart() {
      if (!paths) {
        throw new ImageForgeViteError(
          "BUILD_FAILED",
          "ImageForge Vite did not receive Vite's resolved build configuration."
        );
      }
      manifest = await compileManifest(options, paths);
    },
    resolveId(id) {
      return id === IMAGEFORGE_VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return undefined;
      if (!manifest) {
        throw new ImageForgeViteError(
          "BUILD_FAILED",
          "ImageForge Vite virtual module loaded before the image build completed."
        );
      }
      return createImageForgeVirtualModule(manifest, options.publicBasePath);
    },
  };
}
