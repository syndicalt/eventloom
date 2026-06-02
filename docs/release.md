# Release Checklist

Eventloom runtime publishes as `@eventloom/runtime`. The MCP server publishes separately from `packages/mcp` as `@eventloom/mcp`.

## Preflight

Run releases from a real Git checkout so branch, tag, and dirty-worktree checks are meaningful.

```bash
npm run ci:runtime-v1
npm run ci:mcp-v1
npm run ci:full-v1
```

The repository CI workflow at `.github/workflows/ci.yml` runs the runtime-first release gate and the staged MCP v1 local preflight on Node.js 20, 22, and 24. The job sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so GitHub JavaScript actions run on the current action runtime while the package itself is still tested across the supported Node matrix. After the runtime gate passes, CI writes `.eventloom-ci/golden-fixtures-node-<node-version>.json`, `.eventloom-ci/export-fixtures-node-<node-version>.json`, `.eventloom-ci/benchmark-smoke-node-<node-version>.json`, `.eventloom-ci/pack-manifests-node-<node-version>.json`, and `.eventloom-ci/artifact-bundle-verify-node-<node-version>.json`, then uploads them as `runtime-release-evidence-node-<node-version>`. The staged MCP preflight runs with `npm run --silent release:preflight:mcp-v1-staged:local -- --json`, writes versioned `eventloom.release-preflight.v1` reports to `.eventloom-ci/staged-mcp-v1-preflight-node-<node-version>.json`, and uploads that file with `actions/upload-artifact@v4` so release reviewers get parseable reports per matrix entry. Treat a matrix failure as release-blocking even if the local development Node version passes.

After the coordinated version bump for the v1 release candidate, run:

```bash
npm run release:preflight:v1
```

During the two-phase first v1 publish, use the narrower phase checks at the appropriate boundary:

```bash
npm run release:preflight:runtime-v1
npm run release:preflight:mcp-v1
```

The guarded publish entrypoints are:

```bash
npm run publish:runtime-v1
npm run publish:mcp-v1
```

`publish:runtime-v1` runs `npm run ci:runtime-v1`, the staged MCP v1 local preflight, and the runtime preflight before invoking `npm publish`. `publish:mcp-v1` runs `npm run ci:full-v1` and the MCP preflight before publishing the MCP package.

The runtime-first publish gate intentionally does not run `npm run smoke:mcp-installed-bin`, because the current MCP package remains pinned to the latest published compatible runtime until `@eventloom/runtime@1.0.0` is available from npm. The installed MCP bin smoke belongs to the MCP phase after the MCP dependency and lockfile move to `^1.0.0`.

This executable preflight verifies that:

- the release is running in a real Git checkout with a clean worktree
- the release branch is `main` or `master`
- runtime preflight requires `runtime-v1.0.0`, MCP preflight requires `mcp-v1.0.0`, and full coordinated preflight requires `v1.0.0` at HEAD
- the `@eventloom/runtime` package version is `1.0.0`
- the runtime package metadata, repository links, keywords, entrypoints, and lockfile package name match `@eventloom/runtime`
- the root lockfile uses npm lockfile format version 3 and package version `1.0.0`
- the `@eventloom/mcp` package version is `1.0.0`
- the MCP package metadata, repository links, keywords, entrypoints, and lockfile package name match `@eventloom/mcp`
- the MCP server metadata constant is `1.0.0`
- the MCP lockfile uses npm lockfile format version 3 and package version `1.0.0`
- the `@eventloom/mcp` dependency on `@eventloom/runtime` is `^1.0.0`
- runtime and MCP `prepack` scripts run tests and builds before pack or publish
- MCP v1 publication uses `--check-published-runtime` after the runtime package has been published
- the runtime package ships the migration guide and selected runtime-user docs; repo-only release, planning, MCP, and contributor docs stay linked from GitHub
- `.github/workflows/ci.yml` runs the release gate on Node.js 20, 22, and 24 with `fail-fast: false`
- `.github/workflows/ci.yml` sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so GitHub JavaScript actions do not run on the deprecated Node 20 action runtime
- `.github/workflows/ci.yml` writes and uploads parseable fixture, benchmark smoke, package-manifest, artifact-bundle verification, and staged MCP preflight evidence reports

The runtime-first release gate runs:

```bash
npm run test:runtime
npm run fixtures:golden:check
npm run fixtures:check
npm run bench:smoke
npm run audit:runtime
npm run smoke:mcp-local-runtime
npm run smoke:mcp-v1-local-runtime-bin
npm run smoke:custom-workflow-package
npm run smoke:runtime-installed-cli
npm run pack:check
npm pack --dry-run
```

`npm run test:runtime` builds runtime and MCP package artifacts before running Vitest so package-facing tests and pack-manifest checks work from a clean checkout.

No high or critical production dependency vulnerabilities are allowed. Treat any `npm run audit:runtime` or `npm run audit:mcp` high/critical production finding as release-blocking until the dependency graph is fixed or the release checklist documents an explicit reviewed exception.

Release preflight JSON reports are versioned as `eventloom.release-preflight.v1`. Release preflight argument failures are structured in the JSON report. `scripts/release-preflight.mjs --json` uses `invalid_release_preflight_option`, and `scripts/release-preflight-mcp-v1-local-staged.mjs --json` uses `invalid_staged_mcp_preflight_option`, with rejected `option`, rejected `value` when available, and `suggestedAction` diagnostics so automation can distinguish release argument mistakes from failed release checks.

Fixture generator argument failures are structured JSON diagnostics on stderr. `npm run fixtures:golden -- --out-dir <dir>` and `npm run fixtures:export -- --out-dir <dir>` use `invalid_fixture_generator_option` with the rejected `option`, rejected `value`, and `suggestedAction`, which lets release automation distinguish argument mistakes from fixture drift.

Fixture drift checks accept `--json` for parseable release logs. `node scripts/check-golden-fixtures.mjs --json` and `node scripts/check-export-fixtures.mjs --json` print versioned `eventloom.fixture-check.v1` reports with `{ version, ok, fixtureSet, actualDir, mismatchCount, mismatches }`; unknown check options return an `invalid_fixture_check_option` diagnostic in the same JSON report shape.

The MCP release gate, after npm resolves the runtime v1 package, runs:

```bash
npm run test:mcp
npm run build:mcp
npm run audit:mcp
npm run smoke:mcp-installed-bin
npm run pack:check
npm pack --dry-run ./packages/mcp
```

`npm run smoke:mcp-v1-local-runtime-bin` builds a temporary MCP v1 package in a scratch directory, points it at the locally packed `@eventloom/runtime@1.0.0` tarball, and exercises the installed `eventloom-mcp` bin over stdio. It is a staging check only; it does not replace the published-runtime preflight or mutate `packages/mcp/package.json`.

Both installed MCP bin smokes exercise the artifact bundle and OTLP MCP tools through stdio, so a packed MCP package must prove `eventloom_write_artifacts` writes `manifest.json`, `inspect.json`, `visualizer.html`, and `otlp-traces.json`, records an `inputDigest` for the source JSONL log, `eventloom_verify_artifacts` verifies all ten source-log and generated artifact digests, and `eventloom_export_otlp` writes a valid OTLP `resourceSpans` payload and delivers that same payload to a local OTLP HTTP collector endpoint with a `202` response.

`npm run pack:check` validates both runtime and MCP dry-run package manifests. It rejects unexpected files, missing required docs and fixtures, unpackaged entrypoints, empty packaged files, broken packaged Markdown links, missing inline source-map sources, and CLI bin targets that are absent, empty, non-executable in the packed tarball, or missing the `#!/usr/bin/env node` shebang.

`node scripts/check-pack-manifests.mjs --json` prints a parseable `eventloom.pack-manifests.v1` report with `{ version, ok, check, failureCount, failures, packages }` for release logs. Unknown options return `invalid_pack_manifest_check_option` diagnostics in the same JSON shape.

The CI workflow also writes `.eventloom/agent-work.jsonl`, exports `.eventloom/artifacts/`, and runs `eventloom artifacts verify .eventloom/artifacts/manifest.json` before upload. Its versioned `eventloom.artifact-bundle-verification.v1` JSON result is archived as `.eventloom-ci/artifact-bundle-verify-node-<node-version>.json`, so the uploaded runtime release evidence includes both the machine-readable gate reports and a tamper-evident Eventloom artifact bundle whose source-log `inputDigest` and generated artifact file digests were checked in CI.

The runtime package should include only:

- `dist/`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- selected runtime-user docs, integration docs, architecture docs, and migration docs
- `fixtures/sample.jsonl`
- golden and export fixtures
- custom workflow example
- `package.json`

It intentionally excludes repo-only publisher checklists, planning notes, contributor docs, and MCP package design/setup docs from the runtime tarball. Packaged Markdown links to those repo-only docs should use GitHub URLs so installed package docs stay link-checkable.

The MCP package currently ships only:

- `dist/`
- `README.md`
- `LICENSE`
- `package.json`

## Benchmark Evidence

`npm run bench:smoke` is the CI correctness gate for the benchmark harness, but release candidates should also include full local benchmark evidence. Before tagging a v1 release candidate, run:

```bash
EVENTLOOM_BENCH_HARDWARE="<CPU, disk, memory>" npm run bench -- --out .eventloom-ci/benchmark-full-node-<node-major>.json
EVENTLOOM_BENCH_HARDWARE="<CPU, disk, memory>" npm run bench:export -- --out .eventloom-ci/benchmark-export-node-<node-major>.json
npm run bench:evidence:check -- --full .eventloom-ci/benchmark-full-node-<node-major>.json --export .eventloom-ci/benchmark-export-node-<node-major>.json
```

Replace `<node-major>` with the Node.js major version used to collect the release-candidate evidence, for example `24` for Node.js 24. When `--full` and `--export` are omitted, `npm run bench:evidence:check` defaults to the current Node.js major version. Upload the `.eventloom-ci/benchmark-*.json` reports with the release-candidate evidence packet after `npm run bench:evidence:check` passes. Each benchmark report is versioned as `eventloom.benchmark.v1`, and the checker report is versioned as `eventloom.benchmark-evidence.v1`; record the command, Node version, hardware note, event counts, `durationMs`, and `throughputPerSecond` values in the release notes. See [Benchmarks](benchmarks.md) and `docs/benchmarks.md` for the benchmark output schema and baseline policy.

## Local Readiness Audit

This checkout can be audited before it is moved into a real release repository or before publish credentials are available. These commands run the same version, lockfile, package metadata, Node engine metadata, and documentation checks as the release preflight, but they do not validate Git branch, tags, or worktree cleanliness and do not publish packages.

The current staged checkout is expected to pass the runtime local preflight and the staged MCP local preflight:

```bash
npm run release:preflight:runtime-v1:local
npm run release:preflight:mcp-v1-staged:local
```

Both commands accept `--json` for machine-readable CI logs. When invoking them through `npm run`, use `npm run --silent <script> -- --json` so npm does not prepend a lifecycle banner. The staged MCP preflight suppresses transient package-manager progress output in JSON mode so stdout remains a single parseable report.

Do not treat `npm run release:preflight:v1:local` or `npm run release:preflight:mcp-v1:local` as current-checkout gates while `packages/mcp` intentionally remains at `0.1.6` and depends on `@eventloom/runtime@^0.1.7`. Those commands are post-runtime-publish audits after `@eventloom/runtime@1.0.0` is published and the checked-in MCP package metadata moves to `1.0.0`.

Use these local audits for development snapshots only. A real release still requires the phase-appropriate CI command, the non-local preflight commands, and the guarded publish scripts from a clean Git checkout.

`npm run release:preflight:mcp-v1-staged:local` builds a scratch release tree, stages MCP metadata as `1.0.0`, points MCP at the locally packed runtime tarball, refreshes only the temporary MCP lockfile, installs staged MCP dependencies with lifecycle scripts disabled, runs the staged MCP build, and performs an `npm pack --dry-run --ignore-scripts` manifest check before running the MCP preflight in explicit local-tarball mode. It is supplemental to the real MCP preflight and must not replace `npm run release:preflight:mcp-v1` after runtime publication.

## Local Tarball Smoke Test

```bash
npm_config_cache=/tmp/eventloom-npm-cache npm pack
mkdir -p /tmp/eventloom-consumer
cd /tmp/eventloom-consumer
npm init -y
npm install /path/to/eventloom/eventloom-runtime-1.0.0.tgz
node --input-type=module -e "import { createRuntime } from '@eventloom/runtime'; console.log(typeof createRuntime)"
npx eventloom replay /path/to/eventloom/fixtures/sample.jsonl
npx eventloom visualize /path/to/eventloom/fixtures/sample.jsonl
npx eventloom artifacts /path/to/eventloom/fixtures/sample.jsonl --out /tmp/eventloom-artifacts
npx eventloom artifacts verify /tmp/eventloom-artifacts/manifest.json
npx eventloom export otlp /path/to/eventloom/fixtures/sample.jsonl --out /tmp/eventloom-otlp-traces.json
npx eventloom export otlp /path/to/eventloom/fixtures/sample.jsonl --out /tmp/eventloom-otlp-traces.json --endpoint http://127.0.0.1:4318/v1/traces
```

## Publish

Read [Migrating To Eventloom v1.0.0](migration-v1.md) before cutting the first v1 release. The v1 release is expected to require no valid-log migration, but the migration guide must be shipped in the runtime package.

The runtime package must be published before the MCP package version that depends on it. Keep `@eventloom/mcp` pinned to the latest published compatible `@eventloom/runtime` range until the runtime v1 package is available from npm; then update the MCP dependency range, refresh `packages/mcp/package-lock.json`, and rerun `npm run ci`.

Use this two-phase sequence for the first v1 release. Do not hand-edit the MCP lockfile to pretend a runtime tarball exists.

Runtime first:

```bash
git rev-parse --is-inside-work-tree
git status --porcelain
git branch --show-current
git tag --points-at HEAD
npm ci
npm --prefix packages/mcp ci
npm run ci:runtime-v1

# If the runtime package is already staged as `1.0.0`, skip `npm version 1.0.0 --no-git-tag-version` and commit the existing `package.json` and `package-lock.json` state.
npm version 1.0.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release runtime v1.0.0"
git tag runtime-v1.0.0
npm run test:runtime
npm run build:runtime
npm run fixtures:golden:check
npm run fixtures:check
npm run bench:smoke
npm run audit:runtime
npm pack --dry-run
npm run publish:runtime-v1
npm view @eventloom/runtime@1.0.0 version
```

Then MCP, after npm resolves the runtime package:

```bash
cd packages/mcp
npm version 1.0.0 --no-git-tag-version
npm pkg set 'dependencies.@eventloom/runtime=^1.0.0'
# update src/version.ts to: export const EVENTLOOM_MCP_VERSION = "1.0.0";
npm install --package-lock-only
npm ci
npm test
npm run build
npm pack --dry-run

cd ../..
git add packages/mcp/package.json packages/mcp/package-lock.json packages/mcp/src/version.ts
git commit -m "Release MCP v1.0.0"
git tag mcp-v1.0.0
npm run ci:full-v1
node scripts/release-preflight.mjs --target 1.0.0 --check-published-runtime
npm run publish:mcp-v1
```

Before publishing the MCP v1 package, also verify that npm can resolve the target runtime package:

```bash
node scripts/release-preflight.mjs --target 1.0.0 --check-published-runtime
```

For the first public scoped publish:

```bash
npm publish --access public
```

For later releases:

```bash
npm version patch
npm publish
git push origin master --tags
```

For MCP package releases:

```bash
cd packages/mcp
npm test
npm run build
npm pack --dry-run
npm publish --access public
```

## Notes

- `prepack` runs tests and build before packing or publishing.
- `@eventloom/runtime` is ESM-only.
- `@eventloom/mcp` is ESM-only and depends on a published `@eventloom/runtime` version.
- Node.js `>=20` is required.
- Do not publish from a dirty worktree.
