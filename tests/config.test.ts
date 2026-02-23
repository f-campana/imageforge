import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as { version: string }
).version;

interface CliRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd = ROOT, extraEnv: Record<string, string> = {}): CliRunResult {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function createJpeg(
  filePath: string,
  width: number,
  height: number,
  background: { r: number; g: number; b: number }
) {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background,
    },
  })
    .jpeg({ quality: 90 })
    .toFile(filePath);
}
describe("config support", () => {
  const configDir = path.join(__dirname, "config-fixtures");
  const configFilePath = path.join(configDir, "imageforge.config.json");

  beforeAll(async () => {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.mkdirSync(configDir, { recursive: true });
    await createJpeg(path.join(configDir, "cfg.jpg"), 80, 60, { r: 20, g: 40, b: 60 });
  });

  afterAll(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("loads imageforge.config.json with CLI overrides", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          output: "from-config.json",
          formats: ["webp", "avif"],
          quality: 70,
          blur: false,
          blurSize: 6,
          widths: [32, 64],
          concurrency: 2,
          quiet: true,
        },
        null,
        2
      )
    );

    const result = runCli(
      [".", "--quality", "90", "--output", path.join(configDir, "from-cli.json")],
      configDir
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(configDir, "from-cli.json"))).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(configDir, "from-cli.json"), "utf-8")
    ) as {
      images: Record<
        string,
        {
          outputs: {
            webp: { path: string };
            avif: { path: string };
          };
          variants?: {
            webp?: { width: number }[];
            avif?: { width: number }[];
          };
          blurDataURL: string;
        }
      >;
    };

    expect(Object.keys(manifest.images["cfg.jpg"].outputs)).toEqual(["webp", "avif"]);
    expect(manifest.images["cfg.jpg"].outputs.webp.path).toBe("cfg.w64.webp");
    expect(manifest.images["cfg.jpg"].outputs.avif.path).toBe("cfg.w64.avif");
    expect(manifest.images["cfg.jpg"].variants?.webp?.map((variant) => variant.width)).toEqual([
      32, 64,
    ]);
    expect(manifest.images["cfg.jpg"].variants?.avif?.map((variant) => variant.width)).toEqual([
      32, 64,
    ]);
    expect(manifest.images["cfg.jpg"].blurDataURL).toBe("");
  });

  it("lets explicit --verbose override config quiet mode", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          quiet: true,
        },
        null,
        2
      )
    );

    const outputManifest = path.join(configDir, "verbose-override.json");
    const result = runCli([".", "--verbose", "--output", outputManifest], configDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cache file:");
  });

  it("reports config source for conflicting verbosity options", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          verbose: true,
          quiet: true,
        },
        null,
        2
      )
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid verbosity settings in");
    expect(result.stderr).toContain("imageforge.config.json");
  });

  it("lets --no-check override check=true from config", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          check: true,
        },
        null,
        2
      )
    );

    const outputManifest = path.join(configDir, "override-no-check.json");
    const result = runCli([".", "--no-check", "--output", outputManifest], configDir);
    expect(result.status).toBe(0);
    expect(fs.existsSync(outputManifest)).toBe(true);
  });

  it("lets --no-json override json=true from config", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          json: true,
        },
        null,
        2
      )
    );

    const outputManifest = path.join(configDir, "override-no-json.json");
    const result = runCli([".", "--no-json", "--output", outputManifest], configDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`imageforge v${PACKAGE_VERSION}`);
  });

  it("fails fast on unknown config keys", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify({
        unknownFlag: true,
      })
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown config key");

    fs.rmSync(configFilePath, { force: true });
  });

  it("fails fast on invalid config value types", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          quality: "high",
        },
        null,
        2
      )
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid "quality"');
    expect(result.stderr).toContain("imageforge.config.json");
  });

  it("includes config source path in range validation errors", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          quality: 0,
        },
        null,
        2
      )
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid quality in");
    expect(result.stderr).toContain("imageforge.config.json");
  });

  it("includes config source path in width range validation errors", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          widths: [0, 64],
        },
        null,
        2
      )
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid width in");
    expect(result.stderr).toContain("imageforge.config.json");
  });

  it("includes config source path in width-count cap validation errors", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify({
        widths: Array.from({ length: 17 }, (_, index) => index + 1),
      })
    );

    const outputManifest = path.join(configDir, "too-many-widths.json");
    const result = runCli([".", "--output", outputManifest], configDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid "widths" in');
    expect(result.stderr).toContain("maximum is 16");
    expect(result.stderr).toContain("imageforge.config.json");
  });

  it("supports include/exclude pattern filters from config", async () => {
    await createJpeg(path.join(configDir, "include.jpg"), 80, 60, { r: 90, g: 20, b: 20 });
    await createJpeg(path.join(configDir, "exclude.jpg"), 80, 60, { r: 20, g: 90, b: 20 });

    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          output: "from-filter-config.json",
          include: ["*.jpg"],
          exclude: ["exclude.jpg", "cfg.jpg"],
        },
        null,
        2
      )
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(configDir, "from-filter-config.json"))).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(configDir, "from-filter-config.json"), "utf-8")
    ) as {
      images: Record<string, unknown>;
    };

    expect(Object.keys(manifest.images).sort()).toEqual(["include.jpg"]);
  });

  it("fails fast on empty include/exclude patterns in config", () => {
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(
        {
          include: ["valid.jpg", "   "],
        },
        null,
        2
      )
    );

    const result = runCli(["."], configDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid "include"');
    expect(result.stderr).toContain("non-empty");
  });

  it("supports explicit --config path", () => {
    const explicitConfig = path.join(configDir, "explicit.json");
    fs.writeFileSync(
      explicitConfig,
      JSON.stringify({
        output: "from-explicit-config.json",
        formats: "webp",
      })
    );

    const result = runCli([".", "--config", explicitConfig], configDir);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(configDir, "from-explicit-config.json"))).toBe(true);
  });

  it("loads package.json#imageforge when imageforge.config.json is absent", async () => {
    const pkgDir = path.join(configDir, "pkg-source");
    fs.rmSync(pkgDir, { recursive: true, force: true });
    fs.mkdirSync(pkgDir, { recursive: true });
    await createJpeg(path.join(pkgDir, "pkg.jpg"), 80, 60, { r: 60, g: 90, b: 120 });

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: "imageforge-config-fixture",
          version: "1.0.0",
          imageforge: {
            output: "from-package-config.json",
            formats: ["webp", "avif"],
          },
        },
        null,
        2
      )
    );

    const result = runCli(["."], pkgDir);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(pkgDir, "from-package-config.json"))).toBe(true);
  });
});
