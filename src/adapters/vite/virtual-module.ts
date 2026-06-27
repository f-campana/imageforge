import type { ImageForgeManifest } from "../../types.js";

function serializeForModule(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

export function createImageForgeVirtualModule(
  manifest: ImageForgeManifest,
  publicBasePath: string
): string {
  return [
    'import { getPictureProps as getCorePictureProps } from "@imageforge/cli/render";',
    `export const manifest = ${serializeForModule(manifest)};`,
    `const configuredPublicBasePath = ${JSON.stringify(publicBasePath)};`,
    "export function getPictureProps(src, options) {",
    "  return getCorePictureProps(manifest, src, {",
    "    ...options,",
    "    publicBasePath: options.publicBasePath ?? configuredPublicBasePath,",
    "  });",
    "}",
  ].join("\n");
}
