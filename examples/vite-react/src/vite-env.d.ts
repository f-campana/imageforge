/// <reference types="vite/client" />

declare module "virtual:imageforge" {
  import type {
    GetPicturePropsOptions,
    ImageForgeManifest,
    ImageForgePictureProps,
  } from "@imageforge/cli/render";

  export const manifest: ImageForgeManifest;

  export function getPictureProps(
    src: string,
    options: GetPicturePropsOptions
  ): ImageForgePictureProps;
}
