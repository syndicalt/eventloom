import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export class FixtureCheckOptionsError extends Error {
  code = "invalid_fixture_check_option";

  constructor(message, option, value, suggestedAction = "Use only --json for fixture check options.") {
    super(message);
    this.name = "FixtureCheckOptionsError";
    this.option = option;
    this.value = value;
    this.suggestedAction = suggestedAction;
  }
}

export function parseFixtureCheckArgs(argv) {
  const parsed = { json: false };
  for (const flag of argv) {
    if (flag === "--json") {
      parsed.json = true;
    } else {
      throw new FixtureCheckOptionsError(`Unknown fixture check option ${flag}`, flag);
    }
  }
  return parsed;
}

export async function buildFixtureCheckReport(options) {
  const mismatches = await compareDirectories(options.actualDir, options.generatedDir, options.extensions, options.fixturePath);
  return {
    version: "eventloom.fixture-check.v1",
    ok: mismatches.length === 0,
    fixtureSet: options.fixtureSet,
    actualDir: resolve(options.actualDir),
    mismatchCount: mismatches.length,
    mismatches,
  };
}

export async function compareDirectories(actualDir, expectedDir, extensions, fixturePath) {
  const actualFiles = await fixtureFiles(actualDir, extensions);
  const expectedFiles = await fixtureFiles(expectedDir, extensions);
  const allFiles = [...new Set([...actualFiles, ...expectedFiles])].sort();
  const mismatches = [];

  for (const file of allFiles) {
    if (!actualFiles.includes(file)) {
      mismatches.push(`${file} is missing from ${fixturePath}`);
      continue;
    }
    if (!expectedFiles.includes(file)) {
      mismatches.push(`${file} is extra in ${fixturePath}`);
      continue;
    }
    const actual = await readFile(join(actualDir, file), "utf8");
    const expected = await readFile(join(expectedDir, file), "utf8");
    if (actual !== expected) mismatches.push(`${file} differs from regenerated output`);
  }

  return mismatches;
}

export function fixtureCheckOptionDiagnostic(error) {
  if (error instanceof FixtureCheckOptionsError) {
    return compactObject({
      code: error.code,
      message: error.message,
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  return {
    code: "fixture_check_failed",
    message: error instanceof Error ? error.message : String(error),
    suggestedAction: "Inspect the fixture check failure and retry after regenerating fixtures if needed.",
  };
}

async function fixtureFiles(dir, extensions) {
  return (await readdir(dir)).filter((file) => extensions.some((extension) => file.endsWith(extension))).sort();
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
