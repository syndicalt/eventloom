#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const packDir = await mkdtemp(join(tmpdir(), "eventloom-pack-manifest-"));
const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");

class PackManifestCheckOptionsError extends Error {
  code = "invalid_pack_manifest_check_option";

  constructor(message, option, value, suggestedAction = "Use only --json for pack manifest check options.") {
    super(message);
    this.name = "PackManifestCheckOptionsError";
    this.option = option;
    this.value = value;
    this.suggestedAction = suggestedAction;
  }
}

try {
  const args = parseArgs(argv);
  const runtime = packManifest(["--json", "--dry-run", "--ignore-scripts", "--pack-destination", packDir]);
  const mcp = packManifest(["--json", "--dry-run", "--ignore-scripts", "--pack-destination", packDir, "./packages/mcp"]);
  const failures = [
    ...checkManifest("runtime", runtime, runtimeRules()),
    ...checkManifest("mcp", mcp, mcpRules()),
    ...await checkPackageEntrypoints("runtime", runtime, root),
    ...await checkPackageEntrypoints("mcp", mcp, join(root, "packages", "mcp")),
    ...await checkBin("runtime", runtime, root),
    ...await checkBin("mcp", mcp, join(root, "packages", "mcp")),
    ...await checkInlineSourceMaps("runtime", runtime, root),
    ...await checkInlineSourceMaps("mcp", mcp, join(root, "packages", "mcp")),
    ...await checkPackedMarkdownLinks("runtime", runtime),
    ...await checkPackedMarkdownLinks("mcp", mcp),
  ];
  const report = {
    version: "eventloom.pack-manifests.v1",
    ok: failures.length === 0,
    check: "pack-manifests",
    failureCount: failures.length,
    failures,
    packages: [
      packageSummary("runtime", runtime),
      packageSummary("mcp", mcp),
    ],
  };

  if (args.json) console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    if (!args.json) {
      console.error("Pack manifest check failed.");
      for (const failure of failures) console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  if (wantsJson) {
    console.log(JSON.stringify({
      version: "eventloom.pack-manifests.v1",
      ok: false,
      check: "pack-manifests",
      failureCount: 0,
      failures: [],
      diagnostic: packManifestCheckDiagnostic(error),
    }, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
} finally {
  await rm(packDir, { recursive: true, force: true });
}

function parseArgs(argv) {
  const parsed = { json: false };
  for (const flag of argv) {
    if (flag === "--json") {
      parsed.json = true;
    } else {
      throw new PackManifestCheckOptionsError(`Unknown pack manifest check option ${flag}`, flag);
    }
  }
  return parsed;
}

function packManifestCheckDiagnostic(error) {
  if (error instanceof PackManifestCheckOptionsError) {
    return compactObject({
      code: error.code,
      message: error.message,
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  return {
    code: "pack_manifest_check_failed",
    message: error instanceof Error ? error.message : String(error),
    suggestedAction: "Inspect the pack manifest check failure and retry after correcting package metadata or packed files.",
  };
}

function packageSummary(label, manifest) {
  return {
    label,
    name: manifest.name,
    version: manifest.version,
    filename: manifest.filename,
    fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
    size: manifest.size,
    unpackedSize: manifest.unpackedSize,
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function packManifest(args) {
  const output = execFileSync("npm", ["pack", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output);
  const manifest = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error(`npm pack did not return a manifest for args: ${args.join(" ")}`);
  }
  return manifest;
}

function runtimeRules() {
  return {
    required: [
      "package.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
      "dist/index.js",
      "dist/cli.js",
      "docs/README.md",
      "docs/migration-v1.md",
      "docs/package-api.md",
      "docs/public-api.md",
      "docs/custom-workflows.md",
      "examples/custom-workflow.ts",
      "fixtures/sample.jsonl",
      "fixtures/golden/manifest.json",
      "fixtures/export/manifest.json",
    ],
    allowedPrefixes: [
      "dist/",
      "docs/",
      "fixtures/",
      "examples/",
    ],
    allowedFiles: [
      "package.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
    ],
    forbiddenPrefixes: [
      "src/",
      "tests/",
      "scripts/",
      "site/",
      "packages/",
      ".github/",
      "node_modules/",
    ],
    forbiddenFiles: [
      "tsconfig.json",
      "vitest.config.ts",
      "README-KARPATHY.md",
      "AGENTS.md",
      "package-lock.json",
    ],
  };
}

function mcpRules() {
  return {
    required: [
      "package.json",
      "README.md",
      "LICENSE",
      "dist/index.js",
      "dist/cli.js",
      "dist/server.js",
      "dist/tools.js",
    ],
    allowedPrefixes: ["dist/"],
    allowedFiles: ["package.json", "README.md", "LICENSE"],
    forbiddenPrefixes: [
      "src/",
      "tests/",
      "node_modules/",
    ],
    forbiddenFiles: [
      "tsconfig.json",
      "vitest.config.ts",
      "package-lock.json",
    ],
  };
}

function checkManifest(label, manifest, rules) {
  const paths = manifest.files.map((file) => file.path).sort();
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const failures = [];

  for (const required of rules.required) {
    if (!paths.includes(required)) {
      failures.push(`${label}: missing required packed file ${required}`);
      continue;
    }
    if (!hasPositivePackedSize(filesByPath.get(required))) {
      failures.push(`${label}: required packed file ${required} must be non-empty`);
    }
  }

  for (const path of paths) {
    const allowed = rules.allowedFiles.includes(path) || rules.allowedPrefixes.some((prefix) => path.startsWith(prefix));
    if (!allowed) failures.push(`${label}: unexpected packed file ${path}`);
    if (rules.forbiddenFiles.includes(path)) failures.push(`${label}: forbidden packed file ${path}`);
    const forbiddenPrefix = rules.forbiddenPrefixes.find((prefix) => path.startsWith(prefix));
    if (forbiddenPrefix) failures.push(`${label}: forbidden packed prefix ${forbiddenPrefix} via ${path}`);
  }

  return failures;
}

async function checkBin(label, manifest, baseDir) {
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const paths = new Set(filesByPath.keys());
  const packageJson = JSON.parse(await readFile(join(baseDir, "package.json"), "utf8"));
  const expected = label === "mcp" ? { "eventloom-mcp": "dist/cli.js" } : { eventloom: "dist/cli.js" };
  const failures = [];

  for (const [name, target] of Object.entries(expected)) {
    if (packageJson.bin?.[name] !== target) {
      failures.push(`${label}: package.json bin ${name} must map to ${target}`);
      continue;
    }
    if (!paths.has(target)) {
      failures.push(`${label}: bin target ${target} is not present in packed files`);
      continue;
    }
    if (!hasPositivePackedSize(filesByPath.get(target))) {
      failures.push(`${label}: bin target ${target} must be non-empty`);
    }
    if (!hasExecutablePackedMode(filesByPath.get(target))) {
      failures.push(`${label}: bin target ${target} must be executable in the packed tarball`);
    }
    const contents = await readFile(join(baseDir, target), "utf8");
    if (!contents.startsWith("#!/usr/bin/env node")) {
      failures.push(`${label}: bin target ${target} must start with #!/usr/bin/env node`);
    }
  }

  return failures;
}

async function checkPackageEntrypoints(label, manifest, baseDir) {
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const paths = new Set(filesByPath.keys());
  const packageJson = JSON.parse(await readFile(join(baseDir, "package.json"), "utf8"));
  const failures = [];

  for (const [field, target] of [["main", packageJson.main], ["types", packageJson.types]]) {
    if (typeof target !== "string") {
      failures.push(`${label}: package.json ${field} must be a string`);
      continue;
    }
    const packedPath = stripPackageTargetPrefix(target);
    if (!paths.has(packedPath)) {
      failures.push(`${label}: package.json ${field} target ${target} is not present in packed files`);
    } else if (!hasPositivePackedSize(filesByPath.get(packedPath))) {
      failures.push(`${label}: package.json ${field} target ${target} must be non-empty`);
    }
  }

  for (const { subpath, condition, target } of packageExportTargets(packageJson.exports)) {
    const packedPath = stripPackageTargetPrefix(target);
    if (!paths.has(packedPath)) {
      failures.push(`${label}: package export ${subpath} ${condition} target ${target} is not present in packed files`);
    } else if (!hasPositivePackedSize(filesByPath.get(packedPath))) {
      failures.push(`${label}: package export ${subpath} ${condition} target ${target} must be non-empty`);
    }
  }

  return failures;
}

function packageExportTargets(exportsField, subpath = ".") {
  if (typeof exportsField === "string") {
    return [{ subpath, condition: "default", target: exportsField }];
  }
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) return [];

  const entries = [];
  for (const [key, value] of Object.entries(exportsField)) {
    if (key.startsWith(".")) {
      entries.push(...packageExportTargets(value, key));
    } else if (typeof value === "string") {
      entries.push({ subpath, condition: key, target: value });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...packageExportTargets(value, `${subpath} ${key}`));
    }
  }
  return entries;
}

function stripPackageTargetPrefix(target) {
  return target.startsWith("./") ? target.slice(2) : target;
}

function hasPositivePackedSize(file) {
  return typeof file?.size === "number" && file.size > 0;
}

function hasExecutablePackedMode(file) {
  return typeof file?.mode === "number" && (file.mode & 0o111) !== 0;
}

async function checkInlineSourceMaps(label, manifest, baseDir) {
  const paths = new Set(manifest.files.map((file) => file.path));
  const mapPaths = [...paths].filter((path) => path.endsWith(".map") && path.startsWith("dist/"));
  const failures = [];

  for (const mapPath of mapPaths) {
    const map = JSON.parse(await readFile(join(baseDir, mapPath), "utf8"));
    const sources = Array.isArray(map.sources) ? map.sources : [];
    const sourcesContent = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
    if (sources.length > 0 && sourcesContent.length !== sources.length) {
      failures.push(`${label}: ${mapPath} references sources without matching inline sourcesContent`);
    }
  }

  return failures;
}

async function checkPackedMarkdownLinks(label, manifest) {
  const paths = new Set(manifest.files.map((file) => file.path));
  const markdownPaths = [...paths].filter((path) => path.endsWith(".md"));
  const failures = [];

  for (const markdownPath of markdownPaths) {
    const text = await readFile(packFileSourcePath(label, markdownPath), "utf8");
    for (const link of extractMarkdownLinks(text)) {
      const target = normalizeMarkdownTarget(markdownPath, link);
      if (target === null) continue;
      if (paths.has(target)) continue;
      if ([...paths].some((path) => path.startsWith(`${target.replace(/\/$/, "")}/`))) continue;
      failures.push(`${label}: ${markdownPath} links to unpacked file ${link}`);
    }
  }

  return failures;
}

function extractMarkdownLinks(text) {
  const links = [];
  const pattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) links.push(match[1]);
  return links;
}

function normalizeMarkdownTarget(markdownPath, rawTarget) {
  if (
    rawTarget.startsWith("#") ||
    rawTarget.startsWith("http://") ||
    rawTarget.startsWith("https://") ||
    rawTarget.startsWith("mailto:") ||
    rawTarget.startsWith("/")
  ) return null;

  const withoutFragment = rawTarget.split("#")[0].split("?")[0];
  if (withoutFragment.length === 0) return null;
  return posix.normalize(posix.join(posix.dirname(markdownPath), withoutFragment));
}

function packFileSourcePath(label, packedPath) {
  return label === "mcp" ? join(root, "packages", "mcp", packedPath) : join(root, packedPath);
}
