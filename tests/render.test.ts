import { describe, expect, it } from "vitest";
import {
  getPictureProps,
  ImageForgeRenderError,
  type ImageForgeEntry,
  type ImageForgeManifest,
  type ImageForgeRenderErrorCode,
} from "../src/index.js";

const BASE_ENTRY: ImageForgeEntry = {
  width: 1200,
  height: 800,
  aspectRatio: 1.5,
  blurDataURL: "data:image/png;base64,blur",
  originalSize: 120_000,
  outputs: {
    webp: { path: "images/hero.w1200.webp", size: 40_000 },
    avif: { path: "images/hero.w1200.avif", size: 30_000 },
  },
  variants: {
    webp: [
      { width: 1200, height: 800, path: "images/hero.w1200.webp", size: 40_000 },
      { width: 320, height: 213, path: "images/hero.w320.webp", size: 8_000 },
      { width: 640, height: 427, path: "images/hero.w640.webp", size: 18_000 },
    ],
    avif: [
      { width: 640, height: 427, path: "images/hero.w640.avif", size: 14_000 },
      { width: 320, height: 213, path: "images/hero.w320.avif", size: 6_000 },
      { width: 1200, height: 800, path: "images/hero.w1200.avif", size: 30_000 },
    ],
  },
  hash: "fixture-hash",
};

function makeManifest(entryOverrides: Partial<ImageForgeEntry> = {}): ImageForgeManifest {
  return {
    version: "1.0",
    generated: "2026-06-22T00:00:00.000Z",
    images: {
      "images/hero.jpg": {
        ...BASE_ENTRY,
        ...entryOverrides,
      },
    },
  };
}

function captureRenderError(callback: () => unknown): ImageForgeRenderError {
  try {
    callback();
  } catch (error) {
    if (error instanceof ImageForgeRenderError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected ImageForgeRenderError.");
}

function expectRenderError(callback: () => unknown, code: ImageForgeRenderErrorCode): void {
  expect(captureRenderError(callback)).toMatchObject({ code });
}

describe("getPictureProps", () => {
  it("builds deterministic framework-neutral picture props from responsive variants", () => {
    expect(
      getPictureProps(makeManifest(), "images/hero.jpg", {
        alt: "Sunrise over the valley",
        sizes: "(max-width: 720px) 100vw, 1200px",
      })
    ).toEqual({
      sources: [
        {
          type: "image/avif",
          srcSet:
            "/images/hero.w320.avif 320w, /images/hero.w640.avif 640w, /images/hero.w1200.avif 1200w",
          sizes: "(max-width: 720px) 100vw, 1200px",
        },
        {
          type: "image/webp",
          srcSet:
            "/images/hero.w320.webp 320w, /images/hero.w640.webp 640w, /images/hero.w1200.webp 1200w",
          sizes: "(max-width: 720px) 100vw, 1200px",
        },
      ],
      img: {
        src: "/images/hero.jpg",
        width: 1200,
        height: 800,
        alt: "Sunrise over the valley",
      },
      blurDataURL: "data:image/png;base64,blur",
    });
  });

  it("uses full-size outputs when responsive variants are absent", () => {
    const picture = getPictureProps(
      makeManifest({
        blurDataURL: "",
        variants: undefined,
      }),
      "images/hero.jpg",
      {
        alt: "",
        sizes: "50vw",
        fallbackFormat: "webp",
        publicBasePath: "/compiled media/",
        assetBaseUrl: "https://cdn.example.com/site-assets",
        loading: "eager",
        decoding: "async",
      }
    );

    expect(picture).toEqual({
      sources: [
        {
          type: "image/avif",
          srcSet:
            "https://cdn.example.com/site-assets/compiled%20media/images/hero.w1200.avif 1200w",
          sizes: "50vw",
        },
        {
          type: "image/webp",
          srcSet:
            "https://cdn.example.com/site-assets/compiled%20media/images/hero.w1200.webp 1200w",
          sizes: "50vw",
        },
      ],
      img: {
        src: "https://cdn.example.com/site-assets/compiled%20media/images/hero.w1200.webp",
        width: 1200,
        height: 800,
        alt: "",
        loading: "eager",
        decoding: "async",
      },
    });
  });

  it("preserves source-bounded responsive widths without inventing a source-width variant", () => {
    const picture = getPictureProps(
      makeManifest({
        width: 800,
        height: 600,
        aspectRatio: 1.333,
        outputs: {
          webp: { path: "images/hero.w640.webp", size: 24_000 },
        },
        variants: {
          webp: [
            { width: 640, height: 480, path: "images/hero.w640.webp", size: 24_000 },
            { width: 320, height: 240, path: "images/hero.w320.webp", size: 9_000 },
          ],
        },
      }),
      "images/hero.jpg",
      {
        alt: "Source-bounded image",
        sizes: "100vw",
      }
    );

    expect(picture.sources).toEqual([
      {
        type: "image/webp",
        srcSet: "/images/hero.w320.webp 320w, /images/hero.w640.webp 640w",
        sizes: "100vw",
      },
    ]);
    expect(picture.img).toMatchObject({
      src: "/images/hero.jpg",
      width: 800,
      height: 600,
    });
  });

  it("reports a missing manifest entry explicitly", () => {
    expect.hasAssertions();
    expectRenderError(
      () =>
        getPictureProps(makeManifest(), "images/missing.jpg", {
          alt: "Missing",
          sizes: "100vw",
        }),
      "IMAGE_NOT_FOUND"
    );
  });

  it("reports an entry without generated outputs explicitly", () => {
    expect.hasAssertions();
    expectRenderError(
      () =>
        getPictureProps(makeManifest({ outputs: {}, variants: undefined }), "images/hero.jpg", {
          alt: "Hero",
          sizes: "100vw",
        }),
      "NO_RENDERABLE_OUTPUTS"
    );
  });

  it("reports an unavailable generated fallback format explicitly", () => {
    expect.hasAssertions();
    expectRenderError(
      () =>
        getPictureProps(
          makeManifest({
            outputs: { webp: BASE_ENTRY.outputs.webp },
            variants: { webp: BASE_ENTRY.variants?.webp ?? [] },
          }),
          "images/hero.jpg",
          {
            alt: "Hero",
            sizes: "100vw",
            fallbackFormat: "avif",
          }
        ),
      "FALLBACK_FORMAT_NOT_FOUND"
    );
  });

  it("rejects filesystem-relative paths instead of emitting them as public URLs", () => {
    expect.hasAssertions();
    expectRenderError(
      () =>
        getPictureProps(
          makeManifest({
            outputs: { webp: { path: "../public/hero.webp", size: 40_000 } },
            variants: undefined,
          }),
          "images/hero.jpg",
          {
            alt: "Hero",
            sizes: "100vw",
          }
        ),
      "INVALID_ASSET_PATH"
    );
  });

  it("rejects an empty sizes policy", () => {
    expect.hasAssertions();
    expectRenderError(
      () =>
        getPictureProps(makeManifest(), "images/hero.jpg", {
          alt: "Hero",
          sizes: "",
        }),
      "INVALID_OPTIONS"
    );
  });

  it("rejects invalid manifest dimensions", () => {
    expect.hasAssertions();
    expectRenderError(
      () =>
        getPictureProps(makeManifest({ width: 0 }), "images/hero.jpg", {
          alt: "Hero",
          sizes: "100vw",
        }),
      "INVALID_MANIFEST_ENTRY"
    );
  });

  it("rejects an invalid absolute asset base URL", () => {
    expect.hasAssertions();
    expectRenderError(
      () =>
        getPictureProps(makeManifest(), "images/hero.jpg", {
          alt: "Hero",
          sizes: "100vw",
          assetBaseUrl: "./filesystem-assets",
        }),
      "INVALID_URL_POLICY"
    );
  });
});
