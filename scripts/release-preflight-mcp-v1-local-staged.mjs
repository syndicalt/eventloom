#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { buildReleasePreflightReport } from "./release-preflight.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const targetVersion = "1.0.0";

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
      stdio: args.json ? ["ignore", "ignore", "pipe"] : "inherit",
    });

    const report = await buildReleasePreflightReport({
      root: stagedRoot,
      targetVersion,
      phase: "mcp",
      checkGit: false,
      localRuntimeTarball: runtimeTarball,
    });

    console.log(args.json ? JSON.stringify(withStagedTarball(report, runtimeTarball), null, 2) : formatReport(report, runtimeTarball));
    if (!report.ok) process.exitCode = 1;
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
    encoding: "utf8",
  });
  const parsed = JSON.parse(output);
  const manifest = Array.isArray(parsed) ? parsed[0] : parsed;
  return join(tempRoot, manifest.filename);
}

function stageReleaseTree(stagedRoot, runtimeTarball) {
  copyFile(stagedRoot, "package.json");
  copyFile(stagedRoot, "package-lock.json");
  copyFile(stagedRoot, "CHANGELOG.md");
  copyFile(stagedRoot, ".github/workflows/ci.yml");
  copyFile(stagedRoot, "docs/release.md");
  copyFile(stagedRoot, "docs/migration-v1.md");

  for (const entry of ["package.json", "README.md", "tsconfig.json", "src"]) {
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
