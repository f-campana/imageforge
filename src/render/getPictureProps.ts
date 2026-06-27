import type { ImageForgeEntry, ImageForgeManifest, ImageForgeOutput } from "../types.js";

export interface GetPicturePropsOptions {
  alt: string;
  sizes: string;
  publicBasePath?: string;
  assetBaseUrl?: string;
  fallbackFormat?: "original" | "webp" | "avif";
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
}

export interface ImageForgePictureSource {
  type: "image/avif" | "image/webp";
  srcSet: string;
  sizes: string;
}

export interface ImageForgePictureImgProps {
  src: string;
  width: number;
  height: number;
  alt: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
}

export interface ImageForgePictureProps {
  sources: ImageForgePictureSource[];
  img: ImageForgePictureImgProps;
  blurDataURL?: string;
}

type RenderableFormat = "avif" | "webp";

const FORMAT_ORDER: RenderableFormat[] = ["avif", "webp"];

export type ImageForgeRenderErrorCode =
  | "IMAGE_NOT_FOUND"
  | "NO_RENDERABLE_OUTPUTS"
  | "FALLBACK_FORMAT_NOT_FOUND"
  | "INVALID_MANIFEST_ENTRY"
  | "INVALID_ASSET_PATH"
  | "INVALID_URL_POLICY"
  | "INVALID_OPTIONS";

export class ImageForgeRenderError extends Error {
  readonly code: ImageForgeRenderErrorCode;
  readonly src: string;

  constructor(code: ImageForgeRenderErrorCode, message: string, src: string) {
    super(message);
    this.name = "ImageForgeRenderError";
    this.code = code;
    this.src = src;
  }
}

function renderError(
  code: ImageForgeRenderErrorCode,
  message: string,
  src: string
): ImageForgeRenderError {
  return new ImageForgeRenderError(code, message, src);
}

function encodeAssetPath(assetPath: string, src: string): string {
  if (assetPath.length === 0 || assetPath.startsWith("/") || assetPath.includes("\\")) {
    throw renderError(
      "INVALID_ASSET_PATH",
      `ImageForge asset path "${assetPath}" must be a non-empty relative POSIX path.`,
      src
    );
  }

  const segments = assetPath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw renderError(
      "INVALID_ASSET_PATH",
      `ImageForge asset path "${assetPath}" contains a filesystem-only path segment.`,
      src
    );
  }

  return segments.map(encodeURIComponent).join("/");
}

function encodePublicBasePath(publicBasePath: string | undefined, src: string): string {
  if (publicBasePath === undefined || publicBasePath === "" || publicBasePath === "/") {
    return "";
  }

  if (
    publicBasePath.includes("\\") ||
    publicBasePath.includes("?") ||
    publicBasePath.includes("#")
  ) {
    throw renderError(
      "INVALID_URL_POLICY",
      `publicBasePath "${publicBasePath}" must contain URL path segments only.`,
      src
    );
  }

  const segments = publicBasePath.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw renderError(
      "INVALID_URL_POLICY",
      `publicBasePath "${publicBasePath}" contains an invalid path segment.`,
      src
    );
  }

  return segments.map(encodeURIComponent).join("/");
}

function normalizeAssetBaseUrl(assetBaseUrl: string, src: string): URL {
  let url: URL;
  try {
    url = new URL(assetBaseUrl);
  } catch {
    throw renderError(
      "INVALID_URL_POLICY",
      `assetBaseUrl "${assetBaseUrl}" must be an absolute HTTP(S) URL.`,
      src
    );
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw renderError(
      "INVALID_URL_POLICY",
      `assetBaseUrl "${assetBaseUrl}" must be an absolute HTTP(S) URL without a query or hash.`,
      src
    );
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

function resolveAssetUrl(assetPath: string, options: GetPicturePropsOptions, src: string): string {
  const publicBasePath = encodePublicBasePath(options.publicBasePath, src);
  const relativeUrl = [publicBasePath, encodeAssetPath(assetPath, src)].filter(Boolean).join("/");

  if (options.assetBaseUrl) {
    return new URL(relativeUrl, normalizeAssetBaseUrl(options.assetBaseUrl, src)).toString();
  }

  return `/${relativeUrl}`;
}

function getFormatCandidates(entry: ImageForgeEntry, format: RenderableFormat) {
  const variants = entry.variants?.[format];
  if (variants && variants.length > 0) {
    return [...variants].sort((left, right) => left.width - right.width);
  }

  const outputs = entry.outputs as Partial<Record<RenderableFormat, ImageForgeOutput>>;
  const output = outputs[format];
  return output ? [{ width: entry.width, path: output.path }] : [];
}

export function getPictureProps(
  manifest: ImageForgeManifest,
  src: string,
  options: GetPicturePropsOptions
): ImageForgePictureProps {
  if (typeof options.sizes !== "string" || options.sizes.trim().length === 0) {
    throw renderError("INVALID_OPTIONS", "ImageForge picture sizes must not be empty.", src);
  }

  const images = manifest.images as Partial<Record<string, ImageForgeEntry>>;
  const entry = images[src];
  if (!entry) {
    throw renderError(
      "IMAGE_NOT_FOUND",
      `ImageForge manifest does not contain image "${src}".`,
      src
    );
  }

  if (
    !Number.isInteger(entry.width) ||
    entry.width <= 0 ||
    !Number.isInteger(entry.height) ||
    entry.height <= 0
  ) {
    throw renderError(
      "INVALID_MANIFEST_ENTRY",
      `ImageForge manifest entry "${src}" must have positive integer dimensions.`,
      src
    );
  }

  const sources = FORMAT_ORDER.flatMap((format): ImageForgePictureSource[] => {
    const candidates = getFormatCandidates(entry, format);
    if (candidates.length === 0) {
      return [];
    }

    return [
      {
        type: `image/${format}`,
        srcSet: candidates
          .map((candidate) => {
            if (!Number.isInteger(candidate.width) || candidate.width <= 0) {
              throw renderError(
                "INVALID_MANIFEST_ENTRY",
                `ImageForge manifest entry "${src}" contains an invalid ${format} width.`,
                src
              );
            }
            return `${resolveAssetUrl(candidate.path, options, src)} ${candidate.width.toString()}w`;
          })
          .join(", "),
        sizes: options.sizes,
      },
    ];
  });

  if (sources.length === 0) {
    throw renderError(
      "NO_RENDERABLE_OUTPUTS",
      `ImageForge manifest entry "${src}" has no AVIF or WebP outputs.`,
      src
    );
  }

  const fallbackFormat = options.fallbackFormat ?? "original";
  let fallbackPath = src;
  if (fallbackFormat !== "original") {
    const outputs = entry.outputs as Partial<Record<RenderableFormat, ImageForgeOutput>>;
    const fallbackOutput = outputs[fallbackFormat];
    if (!fallbackOutput) {
      throw renderError(
        "FALLBACK_FORMAT_NOT_FOUND",
        `ImageForge manifest entry "${src}" has no ${fallbackFormat} fallback output.`,
        src
      );
    }
    fallbackPath = fallbackOutput.path;
  }

  const img: ImageForgePictureImgProps = {
    src: resolveAssetUrl(fallbackPath, options, src),
    width: entry.width,
    height: entry.height,
    alt: options.alt,
    ...(options.loading ? { loading: options.loading } : {}),
    ...(options.decoding ? { decoding: options.decoding } : {}),
  };

  return {
    sources,
    img,
    ...(entry.blurDataURL ? { blurDataURL: entry.blurDataURL } : {}),
  };
}
