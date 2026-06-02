import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { formatHaloJsonl, exportToHalo } from "./export/halo.js";
import { exportToOtlp, formatOtlpJson } from "./export/otlp.js";
import { JsonlEventStore, type EventLogDiagnostic, type EventLogVerificationReport } from "./event-store.js";
import { formatHandoffSummary, summarizeHandoff } from "./handoff.js";
import { buildEventLogInspectionModel } from "./inspect.js";
import { buildEventLogStats, buildEventQueryResult } from "./query.js";
import { buildVisualizerModel, renderVisualizerHtml } from "./visualizer.js";

/**
 * Inputs for writing a complete repository-local Eventloom artifact bundle.
 */
export interface ArtifactBundleOptions {
  inputPath: string;
  outDir: string;
  title?: string;
}

/**
 * Manifest returned after writing verification, stats, visualizer, handoff, HALO, and OTLP artifacts.
 */
export interface ArtifactBundleResult {
  version: "eventloom.artifact-bundle.v1";
  inputPath: string;
  outDir: string;
  eventCount: number;
  integrityOk: boolean;
  validPrefixCount: number;
  lastGoodLine: number | null;
  lastGoodHash: string | null;
  diagnosticCount: number;
  diagnostics: EventLogDiagnostic[];
  projectionHash: string;
  inputDigest: ArtifactBundleFileDigest;
  files: ArtifactBundleFiles;
  fileDigests: ArtifactBundleFileDigests;
}

/**
 * Versioned verification artifact written as `verify.json` inside an artifact bundle.
 *
 * The top-level integrity fields mirror the underlying verification report for
 * existing consumers, while `integrity` preserves the complete source report
 * under a stable read-model version.
 */
export interface ArtifactBundleVerifyArtifact extends EventLogVerificationReport {
  version: "eventloom.verify.v1";
  diagnosticCount: number;
  integrity: EventLogVerificationReport;
}

/**
 * Canonical file paths written by `writeArtifactBundle()`.
 */
export interface ArtifactBundleFiles {
  verify: string;
  stats: string;
  queryJson: string;
  inspectJson: string;
  visualizerJson: string;
  visualizerHtml: string;
  handoff: string;
  haloJsonl: string;
  otlpJson: string;
  manifest: string;
}

/**
 * Durable checksum metadata for a generated artifact bundle file.
 */
export interface ArtifactBundleFileDigest {
  path: string;
  bytes: number;
  sha256: `sha256:${string}`;
}

/**
 * Checksums for generated bundle files, excluding the self-describing manifest.
 */
export type ArtifactBundleFileDigests = {
  [K in Exclude<keyof ArtifactBundleFiles, "manifest">]: ArtifactBundleFileDigest;
};

/**
 * Stable verification issue for a generated artifact bundle file.
 */
export interface ArtifactBundleVerificationIssue {
  file: keyof ArtifactBundleFileDigests | "input" | "manifest";
  path: string;
  code: "invalid_manifest" | "missing_file" | "unreadable_file" | "byte_count_mismatch" | "sha256_mismatch";
  message: string;
  expectedBytes?: number;
  actualBytes?: number;
  expectedSha256?: `sha256:${string}`;
  actualSha256?: `sha256:${string}`;
}

/**
 * Result of checking the source log and generated artifact files against
 * manifest digest metadata.
 */
export interface ArtifactBundleVerificationResult {
  version: "eventloom.artifact-bundle-verification.v1";
  ok: boolean;
  checkedFiles: number;
  issues: ArtifactBundleVerificationIssue[];
}

/**
 * Build a stable artifact-bundle verification failure for an unreadable or
 * malformed manifest file.
 */
export function invalidArtifactBundleManifest(
  path: string,
  message: string,
): ArtifactBundleVerificationResult {
  return artifactBundleVerificationResult({
    ok: false,
    checkedFiles: 0,
    issues: [{
      file: "manifest",
      path,
      code: "invalid_manifest",
      message,
    }],
  });
}

/**
 * Write a complete local handoff bundle from the verified prefix of an Eventloom log.
 *
 * Derived artifacts preserve source-log integrity diagnostics while using only
 * recoverable events for projections and exports.
 */
export async function writeArtifactBundle(options: ArtifactBundleOptions): Promise<ArtifactBundleResult> {
  const store = new JsonlEventStore(options.inputPath);
  const snapshot = await store.readVerifiedSnapshot();
  const visualizer = buildVisualizerModel(snapshot.validEvents);
  visualizer.replay.integrity = snapshot.report;
  visualizer.handoff = summarizeHandoff(snapshot.validEvents, snapshot.report);
  const stats = buildEventLogStats(snapshot.validEvents, snapshot.report);
  const query = buildEventQueryResult(snapshot.validEvents, {}, snapshot.report);
  const inspection = buildEventLogInspectionModel(snapshot.validEvents, snapshot.report);
  const handoff = visualizer.handoff;
  const halo = await exportToHalo(snapshot.validEvents, { integrityReport: snapshot.report });
  const otlp = await exportToOtlp(snapshot.validEvents, { integrityReport: snapshot.report });
  const files = artifactBundleFiles(options.outDir);

  await mkdir(options.outDir, { recursive: true });
  await writeJson(files.verify, buildArtifactBundleVerifyArtifact(snapshot.report));
  await writeJson(files.stats, stats);
  await writeJson(files.queryJson, query);
  await writeJson(files.inspectJson, inspection);
  await writeJson(files.visualizerJson, visualizer);
  await writeTextFileAtomically(files.visualizerHtml, renderVisualizerHtml(visualizer, { title: options.title }));
  await writeTextFileAtomically(files.handoff, formatHandoffSummary(handoff));
  await writeTextFileAtomically(files.haloJsonl, formatHaloJsonl(halo));
  await writeTextFileAtomically(files.otlpJson, formatOtlpJson(otlp));
  const [inputDigest, fileDigests] = await Promise.all([
    fileDigest(options.inputPath),
    artifactBundleFileDigests(files),
  ]);

  const result: ArtifactBundleResult = {
    version: "eventloom.artifact-bundle.v1",
    inputPath: options.inputPath,
    outDir: options.outDir,
    eventCount: snapshot.report.validPrefixCount,
    integrityOk: snapshot.report.ok,
    validPrefixCount: snapshot.report.validPrefixCount,
    lastGoodLine: snapshot.report.lastGoodLine,
    lastGoodHash: snapshot.report.lastGoodHash,
    diagnosticCount: snapshot.report.diagnostics.length,
    diagnostics: snapshot.report.diagnostics,
    projectionHash: visualizer.replay.projectionHash,
    inputDigest,
    files,
    fileDigests,
  };
  await writeJson(files.manifest, result);
  return result;
}

/**
 * Build the stable verification JSON artifact for repository-local bundles.
 */
export function buildArtifactBundleVerifyArtifact(
  integrity: EventLogVerificationReport,
): ArtifactBundleVerifyArtifact {
  return {
    ...integrity,
    diagnosticCount: integrity.diagnostics.length,
    integrity,
  };
}

/**
 * Verify the source log and generated artifact files against the byte counts
 * and SHA-256 hashes recorded in an artifact bundle manifest.
 */
export async function verifyArtifactBundleFiles(
  bundle: ArtifactBundleResult | unknown,
): Promise<ArtifactBundleVerificationResult> {
  const issues: ArtifactBundleVerificationIssue[] = [];
  const fileDigests = manifestFileDigests(bundle);
  if (!fileDigests) {
    return artifactBundleVerificationResult({
      ok: false,
      checkedFiles: 0,
      issues: [{
        file: "manifest",
        path: "",
        code: "invalid_manifest",
        message: "Artifact bundle manifest must include a fileDigests object",
      }],
    });
  }
  const inputDigest = manifestInputDigest(bundle);
  let checkedFiles = 0;
  if (!isArtifactBundleFileDigest(inputDigest)) {
    issues.push({
      file: "input",
      path: "",
      code: "invalid_manifest",
      message: "Artifact bundle manifest inputDigest must include path, bytes, and sha256",
    });
  } else {
    checkedFiles += 1;
    issues.push(...await verifyExpectedDigest("input", inputDigest));
  }
  for (const file of artifactDigestKeys) {
    const expected = fileDigests[file];
    if (!isArtifactBundleFileDigest(expected)) {
      issues.push({
        file,
        path: "",
        code: "invalid_manifest",
        message: `Artifact bundle manifest fileDigests.${file} must include path, bytes, and sha256`,
      });
      continue;
    }
    checkedFiles += 1;
    issues.push(...await verifyExpectedDigest(file, expected));
  }
  return artifactBundleVerificationResult({
    ok: issues.length === 0,
    checkedFiles,
    issues,
  });
}

function artifactBundleVerificationResult(
  result: Omit<ArtifactBundleVerificationResult, "version">,
): ArtifactBundleVerificationResult {
  return {
    version: "eventloom.artifact-bundle-verification.v1",
    ...result,
  };
}

function artifactBundleFiles(outDir: string): ArtifactBundleFiles {
  return {
    verify: join(outDir, "verify.json"),
    stats: join(outDir, "stats.json"),
    queryJson: join(outDir, "query.json"),
    inspectJson: join(outDir, "inspect.json"),
    visualizerJson: join(outDir, "visualizer.json"),
    visualizerHtml: join(outDir, "visualizer.html"),
    handoff: join(outDir, "handoff.md"),
    haloJsonl: join(outDir, "halo.jsonl"),
    otlpJson: join(outDir, "otlp-traces.json"),
    manifest: join(outDir, "manifest.json"),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeTextFileAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function artifactBundleFileDigests(files: ArtifactBundleFiles): Promise<ArtifactBundleFileDigests> {
  return {
    verify: await fileDigest(files.verify),
    stats: await fileDigest(files.stats),
    queryJson: await fileDigest(files.queryJson),
    inspectJson: await fileDigest(files.inspectJson),
    visualizerJson: await fileDigest(files.visualizerJson),
    visualizerHtml: await fileDigest(files.visualizerHtml),
    handoff: await fileDigest(files.handoff),
    haloJsonl: await fileDigest(files.haloJsonl),
    otlpJson: await fileDigest(files.otlpJson),
  };
}

async function fileDigest(path: string): Promise<ArtifactBundleFileDigest> {
  const [contents, metadata] = await Promise.all([
    readFile(path),
    stat(path),
  ]);
  return {
    path,
    bytes: metadata.size,
    sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
  };
}

const artifactDigestKeys = [
  "verify",
  "stats",
  "queryJson",
  "inspectJson",
  "visualizerJson",
  "visualizerHtml",
  "handoff",
  "haloJsonl",
  "otlpJson",
] as const satisfies readonly (keyof ArtifactBundleFileDigests)[];

async function readFileDigest(
  path: string,
  file: keyof ArtifactBundleFileDigests | "input",
): Promise<{ digest: ArtifactBundleFileDigest } | { issue: ArtifactBundleVerificationIssue }> {
  try {
    return { digest: await fileDigest(path) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        issue: {
          file,
          path,
          code: "missing_file",
          message: `Expected ${file} artifact at ${path} but the file does not exist`,
        },
      };
    }
    return {
      issue: {
        file,
        path,
        code: "unreadable_file",
        message: `Expected ${file} artifact at ${path} to be readable`,
      },
    };
  }
}

async function verifyExpectedDigest(
  file: keyof ArtifactBundleFileDigests | "input",
  expected: ArtifactBundleFileDigest,
): Promise<ArtifactBundleVerificationIssue[]> {
  const actual = await readFileDigest(expected.path, file);
  if ("issue" in actual) return [actual.issue];
  const issues: ArtifactBundleVerificationIssue[] = [];
  if (actual.digest.bytes !== expected.bytes) {
    issues.push({
      file,
      path: expected.path,
      code: "byte_count_mismatch",
      message: `Expected ${file} to contain ${expected.bytes} bytes but found ${actual.digest.bytes}`,
      expectedBytes: expected.bytes,
      actualBytes: actual.digest.bytes,
    });
  }
  if (actual.digest.sha256 !== expected.sha256) {
    issues.push({
      file,
      path: expected.path,
      code: "sha256_mismatch",
      message: `Expected ${file} digest ${expected.sha256} but found ${actual.digest.sha256}`,
      expectedSha256: expected.sha256,
      actualSha256: actual.digest.sha256,
    });
  }
  return issues;
}

async function writeTextFileAtomically(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(tempPath, "wx");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(tempPath, path);
    await syncContainingDirectory(path);
  } catch (error) {
    await unlink(tempPath).catch((cleanupError: unknown) => {
      if (!isNodeError(cleanupError) || cleanupError.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
}

async function syncContainingDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dirname(path), "r");
    await handle.sync();
  } catch (error) {
    if (isUnsupportedDirectorySyncError(error)) return;
    throw error;
  } finally {
    await handle?.close();
  }
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return isNodeError(error) && (error.code === "EINVAL" || error.code === "EISDIR" || error.code === "EPERM");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function manifestFileDigests(bundle: unknown): Partial<ArtifactBundleFileDigests> | undefined {
  if (!isRecord(bundle) || !isRecord(bundle.fileDigests)) return undefined;
  return bundle.fileDigests as Partial<ArtifactBundleFileDigests>;
}

function manifestInputDigest(bundle: unknown): unknown {
  return isRecord(bundle) ? bundle.inputDigest : undefined;
}

function isArtifactBundleFileDigest(value: unknown): value is ArtifactBundleFileDigest {
  if (!isRecord(value)) return false;
  const { bytes, path, sha256 } = value;
  return isRecord(value) &&
    typeof path === "string" &&
    typeof bytes === "number" &&
    Number.isInteger(bytes) &&
    bytes >= 0 &&
    typeof sha256 === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(sha256);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
