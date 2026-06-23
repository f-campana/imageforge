import { defineConfig } from "vite";
import { imageforgeVitePlugin } from "../../dist/index.js";

export default defineConfig({
  plugins: [
    imageforgeVitePlugin({
      inputDir: "src/assets/images",
      outDir: "public/imageforge",
      publicBasePath: "/imageforge",
      formats: ["webp", "avif"],
      widths: [16, 32, 64],
    }),
  ],
});
