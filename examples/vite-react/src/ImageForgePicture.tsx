import type { ImageForgePictureProps } from "@imageforge/cli/render";

export function ImageForgePicture({ sources, img }: ImageForgePictureProps) {
  return (
    <picture>
      {sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={source.sizes} />
      ))}
      <img {...img} />
    </picture>
  );
}
