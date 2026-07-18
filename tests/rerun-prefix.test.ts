import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectCommandPrefix } from "../src/rerun-prefix.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "imageforge-rerun-prefix-"));
  workspaces.push(directory);
  return directory;
}

describe("rerun command prefix", () => {
  it.each([
    [
      "npm/11.4.2 node/v22",
      ["npm", "exec", "--yes", "--package", "@imageforge/cli@0.1.9", "--", "imageforge"],
    ],
    [
      "yarn/1.22.22 npm/? node/v22",
      ["npm", "exec", "--yes", "--package", "@imageforge/cli@0.1.9", "--", "imageforge"],
    ],
    ["yarn/4.9.1 npm/? node/v22", ["yarn", "dlx", "@imageforge/cli@0.1.9"]],
    ["pnpm/10.28.2 npm/? node/v22", ["pnpm", "dlx", "@imageforge/cli@0.1.9"]],
    ["bun/1.2.0", ["bunx", "@imageforge/cli@0.1.9"]],
  ])("uses a valid exact-package fallback for %s", (userAgent, expected) => {
    expect(resolveProjectCommandPrefix("0.1.9", workspace(), userAgent)).toEqual(expected);
  });

  it("uses the matching project install without allowing a registry fallback", () => {
    const root = workspace();
    const packageDirectory = path.join(root, "node_modules", "@imageforge", "cli");
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, "package.json"), '{"version":"0.1.9"}\n');

    expect(resolveProjectCommandPrefix("0.1.9", root, "npm/11.4.2 node/v22")).toEqual([
      "npm",
      "exec",
      "--no",
      "--",
      "imageforge",
    ]);
  });

  it("uses an exact declared Yarn Plug'n'Play dependency without requiring node_modules", () => {
    const root = workspace();
    fs.writeFileSync(
      path.join(root, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.9"}}\n'
    );

    expect(resolveProjectCommandPrefix("0.1.9", root, "yarn/4.9.1 npm/? node/v22")).toEqual([
      "yarn",
      "exec",
      "imageforge",
    ]);
  });
});
