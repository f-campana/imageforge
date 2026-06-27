import * as fs from "node:fs";
import { fileURLToPath, URL } from "node:url";
import sharp from "sharp";

const fixturePath = fileURLToPath(new URL("../fixtures/hero.svg", import.meta.url));
const outputPath = fileURLToPath(new URL("../src/assets/images/hero.jpg", import.meta.url));

fs.mkdirSync(fileURLToPath(new URL("../src/assets/images", import.meta.url)), {
  recursive: true,
});
await sharp(fixturePath).jpeg({ quality: 75 }).toFile(outputPath);
