# ImageForge CLI Manual Testing & Release Checklist

This playbook is for final validation before sharing a new ImageForge CLI release publicly.

Use it as a release gate: if any required item fails, stop and fix before publishing.

## 1. Prerequisites

- Node.js `>=22` installed (`node -v`).
- `pnpm` installed (`pnpm -v`).
- Clean working tree preferred (`git status`).
- Dependencies installed (`pnpm install --frozen-lockfile`).

## 2. Automated Quality Gate (Required)

Run the same gate used for release verification:

```bash
pnpm run release:verify
```

Pass criteria:

- Exit code is `0`.
- Typecheck, lint, format check, and tests pass.
- Build succeeds.
- `pnpm pack --dry-run` shows expected tarball contents.

## Benchmark Evidence Gate (Required for Public Performance/Speed Claims)

Before publishing benchmark-driven claims (README, website, release notes), verify latest CI benchmark evidence:

```bash
# Optional local dry-run benchmark on tier30
pnpm run bench:dataset:synthetic -- --count 600
pnpm run bench:dataset:build -- --dataset-version 0.0.0-dev --tiers 30
pnpm run bench:run -- --cli-path ./dist/cli.js --tier-manifest ./.tmp/bench/build/v0.0.0-dev/tier30/tier-manifest.json --workspace /tmp/imageforge-bench-local --run-count 4 --profiles P1,P2,P3
```

Required release-review checks:

- Latest nightly benchmark workflow succeeded.
- Benchmark artifacts include `raw-runs.jsonl`, `summary.json`, and comparison report.
- Any benchmark numbers used in public copy include as-of date, runner, dataset version, and profile.

## 3. Create a Manual Test Workspace

Create deterministic local fixtures in a temp directory:

```bash
export IF_ROOT="$(pwd)"
export IF_TMP="$(mktemp -d /tmp/imageforge-manual-XXXXXX)"
mkdir -p "$IF_TMP/input/sub dir"

node <<'NODE'
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = process.env.IF_TMP;

async function main() {
  await sharp({
    create: { width: 120, height: 80, channels: 3, background: { r: 110, g: 80, b: 60 } },
  })
    .jpeg({ quality: 90 })
    .toFile(path.join(root, "input", "hero.jpg"));

  await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 150, b: 210 } },
  })
    .png()
    .toFile(path.join(root, "input", "sub dir", "icon café.png"));

  fs.writeFileSync(path.join(root, "input", "notes.txt"), "not an image");
  fs.writeFileSync(path.join(root, "input", "broken.jpg"), "");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

## 4. Manual CLI Functional Checks (Required)

### 4.1 Basic UX and metadata

```bash
node "$IF_ROOT/dist/cli.js" --version
node "$IF_ROOT/dist/cli.js" --help
```

Pass criteria:

- Version is printed.
- Help contains key options (`--check`, `--out-dir`, `--json`, `--concurrency`).

### 4.2 First processing run

```bash
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" \
  -o "$IF_TMP/manifest.json" \
  -f webp,avif \
  --concurrency 2
```

Pass criteria:

- Exit code `0`.
- Outputs exist (for example `hero.webp`, `hero.avif`, `icon café.webp`, `icon café.avif`).
- Cache exists at `$IF_TMP/input/.imageforge-cache.json`.
- Manifest exists at `$IF_TMP/manifest.json`.

### 4.3 Cache behavior

Run the same command again.

Pass criteria:

- Exit code `0`.
- Output indicates cached reuse.
- Processed count should be `0` (or all files reported as cached).

### 4.4 `--check` up-to-date path

```bash
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" --check -o "$IF_TMP/manifest.json"
```

Pass criteria:

- Exit code `0`.
- Output indicates all images are up to date.

### 4.5 `--check` needs-processing path

Mutate one source image:

```bash
node <<'NODE'
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const src = path.join(process.env.IF_TMP, "input", "hero.jpg");
const tmp = src + ".tmp";
sharp(src)
  .modulate({ brightness: 1.05 })
  .jpeg({ quality: 90 })
  .toFile(tmp)
  .then(() => fs.renameSync(tmp, src))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
NODE

node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" --check -o "$IF_TMP/manifest.json"
```

Pass criteria:

- Exit code `1`.
- Output includes an exact rerun command.

### 4.6 `--no-cache` overwrite protection

```bash
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" --no-cache -o "$IF_TMP/no-cache.json"
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" --no-cache -o "$IF_TMP/no-cache.json"
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" --no-cache --force-overwrite -o "$IF_TMP/no-cache.json"
```

Pass criteria:

- 1st run: exit `0`.
- 2nd run: exit `1` with message explaining existing outputs + `--no-cache`.
- 3rd run: exit `0`.

### 4.7 `--out-dir` behavior

```bash
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" \
  --out-dir "$IF_TMP/generated" \
  -o "$IF_TMP/out-dir-manifest.json"
```

Pass criteria:

- Outputs are written under `$IF_TMP/generated`.
- Manifest output paths remain input-relative (can include `../` when out-dir is outside input root).

### 4.8 JSON report mode

```bash
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" \
  --json \
  -o "$IF_TMP/json-manifest.json" > "$IF_TMP/report.json"

node -e "const r=require(process.argv[1]); if(!r.summary||!Array.isArray(r.images)) process.exit(1);" "$IF_TMP/report.json"
```

Pass criteria:

- Exit code `0`.
- Report is valid JSON with `summary` and `images`.

### 4.9 Error-path sanity checks

```bash
node "$IF_ROOT/dist/cli.js" "$IF_TMP/does-not-exist" -o "$IF_TMP/missing.json"
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" --quality 0 -o "$IF_TMP/invalid-quality.json"
node "$IF_ROOT/dist/cli.js" "$IF_TMP/input" --verbose --quiet -o "$IF_TMP/verbosity-conflict.json"
```

Pass criteria:

- Each command exits `1`.
- Error messages clearly describe the invalid input/state.

## 5. Config Resolution Checks (Required)

Create config file:

```bash
cat > "$IF_TMP/input/imageforge.config.json" <<'JSON'
{
  "output": "from-config.json",
  "formats": ["webp", "avif"],
  "quality": 70,
  "blur": false,
  "quiet": true
}
JSON
```

Run:

```bash
(
  cd "$IF_TMP/input" && \
  node "$IF_ROOT/dist/cli.js" . --output "$IF_TMP/from-cli.json" --quality 90 --verbose
)
```

Pass criteria:

- CLI override wins for `--output` and `--quality`.
- Explicit `--verbose` overrides config quiet mode.
- Manifest is created successfully.

## 6. Packaging & Install Smoke Test (Required)

Build tarball:

```bash
export IF_VERSION="$(node -p "require('./package.json').version")"
pnpm pack --pack-destination "$IF_TMP"
export IF_TARBALL="$IF_TMP/imageforge-cli-$IF_VERSION.tgz"
tar -tzf "$IF_TARBALL"
```

Pass criteria:

- Tarball exists.
- Contents include `dist/`, `README.md`, `LICENSE`, and `package.json`.
- No test fixtures or dev-only junk included.

Install into a clean consumer project:

```bash
mkdir -p "$IF_TMP/consumer"
(
  cd "$IF_TMP/consumer" && \
  pnpm init --bare >/dev/null && \
  pnpm add "$IF_TARBALL" && \
  npx imageforge --version
)
```

Pass criteria:

- Install succeeds with no missing runtime files.
- Binary runs and prints expected version.

Programmatic exports smoke test:

```bash
(
  cd "$IF_TMP/consumer" && \
  node -e "const root=require('@imageforge/cli');const p=require('@imageforge/cli/processor');if(typeof root.processImage!=='function'||typeof p.convertImage!=='function'){process.exit(1)}"
)
```

Pass criteria:

- Exit code `0`.

## 7. Cross-Environment Matrix (Strongly Recommended)

Run section 2 and key items from sections 4-6 on:

- Node `22` (required, minimum supported).
- Node `24` (CI parity).
- At least one Linux host and one macOS host.
- Windows shell smoke test (`--help`, simple run, path with spaces) if Windows users are expected.

## 8. Release Ops Readiness (Required)

- npm trusted publisher is configured for this repository/package pair.
- GitHub Actions OIDC/provenance publish path is intact (`id-token: write` on publish job).
- Workflows are green on `main`:
  - `.github/workflows/ci.yml`
  - `.github/workflows/benchmark-ci.yml`
  - `.github/workflows/release-please.yml`
  - `.github/workflows/publish.yml`
- Commit history uses Conventional Commits for Release Please.
- `README.md` usage/options are current.
- License/Code of Conduct/Security docs are present.

## 9. Day-of-Release Runbook

1. Merge approved changes to `main` with Conventional Commit semantics.
2. Wait for Release Please PR; review version bump and generated changelog; merge it.
3. Confirm GitHub Release is created with `v*` tag.
4. Confirm publish workflow succeeds and package is available on npm.
5. Verify install from registry in a clean directory:

```bash
mkdir -p "$IF_TMP/post-release"
(
  cd "$IF_TMP/post-release" && \
  pnpm init --bare >/dev/null && \
  pnpm add @imageforge/cli@latest && \
  npx imageforge --version
)
```

6. Sanity run on real sample images and confirm manifest/output quality.

## 10. Sign-off Template

- Release candidate/tag:
- Date:
- Tester:
- Node versions tested:
- OSes tested:
- Required checks passed (`yes`/`no`):
- Known limitations accepted for this release:
- Go/No-Go decision:
