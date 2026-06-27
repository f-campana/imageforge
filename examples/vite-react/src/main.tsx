import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getPictureProps, manifest } from "virtual:imageforge";
import { ImageForgePicture } from "./ImageForgePicture.js";

const hero = getPictureProps("hero.jpg", {
  alt: "Blue ImageForge fixture",
  sizes: "(max-width: 720px) 100vw, 960px",
  fallbackFormat: "webp",
});

function App() {
  return (
    <main data-imageforge-manifest-version={manifest.version}>
      <h1>ImageForge React/Vite consumer proof</h1>
      <ImageForgePicture {...hero} />
    </main>
  );
}

const root = document.querySelector("#root");
if (!root) {
  throw new Error("React root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
