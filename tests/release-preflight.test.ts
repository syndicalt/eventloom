import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReleasePreflightReport } from "../scripts/release-preflight.mjs";

describe("release preflight", () => {
  it("reports argument errors as parseable JSON when requested", () => {
    const result = spawnSync(process.execPath, [
      "scripts/release-preflight.mjs",
      "--json",
      "--unknown-option",
    ], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.release-preflight.v1",
      ok: false,
      targetVersion: "1.0.0",
      phase: "full",
      checks: [{
        name: "release preflight arguments",
        ok: false,
        expected: "valid release preflight arguments",
        actual: "Unknown option --unknown-option",
        diagnostic: {
          code: "invalid_release_preflight_option",
          message: "Unknown option --unknown-option",
          option: "--unknown-option",
          suggestedAction: "Use --root, --target, --phase, --no-git, --check-published-runtime, --local-runtime-tarball, or --json with valid values.",
        },
      }],
    });
  });

  it("does not treat the next option as a missing option value", () => {
    const result = spawnSync(process.execPath, [
      "scripts/release-preflight.mjs",
      "--json",
      "--target",
      "--phase",
      "runtime",
    ], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.release-preflight.v1",
      ok: false,
      targetVersion: "1.0.0",
      phase: "runtime",
      checks: [{
        name: "release preflight arguments",
        ok: false,
        expected: "valid release preflight arguments",
        actual: "Missing value for --target",
        diagnostic: {
          code: "invalid_release_preflight_option",
          message: "Missing value for --target",
          option: "--target",
          value: "--phase",
          suggestedAction: "Provide a non-empty value that does not start with --.",
        },
      }],
    });
  });

  it("reports invalid release phases as typed option diagnostics", () => {
    const result = spawnSync(process.execPath, [
      "scripts/release-preflight.mjs",
      "--json",
      "--phase",
      "docs",
    ], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.release-preflight.v1",
      ok: false,
      targetVersion: "1.0.0",
      phase: "docs",
      checks: [{
        name: "release preflight arguments",
        ok: false,
        expected: "valid release preflight arguments",
        actual: "Unknown release phase docs",
        diagnostic: {
          code: "invalid_release_preflight_option",
          message: "Unknown release phase docs",
          option: "--phase",
          value: "docs",
          suggestedAction: "Use one of: runtime, mcp, full.",
        },
      }],
    });
  });

  it("passes the current checkout runtime-only v1 local preflight before MCP v1 exists", async () => {
    const report = await buildReleasePreflightReport({
      targetVersion: "1.0.0",
      phase: "runtime",
      checkGit: false,
    });

    expect(report.version).toBe("eventloom.release-preflight.v1");
    expect(report.ok).toBe(true);
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
  });

  it("reports staged MCP local preflight argument errors as versioned JSON", () => {
    const result = spawnSync(process.execPath, [
      "scripts/release-preflight-mcp-v1-local-staged.mjs",
      "--json",
      "--unknown-option",
    ], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.release-preflight.v1",
      ok: false,
      targetVersion: "1.0.0",
      phase: "mcp",
      checks: [{
        name: "staged MCP v1 local preflight",
        ok: false,
        expected: "ok",
        actual: "Unknown option: --unknown-option",
        diagnostic: {
          code: "invalid_staged_mcp_preflight_option",
          message: "Unknown option: --unknown-option",
          option: "--unknown-option",
          suggestedAction: "Use only --json for staged MCP v1 local preflight options.",
        },
      }],
    });
  });

  it("can preflight the runtime package before the MCP v1 package exists", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "0.1.6",
      mcpVersionConstant: "0.1.6",
      mcpRuntimeDependency: "^0.1.7",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "runtime",
      checkGit: false,
    });

    expect(report.ok).toBe(true);
    expect(report.phase).toBe("runtime");
    expect(report.checks.map((check) => check.name)).not.toContain("mcp package version");
  });

  it("can preflight the MCP package after the runtime is published", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "mcp",
      checkGit: false,
      checkPublishedRuntime: true,
      npmView: publishedRuntimeView(),
    });

    expect(report.ok).toBe(true);
    expect(report.phase).toBe("mcp");
    expect(report.checks).toContainEqual({
      name: "published runtime version",
      ok: true,
      expected: "1.0.0",
      actual: "1.0.0",
    });
  });

  it("can preflight a staged MCP package against a local runtime tarball without weakening publish checks", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "file:/tmp/eventloom-runtime-1.0.0.tgz",
      mcpRuntimeResolved: "file:/tmp/eventloom-runtime-1.0.0.tgz",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "mcp",
      checkGit: false,
      localRuntimeTarball: "/tmp/eventloom-runtime-1.0.0.tgz",
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "mcp runtime dependency",
        ok: true,
        expected: "file:/tmp/eventloom-runtime-1.0.0.tgz",
        actual: "file:/tmp/eventloom-runtime-1.0.0.tgz",
      },
      {
        name: "mcp installed runtime lock resolved tarball",
        ok: true,
        expected: "file:/tmp/eventloom-runtime-1.0.0.tgz",
        actual: "file:/tmp/eventloom-runtime-1.0.0.tgz",
      },
    ]));
  });

  it("rejects local runtime tarball dependencies in the normal MCP publish preflight", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "file:/tmp/eventloom-runtime-1.0.0.tgz",
      mcpRuntimeResolved: "file:/tmp/eventloom-runtime-1.0.0.tgz",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "mcp",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "mcp runtime dependency",
        ok: false,
        expected: "^1.0.0",
        actual: "file:/tmp/eventloom-runtime-1.0.0.tgz",
      },
    ]));
  });

  it("requires runtime, MCP, lockfile, and dependency versions to match the target", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "0.1.7",
      mcpVersion: "0.1.6",
      mcpVersionConstant: "0.1.6",
      mcpRuntimeDependency: "^0.1.7",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "full",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime package version",
        ok: false,
        expected: "1.0.0",
        actual: "0.1.7",
      },
      {
        name: "runtime lockfile top-level version",
        ok: false,
        expected: "1.0.0",
        actual: "0.1.7",
      },
      {
        name: "mcp package version",
        ok: false,
        expected: "1.0.0",
        actual: "0.1.6",
      },
      {
        name: "mcp version constant",
        ok: false,
        expected: "1.0.0",
        actual: "0.1.6",
      },
      {
        name: "mcp installed runtime lock version",
        ok: false,
        expected: "1.0.0",
        actual: "0.1.7",
      },
      {
        name: "mcp runtime dependency",
        ok: false,
        expected: "^1.0.0",
        actual: "^0.1.7",
      },
    ]));
  });

  it("requires runtime and MCP lockfile package names to match the publish targets", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      runtimeLockName: "eventloom-runtime",
      runtimeLockPackageName: "eventloom-runtime-root",
      mcpLockName: "eventloom-mcp",
      mcpLockPackageName: "eventloom-mcp-root",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime lockfile top-level name",
        ok: false,
        expected: "@eventloom/runtime",
        actual: "eventloom-runtime",
      },
      {
        name: "runtime lockfile package name",
        ok: false,
        expected: "@eventloom/runtime",
        actual: "eventloom-runtime-root",
      },
      {
        name: "mcp lockfile top-level name",
        ok: false,
        expected: "@eventloom/mcp",
        actual: "eventloom-mcp",
      },
      {
        name: "mcp lockfile package name",
        ok: false,
        expected: "@eventloom/mcp",
        actual: "eventloom-mcp-root",
      },
    ]));
  });

  it("requires runtime and MCP lockfiles to use the npm v3 lockfile format", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      runtimeLockfileVersion: 2,
      mcpLockfileVersion: null,
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime lockfile format version",
        ok: false,
        expected: 3,
        actual: 2,
      },
      {
        name: "mcp lockfile format version",
        ok: false,
        expected: 3,
        actual: undefined,
      },
    ]));
  });

  it("requires the runtime and MCP package names to match the publish targets", async () => {
    const root = await tempReleaseTree({
      runtimeName: "eventloom-runtime",
      mcpName: "eventloom-mcp",
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime package name",
        ok: false,
        expected: "@eventloom/runtime",
        actual: "eventloom-runtime",
      },
      {
        name: "mcp package name",
        ok: false,
        expected: "@eventloom/mcp",
        actual: "eventloom-mcp",
      },
    ]));
  });

  it("requires runtime and MCP Node engine metadata to match the v1 support floor", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      runtimeNodeEngine: ">=18",
      mcpNodeEngine: null,
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime node engine",
        ok: false,
        expected: ">=20",
        actual: ">=18",
      },
      {
        name: "mcp node engine",
        ok: false,
        expected: ">=20",
        actual: "missing",
      },
    ]));
  });

  it("requires runtime and MCP publish metadata to match public MIT packages", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      runtimeLicense: "UNLICENSED",
      mcpLicense: null,
      runtimePublishAccess: "restricted",
      mcpPublishAccess: null,
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime package license",
        ok: false,
        expected: "MIT",
        actual: "UNLICENSED",
      },
      {
        name: "runtime publish access",
        ok: false,
        expected: "public",
        actual: "restricted",
      },
      {
        name: "mcp package license",
        ok: false,
        expected: "MIT",
        actual: "missing",
      },
      {
        name: "mcp publish access",
        ok: false,
        expected: "public",
        actual: "missing",
      },
    ]));
  });

  it("requires runtime and MCP npm metadata to point at the public Eventloom project", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      runtimeDescription: "Mutable transcript scratchpad",
      runtimeAuthor: null,
      runtimeRepository: { type: "git", url: "git+https://example.invalid/not-eventloom.git" },
      runtimeBugs: {},
      runtimeKeywords: ["agents", "runtime"],
      mcpRepository: { type: "git", url: "git+https://github.com/syndicalt/eventloom.git" },
      mcpHomepage: "https://example.invalid/mcp",
      mcpKeywords: ["eventloom", "mcp"],
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime package description",
        ok: false,
        expected: "Append-only event-log runtime for multi-agent AI systems",
        actual: "Mutable transcript scratchpad",
      },
      {
        name: "runtime package author",
        ok: false,
        expected: "Nicholas Blanchard <syndicalt@gmail.com>",
        actual: "missing",
      },
      {
        name: "runtime repository url",
        ok: false,
        expected: "git+https://github.com/syndicalt/eventloom.git",
        actual: "git+https://example.invalid/not-eventloom.git",
      },
      {
        name: "runtime bugs url",
        ok: false,
        expected: "https://github.com/syndicalt/eventloom/issues",
        actual: "missing",
      },
      {
        name: "runtime keyword observability",
        ok: false,
        expected: "observability",
        actual: "missing",
      },
      {
        name: "mcp repository directory",
        ok: false,
        expected: "packages/mcp",
        actual: "missing",
      },
      {
        name: "mcp homepage",
        ok: false,
        expected: "https://github.com/syndicalt/eventloom#readme",
        actual: "https://example.invalid/mcp",
      },
      {
        name: "mcp keyword opentelemetry",
        ok: false,
        expected: "opentelemetry",
        actual: "missing",
      },
    ]));
  });

  it("requires runtime and MCP package entrypoints to match the published ESM and CLI contracts", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      runtimeMain: "./dist/runtime.js",
      runtimeBin: { eventloom: "dist/runtime-cli.js" },
      runtimeExports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./export/halo": { import: "./dist/export/halo.js" },
        "./export/otlp": { types: "./dist/export/otlp.d.ts", import: "./dist/export/otlp.js" },
        "./package.json": "./package.json",
      },
      mcpType: "commonjs",
      mcpBin: {},
      mcpExports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/server.js" },
      },
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime main entry",
        ok: false,
        expected: "./dist/index.js",
        actual: "./dist/runtime.js",
      },
      {
        name: "runtime bin eventloom",
        ok: false,
        expected: "dist/cli.js",
        actual: "dist/runtime-cli.js",
      },
      {
        name: "runtime halo export types",
        ok: false,
        expected: "./dist/export/halo.d.ts",
        actual: "missing",
      },
      {
        name: "runtime pathlight export import",
        ok: false,
        expected: "./dist/export/pathlight.js",
        actual: "missing",
      },
      {
        name: "mcp package type",
        ok: false,
        expected: "module",
        actual: "commonjs",
      },
      {
        name: "mcp bin eventloom-mcp",
        ok: false,
        expected: "dist/cli.js",
        actual: "missing",
      },
      {
        name: "mcp root export import",
        ok: false,
        expected: "./dist/index.js",
        actual: "./dist/server.js",
      },
      {
        name: "mcp package.json export",
        ok: false,
        expected: "./package.json",
        actual: "missing",
      },
    ]));
  });

  it("requires documented v1 release gate scripts in preflight", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      scripts: { ci: "npm run test:runtime" },
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime ci script",
        ok: false,
        expected: "npm run ci:runtime-v1",
        actual: "npm run test:runtime",
      },
      {
        name: "runtime ci:runtime-v1 script",
        ok: false,
        expected: expect.stringContaining("npm run test:runtime"),
        actual: "missing",
      },
      {
        name: "runtime release:preflight:v1:local script",
        ok: false,
        expected: "node scripts/release-preflight.mjs --target 1.0.0 --no-git",
        actual: "missing",
      },
      {
        name: "runtime release:preflight:runtime-v1:local script",
        ok: false,
        expected: "node scripts/release-preflight.mjs --target 1.0.0 --phase runtime --no-git",
        actual: "missing",
      },
      {
        name: "runtime release:preflight:mcp-v1:local script",
        ok: false,
        expected: "node scripts/release-preflight.mjs --target 1.0.0 --phase mcp --no-git",
        actual: "missing",
      },
      {
        name: "runtime publish:mcp-v1 script",
        ok: false,
        expected: expect.stringContaining("npm run release:preflight:mcp-v1"),
        actual: "missing",
      },
    ]));
  });

  it("requires prepack scripts to run tests and builds before publishing", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      scripts: {
        ...releaseGateScripts(),
        prepack: "npm run build:runtime",
      },
      mcpScripts: {
        ...mcpPackageScripts(),
        prepack: "npm run build",
      },
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime prepack script",
        ok: false,
        expected: "npm run test:runtime && npm run build:runtime",
        actual: "npm run build:runtime",
      },
      {
        name: "mcp prepack script",
        ok: false,
        expected: "npm test && npm run build",
        actual: "npm run build",
      },
    ]));
  });

  it("requires CI release evidence workflow commands in preflight", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      workflow: "name: CI\njobs:\n  release-gates:\n    steps:\n      - run: npm run ci:runtime-v1\n",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "workflow tests supported Node versions",
        ok: false,
        expected: "node-version: [20.x, 22.x, 24.x]",
        actual: "missing",
      },
      {
        name: "workflow uploads artifacts with upload-artifact v4",
        ok: false,
        expected: "actions/upload-artifact@v4",
        actual: "missing",
      },
      {
        name: "workflow uses setup-node v4",
        ok: false,
        expected: "actions/setup-node@v4",
        actual: "missing",
      },
      {
        name: "workflow caches MCP lockfile",
        ok: false,
        expected: "packages/mcp/package-lock.json",
        actual: "missing",
      },
      {
        name: "workflow caches runtime lockfile",
        ok: false,
        expected: "package-lock.json",
        actual: "missing",
      },
      {
        name: "workflow installs runtime dependencies from lockfile",
        ok: false,
        expected: "npm ci",
        actual: "missing",
      },
      {
        name: "workflow installs MCP dependencies from lockfile",
        ok: false,
        expected: "npm --prefix packages/mcp ci",
        actual: "missing",
      },
      {
        name: "workflow writes benchmark smoke evidence",
        ok: false,
        expected: 'npm run --silent bench:smoke -- --out ".eventloom-ci/benchmark-smoke-node-${{ matrix.node-version }}.json" > /dev/null',
        actual: "missing",
      },
      {
        name: "workflow writes agent release event log",
        ok: false,
        expected: "npm run --silent eventloom -- append .eventloom/agent-work.jsonl goal.created",
        actual: "missing",
      },
      {
        name: "workflow writes agent verification event",
        ok: false,
        expected: "npm run --silent eventloom -- append .eventloom/agent-work.jsonl verification.completed",
        actual: "missing",
      },
      {
        name: "workflow writes agent artifact bundle",
        ok: false,
        expected: "npm run --silent eventloom -- artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts",
        actual: "missing",
      },
      {
        name: "workflow verifies agent artifact bundle",
        ok: false,
        expected: "npm run --silent eventloom -- artifacts verify .eventloom/artifacts/manifest.json",
        actual: "missing",
      },
      {
        name: "workflow writes artifact verification evidence",
        ok: false,
        expected: ' > ".eventloom-ci/artifact-bundle-verify-node-${{ matrix.node-version }}.json"',
        actual: "missing",
      },
      {
        name: "workflow uploads benchmark smoke evidence",
        ok: false,
        expected: ".eventloom-ci/benchmark-smoke-node-${{ matrix.node-version }}.json",
        actual: "missing",
      },
      {
        name: "workflow uploads artifact verification evidence",
        ok: false,
        expected: ".eventloom-ci/artifact-bundle-verify-node-${{ matrix.node-version }}.json",
        actual: "missing",
      },
      {
        name: "workflow uploads agent event log",
        ok: false,
        expected: ".eventloom/agent-work.jsonl",
        actual: "missing",
      },
      {
        name: "workflow uploads agent artifact bundle",
        ok: false,
        expected: ".eventloom/artifacts/",
        actual: "missing",
      },
      {
        name: "workflow uploads staged MCP preflight evidence",
        ok: false,
        expected: "staged-mcp-v1-preflight-node-${{ matrix.node-version }}",
        actual: "missing",
      },
    ]));
  });

  it("requires release docs to describe executable CI evidence checks", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      releaseDoc: "npm run ci\nMigrating To Eventloom v1.0.0\n",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "release doc references CI workflow",
        ok: false,
        expected: ".github/workflows/ci.yml",
        actual: "missing",
      },
      {
        name: "release doc references benchmark evidence report",
        ok: false,
        expected: ".eventloom-ci/benchmark-smoke-node-<node-version>.json",
        actual: "missing",
      },
      {
        name: "release doc references full benchmark evidence report",
        ok: false,
        expected: ".eventloom-ci/benchmark-full-node-20.json",
        actual: "missing",
      },
      {
        name: "release doc references export benchmark evidence report",
        ok: false,
        expected: ".eventloom-ci/benchmark-export-node-20.json",
        actual: "missing",
      },
      {
        name: "release doc references benchmark hardware note",
        ok: false,
        expected: "EVENTLOOM_BENCH_HARDWARE",
        actual: "missing",
      },
      {
        name: "release doc references artifact verification evidence report",
        ok: false,
        expected: ".eventloom-ci/artifact-bundle-verify-node-<node-version>.json",
        actual: "missing",
      },
      {
        name: "release doc references artifact verification report version",
        ok: false,
        expected: "eventloom.artifact-bundle-verification.v1",
        actual: "missing",
      },
      {
        name: "release doc references agent artifact manifest verification",
        ok: false,
        expected: "eventloom artifacts verify .eventloom/artifacts/manifest.json",
        actual: "missing",
      },
      {
        name: "release doc references staged MCP preflight report",
        ok: false,
        expected: ".eventloom-ci/staged-mcp-v1-preflight-node-<node-version>.json",
        actual: "missing",
      },
      {
        name: "release doc references pack manifest check",
        ok: false,
        expected: "npm run pack:check",
        actual: "missing",
      },
      {
        name: "release doc references prepack checks",
        ok: false,
        expected: "runtime and MCP `prepack` scripts run tests and builds before pack or publish",
        actual: "missing",
      },
      {
        name: "release doc references published runtime preflight",
        ok: false,
        expected: "--check-published-runtime",
        actual: "missing",
      },
      {
        name: "release doc references runtime production audit",
        ok: false,
        expected: "npm run audit:runtime",
        actual: "missing",
      },
      {
        name: "release doc references MCP production audit",
        ok: false,
        expected: "npm run audit:mcp",
        actual: "missing",
      },
      {
        name: "release doc documents production vulnerability threshold",
        ok: false,
        expected: "No high or critical production dependency vulnerabilities",
        actual: "missing",
      },
      {
        name: "release doc documents runtime-before-MCP publish order",
        ok: false,
        expected: "The runtime package must be published before the MCP package version that depends on it",
        actual: "missing",
      },
      {
        name: "release doc warns against hand-edited MCP lockfile",
        ok: false,
        expected: "Do not hand-edit the MCP lockfile to pretend a runtime tarball exists",
        actual: "missing",
      },
      {
        name: "release doc documents runtime package boundary",
        ok: false,
        expected: "The runtime package should include only",
        actual: "missing",
      },
      {
        name: "release doc documents MCP package boundary",
        ok: false,
        expected: "The MCP package currently ships only",
        actual: "missing",
      },
      {
        name: "release doc documents runtime ESM-only package",
        ok: false,
        expected: "`@eventloom/runtime` is ESM-only",
        actual: "missing",
      },
      {
        name: "release doc documents Node engine floor",
        ok: false,
        expected: "Node.js `>=20` is required",
        actual: "missing",
      },
      {
        name: "release doc warns against dirty publish",
        ok: false,
        expected: "Do not publish from a dirty worktree",
        actual: "missing",
      },
    ]));
  });

  it("requires the changelog to document v1 release history and semver policy", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      changelog: "# Changelog\n\n## Unreleased\n",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "changelog documents semantic versioning policy",
        ok: false,
        expected: "Eventloom follows semantic versioning",
        actual: "missing",
      },
      {
        name: "changelog has v1.0.0 section",
        ok: false,
        expected: "## 1.0.0",
        actual: "missing",
      },
      {
        name: "changelog documents runtime v1 package",
        ok: false,
        expected: "@eventloom/runtime@1.0.0",
        actual: "missing",
      },
      {
        name: "changelog documents MCP publish staging",
        ok: false,
        expected: "MCP package remains `0.1.6`",
        actual: "missing",
      },
      {
        name: "changelog documents artifact verification evidence",
        ok: false,
        expected: "archived artifact-bundle verification JSON reports",
        actual: "missing",
      },
      {
        name: "changelog documents fixture check evidence version",
        ok: false,
        expected: "eventloom.fixture-check.v1",
        actual: "missing",
      },
      {
        name: "changelog documents benchmark evidence version",
        ok: false,
        expected: "eventloom.benchmark.v1",
        actual: "missing",
      },
      {
        name: "changelog documents release preflight report version",
        ok: false,
        expected: "eventloom.release-preflight.v1",
        actual: "missing",
      },
      {
        name: "changelog documents pack manifest evidence version",
        ok: false,
        expected: "eventloom.pack-manifests.v1",
        actual: "missing",
      },
      {
        name: "changelog documents packaged smoke verification",
        ok: false,
        expected: "verify generated artifact bundle manifests",
        actual: "missing",
      },
    ]));
  });

  it("requires the runtime package to ship v1 public docs", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      files: ["docs/release.md", "docs/migration-v1.md"],
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime package ships changelog",
        ok: false,
        expected: "CHANGELOG.md",
        actual: "missing",
      },
      {
        name: "runtime package ships license",
        ok: false,
        expected: "LICENSE",
        actual: "missing",
      },
      {
        name: "runtime package ships public API docs",
        ok: false,
        expected: "docs/public-api.md",
        actual: "missing",
      },
      {
        name: "runtime package ships cookbook docs",
        ok: false,
        expected: "docs/agent-journal-cookbook.md",
        actual: "missing",
      },
      {
        name: "runtime package ships Pathlight integration docs",
        ok: false,
        expected: "docs/pathlight-integration.md",
        actual: "missing",
      },
      {
        name: "runtime package ships HALO integration docs",
        ok: false,
        expected: "docs/halo-integration.md",
        actual: "missing",
      },
      {
        name: "runtime package ships contributor guide",
        ok: false,
        expected: "docs/contributor-guide.md",
        actual: "missing",
      },
      {
        name: "runtime package ships product spec",
        ok: false,
        expected: "docs/product-spec.md",
        actual: "missing",
      },
      {
        name: "runtime package ships development plan",
        ok: false,
        expected: "docs/development-plan.md",
        actual: "missing",
      },
      {
        name: "runtime package ships stack review",
        ok: false,
        expected: "docs/stack-review.md",
        actual: "missing",
      },
      {
        name: "runtime package ships Pathlight ADR",
        ok: false,
        expected: "docs/decisions/pathlight-bridge-spike.md",
        actual: "missing",
      },
      {
        name: "runtime package ships architecture docs",
        ok: false,
        expected: "docs/architecture.md",
        actual: "missing",
      },
      {
        name: "runtime package ships event model docs",
        ok: false,
        expected: "docs/event-model.md",
        actual: "missing",
      },
      {
        name: "runtime package ships workflow docs",
        ok: false,
        expected: "docs/workflows.md",
        actual: "missing",
      },
      {
        name: "runtime package ships case studies",
        ok: false,
        expected: "docs/case-studies",
        actual: "missing",
      },
      {
        name: "runtime package ships sample fixture",
        ok: false,
        expected: "fixtures/sample.jsonl",
        actual: "missing",
      },
      {
        name: "runtime package ships golden fixtures",
        ok: false,
        expected: "fixtures/golden",
        actual: "missing",
      },
      {
        name: "runtime package ships export fixtures",
        ok: false,
        expected: "fixtures/export",
        actual: "missing",
      },
      {
        name: "runtime package ships custom workflow example",
        ok: false,
        expected: "examples/custom-workflow.ts",
        actual: "missing",
      },
    ]));
  });

  it("requires listed package files to exist in the release tree", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });
    await rm(join(root, "LICENSE"), { force: true });
    await rm(join(root, "packages", "mcp", "LICENSE"), { force: true });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "runtime package file exists LICENSE",
        ok: false,
        expected: "LICENSE",
        actual: "missing",
      },
      {
        name: "mcp package file exists LICENSE",
        ok: false,
        expected: "LICENSE",
        actual: "missing",
      },
    ]));
  });

  it("requires the MCP package to ship runtime adapter files and user-facing metadata", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      mcpFiles: ["dist"],
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "mcp",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "mcp package ships README",
        ok: false,
        expected: "README.md",
        actual: "missing",
      },
      {
        name: "mcp package ships license",
        ok: false,
        expected: "LICENSE",
        actual: "missing",
      },
    ]));
  });

  it("passes package checks after the coordinated v1 version bump", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it("requires a release branch and target tag for non-local preflight", async () => {
    const root = await tempGitReleaseTree({
      branch: "feature/v1",
      tag: null,
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "git release branch",
        ok: false,
        expected: "main or master",
        actual: "feature/v1",
      },
      {
        name: "git release tag",
        ok: false,
        expected: "v1.0.0",
        actual: "missing",
      },
    ]));
  });

  it("passes Git release checks on a clean release branch tagged at HEAD", async () => {
    const root = await tempGitReleaseTree({
      branch: "main",
      tag: "v1.0.0",
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "git release branch",
        ok: true,
        expected: "main or master",
        actual: "main",
      },
      {
        name: "git release tag",
        ok: true,
        expected: "v1.0.0",
        actual: "v1.0.0",
      },
    ]));
  });

  it("uses phase-specific tags for the runtime-first and MCP release commits", async () => {
    const runtimeRoot = await tempGitReleaseTree({
      branch: "main",
      tag: "runtime-v1.0.0",
      runtimeVersion: "1.0.0",
      mcpVersion: "0.1.6",
      mcpVersionConstant: "0.1.6",
      mcpRuntimeDependency: "^0.1.7",
    });

    const runtimeReport = await buildReleasePreflightReport({
      root: runtimeRoot,
      targetVersion: "1.0.0",
      phase: "runtime",
    });

    expect(runtimeReport.ok).toBe(true);
    expect(runtimeReport.checks).toContainEqual({
      name: "git release tag",
      ok: true,
      expected: "runtime-v1.0.0",
      actual: "runtime-v1.0.0",
    });

    const mcpRoot = await tempGitReleaseTree({
      branch: "main",
      tag: "mcp-v1.0.0",
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const mcpReport = await buildReleasePreflightReport({
      root: mcpRoot,
      targetVersion: "1.0.0",
      phase: "mcp",
      checkPublishedRuntime: true,
      npmView: publishedRuntimeView(),
    });

    expect(mcpReport.ok).toBe(true);
    expect(mcpReport.checks).toContainEqual({
      name: "git release tag",
      ok: true,
      expected: "mcp-v1.0.0",
      actual: "mcp-v1.0.0",
    });
  });

  it("can verify that the target runtime is published before MCP release", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
      checkPublishedRuntime: true,
      npmView: async () => "0.1.7",
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "published runtime version",
      ok: false,
      expected: "1.0.0",
      actual: "0.1.7",
    });
  });

  it("passes the published runtime check when npm resolves the target version", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
      checkPublishedRuntime: true,
      npmView: publishedRuntimeView(),
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual({
      name: "published runtime version",
      ok: true,
      expected: "1.0.0",
      actual: "1.0.0",
    });
  });

  it("rejects stale or hand-edited MCP runtime lockfile entries", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      mcpRuntimeResolved: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-0.1.7.tgz",
      mcpRuntimeIntegrity: "",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "mcp installed runtime lock resolved tarball",
        ok: false,
        expected: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-1.0.0.tgz",
        actual: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-0.1.7.tgz",
      },
      {
        name: "mcp installed runtime lock integrity",
        ok: false,
        expected: "present",
        actual: "missing",
      },
    ]));
  });

  it("rejects spoofed MCP runtime registry tarball URLs in normal publish preflight", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      mcpRuntimeResolved: "https://example.invalid/not-npm/runtime-1.0.0.tgz",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "mcp",
      checkGit: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "mcp installed runtime lock resolved tarball",
        ok: false,
        expected: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-1.0.0.tgz",
        actual: "https://example.invalid/not-npm/runtime-1.0.0.tgz",
      },
    ]));
  });

  it("compares MCP runtime lockfile metadata to the published runtime dist metadata", async () => {
    const root = await tempReleaseTree({
      runtimeVersion: "1.0.0",
      mcpVersion: "1.0.0",
      mcpVersionConstant: "1.0.0",
      mcpRuntimeDependency: "^1.0.0",
      mcpRuntimeResolved: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-1.0.0.tgz",
      mcpRuntimeIntegrity: "sha512-fake-hand-edited-integrity",
    });

    const report = await buildReleasePreflightReport({
      root,
      targetVersion: "1.0.0",
      phase: "mcp",
      checkGit: false,
      checkPublishedRuntime: true,
      npmView: async (_packageSpec: string, field?: string) => {
        if (field === "dist") {
          return JSON.stringify({
            tarball: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-1.0.0.tgz",
            integrity: "sha512-real-published-integrity",
          });
        }
        return "1.0.0";
      },
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      {
        name: "published runtime tarball matches MCP lockfile",
        ok: true,
        expected: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-1.0.0.tgz",
        actual: "https://registry.npmjs.org/@eventloom/runtime/-/runtime-1.0.0.tgz",
      },
      {
        name: "published runtime integrity matches MCP lockfile",
        ok: false,
        expected: "sha512-real-published-integrity",
        actual: "sha512-fake-hand-edited-integrity",
      },
    ]));
  });
});

async function tempReleaseTree(options: {
  runtimeName?: string;
  mcpName?: string;
  runtimeNodeEngine?: string | null;
  mcpNodeEngine?: string | null;
  runtimeLicense?: string | null;
  mcpLicense?: string | null;
  runtimePublishAccess?: string | null;
  mcpPublishAccess?: string | null;
  runtimeType?: string;
  mcpType?: string;
  runtimeMain?: string;
  mcpMain?: string;
  runtimeTypes?: string;
  mcpTypes?: string;
  runtimeBin?: Record<string, string>;
  mcpBin?: Record<string, string>;
  runtimeExports?: Record<string, unknown>;
  mcpExports?: Record<string, unknown>;
  runtimeDescription?: string;
  mcpDescription?: string;
  runtimeAuthor?: string | null;
  mcpAuthor?: string | null;
  runtimeRepository?: Record<string, string>;
  mcpRepository?: Record<string, string>;
  runtimeBugs?: Record<string, string>;
  mcpBugs?: Record<string, string>;
  runtimeHomepage?: string;
  mcpHomepage?: string;
  runtimeKeywords?: string[];
  mcpKeywords?: string[];
  runtimeLockName?: string;
  runtimeLockPackageName?: string;
  mcpLockName?: string;
  mcpLockPackageName?: string;
  runtimeLockfileVersion?: number | null;
  mcpLockfileVersion?: number | null;
  runtimeVersion: string;
  mcpVersion: string;
  mcpVersionConstant: string;
  mcpRuntimeDependency: string;
  mcpRuntimeResolved?: string;
  mcpRuntimeIntegrity?: string;
  scripts?: Record<string, string>;
  mcpScripts?: Record<string, string>;
  files?: string[];
  mcpFiles?: string[];
  workflow?: string;
  releaseDoc?: string;
  changelog?: string;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "eventloom-release-preflight-"));
  await writeJson(join(root, "package.json"), {
    name: options.runtimeName ?? "@eventloom/runtime",
    version: options.runtimeVersion,
    type: options.runtimeType ?? "module",
    main: options.runtimeMain ?? "./dist/index.js",
    types: options.runtimeTypes ?? "./dist/index.d.ts",
    bin: options.runtimeBin ?? { eventloom: "dist/cli.js" },
    exports: options.runtimeExports ?? runtimePackageExports(),
    description: options.runtimeDescription ?? "Append-only event-log runtime for multi-agent AI systems",
    ...(options.runtimeAuthor !== null ? { author: options.runtimeAuthor ?? "Nicholas Blanchard <syndicalt@gmail.com>" } : {}),
    repository: options.runtimeRepository ?? eventloomRepository(),
    bugs: options.runtimeBugs ?? eventloomBugs(),
    homepage: options.runtimeHomepage ?? "https://github.com/syndicalt/eventloom#readme",
    keywords: options.runtimeKeywords ?? runtimePackageKeywords(),
    ...(options.runtimeNodeEngine !== null ? { engines: { node: options.runtimeNodeEngine ?? ">=20" } } : {}),
    ...(options.runtimeLicense !== null ? { license: options.runtimeLicense ?? "MIT" } : {}),
    ...(options.runtimePublishAccess !== null ? { publishConfig: { access: options.runtimePublishAccess ?? "public" } } : {}),
    files: options.files ?? runtimePackageFiles(),
    scripts: options.scripts ?? releaseGateScripts(),
  });
  await writeJson(join(root, "package-lock.json"), {
    name: options.runtimeLockName ?? "@eventloom/runtime",
    version: options.runtimeVersion,
    ...(options.runtimeLockfileVersion !== null ? { lockfileVersion: options.runtimeLockfileVersion ?? 3 } : {}),
    packages: {
      "": {
        name: options.runtimeLockPackageName ?? "@eventloom/runtime",
        version: options.runtimeVersion,
      },
    },
  });
  await writeJson(join(root, "packages", "mcp", "package.json"), {
    name: options.mcpName ?? "@eventloom/mcp",
    version: options.mcpVersion,
    type: options.mcpType ?? "module",
    main: options.mcpMain ?? "./dist/index.js",
    types: options.mcpTypes ?? "./dist/index.d.ts",
    bin: options.mcpBin ?? { "eventloom-mcp": "dist/cli.js" },
    exports: options.mcpExports ?? mcpPackageExports(),
    description: options.mcpDescription ?? "MCP server for Eventloom local event logs",
    ...(options.mcpAuthor !== null ? { author: options.mcpAuthor ?? "Nicholas Blanchard <syndicalt@gmail.com>" } : {}),
    repository: options.mcpRepository ?? eventloomMcpRepository(),
    bugs: options.mcpBugs ?? eventloomBugs(),
    homepage: options.mcpHomepage ?? "https://github.com/syndicalt/eventloom#readme",
    keywords: options.mcpKeywords ?? mcpPackageKeywords(),
    ...(options.mcpNodeEngine !== null ? { engines: { node: options.mcpNodeEngine ?? ">=20" } } : {}),
    ...(options.mcpLicense !== null ? { license: options.mcpLicense ?? "MIT" } : {}),
    ...(options.mcpPublishAccess !== null ? { publishConfig: { access: options.mcpPublishAccess ?? "public" } } : {}),
    files: options.mcpFiles ?? mcpPackageFiles(),
    scripts: options.mcpScripts ?? mcpPackageScripts(),
    dependencies: { "@eventloom/runtime": options.mcpRuntimeDependency },
  });
  await writeJson(join(root, "packages", "mcp", "package-lock.json"), {
    name: options.mcpLockName ?? "@eventloom/mcp",
    version: options.mcpVersion,
    ...(options.mcpLockfileVersion !== null ? { lockfileVersion: options.mcpLockfileVersion ?? 3 } : {}),
    packages: {
      "": {
        name: options.mcpLockPackageName ?? "@eventloom/mcp",
        version: options.mcpVersion,
        dependencies: { "@eventloom/runtime": options.mcpRuntimeDependency },
      },
      "node_modules/@eventloom/runtime": {
        version: options.mcpRuntimeDependency.startsWith("file:") ? options.runtimeVersion : options.mcpRuntimeDependency.replace(/^\^/, ""),
        resolved: options.mcpRuntimeResolved ?? `https://registry.npmjs.org/@eventloom/runtime/-/runtime-${options.mcpRuntimeDependency.replace(/^\^/, "")}.tgz`,
        integrity: options.mcpRuntimeIntegrity ?? "sha512-test-integrity",
      },
    },
  });
  await writeText(
    join(root, "packages", "mcp", "src", "version.ts"),
    `export const EVENTLOOM_MCP_VERSION = "${options.mcpVersionConstant}";\n`,
  );
  await writeText(join(root, "docs", "release.md"), options.releaseDoc ?? releaseDoc());
  await writeText(join(root, "docs", "migration-v1.md"), "# Migrating To Eventloom v1.0.0\n");
  await writeText(join(root, "CHANGELOG.md"), options.changelog ?? changelog());
  await writeText(join(root, ".github", "workflows", "ci.yml"), options.workflow ?? releaseWorkflow());
  await materializePackageFiles(root, options.files ?? runtimePackageFiles());
  await materializePackageFiles(join(root, "packages", "mcp"), options.mcpFiles ?? mcpPackageFiles());
  return root;
}

async function tempGitReleaseTree(options: Parameters<typeof tempReleaseTree>[0] & {
  branch: string;
  tag: string | null;
}): Promise<string> {
  const root = await tempReleaseTree(options);
  execFileSync("git", ["init", "-b", options.branch], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", [
    "-c",
    "user.name=Eventloom Test",
    "-c",
    "user.email=eventloom@example.invalid",
    "commit",
    "-m",
    "release fixture",
  ], { cwd: root, stdio: "ignore" });
  if (options.tag) {
    execFileSync("git", ["tag", options.tag], { cwd: root, stdio: "ignore" });
  }
  return root;
}

function releaseGateScripts(): Record<string, string> {
  return {
    prepack: "npm run test:runtime && npm run build:runtime",
    ci: "npm run ci:runtime-v1",
    "ci:runtime-v1": "npm run test:runtime && npm run build:runtime && npm run fixtures:golden:check && npm run fixtures:check && npm run bench:smoke && npm run audit:runtime && npm run smoke:mcp-local-runtime && npm run smoke:mcp-v1-local-runtime-bin && npm run smoke:custom-workflow-package && npm run smoke:runtime-installed-cli && npm run pack:check && npm pack --dry-run",
    "ci:mcp-v1": "npm run test:mcp && npm run build:mcp && npm run audit:mcp && npm run smoke:mcp-installed-bin && npm run pack:check && npm pack --dry-run ./packages/mcp",
    "ci:full-v1": "npm run ci:runtime-v1 && npm run ci:mcp-v1",
    "release:preflight:v1": "node scripts/release-preflight.mjs --target 1.0.0",
    "release:preflight:v1:local": "node scripts/release-preflight.mjs --target 1.0.0 --no-git",
    "release:preflight:runtime-v1": "node scripts/release-preflight.mjs --target 1.0.0 --phase runtime",
    "release:preflight:runtime-v1:local": "node scripts/release-preflight.mjs --target 1.0.0 --phase runtime --no-git",
    "release:preflight:mcp-v1": "node scripts/release-preflight.mjs --target 1.0.0 --phase mcp --check-published-runtime",
    "release:preflight:mcp-v1:local": "node scripts/release-preflight.mjs --target 1.0.0 --phase mcp --no-git",
    "release:preflight:mcp-v1-staged:local": "node scripts/release-preflight-mcp-v1-local-staged.mjs",
    "publish:runtime-v1": "npm run ci:runtime-v1 && npm run release:preflight:runtime-v1 && npm publish --access public",
    "publish:mcp-v1": "npm run ci:full-v1 && npm run release:preflight:mcp-v1 && npm --prefix packages/mcp publish --access public",
  };
}

function mcpPackageScripts(): Record<string, string> {
  return {
    build: "node -e \"import('node:fs/promises').then(({ rm }) => rm('dist', { recursive: true, force: true }))\" && tsc && node ../../scripts/chmod-cli-bins.mjs dist/cli.js",
    "smoke:installed-bin": "node scripts/smoke-installed-bin.mjs",
    "smoke:v1-local-runtime-bin": "node scripts/smoke-v1-local-runtime-bin.mjs",
    prepack: "npm test && npm run build",
    test: "vitest run",
  };
}

function releaseDoc(): string {
  return `# Release Checklist

Run releases from a real Git checkout.

npm run ci

Migrating To Eventloom v1.0.0

The repository CI workflow at .github/workflows/ci.yml runs the runtime-first release gate and the staged MCP v1 local preflight on Node.js 20, 22, and 24.

Runtime release evidence includes .eventloom-ci/benchmark-smoke-node-<node-version>.json.

Release-candidate benchmark evidence includes .eventloom-ci/benchmark-full-node-20.json and .eventloom-ci/benchmark-export-node-20.json with EVENTLOOM_BENCH_HARDWARE.

Runtime release evidence includes .eventloom-ci/artifact-bundle-verify-node-<node-version>.json.

Artifact bundle verification release evidence is versioned eventloom.artifact-bundle-verification.v1.

Runtime release evidence verifies the agent artifact manifest with eventloom artifacts verify .eventloom/artifacts/manifest.json.

Staged MCP release evidence includes versioned eventloom.release-preflight.v1 .eventloom-ci/staged-mcp-v1-preflight-node-<node-version>.json.

npm run pack:check validates runtime and MCP package manifests.

runtime and MCP \`prepack\` scripts run tests and builds before pack or publish.

MCP v1 publication uses --check-published-runtime after the runtime package has been published.

npm run audit:runtime and npm run audit:mcp verify production dependencies. No high or critical production dependency vulnerabilities are allowed.

The runtime package must be published before the MCP package version that depends on it.

Do not hand-edit the MCP lockfile to pretend a runtime tarball exists.

The runtime package should include only the intended runtime files.

The MCP package currently ships only the MCP distribution files and package metadata.

\`@eventloom/runtime\` is ESM-only.

\`@eventloom/mcp\` is ESM-only.

Node.js \`>=20\` is required.

Do not publish from a dirty worktree.
`;
}

function changelog(): string {
  return `# Changelog

Eventloom follows semantic versioning for all stable release lines.

## 1.0.0

- Publish @eventloom/runtime@1.0.0 as the stable runtime package.
- MCP package remains \`0.1.6\` until the runtime package is published and the MCP v1 package can be staged against the published runtime artifact.
- Add archived artifact-bundle verification JSON reports to release evidence.
- Add explicit eventloom.fixture-check.v1 versioning to fixture freshness release evidence.
- Add explicit eventloom.benchmark.v1 versioning to benchmark release evidence.
- Add explicit eventloom.release-preflight.v1 versioning to release-preflight JSON reports.
- Add explicit eventloom.pack-manifests.v1 versioning to package manifest release evidence.
- Installed runtime CLI, installed MCP bin, and staged MCP v1 smoke tests verify generated artifact bundle manifests.
`;
}

function runtimePackageExports(): Record<string, unknown> {
  return {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
    "./export/halo": {
      types: "./dist/export/halo.d.ts",
      import: "./dist/export/halo.js",
    },
    "./export/otlp": {
      types: "./dist/export/otlp.d.ts",
      import: "./dist/export/otlp.js",
    },
    "./export/pathlight": {
      types: "./dist/export/pathlight.d.ts",
      import: "./dist/export/pathlight.js",
    },
    "./package.json": "./package.json",
  };
}

function mcpPackageExports(): Record<string, unknown> {
  return {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
    "./package.json": "./package.json",
  };
}

function eventloomRepository(): Record<string, string> {
  return {
    type: "git",
    url: "git+https://github.com/syndicalt/eventloom.git",
  };
}

function eventloomMcpRepository(): Record<string, string> {
  return {
    ...eventloomRepository(),
    directory: "packages/mcp",
  };
}

function eventloomBugs(): Record<string, string> {
  return {
    url: "https://github.com/syndicalt/eventloom/issues",
  };
}

function runtimePackageKeywords(): string[] {
  return [
    "agents",
    "event-log",
    "workflow",
    "runtime",
    "multi-agent",
    "observability",
    "pathlight",
    "halo",
    "otlp",
    "opentelemetry",
  ];
}

function mcpPackageKeywords(): string[] {
  return [
    "eventloom",
    "mcp",
    "agents",
    "event-log",
    "workflow",
    "halo",
    "otlp",
    "opentelemetry",
  ];
}

function runtimePackageFiles(): string[] {
  return [
    "dist",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "docs/README.md",
    "docs/roadmap-v1.md",
    "docs/benchmarks.md",
    "docs/package-api.md",
    "docs/public-api.md",
    "docs/custom-workflows.md",
    "docs/agent-journal-cookbook.md",
    "docs/github-actions-artifacts.md",
    "docs/release.md",
    "docs/migration-v1.md",
    "docs/cli-reference.md",
    "docs/user-guide.md",
    "docs/agent-integration.md",
    "docs/mcp-setup.md",
    "docs/mcp-package.md",
    "docs/contributor-guide.md",
    "docs/product-spec.md",
    "docs/development-plan.md",
    "docs/stack-review.md",
    "docs/decisions/pathlight-bridge-spike.md",
    "docs/case-studies",
    "docs/architecture.md",
    "docs/event-model.md",
    "docs/workflows.md",
    "docs/pathlight-integration.md",
    "docs/halo-integration.md",
    "docs/otlp-integration.md",
    "fixtures/sample.jsonl",
    "fixtures/export",
    "examples/custom-workflow.ts",
    "fixtures/golden",
  ];
}

function mcpPackageFiles(): string[] {
  return [
    "dist",
    "README.md",
    "LICENSE",
  ];
}

function releaseWorkflow(): string {
  return `name: CI

jobs:
  release-gates:
    strategy:
      fail-fast: false
      matrix:
        node-version: [20.x, 22.x, 24.x]
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: npm
          cache-dependency-path: |
            package-lock.json
            packages/mcp/package-lock.json
      - run: npm ci
      - run: npm --prefix packages/mcp ci
      - name: Run release gates
        run: npm run ci:runtime-v1
      - name: Write runtime release evidence reports
        run: |
          mkdir -p .eventloom-ci
          node scripts/check-golden-fixtures.mjs --json > ".eventloom-ci/golden-fixtures-node-\${{ matrix.node-version }}.json"
          node scripts/check-export-fixtures.mjs --json > ".eventloom-ci/export-fixtures-node-\${{ matrix.node-version }}.json"
          npm run --silent bench:smoke -- --out ".eventloom-ci/benchmark-smoke-node-\${{ matrix.node-version }}.json" > /dev/null
          node scripts/check-pack-manifests.mjs --json > ".eventloom-ci/pack-manifests-node-\${{ matrix.node-version }}.json"
          npm run --silent eventloom -- append .eventloom/agent-work.jsonl goal.created --actor ci --payload '{"title":"Run Eventloom v1 runtime release gate"}'
          npm run --silent eventloom -- append .eventloom/agent-work.jsonl verification.completed --actor ci --payload '{"summary":"Runtime release gate passed","command":"npm run ci:runtime-v1","checks":["runtime v1 gate"],"assertions":["release gate completed"],"evidenceEventIds":[],"artifactIds":["github-actions:\${{ github.run_id }}"],"passCount":1,"failCount":0}'
          npm run --silent eventloom -- artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts --title "Runtime Release Evidence"
          npm run --silent eventloom -- artifacts verify .eventloom/artifacts/manifest.json > ".eventloom-ci/artifact-bundle-verify-node-\${{ matrix.node-version }}.json"
      - name: Upload runtime release evidence reports
        uses: actions/upload-artifact@v4
        with:
          name: runtime-release-evidence-node-\${{ matrix.node-version }}
          if-no-files-found: error
          path: |
            .eventloom-ci/golden-fixtures-node-\${{ matrix.node-version }}.json
            .eventloom-ci/export-fixtures-node-\${{ matrix.node-version }}.json
            .eventloom-ci/benchmark-smoke-node-\${{ matrix.node-version }}.json
            .eventloom-ci/pack-manifests-node-\${{ matrix.node-version }}.json
            .eventloom-ci/artifact-bundle-verify-node-\${{ matrix.node-version }}.json
            .eventloom/agent-work.jsonl
            .eventloom/artifacts/
      - name: Run staged MCP v1 preflight
        run: |
          npm run --silent release:preflight:mcp-v1-staged:local -- --json \\
            | tee ".eventloom-ci/staged-mcp-v1-preflight-node-\${{ matrix.node-version }}.json"
      - name: Upload staged MCP v1 preflight report
        uses: actions/upload-artifact@v4
        with:
          name: staged-mcp-v1-preflight-node-\${{ matrix.node-version }}
          if-no-files-found: error
          path: .eventloom-ci/staged-mcp-v1-preflight-node-\${{ matrix.node-version }}.json
`;
}

function publishedRuntimeView(options: {
  version?: string;
  tarball?: string;
  integrity?: string;
} = {}) {
  const version = options.version ?? "1.0.0";
  const tarball = options.tarball ?? `https://registry.npmjs.org/@eventloom/runtime/-/runtime-${version}.tgz`;
  const integrity = options.integrity ?? "sha512-test-integrity";
  return async (_packageSpec: string, field?: string): Promise<string> => {
    if (field === "dist") return JSON.stringify({ tarball, integrity });
    return version;
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function materializePackageFiles(root: string, entries: readonly string[]): Promise<void> {
  const directoryEntries = new Set(["dist", "docs/case-studies", "fixtures/export", "fixtures/golden"]);
  for (const entry of entries) {
    const path = join(root, entry);
    if (directoryEntries.has(entry)) {
      await mkdir(path, { recursive: true });
    } else if (!(await pathExists(path))) {
      await writeText(path, `${entry}\n`);
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
