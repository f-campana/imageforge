import { afterAll, afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { manifestMatches } from "../src/runner/manifest.js";
import type { ImageForgeManifest } from "../src/types.js";

const expected: ImageForgeManifest = {
  version: "1.0",
  generated: "2026-07-18T00:00:00.000Z",
  images: {},
};

describe("manifest freshness comparison", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-manifest-match-"));
  const manifestPath = path.join(workspace, "imageforge.json");

  afterEach(() => {
    fs.rmSync(manifestPath, { force: true });
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  function write(value: unknown) {
    fs.writeFileSync(manifestPath, JSON.stringify(value));
  }

  it("accepts exact content while ignoring only the generated timestamp", () => {
    write(expected);
    expect(manifestMatches(manifestPath, expected)).toBe(true);

    write({ ...expected, generated: "2000-01-01T00:00:00.000Z" });
    expect(manifestMatches(manifestPath, expected)).toBe(true);
  });

  it.each([
    ["wrong version", { ...expected, version: "2.0" }],
    ["missing generated", { version: "1.0", images: {} }],
    ["null generated", { ...expected, generated: null }],
    ["object generated", { ...expected, generated: {} }],
    ["invalid generated", { ...expected, generated: "not-a-date" }],
    ["non-canonical generated", { ...expected, generated: "2026-07-18" }],
    ["missing images", { version: "1.0", generated: expected.generated }],
    ["null images", { ...expected, images: null }],
    ["extra root field", { ...expected, extra: true }],
    ["extra image entry", { ...expected, images: { "extra.jpg": {} } }],
    ["array root", []],
    ["primitive root", 1],
    ["null root", null],
  ])("rejects %s", (_label, value) => {
    write(value);
    expect(manifestMatches(manifestPath, expected)).toBe(false);
  });

  it("rejects a missing or malformed manifest", () => {
    expect(manifestMatches(manifestPath, expected)).toBe(false);
    fs.writeFileSync(manifestPath, "{not-json");
    expect(manifestMatches(manifestPath, expected)).toBe(false);
  });
});
