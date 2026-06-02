import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildFixtureCheckReport, parseFixtureCheckArgs } from "../scripts/fixture-check.mjs";

const execFileAsync = promisify(execFile);

describe("fixture check reports", () => {
  it("reports stale fixture differences with stable mismatch details", async () => {
    const root = await mkdtemp(join(tmpdir(), "eventloom-fixture-check-"));
    const actualDir = join(root, "actual");
    const generatedDir = join(root, "generated");
    await mkdir(actualDir);
    await mkdir(generatedDir);
    await writeFile(join(actualDir, "matching.json"), "{}\n", "utf8");
    await writeFile(join(generatedDir, "matching.json"), "{}\n", "utf8");
    await writeFile(join(actualDir, "changed.json"), "{\"value\":1}\n", "utf8");
    await writeFile(join(generatedDir, "changed.json"), "{\"value\":2}\n", "utf8");
    await writeFile(join(actualDir, "extra.json"), "{}\n", "utf8");
    await writeFile(join(generatedDir, "missing.json"), "{}\n", "utf8");

    await expect(buildFixtureCheckReport({
      fixtureSet: "golden",
      fixturePath: "fixtures/golden",
      actualDir,
      generatedDir,
      extensions: [".json"],
    })).resolves.toMatchObject({
      version: "eventloom.fixture-check.v1",
      ok: false,
      fixtureSet: "golden",
      mismatchCount: 3,
      mismatches: [
        "changed.json differs from regenerated output",
        "extra.json is extra in fixtures/golden",
        "missing.json is missing from fixtures/golden",
      ],
    });
  });

  it("prints parseable success reports for current fixture checks", async () => {
    const golden = await execFileAsync("node", ["scripts/check-golden-fixtures.mjs", "--json"]);
    const exported = await execFileAsync("node", ["scripts/check-export-fixtures.mjs", "--json"]);

    expect(golden.stderr).toBe("");
    expect(exported.stderr).toBe("");
    expect(JSON.parse(golden.stdout)).toMatchObject({
      version: "eventloom.fixture-check.v1",
      ok: true,
      fixtureSet: "golden",
      mismatchCount: 0,
      mismatches: [],
    });
    expect(JSON.parse(exported.stdout)).toMatchObject({
      version: "eventloom.fixture-check.v1",
      ok: true,
      fixtureSet: "export",
      mismatchCount: 0,
      mismatches: [],
    });
  });

  it("rejects unknown fixture check options as structured JSON when requested", () => {
    expect(() => parseFixtureCheckArgs(["--unknown"])).toThrow("Unknown fixture check option --unknown");

    const result = spawnSync(process.execPath, [
      "scripts/check-golden-fixtures.mjs",
      "--json",
      "--unknown",
    ], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.fixture-check.v1",
      ok: false,
      fixtureSet: "golden",
      diagnostic: {
        code: "invalid_fixture_check_option",
        message: "Unknown fixture check option --unknown",
        option: "--unknown",
        suggestedAction: "Use only --json for fixture check options.",
      },
    });
  });
});
