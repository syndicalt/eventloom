#!/usr/bin/env node
import { EventStoreAppendError, EventStoreLockError, EventStoreOptionsError, EventStoreReadError, EventStoreRecoveryError, HaloExportError, OtlpExportError, PathlightExportError, RuntimeOptionsError, RuntimeProjectionError, RuntimeRunnerError } from "@eventloom/runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError, type z } from "zod";
import {
  AppendInputSchema,
  DiffInputSchema,
  ExplainTaskInputSchema,
  ExportHaloInputSchema,
  ExportOtlpInputSchema,
  ExportPathlightInputSchema,
  HandoffInputSchema,
  InspectInputSchema,
  MailboxInputSchema,
  QueryInputSchema,
  RecoverInputSchema,
  ReplayInputSchema,
  RunBuiltInInputSchema,
  StatsInputSchema,
  TimelineInputSchema,
  ToolInputValidationError,
  VerifyInputSchema,
  VerifyArtifactsInputSchema,
  VisualizeInputSchema,
  WriteArtifactsInputSchema,
  appendEvent,
  diffLogs,
  explainTask,
  exportHalo,
  exportOtlp,
  exportPathlight,
  handoff,
  inspectLog,
  mailbox,
  queryLog,
  recoverLog,
  replayLog,
  runBuiltIn,
  stats,
  timeline,
  verifyLog,
  verifyArtifacts,
  visualize,
  writeArtifacts,
} from "./tools.js";
import { createServerConfig, PathSafetyError, ServerConfigOptionsError } from "./path-safety.js";
import { EVENTLOOM_MCP_VERSION } from "./version.js";

/**
 * Stable startup diagnostic for invalid MCP stdio CLI arguments.
 */
export class ServerCliOptionsError extends Error {
  readonly code = "invalid_mcp_server_option";

  constructor(
    message: string,
    readonly option: string,
    readonly value?: unknown,
    readonly suggestedAction = "Use --root, --lock-timeout-ms, or --lock-retry-ms with valid option values.",
  ) {
    super(message);
    this.name = "ServerCliOptionsError";
  }
}

export function createEventloomMcpServer(options: Parameters<typeof createServerConfig>[0] = {}): McpServer {
  const config = createServerConfig(options);
  const server = new McpServer({
    name: "eventloom",
    version: EVENTLOOM_MCP_VERSION,
  });

  server.registerTool(
    "eventloom_append",
    {
      title: "Append Eventloom Event",
      description: "Append one sealed external event to a local Eventloom JSONL log.",
      inputSchema: AppendInputSchema.shape,
    },
    (input) => safeTool(input, AppendInputSchema, (parsed) => appendEvent(config, parsed)),
  );

  server.registerTool(
    "eventloom_replay",
    {
      title: "Replay Eventloom Log",
      description: "Replay a local Eventloom JSONL log and return integrity and projection status.",
      inputSchema: ReplayInputSchema.shape,
    },
    (input) => safeTool(input, ReplayInputSchema, (parsed) => replayLog(config, parsed)),
  );

  server.registerTool(
    "eventloom_verify",
    {
      title: "Verify Eventloom Log",
      description: "Stream-verify a local Eventloom JSONL log and return structured integrity diagnostics.",
      inputSchema: VerifyInputSchema.shape,
    },
    (input) => safeTool(input, VerifyInputSchema, (parsed) => verifyLog(config, parsed)),
  );

  server.registerTool(
    "eventloom_recover",
    {
      title: "Recover Eventloom Log",
      description: "Write a damaged log's verified prefix to a separate JSONL path, with optional tail quarantine.",
      inputSchema: RecoverInputSchema.shape,
    },
    (input) => safeTool(input, RecoverInputSchema, (parsed) => recoverLog(config, parsed)),
  );

  server.registerTool(
    "eventloom_diff",
    {
      title: "Diff Eventloom Replays",
      description: "Replay two local Eventloom JSONL logs and return structured projection differences.",
      inputSchema: DiffInputSchema.shape,
    },
    (input) => safeTool(input, DiffInputSchema, (parsed) => diffLogs(config, parsed)),
  );

  server.registerTool(
    "eventloom_stats",
    {
      title: "Eventloom Log Stats",
      description: "Return structured counts, integrity, and projection hash for a local Eventloom JSONL log.",
      inputSchema: StatsInputSchema.shape,
    },
    (input) => safeTool(input, StatsInputSchema, (parsed) => stats(config, parsed)),
  );

  server.registerTool(
    "eventloom_inspect",
    {
      title: "Inspect Eventloom Log",
      description: "Return a consolidated integrity, stats, timeline, and handoff inspection model for a local Eventloom JSONL log.",
      inputSchema: InspectInputSchema.shape,
    },
    (input) => safeTool(input, InspectInputSchema, (parsed) => inspectLog(config, parsed)),
  );

  server.registerTool(
    "eventloom_query",
    {
      title: "Query Eventloom Events",
      description: "Return filtered Eventloom event summaries from the verified prefix of a local JSONL log.",
      inputSchema: QueryInputSchema.shape,
    },
    (input) => safeTool(input, QueryInputSchema, (parsed) => queryLog(config, parsed)),
  );

  server.registerTool(
    "eventloom_timeline",
    {
      title: "Eventloom Timeline",
      description: "Return ordered Eventloom event history for a local JSONL log.",
      inputSchema: TimelineInputSchema.shape,
    },
    (input) => safeTool(input, TimelineInputSchema, (parsed) => timeline(config, parsed)),
  );

  server.registerTool(
    "eventloom_explain_task",
    {
      title: "Explain Eventloom Task",
      description: "Explain one projected task lifecycle from a local Eventloom JSONL log.",
      inputSchema: ExplainTaskInputSchema.shape,
    },
    (input) => safeTool(input, ExplainTaskInputSchema, (parsed) => explainTask(config, parsed)),
  );

  server.registerTool(
    "eventloom_mailbox",
    {
      title: "Eventloom Actor Mailbox",
      description: "Rebuild one actor mailbox from a local Eventloom JSONL log.",
      inputSchema: MailboxInputSchema.shape,
    },
    (input) => safeTool(input, MailboxInputSchema, (parsed) => mailbox(config, parsed)),
  );

  server.registerTool(
    "eventloom_summarize_handoff",
    {
      title: "Summarize Eventloom Handoff",
      description: "Summarize goals, tasks, decisions, verification, and next actions from a local Eventloom log.",
      inputSchema: HandoffInputSchema.shape,
    },
    (input) => safeTool(input, HandoffInputSchema, (parsed) => handoff(config, parsed)),
  );

  server.registerTool(
    "eventloom_visualize",
    {
      title: "Build Eventloom Visualizer Model",
      description: "Build Capture, Replay, and Handoff visualizer output from a local Eventloom JSONL log.",
      inputSchema: VisualizeInputSchema.shape,
    },
    (input) => safeTool(input, VisualizeInputSchema, (parsed) => visualize(config, parsed)),
  );

  server.registerTool(
    "eventloom_write_artifacts",
    {
      title: "Write Eventloom Artifact Bundle",
      description: "Write verification, stats, inspect, visualizer, HALO, OTLP, handoff, and manifest artifacts from a local Eventloom JSONL log.",
      inputSchema: WriteArtifactsInputSchema.shape,
    },
    (input) => safeTool(input, WriteArtifactsInputSchema, (parsed) => writeArtifacts(config, parsed)),
  );

  server.registerTool(
    "eventloom_verify_artifacts",
    {
      title: "Verify Eventloom Artifact Bundle",
      description: "Verify the source log and generated artifact files against an Eventloom artifact bundle manifest's byte counts and SHA-256 digests.",
      inputSchema: VerifyArtifactsInputSchema.shape,
    },
    (input) => safeTool(input, VerifyArtifactsInputSchema, (parsed) => verifyArtifacts(config, parsed)),
  );

  server.registerTool(
    "eventloom_run_builtin",
    {
      title: "Run Built-In Eventloom Workflow",
      description: "Run or resume a built-in deterministic Eventloom workflow.",
      inputSchema: RunBuiltInInputSchema.shape,
    },
    (input) => safeTool(input, RunBuiltInInputSchema, (parsed) => runBuiltIn(config, parsed)),
  );

  server.registerTool(
    "eventloom_export_pathlight",
    {
      title: "Export Eventloom Log To Pathlight",
      description: "Export a local Eventloom JSONL log to a Pathlight collector.",
      inputSchema: ExportPathlightInputSchema.shape,
    },
    (input) => safeTool(input, ExportPathlightInputSchema, (parsed) => exportPathlight(config, parsed)),
  );

  server.registerTool(
    "eventloom_export_halo",
    {
      title: "Export Eventloom Log To HALO",
      description: "Export a local Eventloom JSONL log to a HALO-compatible OpenTelemetry JSONL trace file.",
      inputSchema: ExportHaloInputSchema.shape,
    },
    (input) => safeTool(input, ExportHaloInputSchema, (parsed) => exportHalo(config, parsed)),
  );

  server.registerTool(
    "eventloom_export_otlp",
    {
      title: "Export Eventloom Log To OTLP",
      description: "Export a local Eventloom JSONL log to generic OpenTelemetry OTLP trace JSON, with optional HTTP delivery.",
      inputSchema: ExportOtlpInputSchema.shape,
    },
    (input) => safeTool(input, ExportOtlpInputSchema, (parsed) => exportOtlp(config, parsed)),
  );

  return server;
}

async function safeTool<TSchema extends z.ZodTypeAny>(
  input: unknown,
  schema: TSchema,
  run: (parsed: z.infer<TSchema>) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await run(schema.parse(input));
  } catch (error) {
    return toolErrorResult(error, input);
  }
}

function toolErrorResult(error: unknown, input: unknown): CallToolResult {
  const value = { error: toolError(error, input) };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(error: unknown, input: unknown): Record<string, unknown> {
  if (error instanceof EventStoreAppendError) {
    const diagnostic = error.report.diagnostics[0];
    return compactError({
      code: diagnostic?.code ?? "event_store_append_failed",
      message: diagnostic?.message ?? error.message,
      path: error.path,
      eventId: diagnostic?.eventId,
      line: diagnostic?.line,
      suggestedAction: suggestedActionForCode(diagnostic?.code),
    });
  }
  if (error instanceof EventStoreReadError) {
    return compactError({
      code: "event_store_read_failed",
      message: error.message,
      path: error.path,
      line: error.line,
      suggestedAction: "Run eventloom_verify for detailed log diagnostics.",
    });
  }
  if (error instanceof EventStoreLockError) {
    return compactError({
      code: "event_store_lock_timeout",
      message: error.message,
      path: error.path,
      suggestedAction: "Wait for the active writer to finish, then retry the tool call.",
    });
  }
  if (error instanceof EventStoreOptionsError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: pathFromInput(input),
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  if (error instanceof EventStoreRecoveryError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: error.path,
      suggestedAction: error.suggestedAction,
    });
  }
  if (error instanceof PathlightExportError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: pathFromInput(input),
      url: error.url,
      status: error.status,
      suggestedAction: error.suggestedAction,
    });
  }
  if (error instanceof HaloExportError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: pathFromInput(input),
      suggestedAction: error.suggestedAction,
    });
  }
  if (error instanceof OtlpExportError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: pathFromInput(input),
      endpoint: error.endpoint,
      status: error.status,
      suggestedAction: error.suggestedAction,
    });
  }
  if (error instanceof RuntimeProjectionError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: pathFromInput(input),
      workflow: error.workflow,
      projectionKind: error.projectionKind,
      projectionErrors: error.errors,
      suggestedAction: "Inspect or recover the workflow log before resuming the built-in runtime.",
    });
  }
  if (error instanceof RuntimeOptionsError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: pathFromInput(input),
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  if (error instanceof RuntimeRunnerError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: pathFromInput(input),
      actorId: error.actorId,
      turnId: error.turnId,
      sourceEventId: error.sourceEventId,
      causeMessage: error.causeMessage,
      suggestedAction: "Inspect the actor runner failure and retry after correcting the workflow implementation or input log.",
    });
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const option = issue ? formatIssuePath(issue.path) : undefined;
    return compactError({
      code: "invalid_tool_input",
      message: error.issues.map((issue) => issue.message).join(", "),
      path: pathFromInput(input),
      option,
      value: option ? valueFromInputPath(input, issue?.path ?? []) : undefined,
      suggestedAction: "Correct the tool arguments to match the Eventloom MCP schema.",
    });
  }
  if (error instanceof ToolInputValidationError) {
    return compactError({
      code: error.code,
      message: error.message,
      path: error.path ?? pathFromInput(input),
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  if (error instanceof PathSafetyError) {
    return compactError({
      code: "path_outside_root",
      message: error.message,
      path: error.path,
      suggestedAction: "Use a path inside the configured Eventloom MCP root.",
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("outside the configured Eventloom root")) {
    return compactError({
      code: "path_outside_root",
      message,
      path: pathFromInput(input),
      suggestedAction: "Use a path inside the configured Eventloom MCP root.",
    });
  }

  return compactError({
    code: "eventloom_tool_error",
    message,
    path: pathFromInput(input),
    suggestedAction: "Inspect the error details and retry after correcting the tool input or log.",
  });
}

function compactError(error: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(error).filter(([, value]) => value !== undefined));
}

function suggestedActionForCode(code: string | undefined): string {
  if (code === "duplicate_event_id") return "Use a unique event id or recover the log before appending.";
  if (code === "malformed_json" || code === "partial_trailing_line" || code === "invalid_event") {
    return "Recover the verified prefix to a separate log before writing more events.";
  }
  if (code?.endsWith("_mismatch") || code === "missing_integrity") {
    return "Inspect the log for tampering or restore it from a trusted copy.";
  }
  return "Inspect the structured diagnostics and retry after correcting the log.";
}

function pathFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  for (const key of ["path", "leftPath", "rightPath", "out", "manifest"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return undefined;
}

function formatIssuePath(path: PropertyKey[]): string | undefined {
  if (path.length === 0) return undefined;
  return path.map((part) => String(part)).join(".");
}

function valueFromInputPath(input: unknown, path: PropertyKey[]): unknown {
  let current = input;
  for (const part of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  return current;
}

export async function runStdioServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  const server = createEventloomMcpServer(parseServerCliOptions(argv));
  await server.connect(new StdioServerTransport());
  setInterval(() => undefined, 2_147_483_647);
  process.stdin.resume();
}

export function parseServerCliOptions(argv: readonly string[]): Parameters<typeof createServerConfig>[0] {
  const options: Parameters<typeof createServerConfig>[0] = {};
  const eventStore: NonNullable<Parameters<typeof createServerConfig>[0]>["eventStore"] = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag !== "--root" && flag !== "--lock-timeout-ms" && flag !== "--lock-retry-ms") {
      throw new ServerCliOptionsError(`Unknown MCP option ${flag}`, flag);
    }
    if (!isOptionValue(value)) throw new ServerCliOptionsError(`Missing value for ${flag}`, flag, value);

    if (flag === "--root") options.root = value;
    else if (flag === "--lock-timeout-ms") eventStore.lockTimeoutMs = parseNonNegativeIntegerFlag(flag, value);
    else eventStore.lockRetryMs = parseNonNegativeIntegerFlag(flag, value);
    index += 1;
  }

  if (eventStore.lockTimeoutMs !== undefined || eventStore.lockRetryMs !== undefined) {
    options.eventStore = eventStore;
  }
  return options;
}

function isOptionValue(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("--");
}

function parseNonNegativeIntegerFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ServerConfigOptionsError(flag, value);
  }
  return parsed;
}
