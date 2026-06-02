import {
  appendExternalEvent,
  buildEventLogInspectionModel,
  buildEventLogStats,
  buildEventQueryResult,
  buildMailboxModel,
  buildTaskExplanationModel,
  buildTimelineModel,
  buildVisualizerModel,
  buildMailbox,
  createRuntime,
  createHumanOpsRegistry,
  createResearchPipelineRegistry,
  createSoftwareWorkRegistry,
  diffRuntimeReplays,
  formatHaloJsonl,
  formatHandoffSummary,
  formatMailbox,
  formatOtlpJson,
  formatTaskExplanation,
  JsonlEventStore,
  pushOtlpJson,
  summarizeHandoff,
  verifyEventChain,
  type ActorRegistry,
  type BuiltInWorkflow,
  type EventEnvelope,
  type EventLogVerificationReport,
  type MailboxItem,
  type RuntimeReplay,
  writeArtifactBundle,
  type ArtifactBundleResult,
} from "@eventloom/runtime";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { resolveLogPath, type ServerConfig } from "./path-safety.js";

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

type ArtifactDigestKey = "verify" | "stats" | "queryJson" | "inspectJson" | "visualizerJson" | "visualizerHtml" | "handoff" | "haloJsonl" | "otlpJson";
type ArtifactVerificationFile = ArtifactDigestKey | "input";

interface ArtifactBundleVerificationIssue {
  file: ArtifactVerificationFile | "manifest";
  path: string;
  code: "invalid_manifest" | "missing_file" | "unreadable_file" | "byte_count_mismatch" | "sha256_mismatch";
  message: string;
  expectedBytes?: number;
  actualBytes?: number;
  expectedSha256?: `sha256:${string}`;
  actualSha256?: `sha256:${string}`;
}

interface ArtifactBundleVerificationResult {
  version: "eventloom.artifact-bundle-verification.v1";
  ok: boolean;
  checkedFiles: number;
  issues: ArtifactBundleVerificationIssue[];
}

export const AppendInputSchema = z.object({
  path: z.string().min(1),
  type: z.string().min(1),
  actorId: z.string().min(1).default("external"),
  threadId: z.string().min(1).default("thread_main"),
  parentEventId: z.string().min(1).nullable().optional(),
  causedBy: z.array(z.string().min(1)).default([]),
  payload: JsonObjectSchema.default({}),
});

export const ReplayInputSchema = z.object({
  path: z.string().min(1),
  verbose: z.boolean().default(false),
});

export const VerifyInputSchema = z.object({
  path: z.string().min(1),
});

export const RecoverInputSchema = z.object({
  path: z.string().min(1),
  out: z.string().min(1),
  quarantineTail: z.string().min(1).optional(),
});

export const DiffInputSchema = z.object({
  leftPath: z.string().min(1),
  rightPath: z.string().min(1),
});

export const StatsInputSchema = z.object({
  path: z.string().min(1),
});

export const InspectInputSchema = z.object({
  path: z.string().min(1),
  type: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  limit: z.number().optional(),
});

export const QueryInputSchema = z.object({
  path: z.string().min(1),
  type: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  limit: z.number().optional(),
});

export const TimelineInputSchema = z.object({
  path: z.string().min(1),
  limit: z.number().optional(),
});

export const ExplainTaskInputSchema = z.object({
  path: z.string().min(1),
  taskId: z.string().min(1),
});

export const HandoffInputSchema = z.object({
  path: z.string().min(1),
});

export const VisualizeInputSchema = z.object({
  path: z.string().min(1),
});

export const WriteArtifactsInputSchema = z.object({
  path: z.string().min(1),
  out: z.string().min(1),
  title: z.string().min(1).optional(),
});

export const VerifyArtifactsInputSchema = z.object({
  manifest: z.string().min(1),
});

export const BuiltInWorkflowSchema = z.enum(["software-work", "research-pipeline", "human-ops"]);

export const MailboxInputSchema = z.object({
  path: z.string().min(1),
  workflow: BuiltInWorkflowSchema.default("software-work"),
  actorId: z.string().min(1),
});

export const RunBuiltInInputSchema = z.object({
  path: z.string().min(1),
  workflow: BuiltInWorkflowSchema,
  resume: z.boolean().default(false),
  maxIterations: z.number().optional(),
});

/**
 * Stable MCP tool-input diagnostic thrown after SDK schema parsing but before
 * runtime side effects such as reading logs or calling collectors.
 */
export class ToolInputValidationError extends Error {
  readonly code = "invalid_tool_input";

  constructor(
    message: string,
    readonly path?: string,
    readonly option?: string,
    readonly value?: unknown,
    readonly suggestedAction = "Correct the tool arguments to match the Eventloom MCP schema.",
  ) {
    super(message);
    this.name = "ToolInputValidationError";
  }
}

export const ExportPathlightInputSchema = z.object({
  path: z.string().min(1),
  baseUrl: z.string().min(1).optional(),
  traceName: z.string().min(1).optional(),
});

export const ExportHaloInputSchema = z.object({
  path: z.string().min(1),
  out: z.string().min(1),
  projectId: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  traceName: z.string().min(1).optional(),
});

export const ExportOtlpInputSchema = z.object({
  path: z.string().min(1),
  out: z.string().min(1),
  endpoint: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  serviceVersion: z.string().min(1).optional(),
  traceName: z.string().min(1).optional(),
});

export type AppendInput = z.infer<typeof AppendInputSchema>;
export type ReplayInput = z.infer<typeof ReplayInputSchema>;
export type VerifyInput = z.infer<typeof VerifyInputSchema>;
export type RecoverInput = z.infer<typeof RecoverInputSchema>;
export type DiffInput = z.infer<typeof DiffInputSchema>;
export type StatsInput = z.infer<typeof StatsInputSchema>;
export type InspectInput = z.infer<typeof InspectInputSchema>;
export type QueryInput = z.infer<typeof QueryInputSchema>;
export type TimelineInput = z.infer<typeof TimelineInputSchema>;
export type ExplainTaskInput = z.infer<typeof ExplainTaskInputSchema>;
export type HandoffInput = z.infer<typeof HandoffInputSchema>;
export type VisualizeInput = z.infer<typeof VisualizeInputSchema>;
export type WriteArtifactsInput = z.infer<typeof WriteArtifactsInputSchema>;
export type VerifyArtifactsInput = z.infer<typeof VerifyArtifactsInputSchema>;
export type MailboxInput = z.infer<typeof MailboxInputSchema>;
export type RunBuiltInInput = z.infer<typeof RunBuiltInInputSchema>;
export type ExportPathlightInput = z.infer<typeof ExportPathlightInputSchema>;
export type ExportHaloInput = z.infer<typeof ExportHaloInputSchema>;
export type ExportOtlpInput = z.infer<typeof ExportOtlpInputSchema>;

export async function appendEvent(config: ServerConfig, input: AppendInput): Promise<CallToolResult> {
  const path = resolveLogPath(config, input.path);
  const event = await appendExternalEvent({
    path,
    eventStore: config.eventStore,
    type: input.type,
    actorId: input.actorId,
    threadId: input.threadId,
    parentEventId: input.parentEventId,
    causedBy: input.causedBy,
    payload: input.payload,
  });

  return toolResult({
    event: eventSummary(event),
    hash: event.integrity.hash,
    previousHash: event.integrity.previousHash,
  });
}

export async function replayLog(config: ServerConfig, input: ReplayInput): Promise<CallToolResult> {
  const replay = await createRuntime(resolveLogPath(config, input.path)).replay();
  const compact = compactReplay(replay);
  return toolResult(input.verbose ? { ...replay } : compact);
}

export async function verifyLog(config: ServerConfig, input: VerifyInput): Promise<CallToolResult> {
  const report = await createRuntime(resolveLogPath(config, input.path)).verify();
  return toolResult({ ...report });
}

export async function recoverLog(config: ServerConfig, input: RecoverInput): Promise<CallToolResult> {
  const store = new JsonlEventStore(resolveLogPath(config, input.path), config.eventStore);
  const result = await store.recoverVerifiedPrefix(resolveLogPath(config, input.out), {
    quarantinePath: input.quarantineTail ? resolveLogPath(config, input.quarantineTail) : undefined,
  });
  return toolResult({ ...result });
}

export async function diffLogs(config: ServerConfig, input: DiffInput): Promise<CallToolResult> {
  const left = await createRuntime(resolveLogPath(config, input.leftPath)).replay();
  const right = await createRuntime(resolveLogPath(config, input.rightPath)).replay();
  return toolResult({ ...diffRuntimeReplays(left, right) });
}

export async function stats(config: ServerConfig, input: StatsInput): Promise<CallToolResult> {
  const runtime = createRuntime(resolveLogPath(config, input.path));
  const snapshot = await runtime.store.readVerifiedSnapshot();
  return toolResult({ ...buildEventLogStats(snapshot.validEvents, snapshot.report) });
}

export async function inspectLog(config: ServerConfig, input: InspectInput): Promise<CallToolResult> {
  const limit = validatePositiveIntegerLimit("limit", input.limit, 1_000, input.path);
  const { events, report } = await readVerified(config, input.path);
  return toolResult({ ...buildEventLogInspectionModel(events, report, {
    type: input.type,
    actorId: input.actorId,
    threadId: input.threadId,
    limit,
  }) });
}

export async function queryLog(config: ServerConfig, input: QueryInput): Promise<CallToolResult> {
  const limit = validatePositiveIntegerLimit("limit", input.limit, 1_000, input.path);
  const { events, report } = await readVerified(config, input.path);
  return toolResult({ ...buildEventQueryResult(events, {
    type: input.type,
    actorId: input.actorId,
    threadId: input.threadId,
    limit,
  }, report) });
}

export async function timeline(config: ServerConfig, input: TimelineInput): Promise<CallToolResult> {
  const limit = validatePositiveIntegerLimit("limit", input.limit, 500, input.path);
  const { events, report } = await readVerified(config, input.path);
  const selectedEvents = limit ? events.slice(-limit) : events;
  return toolResult({
    text: formatTimelineForMcp(selectedEvents, report),
    ...buildTimelineModel(selectedEvents, report),
  });
}

function validatePositiveIntegerLimit(option: string, value: number | undefined, max: number, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new ToolInputValidationError(
      `${option} must be a positive integer no greater than ${max}`,
      path,
      option,
      value,
      `Use a positive integer no greater than ${max} for MCP result limits.`,
    );
  }
  return value;
}

export async function explainTask(config: ServerConfig, input: ExplainTaskInput): Promise<CallToolResult> {
  const { events, report } = await readVerified(config, input.path);
  const model = buildTaskExplanationModel(events, input.taskId);
  return toolResult({
    text: formatTaskExplanation(events, input.taskId),
    integrity: report,
    ...model,
  });
}

export async function handoff(config: ServerConfig, input: HandoffInput): Promise<CallToolResult> {
  const { events, report } = await readVerified(config, input.path);
  const summary = summarizeHandoff(events, report);
  return toolResult({
    text: formatHandoffSummary(summary),
    version: "eventloom.handoff.v1",
    ...summary,
  });
}

export async function visualize(config: ServerConfig, input: VisualizeInput): Promise<CallToolResult> {
  const { events, report } = await readVerified(config, input.path);
  const model = buildVisualizerModel(events);
  return toolResult({
    ...model,
    replay: {
      ...model.replay,
      integrity: report,
    },
    handoff: {
      ...model.handoff,
      integrity: report,
    },
  });
}

export async function writeArtifacts(config: ServerConfig, input: WriteArtifactsInput): Promise<CallToolResult> {
  const result = await writeArtifactBundle({
    inputPath: resolveLogPath(config, input.path),
    outDir: resolveLogPath(config, input.out),
    title: input.title,
  });
  return toolResult({ ...result });
}

export async function verifyArtifacts(config: ServerConfig, input: VerifyArtifactsInput): Promise<CallToolResult> {
  const manifestPath = resolveLogPath(config, input.manifest);
  const manifestRead = await readArtifactManifest(manifestPath);
  if ("verification" in manifestRead) return toolResult({ manifestPath, ...manifestRead.verification });
  const manifest = manifestRead.manifest;
  if (hasManifestFileDigests(manifest)) {
    for (const digest of Object.values(manifest.fileDigests)) {
      if (isManifestFileDigest(digest)) resolveLogPath(config, digest.path);
    }
  }
  const inputDigest = manifestInputDigest(manifest);
  if (isManifestFileDigest(inputDigest)) resolveLogPath(config, inputDigest.path);
  const result = await verifyArtifactBundleFilesLocal(manifest);
  return toolResult({ manifestPath, ...result });
}

async function readArtifactManifest(path: string): Promise<
  | { manifest: unknown }
  | { verification: ArtifactBundleVerificationResult }
> {
  try {
    return { manifest: JSON.parse(await readFile(path, "utf8")) as unknown };
  } catch (error) {
    return { verification: invalidArtifactBundleManifest(path, artifactManifestReadMessage(error)) };
  }
}

export async function mailbox(config: ServerConfig, input: MailboxInput): Promise<CallToolResult> {
  const { events, report } = await readVerified(config, input.path);
  const items = buildMailbox(registryForWorkflow(input.workflow as BuiltInWorkflow), input.actorId, events);
  return toolResult({
    text: formatMailbox(input.actorId, items),
    integrity: report,
    ...buildMailboxModel(input.actorId, items),
  });
}

export async function runBuiltIn(config: ServerConfig, input: RunBuiltInInput): Promise<CallToolResult> {
  const path = resolveLogPath(config, input.path);
  const runtime = createRuntime(path);
  const result = await runtime.runBuiltIn(input.workflow as BuiltInWorkflow, {
    resume: input.resume,
    maxIterations: input.maxIterations,
    eventStore: config.eventStore,
  });
  return toolResult({
    ...result,
    ...compactReplay(await runtime.replay()),
  });
}

export async function exportPathlight(config: ServerConfig, input: ExportPathlightInput): Promise<CallToolResult> {
  const baseUrl = validateHttpUrlInput(pathlightBaseUrl(input.baseUrl), input.path);
  const runtime = createRuntime(resolveLogPath(config, input.path));
  return toolResult({ ...await runtime.exportPathlight({
    baseUrl,
    traceName: input.traceName,
  }) });
}

export async function exportHalo(config: ServerConfig, input: ExportHaloInput): Promise<CallToolResult> {
  const runtime = createRuntime(resolveLogPath(config, input.path));
  const outputPath = resolveLogPath(config, input.out);
  const result = await runtime.exportHalo({
    projectId: input.projectId,
    serviceName: input.serviceName,
    traceName: input.traceName,
  });
  await writeTextFileAtomically(outputPath, formatHaloJsonl(result) + "\n");

  return toolResult({
    version: result.version,
    outputPath,
    traceId: result.traceId,
    eventCount: result.exportedEventCount,
    exportedEventCount: result.exportedEventCount,
    validPrefixCount: result.validPrefixCount,
    integrity: result.integrity,
    spanCount: result.spanCount,
  });
}

export async function exportOtlp(config: ServerConfig, input: ExportOtlpInput): Promise<CallToolResult> {
  const runtime = createRuntime(resolveLogPath(config, input.path));
  const outputPath = resolveLogPath(config, input.out);
  const result = await runtime.exportOtlp({
    serviceName: input.serviceName,
    serviceVersion: input.serviceVersion,
    traceName: input.traceName,
  });
  await writeTextFileAtomically(outputPath, formatOtlpJson(result));
  const delivery = input.endpoint
    ? await pushOtlpJson(result, { endpoint: input.endpoint })
    : undefined;

  return toolResult({
    version: result.version,
    outputPath,
    endpoint: delivery?.endpoint,
    status: delivery?.status,
    traceCount: result.traceCount,
    spanCount: result.spanCount,
    exportedEventCount: result.exportedEventCount,
    validPrefixCount: result.validPrefixCount,
    integrity: result.integrity,
  });
}

async function readVerified(
  config: ServerConfig,
  path: string,
): Promise<{ events: EventEnvelope[]; report: EventLogVerificationReport }> {
  const runtime = createRuntime(resolveLogPath(config, path));
  const snapshot = await runtime.store.readVerifiedSnapshot();
  return { events: snapshot.validEvents, report: snapshot.report };
}

function compactReplay(replay: RuntimeReplay): Record<string, unknown> {
  return {
    version: replay.version,
    eventCount: replay.eventCount,
    integrity: replay.integrity,
    projectionHash: replay.projectionHash,
  };
}

function formatTimelineForMcp(
  events: readonly EventEnvelope[],
  integrity: EventLogVerificationReport | ReturnType<typeof verifyEventChain>,
): string {
  const lines = [
    `integrity: ${integrity.ok ? "ok" : "failed"}`,
    "",
    ...events.map((event, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      const parent = event.parentEventId ? ` parent=${event.parentEventId}` : "";
      return `${ordinal} ${event.id} ${event.actorId} ${event.type}${parent}`;
    }),
  ];

  if (!integrity.ok) {
    lines.push("", "integrity errors:");
    for (const error of integrity.errors) {
      lines.push(`- ${error.eventId}: ${error.message}`);
    }
  }

  return lines.join("\n");
}

function registryForWorkflow(workflow: BuiltInWorkflow): ActorRegistry {
  if (workflow === "software-work") return createSoftwareWorkRegistry();
  if (workflow === "research-pipeline") return createResearchPipelineRegistry();
  return createHumanOpsRegistry();
}

function eventSummary(event: EventEnvelope): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    threadId: event.threadId,
    timestamp: event.timestamp,
    parentEventId: event.parentEventId,
    causedBy: event.causedBy,
    payload: event.payload,
  };
}

function toolResult(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function hasManifestFileDigests(value: unknown): value is { fileDigests: Record<string, unknown> } {
  return isRecord(value) && isRecord(value.fileDigests);
}

function isManifestFileDigest(value: unknown): value is { path: string } {
  return isRecord(value) && typeof value.path === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function verifyArtifactBundleFilesLocal(manifest: unknown): Promise<ArtifactBundleVerificationResult> {
  const fileDigests = manifestFileDigests(manifest);
  if (!fileDigests) return invalidArtifactBundleManifest("", "Artifact bundle manifest must include a fileDigests object");
  const issues: ArtifactBundleVerificationIssue[] = [];
  const inputDigest = manifestInputDigest(manifest);
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
  return artifactBundleVerificationResult({ ok: issues.length === 0, checkedFiles, issues });
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
] as const satisfies readonly ArtifactDigestKey[];

function manifestFileDigests(manifest: unknown): Partial<Record<ArtifactDigestKey, unknown>> | undefined {
  if (!isRecord(manifest) || !isRecord(manifest.fileDigests)) return undefined;
  return manifest.fileDigests as Partial<Record<ArtifactDigestKey, unknown>>;
}

function manifestInputDigest(manifest: unknown): unknown {
  return isRecord(manifest) ? manifest.inputDigest : undefined;
}

function isArtifactBundleFileDigest(value: unknown): value is { path: string; bytes: number; sha256: `sha256:${string}` } {
  if (!isRecord(value)) return false;
  const { bytes, path, sha256 } = value;
  return typeof path === "string" &&
    typeof bytes === "number" &&
    Number.isInteger(bytes) &&
    bytes >= 0 &&
    typeof sha256 === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(sha256);
}

async function readFileDigest(
  path: string,
  file: ArtifactVerificationFile,
): Promise<{ digest: { path: string; bytes: number; sha256: `sha256:${string}` } } | { issue: ArtifactBundleVerificationIssue }> {
  try {
    const [contents, metadata] = await Promise.all([
      readFile(path),
      stat(path),
    ]);
    return {
      digest: {
        path,
        bytes: metadata.size,
        sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
      },
    };
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
  file: ArtifactVerificationFile,
  expected: { path: string; bytes: number; sha256: `sha256:${string}` },
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

function artifactManifestReadMessage(error: unknown): string {
  if (error instanceof SyntaxError) return `Artifact bundle manifest is not valid JSON: ${error.message}`;
  if (error instanceof Error) return `Artifact bundle manifest could not be read: ${error.message}`;
  return `Artifact bundle manifest could not be read: ${String(error)}`;
}

function invalidArtifactBundleManifest(path: string, message: string): ArtifactBundleVerificationResult {
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

function artifactBundleVerificationResult(
  result: Omit<ArtifactBundleVerificationResult, "version">,
): ArtifactBundleVerificationResult {
  return {
    version: "eventloom.artifact-bundle-verification.v1",
    ...result,
  };
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

function validateHttpUrlInput(value: string, path: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ToolInputValidationError(
      "baseUrl must be an absolute HTTP(S) URL",
      path,
      "baseUrl",
      value,
      "Use an absolute http:// or https:// URL for the Pathlight collector.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ToolInputValidationError(
      "baseUrl must be an absolute HTTP(S) URL",
      path,
      "baseUrl",
      value,
      "Use an absolute http:// or https:// URL for the Pathlight collector.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

function pathlightBaseUrl(value: string | undefined): string {
  return value ?? process.env.EVENTLOOM_PATHLIGHT_BASE_URL ?? "http://localhost:4100";
}
