#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { invalidArtifactBundleManifest, verifyArtifactBundleFiles, writeArtifactBundle, type ArtifactBundleResult, type ArtifactBundleVerificationResult } from "./artifacts.js";
import { createBuiltInRegistry } from "./actors.js";
import { EventStoreAppendError, EventStoreLockError, EventStoreReadError, EventStoreRecoveryError, JsonlEventStore } from "./event-store.js";
import { EventValidationError, type EventValidationIssue } from "./events.js";
import { exportToHalo, formatHaloJsonl, HaloExportError } from "./export/halo.js";
import { exportToOtlp, formatOtlpJson, OtlpExportError, pushOtlpJson } from "./export/otlp.js";
import { exportToPathlight, PathlightExportError } from "./export/pathlight.js";
import { formatHandoffSummary, summarizeHandoff } from "./handoff.js";
import { appendExternalEvent, JsonPayloadParseError, parseJsonPayload } from "./ingest.js";
import { buildEventLogInspectionModel, buildMailboxModel, buildTaskExplanationModel, buildTimelineModel, formatMailbox, formatTaskExplanation, formatTimeline } from "./inspect.js";
import { buildMailbox } from "./mailbox.js";
import { diffRuntimeReplays } from "./projection-diff.js";
import { buildEventLogStats, buildEventQueryResult, type EventQuery } from "./query.js";
import { runSoftwareWorkDemo } from "./demo.js";
import { createRuntime } from "./runtime.js";
import { RuntimeOptionsError, RuntimeProjectionError, RuntimeRunnerError, runHumanOpsRuntime, runResearchPipelineRuntime, runSoftwareWorkRuntime } from "./runners.js";
import { formatAgentWorkflowTemplate, formatAgentWorkflowTemplates, getAgentWorkflowTemplate } from "./templates.js";
import { buildVisualizerModel, renderVisualizerHtml, type VisualizerModel } from "./visualizer.js";

type BuiltInRunWorkflow = "software-work" | "research-pipeline" | "human-ops";

interface BuiltInRunOptions {
  path: string;
  resume: boolean;
  maxIterations?: number;
}

interface TimelineOptions {
  json: boolean;
  limit?: number;
}

class CliOptionsError extends Error {
  readonly code = "invalid_cli_option";

  constructor(
    readonly option: string,
    readonly value: unknown,
    requirement = "a non-negative integer",
    readonly suggestedAction = "Check the command arguments and run eventloom help for usage.",
    message?: string,
  ) {
    super(message ?? `${option} must be ${requirement}`);
    this.name = "CliOptionsError";
  }
}

async function writeTextFileCreatingParents(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function main(argv: string[]): Promise<void> {
  const [command, path, extra, rest] = argv;

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage(console.log);
    return;
  }

  if (command === "append" && path && extra) {
    const options = parseAppendOptions(argv.slice(3));
    const event = await appendExternalEvent({
      path,
      eventStore: eventStoreOptionsFromEnv(),
      id: options.id,
      type: extra,
      actorId: options.actorId,
      threadId: options.threadId,
      parentEventId: options.parentEventId,
      causedBy: options.causedBy,
      payload: parseJsonPayload(options.payload),
    });
    console.log(JSON.stringify({
      id: event.id,
      hash: event.integrity.hash,
      previousHash: event.integrity.previousHash,
    }, null, 2));
    return;
  }

  if (command === "demo" && path === "software-work") {
    const outPath = parseDemoPath(argv.slice(2));
    await runSoftwareWorkDemo(outPath);
    console.log(JSON.stringify({ path: outPath }, null, 2));
    return;
  }

  if (command === "run" && path === "software-work") {
    const options = parseBuiltInRunOptions("software-work", argv.slice(2));
    const outPath = options.path;
    const result = await runSoftwareWorkRuntime(outPath, {
      resume: options.resume,
      maxIterations: options.maxIterations,
      eventStore: eventStoreOptionsFromEnv(),
    });
    console.log(JSON.stringify({ path: outPath, ...result }, null, 2));
    return;
  }

  if (command === "run" && path === "research-pipeline") {
    const options = parseBuiltInRunOptions("research-pipeline", argv.slice(2));
    const outPath = options.path;
    const result = await runResearchPipelineRuntime(outPath, {
      resume: options.resume,
      maxIterations: options.maxIterations,
      eventStore: eventStoreOptionsFromEnv(),
    });
    console.log(JSON.stringify({ path: outPath, ...result }, null, 2));
    return;
  }

  if (command === "run" && path === "human-ops") {
    const options = parseBuiltInRunOptions("human-ops", argv.slice(2));
    const outPath = options.path;
    const result = await runHumanOpsRuntime(outPath, {
      resume: options.resume,
      maxIterations: options.maxIterations,
      eventStore: eventStoreOptionsFromEnv(),
    });
    console.log(JSON.stringify({ path: outPath, ...result }, null, 2));
    return;
  }

  if (command === "export" && path === "pathlight" && extra) {
    const options = parseExportOptions(argv.slice(3));
    const snapshot = await readVerifiedEvents(extra);
    const result = await exportToPathlight(snapshot.validEvents, {
      baseUrl: options.baseUrl,
      traceName: options.traceName,
      integrityReport: snapshot.report,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "export" && path === "halo" && extra) {
    const options = parseHaloExportOptions(argv.slice(3));
    const snapshot = await readVerifiedEvents(extra);
    const result = await exportToHalo(snapshot.validEvents, {
      projectId: options.projectId,
      serviceName: options.serviceName,
      traceName: options.traceName,
      integrityReport: snapshot.report,
    });
    await writeTextFileCreatingParents(options.out, formatHaloJsonl(result));
    console.log(JSON.stringify({
      version: result.version,
      out: options.out,
      projectId: result.projectId,
      traceId: result.traceId,
      traceCount: result.traceCount,
      spanCount: result.spanCount,
      exportedEventCount: result.exportedEventCount,
      validPrefixCount: result.validPrefixCount,
      integrity: result.integrity,
    }, null, 2));
    return;
  }

  if (command === "export" && path === "otlp" && extra) {
    const options = parseOtlpExportOptions(argv.slice(3));
    const snapshot = await readVerifiedEvents(extra);
    const result = await exportToOtlp(snapshot.validEvents, {
      serviceName: options.serviceName,
      serviceVersion: options.serviceVersion,
      traceName: options.traceName,
      integrityReport: snapshot.report,
    });
    await writeTextFileCreatingParents(options.out, formatOtlpJson(result));
    const delivery = options.endpoint
      ? await pushOtlpJson(result, { endpoint: options.endpoint })
      : undefined;
    console.log(JSON.stringify({
      version: result.version,
      out: options.out,
      endpoint: delivery?.endpoint,
      status: delivery?.status,
      traceCount: result.traceCount,
      spanCount: result.spanCount,
      exportedEventCount: result.exportedEventCount,
      validPrefixCount: result.validPrefixCount,
      integrity: result.integrity,
    }, null, 2));
    return;
  }

  if (command === "timeline" && path) {
    const options = parseTimelineOptions(argv.slice(2));
    const snapshot = await readVerifiedEvents(path);
    const events = options.limit ? snapshot.validEvents.slice(-options.limit) : snapshot.validEvents;
    if (options.json) {
      console.log(JSON.stringify({
        ...buildTimelineModel(events, snapshot.report),
        integrity: snapshot.report,
      }, null, 2));
      return;
    }
    console.log(formatVerifiedTimeline(events, snapshot.report));
    return;
  }

  if (command === "explain" && path === "task" && extra && rest) {
    const options = parseJsonOutputOptions("explain", argv.slice(4));
    const snapshot = await readVerifiedEvents(rest);
    if (options.json) {
      console.log(JSON.stringify({
        ...buildTaskExplanationModel(snapshot.validEvents, extra),
        integrity: snapshot.report,
      }, null, 2));
      return;
    }
    console.log(formatTaskExplanation(snapshot.validEvents, extra));
    return;
  }

  if (command === "mailbox" && path && extra) {
    const options = parseJsonOutputOptions("mailbox", argv.slice(3));
    const snapshot = await readVerifiedEvents(extra);
    const items = buildMailbox(createBuiltInRegistry("software-work"), path, snapshot.validEvents);
    if (options.json) {
      console.log(JSON.stringify({
        ...buildMailboxModel(path, items),
        integrity: snapshot.report,
      }, null, 2));
      return;
    }
    console.log(formatMailbox(path, items));
    return;
  }

  if (command === "handoff" && path) {
    const options = parseJsonOutputOptions("handoff", argv.slice(2));
    const snapshot = await readVerifiedEvents(path);
    const summary = summarizeHandoff(snapshot.validEvents, snapshot.report);
    if (options.json) {
      console.log(JSON.stringify({ version: "eventloom.handoff.v1", ...summary }, null, 2));
      return;
    }
    console.log(formatHandoffSummary(summary));
    return;
  }

  if (command === "visualize" && path) {
    const snapshot = await readVerifiedEvents(path);
    const model = buildVerifiedVisualizerModel(snapshot.validEvents, snapshot.report);
    const options = parseVisualizeOptions(argv.slice(2));
    if (options.html) {
      await writeTextFileCreatingParents(options.html, renderVisualizerHtml(model, { title: options.title }));
      console.log(JSON.stringify({
        out: options.html,
        eventCount: model.capture.eventCount,
        projectionHash: model.replay.projectionHash,
      }, null, 2));
      return;
    }
    console.log(JSON.stringify(model, null, 2));
    return;
  }

  if ((command === "verify" || command === "validate") && path) {
    parseJsonDefaultOutputOptions(command, argv.slice(2));
    const report = await new JsonlEventStore(path).verify();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "recover" && path) {
    const options = parseRecoverOptions(argv.slice(2));
    const result = await new JsonlEventStore(path).recoverVerifiedPrefix(options.out, {
      quarantinePath: options.quarantineTail,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "diff" && path && extra) {
    parseJsonDefaultOutputOptions("diff", argv.slice(3));
    const left = await createRuntime(path).replay();
    const right = await createRuntime(extra).replay();
    console.log(JSON.stringify(diffRuntimeReplays(left, right), null, 2));
    return;
  }

  if (command === "stats" && path) {
    parseJsonDefaultOutputOptions("stats", argv.slice(2));
    const store = new JsonlEventStore(path);
    const snapshot = await store.readVerifiedSnapshot();
    console.log(JSON.stringify(buildEventLogStats(snapshot.validEvents, snapshot.report), null, 2));
    return;
  }

  if (command === "query" && path) {
    const snapshot = await readVerifiedEvents(path);
    console.log(JSON.stringify(buildEventQueryResult(snapshot.validEvents, parseQueryOptions(argv.slice(2)), snapshot.report), null, 2));
    return;
  }

  if (command === "inspect" && path) {
    const snapshot = await readVerifiedEvents(path);
    console.log(JSON.stringify(buildEventLogInspectionModel(
      snapshot.validEvents,
      snapshot.report,
      parseQueryOptions(argv.slice(2), "inspect"),
    ), null, 2));
    return;
  }

  if (command === "templates") {
    if (!path) {
      console.log(formatAgentWorkflowTemplates());
      return;
    }
    if (extra) throw unknownCommandArgumentError("templates", extra);
    const template = getAgentWorkflowTemplate(path);
    if (!template) throw new CliOptionsError(
      "templateId",
      path,
      "a known template id",
      "Run eventloom templates to list available workflow templates.",
      `Unknown template ${path}`,
    );
    console.log(formatAgentWorkflowTemplate(template));
    return;
  }

  if (command === "artifacts" && path === "verify") {
    if (!extra) throw new CliOptionsError(
      "argument",
      undefined,
      "an artifact bundle manifest path",
      "Run eventloom help for usage.",
      "Missing required manifest path for artifacts verify",
    );
    parseJsonDefaultOutputOptions("artifacts verify", argv.slice(3));
    const result = await verifyArtifactBundleManifestPath(extra);
    console.log(JSON.stringify({ manifestPath: extra, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "artifacts" && path) {
    const options = parseArtifactsOptions(argv.slice(2));
    console.log(JSON.stringify(await writeArtifactBundle({
      inputPath: path,
      outDir: options.out,
      title: options.title,
    }), null, 2));
    return;
  }

  if (command !== "replay" || !path) {
    throw invalidInvocationError(argv);
  }

  parseJsonDefaultOutputOptions("replay", argv.slice(2));
  console.log(JSON.stringify(await createRuntime(path).replay(), null, 2));
}

function eventStoreOptionsFromEnv(): { lockTimeoutMs?: number; lockRetryMs?: number } {
  return {
    lockTimeoutMs: parseNonNegativeIntegerEnv("EVENTLOOM_LOCK_TIMEOUT_MS"),
    lockRetryMs: parseNonNegativeIntegerEnv("EVENTLOOM_LOCK_RETRY_MS"),
  };
}

async function readVerifiedEvents(path: string) {
  return new JsonlEventStore(path).readVerifiedSnapshot();
}

async function verifyArtifactBundleManifestPath(path: string): Promise<ArtifactBundleVerificationResult> {
  try {
    const manifest = JSON.parse(await readFile(path, "utf8")) as ArtifactBundleResult;
    return verifyArtifactBundleFiles(manifest);
  } catch (error) {
    return invalidArtifactBundleManifest(path, artifactManifestReadMessage(error));
  }
}

function artifactManifestReadMessage(error: unknown): string {
  if (error instanceof SyntaxError) return `Artifact bundle manifest is not valid JSON: ${error.message}`;
  if (error instanceof Error) return `Artifact bundle manifest could not be read: ${error.message}`;
  return `Artifact bundle manifest could not be read: ${String(error)}`;
}

function buildVerifiedVisualizerModel(
  events: Parameters<typeof buildVisualizerModel>[0],
  integrity: Awaited<ReturnType<JsonlEventStore["readVerifiedSnapshot"]>>["report"],
): VisualizerModel {
  const model = buildVisualizerModel(events);
  return {
    ...model,
    replay: { ...model.replay, integrity },
    handoff: { ...model.handoff, integrity },
  };
}

function formatVerifiedTimeline(
  events: Parameters<typeof formatTimeline>[0],
  integrity: Awaited<ReturnType<JsonlEventStore["readVerifiedSnapshot"]>>["report"],
): string {
  if (integrity.ok) return formatTimeline(events);
  return [
    formatTimeline(events).replace("integrity: ok", "integrity: failed"),
    "",
    "integrity diagnostics:",
    ...integrity.diagnostics.map((diagnostic) => {
      const event = diagnostic.eventId ? `${diagnostic.eventId}` : `line ${diagnostic.line}`;
      return `- ${event}: ${diagnostic.message}`;
    }),
  ].join("\n");
}

function parseNonNegativeIntegerEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliOptionsError(
      name,
      value,
      "a non-negative integer",
      "Use non-negative integer millisecond values for Eventloom CLI lock timing options.",
    );
  }
  return parsed;
}

function parseBuiltInRunOptions(workflow: BuiltInRunWorkflow, args: string[]): BuiltInRunOptions {
  const options: BuiltInRunOptions = {
    path: defaultBuiltInRunPath(workflow),
    resume: false,
  };
  let pathSet = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") continue;

    if (arg === "--resume") {
      options.resume = true;
      continue;
    }

    if (arg === "--max-iterations") {
      const value = args[index + 1];
      if (!isOptionValue(value)) throw new RuntimeOptionsError("maxIterations", value);
      options.maxIterations = parsePositiveIntegerOption("maxIterations", value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) throw unknownCliOptionError("run", arg);
    if (pathSet) throw new CliOptionsError(
      "path",
      arg,
      "a single event log path",
      "Check the command arguments and run eventloom help for usage.",
      "Unknown run argument " + arg,
    );

    options.path = arg;
    pathSet = true;
  }

  return options;
}

function parsePositiveIntegerOption(option: "maxIterations", value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new RuntimeOptionsError(option, value);
  return parsed;
}

function parseDemoPath(args: readonly string[]): string {
  let path = ".eventloom/events.jsonl";
  let pathSet = false;
  for (const arg of args) {
    if (arg === "--json") continue;
    if (arg.startsWith("--")) throw unknownCliOptionError("demo", arg);
    if (pathSet) throw unknownCommandArgumentError("demo", arg);
    path = arg;
    pathSet = true;
  }
  return path;
}

function parseNoExtraArgs(command: string, args: readonly string[]): void {
  for (const arg of args) {
    if (arg.startsWith("--")) throw unknownCliOptionError(command, arg);
    throw unknownCommandArgumentError(command, arg);
  }
}

function invalidInvocationError(argv: readonly string[]): CliOptionsError {
  const [command] = argv;
  if (!command) {
    return new CliOptionsError(
      "command",
      undefined,
      "a command",
      "Run eventloom help for usage.",
      "Missing command",
    );
  }

  if (isKnownCommand(command)) {
    return new CliOptionsError(
      "argument",
      undefined,
      `the required ${command} command arguments`,
      "Run eventloom help for usage.",
      `Missing required arguments for ${command}`,
    );
  }

  return new CliOptionsError(
    "command",
    command,
    "a known command",
    "Run eventloom help for usage.",
    `Unknown command ${command}`,
  );
}

function isKnownCommand(command: string): boolean {
  return [
    "append",
    "artifacts",
    "demo",
    "diff",
    "export",
    "explain",
    "handoff",
    "inspect",
    "mailbox",
    "query",
    "recover",
    "replay",
    "run",
    "stats",
    "templates",
    "timeline",
    "validate",
    "verify",
    "visualize",
  ].includes(command);
}

function printUsage(writeLine: (message: string) => void = console.error): void {
  writeLine("Usage: eventloom append <events.jsonl> <event.type> [--actor <actorId>] [--payload '<json>'] [--json]");
  writeLine("       eventloom replay <events.jsonl> [--json]");
  writeLine("       eventloom demo software-work [events.jsonl] [--json]");
  writeLine("       eventloom run software-work [events.jsonl] [--resume] [--max-iterations <n>] [--json]");
  writeLine("       eventloom run research-pipeline [events.jsonl] [--resume] [--max-iterations <n>] [--json]");
  writeLine("       eventloom run human-ops [events.jsonl] [--resume] [--max-iterations <n>] [--json]");
  writeLine("       eventloom export pathlight <events.jsonl> [--base-url <url>] [--trace-name <name>] [--json]");
  writeLine("       eventloom export halo <events.jsonl> [--out <traces.jsonl>] [--project-id <id>] [--service-name <name>] [--trace-name <name>] [--json]");
  writeLine("       eventloom export otlp <events.jsonl> [--out <traces.json>] [--endpoint <url>] [--service-name <name>] [--service-version <version>] [--trace-name <name>] [--json]");
  writeLine("       eventloom verify <events.jsonl> [--json]");
  writeLine("       eventloom validate <events.jsonl> [--json]");
  writeLine("       eventloom recover <events.jsonl> --out <recovered.jsonl> [--quarantine-tail <bad-tail.jsonl>] [--json]");
  writeLine("       eventloom diff <left.jsonl> <right.jsonl> [--json]");
  writeLine("       eventloom stats <events.jsonl> [--json]");
  writeLine("       eventloom query <events.jsonl> [--type <event.type>] [--actor <actorId>] [--thread <threadId>] [--limit <n>] [--json]");
  writeLine("       eventloom inspect <events.jsonl> [--type <event.type>] [--actor <actorId>] [--thread <threadId>] [--limit <n>] [--json]");
  writeLine("       eventloom timeline <events.jsonl> [--limit <n>] [--json]");
  writeLine("       eventloom explain task <taskId> <events.jsonl> [--json]");
  writeLine("       eventloom mailbox <actorId> <events.jsonl> [--json]");
  writeLine("       eventloom handoff <events.jsonl> [--json]");
  writeLine("       eventloom visualize <events.jsonl> [--html <visualizer.html>] [--title <title>] [--json]");
  writeLine("       eventloom artifacts <events.jsonl> --out <artifact-dir> [--title <title>] [--json]");
  writeLine("       eventloom artifacts verify <manifest.json> [--json]");
  writeLine("       eventloom templates [templateId]");
}

interface VisualizeOptions {
  html?: string;
  title?: string;
}

function parseVisualizeOptions(args: string[]): VisualizeOptions {
  const options: VisualizeOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") continue;
    const value = args[index + 1];
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);

    if (flag === "--html") options.html = value;
    else if (flag === "--title") options.title = value;
    else throw unknownCliOptionError("visualize", flag);
    index += 1;
  }
  return options;
}

function parseJsonOutputOptions(command: string, args: readonly string[]): { json: boolean } {
  let json = false;
  for (const flag of args) {
    if (flag === "--json") json = true;
    else {
      throw new CliOptionsError(
        flag,
        undefined,
        `a recognized ${command} option`,
        "Check the command arguments and run eventloom help for usage.",
        `Unknown ${command} option ${flag}`,
      );
    }
  }
  return { json };
}

function parseTimelineOptions(args: readonly string[]): TimelineOptions {
  const options: TimelineOptions = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (flag === "--limit") {
      const value = args[index + 1];
      if (!isOptionValue(value)) throw missingOptionValueError(flag, value);
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new CliOptionsError(
          "--limit",
          value,
          "a positive integer",
          "Use a positive integer event count for timeline limits.",
        );
      }
      options.limit = limit;
      index += 1;
      continue;
    }
    if (flag.startsWith("--")) throw unknownCliOptionError("timeline", flag);
    throw unknownCommandArgumentError("timeline", flag);
  }
  return options;
}

function parseJsonDefaultOutputOptions(command: string, args: readonly string[]): void {
  for (const flag of args) {
    if (flag === "--json") continue;
    if (flag.startsWith("--")) throw unknownCliOptionError(command, flag);
    throw unknownCommandArgumentError(command, flag);
  }
}

interface ArtifactsOptions {
  out: string;
  title?: string;
}

function parseArtifactsOptions(args: string[]): ArtifactsOptions {
  const options: ArtifactsOptions = { out: "" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") continue;
    const value = args[index + 1];
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);

    if (flag === "--out") options.out = value;
    else if (flag === "--title") options.title = value;
    else throw unknownCliOptionError("artifacts", flag);
    index += 1;
  }
  if (!options.out) throw missingRequiredOptionError("--out", "artifacts");
  return options;
}

function parseQueryOptions(args: string[], command = "query"): EventQuery {
  const options: EventQuery = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--json") continue;
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);

    if (flag === "--type") options.type = value;
    else if (flag === "--actor") options.actorId = value;
    else if (flag === "--thread") options.threadId = value;
    else if (flag === "--limit") {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new CliOptionsError(
          "--limit",
          value,
          "a positive integer",
          `Use a positive integer event count for ${command} limits.`,
        );
      }
      options.limit = limit;
    } else throw unknownCliOptionError(command, flag);
    index += 1;
  }
  return options;
}

interface RecoverOptions {
  out: string;
  quarantineTail?: string;
}

function parseRecoverOptions(args: string[]): RecoverOptions {
  const options: RecoverOptions = { out: "" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") continue;
    const value = args[index + 1];
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);
    if (flag === "--out") options.out = value;
    else if (flag === "--quarantine-tail") options.quarantineTail = value;
    else throw unknownCliOptionError("recover", flag);
    index += 1;
  }
  if (!options.out) throw missingRequiredOptionError("--out", "recover");
  return options;
}

interface ExportOptions {
  baseUrl: string;
  traceName?: string;
}

function parseExportOptions(args: string[]): ExportOptions {
  const options: ExportOptions = { baseUrl: "http://localhost:4100" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") continue;
    const value = args[index + 1];
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);

    if (flag === "--base-url") options.baseUrl = parseHttpUrlOption(flag, value);
    else if (flag === "--trace-name") options.traceName = value;
    else throw unknownCliOptionError("export", flag);
    index += 1;
  }
  return options;
}

function parseHttpUrlOption(flag: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliOptionsError(
      flag,
      value,
      "an absolute HTTP(S) URL",
      "Use an absolute http:// or https:// URL for the Pathlight collector.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliOptionsError(
      flag,
      value,
      "an absolute HTTP(S) URL",
      "Use an absolute http:// or https:// URL for the Pathlight collector.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

interface HaloExportOptions {
  out: string;
  projectId?: string;
  serviceName?: string;
  traceName?: string;
}

function parseHaloExportOptions(args: string[]): HaloExportOptions {
  const options: HaloExportOptions = { out: "eventloom-halo-traces.jsonl" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") continue;
    const value = args[index + 1];
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);

    if (flag === "--out") options.out = value;
    else if (flag === "--project-id") options.projectId = value;
    else if (flag === "--service-name") options.serviceName = value;
    else if (flag === "--trace-name") options.traceName = value;
    else throw unknownCliOptionError("HALO export", flag);
    index += 1;
  }
  return options;
}

interface OtlpExportOptions {
  out: string;
  endpoint?: string;
  serviceName?: string;
  serviceVersion?: string;
  traceName?: string;
}

function parseOtlpExportOptions(args: string[]): OtlpExportOptions {
  const options: OtlpExportOptions = { out: "eventloom-otlp-traces.json" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") continue;
    const value = args[index + 1];
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);

    if (flag === "--out") options.out = value;
    else if (flag === "--endpoint") options.endpoint = value;
    else if (flag === "--service-name") options.serviceName = value;
    else if (flag === "--service-version") options.serviceVersion = value;
    else if (flag === "--trace-name") options.traceName = value;
    else throw unknownCliOptionError("OTLP export", flag);
    index += 1;
  }
  return options;
}

interface AppendOptions {
  id?: string;
  actorId: string;
  threadId: string;
  parentEventId: string | null;
  causedBy: string[];
  payload: string;
}

function parseAppendOptions(args: string[]): AppendOptions {
  const options: AppendOptions = {
    actorId: "external",
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    payload: "{}",
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") continue;
    const value = args[index + 1];
    if (!isOptionValue(value)) throw missingOptionValueError(flag, value);

    if (flag === "--actor") options.actorId = value;
    else if (flag === "--id") options.id = value;
    else if (flag === "--thread") options.threadId = value;
    else if (flag === "--parent") options.parentEventId = value;
    else if (flag === "--caused-by") options.causedBy = value.split(",").filter(Boolean);
    else if (flag === "--payload") options.payload = value;
    else throw unknownCliOptionError("append", flag);
    index += 1;
  }

  return options;
}

function missingOptionValueError(option: string, value: string | undefined): CliOptionsError {
  return new CliOptionsError(
    option,
    value,
    "a value",
    "Check the command arguments and run eventloom help for usage.",
    "Missing value for " + option,
  );
}

function missingRequiredOptionError(option: string, command: string): CliOptionsError {
  return new CliOptionsError(
    option,
    undefined,
    "required",
    "Check the command arguments and run eventloom help for usage.",
    `Missing required ${option} for ${command}`,
  );
}

function unknownCliOptionError(command: string, option: string): CliOptionsError {
  return new CliOptionsError(
    option,
    undefined,
    `a recognized ${command} option`,
    "Check the command arguments and run eventloom help for usage.",
    `Unknown ${command} option ${option}`,
  );
}

function unknownCommandArgumentError(command: string, value: string): CliOptionsError {
  return new CliOptionsError(
    "argument",
    value,
    `a recognized ${command} argument`,
    "Check the command arguments and run eventloom help for usage.",
    `Unknown ${command} argument ${value}`,
  );
}

function isOptionValue(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("--");
}

main(process.argv.slice(2)).catch((error) => {
  console.error(JSON.stringify(formatCliError(error, process.argv.slice(2)), null, 2));
  process.exitCode = 1;
});

interface CliDiagnostic {
  error: {
    code: string;
    message: string;
    path?: string;
    eventId?: string | null;
    line?: number;
    url?: string;
    endpoint?: string;
    status?: number;
    validationIssues?: EventValidationIssue[];
    workflow?: string;
    projectionKind?: string;
    projectionErrors?: Array<{
      code: string;
      eventId: string;
      type: string;
      message: string;
    }>;
    option?: string;
    value?: unknown;
    actorId?: string;
    turnId?: string;
    sourceEventId?: string;
    causeMessage?: string;
    suggestedAction: string;
  };
}

function formatCliError(error: unknown, argv: readonly string[]): CliDiagnostic {
  if (error instanceof EventStoreAppendError) {
    const diagnostic = error.report.diagnostics[0];
    return {
      error: {
        code: diagnostic?.code ?? "event_store_append_failed",
        message: diagnostic?.message ?? error.message,
        path: error.path,
        eventId: diagnostic?.eventId,
        line: diagnostic?.line,
        suggestedAction: suggestedActionForCode(diagnostic?.code),
      },
    };
  }

  if (error instanceof EventStoreReadError) {
    return {
      error: {
        code: "event_store_read_failed",
        message: error.message,
        path: error.path,
        line: error.line,
        suggestedAction: "Run eventloom verify or eventloom validate for detailed log diagnostics.",
      },
    };
  }

  if (error instanceof EventStoreLockError) {
    return {
      error: {
        code: "event_store_lock_timeout",
        message: error.message,
        path: error.path,
        suggestedAction: "Wait for the active writer to finish, then retry the command.",
      },
    };
  }

  if (error instanceof EventStoreRecoveryError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: error.path,
        suggestedAction: error.suggestedAction,
      },
    };
  }

  if (error instanceof EventValidationError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        eventId: error.eventId,
        validationIssues: error.issues,
        suggestedAction: "Correct the event envelope fields and retry the append.",
      },
    };
  }

  if (error instanceof JsonPayloadParseError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        suggestedAction: error.suggestedAction,
      },
    };
  }

  if (error instanceof PathlightExportError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        url: error.url,
        status: error.status,
        suggestedAction: error.suggestedAction,
      },
    };
  }

  if (error instanceof HaloExportError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        suggestedAction: error.suggestedAction,
      },
    };
  }

  if (error instanceof RuntimeProjectionError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        workflow: error.workflow,
        projectionKind: error.projectionKind,
        projectionErrors: error.errors,
        suggestedAction: "Inspect or recover the workflow log before resuming the built-in runtime.",
      },
    };
  }

  if (error instanceof OtlpExportError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        endpoint: error.endpoint,
        status: error.status,
        suggestedAction: error.suggestedAction,
      },
    };
  }

  if (error instanceof RuntimeOptionsError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        option: error.option,
        value: error.value,
        suggestedAction: error.suggestedAction,
      },
    };
  }

  if (error instanceof RuntimeRunnerError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        actorId: error.actorId,
        turnId: error.turnId,
        sourceEventId: error.sourceEventId,
        causeMessage: error.causeMessage,
        suggestedAction: "Inspect the actor runner failure and retry after correcting the workflow implementation or input log.",
      },
    };
  }

  if (error instanceof CliOptionsError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        path: pathArgument(argv),
        option: error.option,
        value: error.value,
        suggestedAction: error.suggestedAction,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    error: {
      code: codeForMessage(message),
      message,
      path: pathArgument(argv),
      suggestedAction: "Check the command arguments and run eventloom help for usage.",
    },
  };
}

function codeForMessage(message: string): string {
  if (
    message.startsWith("Missing value for ") ||
    message.startsWith("Unknown ") ||
    message.startsWith("Missing required ") ||
    message.includes("must be an absolute HTTP(S) URL") ||
    message.includes("must be a positive integer") ||
    message.includes("must be a non-negative integer")
  ) {
    return "invalid_cli_option";
  }
  if (message.includes("JSON")) return "invalid_json_payload";
  return "eventloom_cli_error";
}

function suggestedActionForCode(code: string | undefined): string {
  if (code === "duplicate_event_id") return "Use a unique event id or recover the log before appending.";
  if (code === "malformed_json" || code === "partial_trailing_line" || code === "invalid_event") {
    return "Run eventloom recover to write the verified prefix to a separate log.";
  }
  if (code?.endsWith("_mismatch") || code === "missing_integrity") {
    return "Inspect the log for tampering or restore it from a trusted copy.";
  }
  return "Inspect the structured diagnostics and retry after correcting the log.";
}

function pathArgument(argv: readonly string[]): string | undefined {
  const [command, path, extra, rest] = argv;
  if (command === "explain" && path === "task") return rest;
  if (command === "mailbox") return extra;
  if (command === "export") return extra;
  if (command === "artifacts" && path === "verify") return extra;
  if (command === "run" && isBuiltInRunWorkflow(path)) return builtInRunPathArgument(path, argv.slice(2));
  if (path && !path.startsWith("--")) return path;
  return undefined;
}

function defaultBuiltInRunPath(workflow: BuiltInRunWorkflow): string {
  if (workflow === "software-work") return ".eventloom/events.jsonl";
  if (workflow === "research-pipeline") return ".eventloom/research-events.jsonl";
  return ".eventloom/human-ops-events.jsonl";
}

function builtInRunPathArgument(workflow: BuiltInRunWorkflow, args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--max-iterations") {
      index += 1;
      continue;
    }
    if (arg === "--resume" || arg.startsWith("--")) continue;
    return arg;
  }
  return defaultBuiltInRunPath(workflow);
}

function isBuiltInRunWorkflow(workflow: string | undefined): workflow is BuiltInRunWorkflow {
  return workflow === "software-work" || workflow === "research-pipeline" || workflow === "human-ops";
}
