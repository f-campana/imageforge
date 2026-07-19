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
    fs.writeFileSync(path.join(root, ".pnp.cjs"), "module.exports = {};\n");
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

  it("uses an exact Yarn Classic Plug'n'Play dependency", () => {
    const root = workspace();
    fs.writeFileSync(path.join(root, ".pnp.js"), "module.exports = {};\n");
    fs.writeFileSync(
      path.join(root, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.9"}}\n'
    );

    expect(resolveProjectCommandPrefix("0.1.9", root, "yarn/1.22.22 npm/? node/v22")).toEqual([
      "yarn",
      "exec",
      "imageforge",
    ]);
  });

  it("uses an exact child-workspace dependency from its containing Yarn PnP project", () => {
    const root = workspace();
    const child = path.join(root, "packages", "app");
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(root, ".pnp.cjs"), "module.exports = {};\n");
    fs.writeFileSync(
      path.join(child, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.9"}}\n'
    );

    expect(resolveProjectCommandPrefix("0.1.9", child, "yarn/4.9.1 npm/? node/v22")).toEqual([
      "yarn",
      "exec",
      "imageforge",
    ]);
  });

  it("does not borrow a root dependency for a child Yarn PnP workspace", () => {
    const root = workspace();
    const child = path.join(root, "packages", "app");
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(root, ".pnp.cjs"), "module.exports = {};\n");
    fs.writeFileSync(
      path.join(root, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.9"}}\n'
    );
    fs.writeFileSync(path.join(child, "package.json"), '{"name":"app"}\n');

    expect(resolveProjectCommandPrefix("0.1.9", child, "yarn/4.9.1 npm/? node/v22")).toEqual([
      "yarn",
      "dlx",
      "@imageforge/cli@0.1.9",
    ]);
  });

  it("does not borrow a matching root dependency over a mismatched child dependency", () => {
    const root = workspace();
    const child = path.join(root, "packages", "app");
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(root, ".pnp.cjs"), "module.exports = {};\n");
    fs.writeFileSync(
      path.join(root, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.9"}}\n'
    );
    fs.writeFileSync(
      path.join(child, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.8"}}\n'
    );

    expect(resolveProjectCommandPrefix("0.1.9", child, "yarn/4.9.1 npm/? node/v22")).toEqual([
      "yarn",
      "dlx",
      "@imageforge/cli@0.1.9",
    ]);
  });

  it("does not treat an uninstalled package declaration as a local npm binary", () => {
    const root = workspace();
    fs.writeFileSync(
      path.join(root, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.9"}}\n'
    );

    expect(resolveProjectCommandPrefix("0.1.9", root, "npm/11.4.2 node/v22")).toEqual([
      "npm",
      "exec",
      "--yes",
      "--package",
      "@imageforge/cli@0.1.9",
      "--",
      "imageforge",
    ]);
  });

  it("does not treat a node_modules Yarn declaration as Plug'n'Play", () => {
    const root = workspace();
    fs.writeFileSync(
      path.join(root, "package.json"),
      '{"devDependencies":{"@imageforge/cli":"0.1.9"}}\n'
    );

    expect(resolveProjectCommandPrefix("0.1.9", root, "yarn/4.9.1 npm/? node/v22")).toEqual([
      "yarn",
      "dlx",
      "@imageforge/cli@0.1.9",
    ]);
  });
});
