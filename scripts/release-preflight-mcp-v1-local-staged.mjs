#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { buildReleasePreflightReport } from "./release-preflight.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const targetVersion = "1.0.0";
const npmMutationEnv = {
  ...process.env,
  npm_config_dry_run: "false",
};

class StagedMcpPreflightOptionsError extends Error {
  code = "invalid_staged_mcp_preflight_option";

  constructor(message, option, value, suggestedAction = "Use only --json for staged MCP v1 local preflight options.") {
    super(message);
    this.name = "StagedMcpPreflightOptionsError";
    this.option = option;
    this.value = value;
    this.suggestedAction = suggestedAction;
  }
}

await main(process.argv.slice(2));

async function main(argv) {
  const wantsJson = argv.includes("--json");
  let tempRoot = null;
  let stagedRoot = root;

  try {
    const args = parseArgs(argv);
    tempRoot = mkdtempSync(join(tmpdir(), "eventloom-mcp-v1-staged-preflight-"));
    stagedRoot = join(tempRoot, "release-tree");
    const stagedMcpRoot = join(stagedRoot, "packages", "mcp");
    const runtimeTarball = packRuntime(tempRoot);
    stageReleaseTree(stagedRoot, runtimeTarball);
    execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
      cwd: stagedMcpRoot,
      env: npmMutationEnv,
      stdio: args.json ? ["ignore", "ignore", "pipe"] : "inherit",
    });
    const stagedPackageChecks = runStagedMcpPackageChecks(stagedMcpRoot, args.json);

    const report = await buildReleasePreflightReport({
      root: stagedRoot,
      targetVersion,
      phase: "mcp",
      checkGit: false,
      localRuntimeTarball: runtimeTarball,
    });
    const combinedReport = withStagedPackageChecks(report, stagedPackageChecks);

    console.log(args.json ? JSON.stringify(withStagedTarball(combinedReport, runtimeTarball), null, 2) : formatReport(combinedReport, runtimeTarball));
    if (!combinedReport.ok) process.exitCode = 1;
  } catch (error) {
    const report = failureReport(stagedRoot, error);
    console.log(wantsJson ? JSON.stringify(report, null, 2) : formatReport(report, null));
    process.exitCode = 1;
  } finally {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const parsed = { json: false };
  for (const flag of argv) {
    if (flag === "--json") {
      parsed.json = true;
    } else {
      throw new StagedMcpPreflightOptionsError(`Unknown option: ${flag}`, flag);
    }
  }
  return parsed;
}

function packRuntime(tempRoot) {
  const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot], {
    cwd: root,
    env: npmMutationEnv,
    encoding: "utf8",
  });
  const parsed = JSON.parse(output);
  const manifest = Array.isArray(parsed) ? parsed[0] : parsed;
  return join(tempRoot, manifest.filename);
}

function stageReleaseTree(stagedRoot, runtimeTarball) {
  copyFile(stagedRoot, "package.json");
  copyFile(stagedRoot, "package-lock.json");
  copyFile(stagedRoot, ".github/workflows/ci.yml");

  const runtimePackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const entry of runtimePackage.files ?? []) {
    copyPath(stagedRoot, entry);
  }
  copyPath(stagedRoot, "docs/release.md");
  copyPath(stagedRoot, "scripts/chmod-cli-bins.mjs");

  for (const entry of ["package.json", "README.md", "LICENSE", "tsconfig.json", "src", "dist"]) {
    copyPath(stagedRoot, join("packages", "mcp", entry));
  }

  const stagedMcpRoot = join(stagedRoot, "packages", "mcp");
  const mcpPackagePath = join(stagedMcpRoot, "package.json");
  const mcpPackage = JSON.parse(readFileSync(mcpPackagePath, "utf8"));
  mcpPackage.version = targetVersion;
  mcpPackage.dependencies["@eventloom/runtime"] = `file:${runtimeTarball}`;
  writeFileSync(mcpPackagePath, `${JSON.stringify(mcpPackage, null, 2)}\n`, "utf8");

  writeFileSync(
    join(stagedMcpRoot, "src", "version.ts"),
    `export const EVENTLOOM_MCP_VERSION = "${targetVersion}";\n`,
    "utf8",
  );
}

function copyFile(stagedRoot, relativePath) {
  copyPath(stagedRoot, relativePath);
}

function copyPath(stagedRoot, relativePath) {
  const source = join(root, relativePath);
  if (!existsSync(source)) return;
  const destination = join(stagedRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function formatReport(report, runtimeTarball) {
  const lines = [
    `staged MCP v1 local preflight against ${runtimeTarball ? basename(runtimeTarball) : "unknown runtime tarball"}: ${report.ok ? "ok" : "failed"}`,
  ];
  for (const check of report.checks) {
    lines.push(`${check.ok ? "ok" : "fail"} ${check.name}: expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}`);
  }
  return lines.join("\n");
}

function runStagedMcpPackageChecks(stagedMcpRoot, json) {
  const install = commandCheck(
    "staged MCP package dependencies install",
    "npm ci --ignore-scripts",
    "npm",
    ["ci", "--ignore-scripts"],
    stagedMcpRoot,
    json,
  );
  const build = install.ok
    ? commandCheck(
      "staged MCP package builds",
      "npm run build",
      "npm",
      ["run", "build"],
      stagedMcpRoot,
      json,
    )
    : skippedCheck("staged MCP package builds", "npm run build", "dependency install failed");
  const packChecks = build.ok
    ? stagedMcpPackDryRunChecks(stagedMcpRoot)
    : [skippedCheck("staged MCP package pack dry-run", "npm pack --dry-run --ignore-scripts", "build failed")];
  return [install, build, ...packChecks];
}

function commandCheck(name, expected, command, args, cwd, json) {
  try {
    execFileSync(command, args, {
      cwd,
      env: npmMutationEnv,
      stdio: json ? ["ignore", "ignore", "pipe"] : "inherit",
    });
    return {
      name,
      ok: true,
      expected,
      actual: expected,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      expected,
      actual: commandError(error),
    };
  }
}

function skippedCheck(name, expected, reason) {
  return {
    name,
    ok: false,
    expected,
    actual: reason,
  };
}

function stagedMcpPackDryRunChecks(stagedMcpRoot) {
  const expected = "npm pack --dry-run --ignore-scripts";
  try {
    const output = execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: stagedMcpRoot,
      env: npmMutationEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const manifest = parsePackManifest(output);
    const paths = Array.isArray(manifest.files) ? manifest.files.map((file) => file.path) : [];
    return [
      {
        name: "staged MCP package pack dry-run",
        ok: true,
        expected,
        actual: expected,
      },
      equalsCheck("staged MCP pack name", "@eventloom/mcp", manifest.name),
      equalsCheck("staged MCP pack version", targetVersion, manifest.version),
      equalsCheck("staged MCP pack filename", `eventloom-mcp-${targetVersion}.tgz`, manifest.filename),
      ...["package.json", "README.md", "LICENSE", "dist/index.js", "dist/cli.js", "dist/server.js", "dist/tools.js"]
        .map((path) => pathIncludedCheck(`staged MCP pack includes ${path}`, paths, path)),
      ...["src/", "tests/", "package-lock.json", "tsconfig.json", "vitest.config.ts"]
        .map((path) => pathExcludedCheck(`staged MCP pack excludes ${path}`, paths, path)),
    ];
  } catch (error) {
    return [{
      name: "staged MCP package pack dry-run",
      ok: false,
      expected,
      actual: commandError(error),
    }];
  }
}

function parsePackManifest(output) {
  const parsed = JSON.parse(output);
  const manifest = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("npm pack --dry-run did not return a package manifest");
  }
  return manifest;
}

function equalsCheck(name, expected, actual) {
  return {
    name,
    ok: actual === expected,
    expected,
    actual: actual ?? "missing",
  };
}

function pathIncludedCheck(name, paths, path) {
  const ok = paths.includes(path);
  return {
    name,
    ok,
    expected: path,
    actual: ok ? path : "missing",
  };
}

function pathExcludedCheck(name, paths, path) {
  const ok = path.endsWith("/")
    ? !paths.some((candidate) => candidate.startsWith(path))
    : !paths.includes(path);
  return {
    name,
    ok,
    expected: "absent",
    actual: ok ? "absent" : path,
  };
}

function withStagedPackageChecks(report, stagedPackageChecks) {
  return {
    ...report,
    ok: report.ok && stagedPackageChecks.every((check) => check.ok),
    checks: [
      ...stagedPackageChecks,
      ...report.checks,
    ],
  };
}

function withStagedTarball(report, runtimeTarball) {
  return {
    ...report,
    stagedRuntimeTarball: basename(runtimeTarball),
  };
}

function failureReport(stagedRoot, error) {
  return {
    version: "eventloom.release-preflight.v1",
    ok: false,
    targetVersion,
    phase: "mcp",
    root: stagedRoot,
    checks: [{
      name: "staged MCP v1 local preflight",
      ok: false,
      expected: "ok",
      actual: commandError(error),
      diagnostic: stagedMcpPreflightDiagnostic(error),
    }],
  };
}

function stagedMcpPreflightDiagnostic(error) {
  if (error instanceof StagedMcpPreflightOptionsError) {
    return compactObject({
      code: error.code,
      message: error.message,
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  return {
    code: "staged_mcp_preflight_failed",
    message: commandError(error),
    suggestedAction: "Inspect the staged MCP preflight failure and retry after correcting the release inputs.",
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function commandError(error) {
  if (error && typeof error === "object" && "stderr" in error && error.stderr) {
    return String(error.stderr).trim();
  }
  return error instanceof Error ? error.message : String(error);
}
