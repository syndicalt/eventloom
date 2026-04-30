#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { JsonlEventStore } from "./event-store.js";
import { projectEffects } from "./effect-projection.js";
import { exportToHalo, formatHaloJsonl } from "./export/halo.js";
import { exportToPathlight } from "./export/pathlight.js";
import { formatHandoffSummary, summarizeHandoff } from "./handoff.js";
import { appendExternalEvent, parseJsonPayload } from "./ingest.js";
import { formatMailbox, formatTaskExplanation, formatTimeline } from "./inspect.js";
import { verifyEventChain } from "./integrity.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectResearch } from "./research-projection.js";
import { projectTasks } from "./task-projection.js";
import { runSoftwareWorkDemo } from "./demo.js";
import { createRuntime } from "./runtime.js";
import { runHumanOpsRuntime, runResearchPipelineRuntime, runSoftwareWorkRuntime } from "./runners.js";
import { formatAgentWorkflowTemplate, formatAgentWorkflowTemplates, getAgentWorkflowTemplate } from "./templates.js";
import { buildVisualizerModel } from "./visualizer.js";

async function main(argv: string[]): Promise<void> {
  const [command, path, extra, rest] = argv;

  if (command === "append" && path && extra) {
    const options = parseAppendOptions(argv.slice(3));
    const event = await appendExternalEvent({
      path,
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
    const outPath = extra ?? ".eventloom/events.jsonl";
    await runSoftwareWorkDemo(outPath);
    console.log(JSON.stringify({ path: outPath }, null, 2));
    return;
  }

  if (command === "run" && path === "software-work") {
    const outPath = extra ?? ".eventloom/events.jsonl";
    const result = await runSoftwareWorkRuntime(outPath, { resume: argv.includes("--resume") });
    console.log(JSON.stringify({ path: outPath, ...result }, null, 2));
    return;
  }

  if (command === "run" && path === "research-pipeline") {
    const outPath = extra ?? ".eventloom/research-events.jsonl";
    const result = await runResearchPipelineRuntime(outPath, { resume: argv.includes("--resume") });
    console.log(JSON.stringify({ path: outPath, ...result }, null, 2));
    return;
  }

  if (command === "run" && path === "human-ops") {
    const outPath = extra ?? ".eventloom/human-ops-events.jsonl";
    const result = await runHumanOpsRuntime(outPath, { resume: argv.includes("--resume") });
    console.log(JSON.stringify({ path: outPath, ...result }, null, 2));
    return;
  }

  if (command === "export" && path === "pathlight" && extra) {
    const options = parseExportOptions(argv.slice(3));
    const store = new JsonlEventStore(extra);
    const result = await exportToPathlight(await store.readAll(), {
      baseUrl: options.baseUrl,
      traceName: options.traceName,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "export" && path === "halo" && extra) {
    const options = parseHaloExportOptions(argv.slice(3));
    const store = new JsonlEventStore(extra);
    const result = await exportToHalo(await store.readAll(), {
      projectId: options.projectId,
      serviceName: options.serviceName,
      traceName: options.traceName,
    });
    await writeFile(options.out, formatHaloJsonl(result), "utf8");
    console.log(JSON.stringify({
      out: options.out,
      projectId: result.projectId,
      traceId: result.traceId,
      traceCount: result.traceCount,
      spanCount: result.spanCount,
    }, null, 2));
    return;
  }

  if (command === "timeline" && path) {
    const store = new JsonlEventStore(path);
    console.log(formatTimeline(await store.readAll()));
    return;
  }

  if (command === "explain" && path === "task" && extra && rest) {
    const store = new JsonlEventStore(rest);
    console.log(formatTaskExplanation(await store.readAll(), extra));
    return;
  }

  if (command === "mailbox" && path && extra) {
    const runtime = createRuntime(extra);
    console.log(formatMailbox(path, await runtime.mailbox("software-work", path)));
    return;
  }

  if (command === "handoff" && path) {
    const store = new JsonlEventStore(path);
    console.log(formatHandoffSummary(summarizeHandoff(await store.readAll())));
    return;
  }

  if (command === "visualize" && path) {
    const store = new JsonlEventStore(path);
    console.log(JSON.stringify(buildVisualizerModel(await store.readAll()), null, 2));
    return;
  }

  if (command === "templates") {
    if (!path) {
      console.log(formatAgentWorkflowTemplates());
      return;
    }
    const template = getAgentWorkflowTemplate(path);
    if (!template) throw new Error(`Unknown template ${path}`);
    console.log(formatAgentWorkflowTemplate(template));
    return;
  }

  if (command !== "replay" || !path) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const store = new JsonlEventStore(path);
  const events = await store.readAll();
  const integrity = verifyEventChain(events);
  const projection = {
    eventTypes: eventTypeCounts(events),
    effects: projectEffects(events),
    research: projectResearch(events),
    tasks: projectTasks(events),
  };

  console.log(JSON.stringify({
    eventCount: events.length,
    integrity,
    projection,
    projectionHash: projectionHash(projection),
  }, null, 2));
}

function printUsage(): void {
  console.error("Usage: eventloom append <events.jsonl> <event.type> --actor <actorId> --payload '<json>'");
  console.error("       eventloom replay <events.jsonl>");
  console.error("       eventloom demo software-work [events.jsonl]");
  console.error("       eventloom run software-work [events.jsonl] [--resume]");
  console.error("       eventloom run research-pipeline [events.jsonl] [--resume]");
  console.error("       eventloom run human-ops [events.jsonl] [--resume]");
  console.error("       eventloom export pathlight <events.jsonl> --base-url <url> [--trace-name <name>]");
  console.error("       eventloom export halo <events.jsonl> --out <traces.jsonl> [--project-id <id>] [--service-name <name>] [--trace-name <name>]");
  console.error("       eventloom timeline <events.jsonl>");
  console.error("       eventloom explain task <taskId> <events.jsonl>");
  console.error("       eventloom mailbox <actorId> <events.jsonl>");
  console.error("       eventloom handoff <events.jsonl>");
  console.error("       eventloom visualize <events.jsonl>");
  console.error("       eventloom templates [templateId]");
}

interface ExportOptions {
  baseUrl: string;
  traceName?: string;
}

function parseExportOptions(args: string[]): ExportOptions {
  const options: ExportOptions = { baseUrl: "http://localhost:4100" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) throw new Error("Missing value for " + flag);

    if (flag === "--base-url") options.baseUrl = value;
    else if (flag === "--trace-name") options.traceName = value;
    else throw new Error("Unknown export option " + flag);
    index += 1;
  }
  return options;
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
    const value = args[index + 1];
    if (!value) throw new Error("Missing value for " + flag);

    if (flag === "--out") options.out = value;
    else if (flag === "--project-id") options.projectId = value;
    else if (flag === "--service-name") options.serviceName = value;
    else if (flag === "--trace-name") options.traceName = value;
    else throw new Error("Unknown HALO export option " + flag);
    index += 1;
  }
  return options;
}

interface AppendOptions {
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
    const value = args[index + 1];
    if (!value) throw new Error("Missing value for " + flag);

    if (flag === "--actor") options.actorId = value;
    else if (flag === "--thread") options.threadId = value;
    else if (flag === "--parent") options.parentEventId = value;
    else if (flag === "--caused-by") options.causedBy = value.split(",").filter(Boolean);
    else if (flag === "--payload") options.payload = value;
    else throw new Error("Unknown append option " + flag);
    index += 1;
  }

  return options;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
