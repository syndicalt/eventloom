#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), "..");
const validPhases = ["runtime", "mcp", "full"];
const RELEASE_PREFLIGHT_REPORT_VERSION = "eventloom.release-preflight.v1";

export class ReleasePreflightOptionsError extends Error {
  code = "invalid_release_preflight_option";

  constructor(message, option, value, suggestedAction = "Use --root, --target, --phase, --no-git, --check-published-runtime, --local-runtime-tarball, or --json with valid values.") {
    super(message);
    this.name = "ReleasePreflightOptionsError";
    this.option = option;
    this.value = value;
    this.suggestedAction = suggestedAction;
  }
}

export async function buildReleasePreflightReport(options = {}) {
  const root = resolve(options.root ?? defaultRoot);
  const targetVersion = options.targetVersion ?? "1.0.0";
  const phase = options.phase ?? "full";
  if (!validPhases.includes(phase)) throw new ReleasePreflightOptionsError(
    `Unknown release phase ${phase}`,
    "--phase",
    phase,
    "Use one of: runtime, mcp, full.",
  );
  const localRuntimeTarball = options.localRuntimeTarball ? resolve(String(options.localRuntimeTarball)) : null;
  const expectedRuntimeRange = localRuntimeTarball ? `file:${localRuntimeTarball}` : `^${targetVersion}`;
  const checks = [];

  if (options.checkGit !== false) {
    checks.push(gitRepositoryCheck(root));
    checks.push(gitCleanCheck(root));
    checks.push(gitReleaseBranchCheck(root, options.releaseBranches ?? ["main", "master"]));
    checks.push(gitReleaseTagCheck(root, releaseTagForPhase(phase, targetVersion)));
  }

  const runtimePackage = await readJson(root, "package.json");
  const runtimeLock = await readJson(root, "package-lock.json");
  const mcpRoot = resolve(root, "packages/mcp");
  const mcpPackage = await readJson(root, "packages/mcp/package.json");
  const mcpLock = await readJson(root, "packages/mcp/package-lock.json");
  const mcpVersionSource = await readText(root, "packages/mcp/src/version.ts");
  const releaseDoc = await readText(root, "docs/release.md");
  const migrationDoc = await readText(root, "docs/migration-v1.md");
  const changelog = await readText(root, "CHANGELOG.md");
  const ciWorkflow = await readText(root, ".github/workflows/ci.yml");

  checks.push(...releaseScriptChecks(runtimePackage.scripts ?? {}));
  checks.push(...prepackScriptChecks(runtimePackage.scripts ?? {}, mcpPackage.scripts ?? {}));
  checks.push(...releaseWorkflowChecks(ciWorkflow));

  if (phase === "runtime" || phase === "full" || phase === "mcp") {
    checks.push(equalsCheck("runtime package name", "@eventloom/runtime", runtimePackage.name));
    checks.push(equalsCheck("runtime package version", targetVersion, runtimePackage.version));
    checks.push(equalsCheck("runtime node engine", ">=20", runtimePackage.engines?.node ?? "missing"));
    checks.push(equalsCheck("runtime package license", "MIT", runtimePackage.license ?? "missing"));
    checks.push(equalsCheck("runtime publish access", "public", runtimePackage.publishConfig?.access ?? "missing"));
    checks.push(...runtimePackageMetadataChecks(runtimePackage));
    checks.push(...runtimePackageEntrypointChecks(runtimePackage));
    checks.push(equalsCheck("runtime lockfile top-level name", "@eventloom/runtime", runtimeLock.name));
    checks.push(equalsCheck("runtime lockfile package name", "@eventloom/runtime", runtimeLock.packages?.[""]?.name));
    checks.push(equalsCheck("runtime lockfile format version", 3, runtimeLock.lockfileVersion));
    checks.push(equalsCheck("runtime lockfile top-level version", targetVersion, runtimeLock.version));
    checks.push(equalsCheck("runtime lockfile version", targetVersion, runtimeLock.packages?.[""]?.version));
  }
  if (phase === "mcp" || phase === "full") {
    checks.push(equalsCheck("mcp package name", "@eventloom/mcp", mcpPackage.name));
    checks.push(equalsCheck("mcp package version", targetVersion, mcpPackage.version));
    checks.push(equalsCheck("mcp node engine", ">=20", mcpPackage.engines?.node ?? "missing"));
    checks.push(equalsCheck("mcp package license", "MIT", mcpPackage.license ?? "missing"));
    checks.push(equalsCheck("mcp publish access", "public", mcpPackage.publishConfig?.access ?? "missing"));
    checks.push(...mcpPackageMetadataChecks(mcpPackage));
    checks.push(...mcpPackageEntrypointChecks(mcpPackage));
    checks.push(equalsCheck("mcp version constant", targetVersion, parseMcpVersionConstant(mcpVersionSource)));
    checks.push(equalsCheck("mcp lockfile top-level name", "@eventloom/mcp", mcpLock.name));
    checks.push(equalsCheck("mcp lockfile package name", "@eventloom/mcp", mcpLock.packages?.[""]?.name));
    checks.push(equalsCheck("mcp lockfile format version", 3, mcpLock.lockfileVersion));
    checks.push(equalsCheck("mcp lockfile top-level version", targetVersion, mcpLock.version));
    checks.push(equalsCheck("mcp lockfile version", targetVersion, mcpLock.packages?.[""]?.version));
    checks.push(equalsCheck("mcp runtime dependency", expectedRuntimeRange, normalizeFileSpec(mcpPackage.dependencies?.["@eventloom/runtime"], mcpRoot)));
    checks.push(equalsCheck(
      "mcp lockfile runtime dependency",
      expectedRuntimeRange,
      normalizeFileSpec(mcpLock.packages?.[""]?.dependencies?.["@eventloom/runtime"], mcpRoot),
    ));
    checks.push(equalsCheck(
      "mcp installed runtime lock version",
      targetVersion,
      mcpLock.packages?.["node_modules/@eventloom/runtime"]?.version,
    ));
    if (localRuntimeTarball) {
      checks.push(equalsCheck(
        "mcp installed runtime lock resolved tarball",
        `file:${localRuntimeTarball}`,
        normalizeFileSpec(mcpLock.packages?.["node_modules/@eventloom/runtime"]?.resolved, mcpRoot),
      ));
    } else {
      checks.push(equalsCheck(
        "mcp installed runtime lock resolved tarball",
        `https://registry.npmjs.org/@eventloom/runtime/-/runtime-${targetVersion}.tgz`,
        mcpLock.packages?.["node_modules/@eventloom/runtime"]?.resolved,
      ));
    }
    checks.push(presentCheck(
      "mcp installed runtime lock integrity",
      mcpLock.packages?.["node_modules/@eventloom/runtime"]?.integrity,
    ));
    checks.push(...mcpPackageFileChecks(mcpPackage.files));
    checks.push(...await mcpPackageFileExistenceChecks(mcpRoot));
  }
  if (options.checkPublishedRuntime) {
    checks.push(await publishedRuntimeCheck(targetVersion, options.npmView));
    checks.push(...await publishedRuntimeDistChecks(targetVersion, mcpLock, options.npmView));
  }
  checks.push(containsCheck("release doc references ci gate", releaseDoc, "npm run ci"));
  checks.push(containsCheck("release doc references v1 migration", releaseDoc, "Migrating To Eventloom v1.0.0"));
  checks.push(containsCheck("release doc references CI workflow", releaseDoc, ".github/workflows/ci.yml"));
  checks.push(containsCheck("release doc references supported Node matrix", releaseDoc, "Node.js 20, 22, and 24"));
  checks.push(containsCheck("release doc references benchmark evidence report", releaseDoc, ".eventloom-ci/benchmark-smoke-node-<node-version>.json"));
  checks.push(containsCheck("release doc references full benchmark evidence report", releaseDoc, ".eventloom-ci/benchmark-full-node-20.json"));
  checks.push(containsCheck("release doc references export benchmark evidence report", releaseDoc, ".eventloom-ci/benchmark-export-node-20.json"));
  checks.push(containsCheck("release doc references benchmark hardware note", releaseDoc, "EVENTLOOM_BENCH_HARDWARE"));
  checks.push(containsCheck("release doc references artifact verification evidence report", releaseDoc, ".eventloom-ci/artifact-bundle-verify-node-<node-version>.json"));
  checks.push(containsCheck("release doc references artifact verification report version", releaseDoc, "eventloom.artifact-bundle-verification.v1"));
  checks.push(containsCheck("release doc references agent artifact manifest verification", releaseDoc, "eventloom artifacts verify .eventloom/artifacts/manifest.json"));
  checks.push(containsCheck("release doc references staged MCP preflight report", releaseDoc, ".eventloom-ci/staged-mcp-v1-preflight-node-<node-version>.json"));
  checks.push(containsCheck("release doc references release preflight report version", releaseDoc, RELEASE_PREFLIGHT_REPORT_VERSION));
  checks.push(containsCheck("release doc references pack manifest check", releaseDoc, "npm run pack:check"));
  checks.push(containsCheck("release doc references prepack checks", releaseDoc, "runtime and MCP `prepack` scripts run tests and builds before pack or publish"));
  checks.push(containsCheck("release doc references published runtime preflight", releaseDoc, "--check-published-runtime"));
  checks.push(containsCheck("release doc references runtime production audit", releaseDoc, "npm run audit:runtime"));
  checks.push(containsCheck("release doc references MCP production audit", releaseDoc, "npm run audit:mcp"));
  checks.push(containsCheck("release doc documents production vulnerability threshold", releaseDoc, "No high or critical production dependency vulnerabilities"));
  checks.push(containsCheck("release doc documents runtime-before-MCP publish order", releaseDoc, "The runtime package must be published before the MCP package version that depends on it"));
  checks.push(containsCheck("release doc warns against hand-edited MCP lockfile", releaseDoc, "Do not hand-edit the MCP lockfile to pretend a runtime tarball exists"));
  checks.push(containsCheck("release doc documents runtime package boundary", releaseDoc, "The runtime package should include only"));
  checks.push(containsCheck("release doc documents MCP package boundary", releaseDoc, "The MCP package currently ships only"));
  checks.push(containsCheck("release doc documents runtime ESM-only package", releaseDoc, "`@eventloom/runtime` is ESM-only"));
  checks.push(containsCheck("release doc documents MCP ESM-only package", releaseDoc, "`@eventloom/mcp` is ESM-only"));
  checks.push(containsCheck("release doc documents Node engine floor", releaseDoc, "Node.js `>=20` is required"));
  checks.push(containsCheck("release doc warns against dirty publish", releaseDoc, "Do not publish from a dirty worktree"));
  checks.push(containsCheck("migration doc is v1", migrationDoc, "Migrating To Eventloom v1.0.0"));
  checks.push(containsCheck("changelog documents semantic versioning policy", changelog, "Eventloom follows semantic versioning"));
  checks.push(containsCheck("changelog has v1.0.0 section", changelog, "## 1.0.0"));
  checks.push(containsCheck("changelog documents runtime v1 package", changelog, "@eventloom/runtime@1.0.0"));
  checks.push(containsCheck("changelog documents MCP publish staging", changelog, "MCP package remains `0.1.6`"));
  checks.push(containsCheck("changelog documents artifact verification evidence", changelog, "archived artifact-bundle verification JSON reports"));
  checks.push(containsCheck("changelog documents fixture check evidence version", changelog, "eventloom.fixture-check.v1"));
  checks.push(containsCheck("changelog documents benchmark evidence version", changelog, "eventloom.benchmark.v1"));
  checks.push(containsCheck("changelog documents release preflight report version", changelog, RELEASE_PREFLIGHT_REPORT_VERSION));
  checks.push(containsCheck("changelog documents pack manifest evidence version", changelog, "eventloom.pack-manifests.v1"));
  checks.push(containsCheck("changelog documents packaged smoke verification", changelog, "verify generated artifact bundle manifests"));
  checks.push(...runtimePackageFileChecks(runtimePackage.files));
  checks.push(...await runtimePackageFileExistenceChecks(root));

  return {
    version: RELEASE_PREFLIGHT_REPORT_VERSION,
    ok: checks.every((check) => check.ok),
    targetVersion,
    phase,
    root,
    checks,
  };
}

async function publishedRuntimeCheck(targetVersion, npmView = defaultNpmView) {
  try {
    const actual = await npmView(`@eventloom/runtime@${targetVersion}`, "version");
    return equalsCheck("published runtime version", targetVersion, String(actual).trim().replace(/^"|"$/g, ""));
  } catch (error) {
    return {
      name: "published runtime version",
      ok: false,
      expected: targetVersion,
      actual: commandError(error),
    };
  }
}

async function publishedRuntimeDistChecks(targetVersion, mcpLock, npmView = defaultNpmView) {
  const lockEntry = mcpLock.packages?.["node_modules/@eventloom/runtime"] ?? {};
  try {
    const output = await npmView(`@eventloom/runtime@${targetVersion}`, "dist");
    const dist = parseNpmJson(output);
    return [
      equalsCheck("published runtime tarball matches MCP lockfile", dist.tarball, lockEntry.resolved),
      equalsCheck("published runtime integrity matches MCP lockfile", dist.integrity, lockEntry.integrity),
    ];
  } catch (error) {
    return [{
      name: "published runtime dist metadata",
      ok: false,
      expected: "dist.tarball and dist.integrity",
      actual: commandError(error),
    }];
  }
}

async function defaultNpmView(packageSpec, field) {
  return execFileSync("npm", ["view", packageSpec, field, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseNpmJson(output) {
  if (typeof output !== "string") return output;
  return JSON.parse(output);
}

function gitRepositoryCheck(root) {
  try {
    const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return equalsCheck("git repository", "true", output);
  } catch (error) {
    return {
      name: "git repository",
      ok: false,
      expected: "true",
      actual: commandError(error),
    };
  }
}

function gitCleanCheck(root) {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      name: "git clean worktree",
      ok: output.trim().length === 0,
      expected: "",
      actual: output.trim(),
    };
  } catch (error) {
    return {
      name: "git clean worktree",
      ok: false,
      expected: "",
      actual: commandError(error),
    };
  }
}

function gitReleaseBranchCheck(root, allowedBranches) {
  const expected = allowedBranches.join(" or ");
  try {
    const output = execFileSync("git", ["branch", "--show-current"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return {
      name: "git release branch",
      ok: allowedBranches.includes(output),
      expected,
      actual: output || "detached",
    };
  } catch (error) {
    return {
      name: "git release branch",
      ok: false,
      expected,
      actual: commandError(error),
    };
  }
}

function gitReleaseTagCheck(root, expectedTag) {
  try {
    const output = execFileSync("git", ["tag", "--points-at", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const tags = output.length > 0 ? output.split(/\r?\n/).filter(Boolean) : [];
    return {
      name: "git release tag",
      ok: tags.includes(expectedTag),
      expected: expectedTag,
      actual: tags.includes(expectedTag) ? expectedTag : (tags.join(", ") || "missing"),
    };
  } catch (error) {
    return {
      name: "git release tag",
      ok: false,
      expected: expectedTag,
      actual: commandError(error),
    };
  }
}

function releaseTagForPhase(phase, targetVersion) {
  if (phase === "runtime") return `runtime-v${targetVersion}`;
  if (phase === "mcp") return `mcp-v${targetVersion}`;
  return `v${targetVersion}`;
}

function equalsCheck(name, expected, actual) {
  return {
    name,
    ok: actual === expected,
    expected,
    actual,
  };
}

function containsCheck(name, text, expected) {
  return {
    name,
    ok: text.includes(expected),
    expected,
    actual: text.includes(expected) ? expected : "missing",
  };
}

function arrayContainsCheck(name, values, expected) {
  const ok = Array.isArray(values) && values.includes(expected);
  return {
    name,
    ok,
    expected,
    actual: ok ? expected : "missing",
  };
}

function presentCheck(name, value) {
  return {
    name,
    ok: typeof value === "string" && value.length > 0,
    expected: "present",
    actual: typeof value === "string" && value.length > 0 ? "present" : "missing",
  };
}

function fileEntryCheck(name, files, expected) {
  const actual = Array.isArray(files) && files.includes(expected) ? expected : "missing";
  return equalsCheck(name, expected, actual);
}

function runtimePackageFileChecks(files) {
  return requiredRuntimePackageFiles().map((entry) => fileEntryCheck(entry.name, files, entry.path));
}

function mcpPackageFileChecks(files) {
  return requiredMcpPackageFiles().map((entry) => fileEntryCheck(entry.name, files, entry.path));
}

async function runtimePackageFileExistenceChecks(root) {
  return Promise.all(requiredRuntimePackageFiles().map((entry) => fileExistsCheck("runtime", root, entry.path)));
}

async function mcpPackageFileExistenceChecks(root) {
  return Promise.all(requiredMcpPackageFiles().map((entry) => fileExistsCheck("mcp", root, entry.path)));
}

async function fileExistsCheck(packageName, root, path) {
  try {
    await access(resolve(root, path));
    return equalsCheck(`${packageName} package file exists ${path}`, path, path);
  } catch {
    return equalsCheck(`${packageName} package file exists ${path}`, path, "missing");
  }
}

function runtimePackageMetadataChecks(packageJson) {
  return [
    equalsCheck("runtime package description", "Append-only event-log runtime for multi-agent AI systems", packageJson.description ?? "missing"),
    equalsCheck("runtime package author", "Nicholas Blanchard <syndicalt@gmail.com>", packageJson.author ?? "missing"),
    equalsCheck("runtime repository type", "git", packageJson.repository?.type ?? "missing"),
    equalsCheck("runtime repository url", "git+https://github.com/syndicalt/eventloom.git", packageJson.repository?.url ?? "missing"),
    equalsCheck("runtime bugs url", "https://github.com/syndicalt/eventloom/issues", packageJson.bugs?.url ?? "missing"),
    equalsCheck("runtime homepage", "https://github.com/syndicalt/eventloom#readme", packageJson.homepage ?? "missing"),
    ...["agents", "event-log", "runtime", "multi-agent", "observability", "pathlight", "halo", "otlp", "opentelemetry"]
      .map((keyword) => arrayContainsCheck(`runtime keyword ${keyword}`, packageJson.keywords, keyword)),
  ];
}

function mcpPackageMetadataChecks(packageJson) {
  return [
    equalsCheck("mcp package description", "MCP server for Eventloom local event logs", packageJson.description ?? "missing"),
    equalsCheck("mcp package author", "Nicholas Blanchard <syndicalt@gmail.com>", packageJson.author ?? "missing"),
    equalsCheck("mcp repository type", "git", packageJson.repository?.type ?? "missing"),
    equalsCheck("mcp repository url", "git+https://github.com/syndicalt/eventloom.git", packageJson.repository?.url ?? "missing"),
    equalsCheck("mcp repository directory", "packages/mcp", packageJson.repository?.directory ?? "missing"),
    equalsCheck("mcp bugs url", "https://github.com/syndicalt/eventloom/issues", packageJson.bugs?.url ?? "missing"),
    equalsCheck("mcp homepage", "https://github.com/syndicalt/eventloom#readme", packageJson.homepage ?? "missing"),
    ...["eventloom", "mcp", "agents", "event-log", "workflow", "halo", "otlp", "opentelemetry"]
      .map((keyword) => arrayContainsCheck(`mcp keyword ${keyword}`, packageJson.keywords, keyword)),
  ];
}

function runtimePackageEntrypointChecks(packageJson) {
  return [
    equalsCheck("runtime package type", "module", packageJson.type ?? "missing"),
    equalsCheck("runtime main entry", "./dist/index.js", packageJson.main ?? "missing"),
    equalsCheck("runtime types entry", "./dist/index.d.ts", packageJson.types ?? "missing"),
    equalsCheck("runtime bin eventloom", "dist/cli.js", packageJson.bin?.eventloom ?? "missing"),
    equalsCheck("runtime root export import", "./dist/index.js", packageJson.exports?.["."]?.import ?? "missing"),
    equalsCheck("runtime root export types", "./dist/index.d.ts", packageJson.exports?.["."]?.types ?? "missing"),
    equalsCheck("runtime package.json export", "./package.json", packageJson.exports?.["./package.json"] ?? "missing"),
    equalsCheck("runtime halo export import", "./dist/export/halo.js", packageJson.exports?.["./export/halo"]?.import ?? "missing"),
    equalsCheck("runtime halo export types", "./dist/export/halo.d.ts", packageJson.exports?.["./export/halo"]?.types ?? "missing"),
    equalsCheck("runtime otlp export import", "./dist/export/otlp.js", packageJson.exports?.["./export/otlp"]?.import ?? "missing"),
    equalsCheck("runtime otlp export types", "./dist/export/otlp.d.ts", packageJson.exports?.["./export/otlp"]?.types ?? "missing"),
    equalsCheck("runtime pathlight export import", "./dist/export/pathlight.js", packageJson.exports?.["./export/pathlight"]?.import ?? "missing"),
    equalsCheck("runtime pathlight export types", "./dist/export/pathlight.d.ts", packageJson.exports?.["./export/pathlight"]?.types ?? "missing"),
  ];
}

function mcpPackageEntrypointChecks(packageJson) {
  return [
    equalsCheck("mcp package type", "module", packageJson.type ?? "missing"),
    equalsCheck("mcp main entry", "./dist/index.js", packageJson.main ?? "missing"),
    equalsCheck("mcp types entry", "./dist/index.d.ts", packageJson.types ?? "missing"),
    equalsCheck("mcp bin eventloom-mcp", "dist/cli.js", packageJson.bin?.["eventloom-mcp"] ?? "missing"),
    equalsCheck("mcp root export import", "./dist/index.js", packageJson.exports?.["."]?.import ?? "missing"),
    equalsCheck("mcp root export types", "./dist/index.d.ts", packageJson.exports?.["."]?.types ?? "missing"),
    equalsCheck("mcp package.json export", "./package.json", packageJson.exports?.["./package.json"] ?? "missing"),
  ];
}

function requiredRuntimePackageFiles() {
  return [
    { name: "runtime package ships dist", path: "dist" },
    { name: "runtime package ships README", path: "README.md" },
    { name: "runtime package ships changelog", path: "CHANGELOG.md" },
    { name: "runtime package ships license", path: "LICENSE" },
    { name: "runtime package ships docs index", path: "docs/README.md" },
    { name: "runtime package ships roadmap docs", path: "docs/roadmap-v1.md" },
    { name: "runtime package ships benchmark docs", path: "docs/benchmarks.md" },
    { name: "runtime package ships package API docs", path: "docs/package-api.md" },
    { name: "runtime package ships public API docs", path: "docs/public-api.md" },
    { name: "runtime package ships custom workflow docs", path: "docs/custom-workflows.md" },
    { name: "runtime package ships cookbook docs", path: "docs/agent-journal-cookbook.md" },
    { name: "runtime package ships GitHub artifact docs", path: "docs/github-actions-artifacts.md" },
    { name: "runtime package ships release docs", path: "docs/release.md" },
    { name: "runtime package ships migration docs", path: "docs/migration-v1.md" },
    { name: "runtime package ships CLI reference", path: "docs/cli-reference.md" },
    { name: "runtime package ships user guide", path: "docs/user-guide.md" },
    { name: "runtime package ships agent integration docs", path: "docs/agent-integration.md" },
    { name: "runtime package ships MCP setup docs", path: "docs/mcp-setup.md" },
    { name: "runtime package ships MCP package docs", path: "docs/mcp-package.md" },
    { name: "runtime package ships contributor guide", path: "docs/contributor-guide.md" },
    { name: "runtime package ships product spec", path: "docs/product-spec.md" },
    { name: "runtime package ships development plan", path: "docs/development-plan.md" },
    { name: "runtime package ships stack review", path: "docs/stack-review.md" },
    { name: "runtime package ships Pathlight ADR", path: "docs/decisions/pathlight-bridge-spike.md" },
    { name: "runtime package ships case studies", path: "docs/case-studies" },
    { name: "runtime package ships architecture docs", path: "docs/architecture.md" },
    { name: "runtime package ships event model docs", path: "docs/event-model.md" },
    { name: "runtime package ships workflow docs", path: "docs/workflows.md" },
    { name: "runtime package ships Pathlight integration docs", path: "docs/pathlight-integration.md" },
    { name: "runtime package ships HALO integration docs", path: "docs/halo-integration.md" },
    { name: "runtime package ships OTLP integration docs", path: "docs/otlp-integration.md" },
    { name: "runtime package ships sample fixture", path: "fixtures/sample.jsonl" },
    { name: "runtime package ships golden fixtures", path: "fixtures/golden" },
    { name: "runtime package ships export fixtures", path: "fixtures/export" },
    { name: "runtime package ships custom workflow example", path: "examples/custom-workflow.ts" },
  ];
}

function requiredMcpPackageFiles() {
  return [
    { name: "mcp package ships dist", path: "dist" },
    { name: "mcp package ships README", path: "README.md" },
    { name: "mcp package ships license", path: "LICENSE" },
  ];
}

function releaseScriptChecks(scripts) {
  return Object.entries(requiredReleaseScripts()).map(([name, expected]) => {
    const actual = typeof scripts[name] === "string" ? scripts[name] : "missing";
    return equalsCheck(`runtime ${name} script`, expected, actual);
  });
}

function prepackScriptChecks(runtimeScripts, mcpScripts) {
  return [
    equalsCheck(
      "runtime prepack script",
      "npm run test:runtime && npm run build:runtime",
      typeof runtimeScripts.prepack === "string" ? runtimeScripts.prepack : "missing",
    ),
    equalsCheck(
      "mcp prepack script",
      "npm test && npm run build",
      typeof mcpScripts.prepack === "string" ? mcpScripts.prepack : "missing",
    ),
  ];
}

function releaseWorkflowChecks(workflow) {
  const workflowDoc = parseWorkflow(workflow);
  const job = workflowDoc?.jobs?.["release-gates"];
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const jobText = workflowSearchText(job);
  const setupNodeStep = steps.find((step) => step?.uses === "actions/setup-node@v4");
  const setupNodeText = workflowSearchText(setupNodeStep);
  const uploadSteps = steps.filter((step) => step?.uses === "actions/upload-artifact@v4");
  const runtimeUploadStep = uploadSteps.find((step) => step?.with?.name === "runtime-release-evidence-node-${{ matrix.node-version }}");
  const runtimeUploadText = workflowSearchText(runtimeUploadStep);
  const stagedMcpUploadStep = uploadSteps.find((step) => step?.with?.name === "staged-mcp-v1-preflight-node-${{ matrix.node-version }}");
  const stagedMcpUploadText = workflowSearchText(stagedMcpUploadStep);

  return [
    workflowStructuralCheck("workflow has matrix strategy", isRecord(job?.strategy), "strategy:"),
    workflowStructuralCheck("workflow keeps matrix fail-fast disabled", job?.strategy?.["fail-fast"] === false, "fail-fast: false"),
    workflowStructuralCheck("workflow tests supported Node versions", sameStringArray(job?.strategy?.matrix?.["node-version"], ["20.x", "22.x", "24.x"]), "node-version: [20.x, 22.x, 24.x]"),
    workflowStructuralCheck("workflow uses matrix Node version", setupNodeStep?.with?.["node-version"] === "${{ matrix.node-version }}", "node-version: ${{ matrix.node-version }}"),
    workflowStructuralCheck("workflow uses setup-node v4", Boolean(setupNodeStep), "actions/setup-node@v4"),
    workflowStructuralCheck("workflow caches runtime lockfile", setupNodeText.includes("package-lock.json"), "package-lock.json"),
    workflowStructuralCheck("workflow caches MCP lockfile", setupNodeText.includes("packages/mcp/package-lock.json"), "packages/mcp/package-lock.json"),
    workflowStructuralCheck("workflow installs runtime dependencies from lockfile", jobText.includes("npm ci"), "npm ci"),
    workflowStructuralCheck("workflow installs MCP dependencies from lockfile", jobText.includes("npm --prefix packages/mcp ci"), "npm --prefix packages/mcp ci"),
    workflowStructuralCheck("workflow uploads artifacts with upload-artifact v4", uploadSteps.length > 0, "actions/upload-artifact@v4"),
    workflowStructuralCheck("workflow runs runtime release gate", jobText.includes("npm run ci:runtime-v1"), "npm run ci:runtime-v1"),
    workflowStructuralCheck("workflow writes golden fixture evidence", jobText.includes('node scripts/check-golden-fixtures.mjs --json > ".eventloom-ci/golden-fixtures-node-${{ matrix.node-version }}.json"'), 'node scripts/check-golden-fixtures.mjs --json > ".eventloom-ci/golden-fixtures-node-${{ matrix.node-version }}.json"'),
    workflowStructuralCheck("workflow writes export fixture evidence", jobText.includes('node scripts/check-export-fixtures.mjs --json > ".eventloom-ci/export-fixtures-node-${{ matrix.node-version }}.json"'), 'node scripts/check-export-fixtures.mjs --json > ".eventloom-ci/export-fixtures-node-${{ matrix.node-version }}.json"'),
    workflowStructuralCheck("workflow writes benchmark smoke evidence", jobText.includes('npm run --silent bench:smoke -- --out ".eventloom-ci/benchmark-smoke-node-${{ matrix.node-version }}.json" > /dev/null'), 'npm run --silent bench:smoke -- --out ".eventloom-ci/benchmark-smoke-node-${{ matrix.node-version }}.json" > /dev/null'),
    workflowStructuralCheck("workflow writes package manifest evidence", jobText.includes('node scripts/check-pack-manifests.mjs --json > ".eventloom-ci/pack-manifests-node-${{ matrix.node-version }}.json"'), 'node scripts/check-pack-manifests.mjs --json > ".eventloom-ci/pack-manifests-node-${{ matrix.node-version }}.json"'),
    workflowStructuralCheck("workflow writes agent release event log", jobText.includes("npm run --silent eventloom -- append .eventloom/agent-work.jsonl goal.created"), "npm run --silent eventloom -- append .eventloom/agent-work.jsonl goal.created"),
    workflowStructuralCheck("workflow writes agent verification event", jobText.includes("npm run --silent eventloom -- append .eventloom/agent-work.jsonl verification.completed"), "npm run --silent eventloom -- append .eventloom/agent-work.jsonl verification.completed"),
    workflowStructuralCheck("workflow writes agent artifact bundle", jobText.includes("npm run --silent eventloom -- artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts"), "npm run --silent eventloom -- artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts"),
    workflowStructuralCheck("workflow verifies agent artifact bundle", jobText.includes("npm run --silent eventloom -- artifacts verify .eventloom/artifacts/manifest.json"), "npm run --silent eventloom -- artifacts verify .eventloom/artifacts/manifest.json"),
    workflowStructuralCheck("workflow writes artifact verification evidence", jobText.includes('> ".eventloom-ci/artifact-bundle-verify-node-${{ matrix.node-version }}.json"'), ' > ".eventloom-ci/artifact-bundle-verify-node-${{ matrix.node-version }}.json"'),
    workflowStructuralCheck("workflow uploads runtime release evidence", Boolean(runtimeUploadStep), "runtime-release-evidence-node-${{ matrix.node-version }}"),
    workflowStructuralCheck("workflow uploads benchmark smoke evidence", runtimeUploadText.includes(".eventloom-ci/benchmark-smoke-node-${{ matrix.node-version }}.json"), ".eventloom-ci/benchmark-smoke-node-${{ matrix.node-version }}.json"),
    workflowStructuralCheck("workflow uploads artifact verification evidence", runtimeUploadText.includes(".eventloom-ci/artifact-bundle-verify-node-${{ matrix.node-version }}.json"), ".eventloom-ci/artifact-bundle-verify-node-${{ matrix.node-version }}.json"),
    workflowStructuralCheck("workflow uploads agent event log", runtimeUploadText.includes(".eventloom/agent-work.jsonl"), ".eventloom/agent-work.jsonl"),
    workflowStructuralCheck("workflow uploads agent artifact bundle", runtimeUploadText.includes(".eventloom/artifacts/"), ".eventloom/artifacts/"),
    workflowStructuralCheck("workflow writes staged MCP preflight evidence", jobText.includes('tee ".eventloom-ci/staged-mcp-v1-preflight-node-${{ matrix.node-version }}.json"'), 'tee ".eventloom-ci/staged-mcp-v1-preflight-node-${{ matrix.node-version }}.json"'),
    workflowStructuralCheck("workflow uploads staged MCP preflight evidence", Boolean(stagedMcpUploadStep), "staged-mcp-v1-preflight-node-${{ matrix.node-version }}"),
    workflowStructuralCheck("workflow fails on missing evidence files", uploadSteps.length > 0 && uploadSteps.every((step) => step?.with?.["if-no-files-found"] === "error"), "if-no-files-found: error"),
  ];
}

function parseWorkflow(workflow) {
  try {
    return parseYaml(workflow);
  } catch {
    return null;
  }
}

function workflowStructuralCheck(name, ok, expected) {
  return {
    name,
    ok,
    expected,
    actual: ok ? expected : "missing",
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function workflowSearchText(value) {
  const parts = [];
  collectWorkflowSearchText(value, parts);
  return parts.join("\n");
}

function collectWorkflowSearchText(value, parts) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    parts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkflowSearchText(item, parts);
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      parts.push(key);
      collectWorkflowSearchText(item, parts);
    }
  }
}

function requiredReleaseScripts() {
  return {
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

function normalizeFileSpec(value, baseDir = process.cwd()) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("file:")) return value;
  return `file:${resolve(baseDir, value.slice("file:".length))}`;
}

function parseMcpVersionConstant(source) {
  return source.match(/EVENTLOOM_MCP_VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? "missing";
}

async function readJson(root, path) {
  return JSON.parse(await readText(root, path));
}

async function readText(root, path) {
  return readFile(resolve(root, path), "utf8");
}

function commandError(error) {
  if (error && typeof error === "object" && "stderr" in error && error.stderr) {
    return String(error.stderr).trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv) {
  const parsed = { root: defaultRoot, targetVersion: "1.0.0", phase: "full", checkGit: true, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--root") {
      if (!isOptionValue(value)) throw missingOptionValueError(flag, value);
      parsed.root = value;
      index += 1;
    } else if (flag === "--target") {
      if (!isOptionValue(value)) throw missingOptionValueError(flag, value);
      parsed.targetVersion = value;
      index += 1;
    } else if (flag === "--phase") {
      if (!isOptionValue(value)) throw missingOptionValueError(flag, value);
      if (!validPhases.includes(value)) throw new ReleasePreflightOptionsError(
        `Unknown release phase ${value}`,
        flag,
        value,
        "Use one of: runtime, mcp, full.",
      );
      parsed.phase = value;
      index += 1;
    } else if (flag === "--no-git") {
      parsed.checkGit = false;
    } else if (flag === "--check-published-runtime") {
      parsed.checkPublishedRuntime = true;
    } else if (flag === "--local-runtime-tarball") {
      if (!isOptionValue(value)) throw missingOptionValueError(flag, value);
      parsed.localRuntimeTarball = value;
      index += 1;
    } else if (flag === "--json") {
      parsed.json = true;
    } else {
      throw new ReleasePreflightOptionsError(`Unknown option ${flag}`, flag);
    }
  }
  return parsed;
}

function missingOptionValueError(option, value) {
  return new ReleasePreflightOptionsError(
    `Missing value for ${option}`,
    option,
    value,
    "Provide a non-empty value that does not start with --.",
  );
}

function isOptionValue(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("--");
}

function formatReport(report) {
  const lines = [`release preflight for ${report.targetVersion} (${report.phase}): ${report.ok ? "ok" : "failed"}`];
  for (const check of report.checks) {
    lines.push(`${check.ok ? "ok" : "fail"} ${check.name}: expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}`);
  }
  return lines.join("\n");
}

function failureReportFromArgs(argv, error) {
  const targetIndex = argv.indexOf("--target");
  const phaseIndex = argv.indexOf("--phase");
  const rootIndex = argv.indexOf("--root");
  const targetVersion = targetIndex >= 0 && isOptionValue(argv[targetIndex + 1]) ? argv[targetIndex + 1] : "1.0.0";
  const phase = phaseIndex >= 0 && isOptionValue(argv[phaseIndex + 1]) ? argv[phaseIndex + 1] : "full";
  const root = rootIndex >= 0 && isOptionValue(argv[rootIndex + 1]) ? resolve(argv[rootIndex + 1]) : defaultRoot;

  return {
    version: RELEASE_PREFLIGHT_REPORT_VERSION,
    ok: false,
    targetVersion,
    phase,
    root,
    checks: [{
      name: "release preflight arguments",
      ok: false,
      expected: "valid release preflight arguments",
      actual: commandError(error),
      diagnostic: releasePreflightDiagnostic(error),
    }],
  };
}

function releasePreflightDiagnostic(error) {
  if (error instanceof ReleasePreflightOptionsError) {
    return compactObject({
      code: error.code,
      message: error.message,
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  return {
    code: "release_preflight_failed",
    message: commandError(error),
    suggestedAction: "Inspect the release preflight failure and retry after correcting the release inputs.",
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

if (process.argv[1] === scriptPath) {
  const argv = process.argv.slice(2);
  const wantsJson = argv.includes("--json");
  try {
    const args = parseArgs(argv);
    const report = await buildReleasePreflightReport(args);
    console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    if (wantsJson) {
      console.log(JSON.stringify(failureReportFromArgs(argv, error), null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
