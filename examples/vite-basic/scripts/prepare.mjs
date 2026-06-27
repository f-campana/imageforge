import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import { fileURLToPath, URL } from "node:url";

const encodedPath = fileURLToPath(new URL("../fixtures/hero.jpg.base64", import.meta.url));
const outputPath = fileURLToPath(new URL("../src/assets/images/hero.jpg", import.meta.url));

fs.mkdirSync(fileURLToPath(new URL("../src/assets/images", import.meta.url)), {
  recursive: true,
});
fs.writeFileSync(outputPath, Buffer.from(fs.readFileSync(encodedPath, "utf-8").trim(), "base64"));
