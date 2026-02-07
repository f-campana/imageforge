export interface ImageForgeManifest {
  version: string;
  generated: string;
  images: Record<string, ImageForgeEntry>;
}

export interface ImageForgeEntry {
  width: number;
  height: number;
  aspectRatio: number;
  blurDataURL: string;
  originalSize: number;
  outputs: Record<string, ImageForgeOutput>;
  hash: string;
}

export interface ImageForgeOutput {
  path: string;
  size: number;
}
