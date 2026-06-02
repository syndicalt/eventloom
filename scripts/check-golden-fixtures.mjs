#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildFixtureCheckReport,
  fixtureCheckOptionDiagnostic,
  parseFixtureCheckArgs,
} from "./fixture-check.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const actualDir = join(root, "fixtures", "golden");
const generatedDir = await mkdtemp(join(tmpdir(), "eventloom-golden-fixtures-"));
const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");

try {
  const args = parseFixtureCheckArgs(argv);
  execFileSync("npx", ["tsx", "scripts/generate-golden-fixtures.ts", "--out-dir", generatedDir], {
    cwd: root,
    stdio: args.json ? ["ignore", "ignore", "pipe"] : "inherit",
  });

  const report = await buildFixtureCheckReport({
    fixtureSet: "golden",
    fixturePath: "fixtures/golden",
    actualDir,
    generatedDir,
    extensions: [".json", ".jsonl"],
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    if (!args.json) {
      console.error("Golden fixtures are stale. Run npm run fixtures:golden and commit the updated fixtures.");
      for (const mismatch of report.mismatches) console.error(`- ${mismatch}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  if (wantsJson) {
    console.log(JSON.stringify({
      version: "eventloom.fixture-check.v1",
      ok: false,
      fixtureSet: "golden",
      actualDir,
      mismatchCount: 0,
      mismatches: [],
      diagnostic: fixtureCheckOptionDiagnostic(error),
    }, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
} finally {
  await rm(generatedDir, { recursive: true, force: true });
}
