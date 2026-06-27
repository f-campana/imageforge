import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { imageforgeVitePlugin } from "../../dist/index.js";

export default defineConfig({
  resolve: {
    alias: {
      "@imageforge/cli/render": fileURLToPath(
        new URL("../../dist/render/index.js", import.meta.url)
      ),
    },
  },
  plugins: [
    imageforgeVitePlugin({
      inputDir: "src/assets/images",
      outDir: "public/imageforge",
      publicBasePath: "/imageforge",
      formats: ["webp", "avif"],
      widths: [320, 640, 960],
    }),
  ],
});
