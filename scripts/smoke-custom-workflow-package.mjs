import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const tempRoot = mkdtempSync(join(tmpdir(), "eventloom-custom-workflow-package-"));
let runtimeTarball = null;

try {
  const packOutput = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot], {
    cwd: root,
    encoding: "utf8",
  });
  const packed = JSON.parse(packOutput);
  runtimeTarball = join(tempRoot, packed[0].filename);

  writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  execFileSync("npm", ["install", "--no-save", runtimeTarball], { cwd: tempRoot, stdio: "inherit" });

  const output = execFileSync("npx", ["tsx", "node_modules/@eventloom/runtime/examples/custom-workflow.ts"], {
    cwd: tempRoot,
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  if (
    result.eventCount !== 3 ||
    result.integrityOk !== true ||
    result.eventTypes["goal.created"] !== 1 ||
    result.eventTypes["note.added"] !== 1 ||
    result.eventTypes["intention.rejected"] !== 1
  ) {
    throw new Error(`Unexpected custom workflow package smoke result: ${output}`);
  }

  console.log(`Custom workflow package smoke passed with ${basename(runtimeTarball)}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
