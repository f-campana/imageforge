import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { build, type Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { IMAGEFORGE_VIRTUAL_MODULE_ID, imageforgeVitePlugin } from "../src/index.js";
import type { ImageForgeViteError } from "../src/index.js";

const workspaces: string[] = [];
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function createWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-vite-"));
  const packageScope = path.join(workspace, "node_modules/@imageforge");
  fs.mkdirSync(packageScope, { recursive: true });
  fs.symlinkSync(ROOT, path.join(packageScope, "cli"), "dir");
  workspaces.push(workspace);
  return workspace;
}

async function createFixtureImage(filePath: string): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width: 96,
      height: 64,
      channels: 3,
      background: { r: 30, g: 90, b: 150 },
    },
  })
    .jpeg({ quality: 90 })
    .toFile(filePath);
}

function getResolveIdHook(plugin: Plugin) {
  if (typeof plugin.resolveId !== "function") {
    throw new Error("Expected the ImageForge Vite plugin to define resolveId().");
  }
  return plugin.resolveId;
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

describe("experimental ImageForge Vite adapter", () => {
  it("resolves only the ImageForge virtual module ID", async () => {
    const plugin = imageforgeVitePlugin({
      inputDir: "src/assets/images",
      outDir: "public/imageforge",
      publicBasePath: "/imageforge",
    });
    const resolveId = getResolveIdHook(plugin);

    expect(
      await resolveId.call({} as never, IMAGEFORGE_VIRTUAL_MODULE_ID, undefined, {} as never)
    ).toBe("\0virtual:imageforge");
    expect(await resolveId.call({} as never, "virtual:other", undefined, {} as never)).toBe(
      undefined
    );
  });

  it("runs ImageForge in a Vite build and exposes URL-safe rendering data", async () => {
    const root = createWorkspace();
    await createFixtureImage(path.join(root, "src/assets/images/nested/hero.jpg"));
    fs.writeFileSync(
      path.join(root, "entry.js"),
      [
        'import { getPictureProps, manifest } from "virtual:imageforge";',
        'globalThis.imageforgeDefault = getPictureProps("nested/hero.jpg", {',
        '  alt: "Hero",',
        '  sizes: "100vw",',
        '  fallbackFormat: "webp",',
        "});",
        'globalThis.imageforgeOverride = getPictureProps("nested/hero.jpg", {',
        '  alt: "Hero",',
        '  sizes: "100vw",',
        '  fallbackFormat: "webp",',
        '  publicBasePath: "/preview",',
        "});",
        "globalThis.imageforgeManifest = manifest;",
      ].join("\n")
    );

    await build({
      root,
      base: "/docs/",
      logLevel: "silent",
      plugins: [
        imageforgeVitePlugin({
          inputDir: "src/assets/images",
          outDir: "public/imageforge",
          publicBasePath: "/docs/imageforge",
          formats: ["webp", "avif"],
          widths: [48, 96, 160],
        }),
      ],
      build: {
        minify: false,
        rollupOptions: {
          input: path.join(root, "entry.js"),
          output: {
            entryFileNames: "app.js",
          },
        },
      },
    });

    const publicManifestPath = path.join(root, "public/imageforge/imageforge.json");
    const builtManifestPath = path.join(root, "dist/imageforge/imageforge.json");
    const publicManifest = JSON.parse(fs.readFileSync(publicManifestPath, "utf-8")) as {
      version: string;
      images: Record<
        string,
        {
          outputs: Record<string, { path: string }>;
          variants?: Partial<Record<string, { path: string; width: number }[]>>;
        }
      >;
    };
    const entry = publicManifest.images["nested/hero.jpg"];
    const bundlePath = path.join(root, "dist/app.js");

    expect(publicManifest.version).toBe("1.0");
    expect(fs.readFileSync(builtManifestPath, "utf-8")).toBe(
      fs.readFileSync(publicManifestPath, "utf-8")
    );
    expect(entry.outputs.webp.path).toBe("nested/hero.w96.webp");
    expect(entry.outputs.avif.path).toBe("nested/hero.w96.avif");
    expect(entry.variants?.webp?.map((variant) => variant.width)).toEqual([48, 96]);
    expect(JSON.stringify(publicManifest)).not.toContain("../");
    expect(fs.existsSync(path.join(root, "dist/imageforge/.imageforge-cache.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "dist/imageforge/nested/hero.w48.webp"))).toBe(true);
    expect(fs.existsSync(path.join(root, "dist/imageforge/nested/hero.w96.avif"))).toBe(true);

    await import(pathToFileURL(bundlePath).href);
    const fixtureGlobal = globalThis as typeof globalThis & {
      imageforgeDefault?: { img: { src: string } };
      imageforgeOverride?: { img: { src: string } };
      imageforgeManifest?: unknown;
    };
    expect(fixtureGlobal.imageforgeDefault?.img.src).toBe("/docs/imageforge/nested/hero.w96.webp");
    expect(fixtureGlobal.imageforgeOverride?.img.src).toBe("/preview/nested/hero.w96.webp");
    delete fixtureGlobal.imageforgeDefault;
    delete fixtureGlobal.imageforgeOverride;
    delete fixtureGlobal.imageforgeManifest;
  });

  it("rejects output directories that Vite will not serve as public assets", async () => {
    const root = createWorkspace();
    await createFixtureImage(path.join(root, "src/assets/images/hero.jpg"));
    fs.writeFileSync(path.join(root, "entry.js"), "export {};\n");

    await expect(
      build({
        root,
        logLevel: "silent",
        build: {
          rollupOptions: {
            input: path.join(root, "entry.js"),
          },
        },
        plugins: [
          imageforgeVitePlugin({
            inputDir: "src/assets/images",
            outDir: "generated/imageforge",
            publicBasePath: "/imageforge",
          }),
        ],
      })
    ).rejects.toMatchObject({
      imageforgeCode: "UNSAFE_OUTPUT_LAYOUT",
    });
  });

  it("rejects a public path that omits Vite's root-relative base", async () => {
    const root = createWorkspace();
    await createFixtureImage(path.join(root, "src/assets/images/hero.jpg"));
    fs.writeFileSync(path.join(root, "entry.js"), "export {};\n");

    await expect(
      build({
        root,
        base: "/docs/",
        logLevel: "silent",
        build: {
          rollupOptions: {
            input: path.join(root, "entry.js"),
          },
        },
        plugins: [
          imageforgeVitePlugin({
            inputDir: "src/assets/images",
            outDir: "public/imageforge",
            publicBasePath: "/imageforge",
          }),
        ],
      })
    ).rejects.toMatchObject({
      imageforgeCode: "PUBLIC_BASE_PATH_MISMATCH",
    });
  });

  it.each(["./", "https://cdn.example.com/assets/"])(
    "rejects unsupported Vite base %s",
    async (base) => {
      const root = createWorkspace();
      await createFixtureImage(path.join(root, "src/assets/images/hero.jpg"));
      fs.writeFileSync(path.join(root, "entry.js"), "export {};\n");

      await expect(
        build({
          root,
          base,
          logLevel: "silent",
          build: {
            rollupOptions: {
              input: path.join(root, "entry.js"),
            },
          },
          plugins: [
            imageforgeVitePlugin({
              inputDir: "src/assets/images",
              outDir: "public/imageforge",
              publicBasePath: "/imageforge",
            }),
          ],
        })
      ).rejects.toMatchObject({
        imageforgeCode: "UNSUPPORTED_VITE_BASE",
      });
    }
  );

  it("reports an empty input directory explicitly", async () => {
    const root = createWorkspace();
    fs.mkdirSync(path.join(root, "src/assets/images"), { recursive: true });
    fs.writeFileSync(path.join(root, "entry.js"), "export {};\n");

    await expect(
      build({
        root,
        logLevel: "silent",
        build: {
          rollupOptions: {
            input: path.join(root, "entry.js"),
          },
        },
        plugins: [
          imageforgeVitePlugin({
            inputDir: "src/assets/images",
            outDir: "public/imageforge",
            publicBasePath: "/imageforge",
          }),
        ],
      })
    ).rejects.toMatchObject({
      imageforgeCode: "NO_IMAGES",
    });
  });

  it("reports clear coded option errors before Vite starts", () => {
    expect(() =>
      imageforgeVitePlugin({
        inputDir: "",
        outDir: "public/imageforge",
        publicBasePath: "/imageforge",
      })
    ).toThrow(
      expect.objectContaining<Partial<ImageForgeViteError>>({
        code: "INVALID_OPTIONS",
      })
    );

    expect(() =>
      imageforgeVitePlugin({
        inputDir: "src/assets/images",
        outDir: "public/imageforge",
        publicBasePath: "/imageforge",
        formats: [],
      })
    ).toThrow(
      expect.objectContaining<Partial<ImageForgeViteError>>({
        code: "INVALID_OPTIONS",
      })
    );
  });
});
