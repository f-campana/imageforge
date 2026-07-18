import { describe, expect, it } from "vitest";

import { compileGlobPatterns, matchesAnyGlob, normalizeGlobPattern } from "../src/glob.js";

describe("glob contracts", () => {
  it("normalizes CLI patterns and candidate separators", () => {
    expect(normalizeGlobPattern("  ./assets\\hero?.png  ")).toBe("assets/hero?.png");
    expect(normalizeGlobPattern(".///assets/hero.png")).toBe("assets/hero.png");
    expect(normalizeGlobPattern("assets/./hero.png")).toBe("assets/./hero.png");
    expect(matchesAnyGlob("./assets\\hero1.png", compileGlobPatterns(["assets/hero?.png"]))).toBe(
      true
    );
  });

  it.each([
    ["*.jpg", "hero.jpg", true],
    ["*.jpg", "nested/hero.jpg", false],
    ["**/*.jpg", "hero.jpg", true],
    ["**/*.jpg", "nested/deep/hero.jpg", true],
    ["assets/**", "assets/nested/hero.png", true],
    ["**/", "nested/", true],
    ["**/", "nested", false],
    ["icon?.png", "icon1.png", true],
    ["icon?.png", "icon😀.png", true],
    ["icon?.png", "icon12.png", false],
    ["file[1].png", "file[1].png", true],
    ["hero.jpg", "prefix-hero.jpg", false],
  ])("matches %s against %s", (pattern, candidate, expected) => {
    expect(matchesAnyGlob(candidate, compileGlobPatterns([pattern]))).toBe(expected);
  });

  it("matches when any compiled pattern succeeds", () => {
    const patterns = compileGlobPatterns(["**/*.jpg", "icons/*.png"]);
    expect(matchesAnyGlob("icons/check.png", patterns)).toBe(true);
    expect(matchesAnyGlob("docs/readme.txt", patterns)).toBe(false);
    expect(matchesAnyGlob("hero.jpg", [])).toBe(false);
  });
});
