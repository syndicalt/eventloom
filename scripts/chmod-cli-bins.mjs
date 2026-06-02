#!/usr/bin/env node
import { chmod, stat } from "node:fs/promises";
import { resolve } from "node:path";

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error("Usage: node scripts/chmod-cli-bins.mjs <file> [file...]");
  process.exit(1);
}

for (const target of targets) {
  const path = resolve(process.cwd(), target);
  const file = await stat(path);

  if (!file.isFile()) {
    throw new Error(`CLI bin target is not a file: ${target}`);
  }

  await chmod(path, file.mode | 0o755);
}
