import * as fs from "node:fs";
import * as path from "node:path";

function packageDeclaresExactVersion(directory: string, version: string): boolean {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8")
    );
    if (typeof parsed !== "object" || parsed === null) return false;
    const packageJson = parsed as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      const dependencies = packageJson[field];
      if (
        typeof dependencies === "object" &&
        dependencies !== null &&
        "@imageforge/cli" in dependencies &&
        (dependencies as Record<string, unknown>)["@imageforge/cli"] === version
      ) {
        return true;
      }
    }
  } catch {
    // Missing or malformed package metadata cannot prove an exact project dependency.
  }
  return false;
}

function hasExactProjectInstall(cwd: string, version: string, allowYarnPnp: boolean): boolean {
  let directory = cwd;
  let activeYarnWorkspaceDeclaresExactVersion: boolean | undefined;
  for (;;) {
    const packagePath = path.join(directory, "node_modules", "@imageforge", "cli", "package.json");
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "version" in parsed &&
        parsed.version === version
      ) {
        return true;
      }
    } catch {
      // Keep walking: package managers can hoist a project dependency to an ancestor.
    }
    if (allowYarnPnp) {
      const workspacePackagePath = path.join(directory, "package.json");
      if (
        activeYarnWorkspaceDeclaresExactVersion === undefined &&
        fs.existsSync(workspacePackagePath)
      ) {
        activeYarnWorkspaceDeclaresExactVersion = packageDeclaresExactVersion(directory, version);
      }
      if (
        fs.existsSync(path.join(directory, ".pnp.cjs")) ||
        fs.existsSync(path.join(directory, ".pnp.js"))
      ) {
        return activeYarnWorkspaceDeclaresExactVersion === true;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

export function resolveProjectCommandPrefix(
  version: string,
  cwd = process.cwd(),
  userAgent = process.env.npm_config_user_agent ?? ""
): string[] {
  const allowYarnPnp = userAgent.startsWith("yarn/");
  if (hasExactProjectInstall(cwd, version, allowYarnPnp)) {
    if (userAgent.startsWith("pnpm/")) return ["pnpm", "exec", "imageforge"];
    if (userAgent.startsWith("yarn/")) return ["yarn", "exec", "imageforge"];
    if (userAgent.startsWith("bun/")) return ["bunx", "--no-install", "imageforge"];
    if (userAgent.startsWith("npm/")) return ["npm", "exec", "--no", "--", "imageforge"];
    return ["npx", "--no-install", "imageforge"];
  }

  const exactPackage = `@imageforge/cli@${version}`;
  if (userAgent.startsWith("pnpm/")) return ["pnpm", "dlx", exactPackage];
  if (userAgent.startsWith("yarn/") && !userAgent.startsWith("yarn/1.")) {
    return ["yarn", "dlx", exactPackage];
  }
  if (userAgent.startsWith("bun/")) return ["bunx", exactPackage];
  return ["npm", "exec", "--yes", "--package", exactPackage, "--", "imageforge"];
}
