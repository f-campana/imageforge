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
  variants?: Record<string, ImageForgeVariant[]>;
  hash: string;
}

export interface ImageForgeOutput {
  path: string;
  size: number;
}

export interface ImageForgeVariant {
  width: number;
  height: number;
  path: string;
  size: number;
}
