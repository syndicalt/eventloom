import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RuntimeProvenance {
  packageName: string;
  packageVersion: string;
  gitCommit: string | null;
  gitBranch: string | null;
  gitDirty: boolean | null;
}

interface PackageJson {
  name?: string;
  version?: string;
}

export async function collectRuntimeProvenance(cwd = process.cwd()): Promise<RuntimeProvenance> {
  const packageJson = await readPackageJson(cwd);
  const [gitCommit, gitBranch, gitDirty] = await Promise.all([
    gitValue(cwd, ["rev-parse", "HEAD"]),
    gitValue(cwd, ["branch", "--show-current"]),
    gitDirtyState(cwd),
  ]);

  return {
    packageName: packageJson.name ?? "unknown",
    packageVersion: packageJson.version ?? "0.0.0",
    gitCommit,
    gitBranch,
    gitDirty,
  };
}

async function readPackageJson(cwd: string): Promise<PackageJson> {
  const text = await readFile(join(cwd, "package.json"), "utf8");
  return JSON.parse(text) as PackageJson;
}

async function gitValue(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function gitDirtyState(cwd: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return stdout.trim().length > 0;
  } catch {
    return null;
  }
}
