#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const target = process.argv[2];

if (!target) {
  console.error("Usage: node scripts/clean-dist.mjs <relative-output-dir>");
  process.exitCode = 1;
} else if (target.startsWith("/") || target.includes("..")) {
  console.error(`Refusing to clean unsafe output directory: ${target}`);
  process.exitCode = 1;
} else {
  await rm(resolve(root, target), { recursive: true, force: true });
}
