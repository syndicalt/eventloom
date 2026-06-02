import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const mcpSource = join(root, "packages", "mcp");
const tempRoot = mkdtempSync(join(tmpdir(), "eventloom-mcp-local-runtime-"));
const tempMcp = join(tempRoot, "mcp");
let runtimeTarball = null;

try {
  const packOutput = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot], {
    cwd: root,
    encoding: "utf8",
  });
  const packed = JSON.parse(packOutput);
  runtimeTarball = join(tempRoot, packed[0].filename);

  mkdirSync(tempMcp, { recursive: true });
  for (const entry of ["package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "README.md", "src", "tests"]) {
    const from = join(mcpSource, entry);
    if (!existsSync(from)) continue;
    cpSync(from, join(tempMcp, entry), { recursive: true });
  }
  copySmokeSupportFiles(tempMcp);
  patchMcpPackageForTempBuild(join(tempMcp, "package.json"));

  execFileSync("npm", ["ci"], { cwd: tempMcp, stdio: "inherit" });
  execFileSync("npm", ["install", "--no-save", runtimeTarball], { cwd: tempMcp, stdio: "inherit" });
  useInstalledRuntimeForSmoke(join(tempMcp, "vitest.config.ts"));
  execFileSync("npm", ["test"], { cwd: tempMcp, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: tempMcp, stdio: "inherit" });

  console.log(`MCP smoke passed with local runtime tarball ${basename(runtimeTarball)}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function useInstalledRuntimeForSmoke(configPath) {
  const config = readFileSync(configPath, "utf8");
  if (!config.includes("@eventloom/runtime")) return;
  writeFileSync(configPath, `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
`, "utf8");
}

function copySmokeSupportFiles(destinationRoot) {
  mkdirSync(join(destinationRoot, "scripts"), { recursive: true });
  cpSync(
    join(mcpSource, "scripts", "stdio-diagnostics.mjs"),
    join(destinationRoot, "scripts", "stdio-diagnostics.mjs"),
  );
  cpSync(
    join(root, "scripts", "chmod-cli-bins.mjs"),
    join(destinationRoot, "scripts", "chmod-cli-bins.mjs"),
  );
}

function patchMcpPackageForTempBuild(packagePath) {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.scripts.build = "node -e \"import('node:fs/promises').then(({ rm }) => rm('dist', { recursive: true, force: true }))\" && tsc && node scripts/chmod-cli-bins.mjs dist/cli.js";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}
