import {
  appendExternalEvent,
  buildMailbox,
  createRuntime,
  createHumanOpsRegistry,
  createResearchPipelineRegistry,
  createSoftwareWorkRegistry,
  formatMailbox,
  formatTaskExplanation,
  formatTimeline,
  projectTasks,
  type ActorRegistry,
  type BuiltInWorkflow,
  type EventEnvelope,
  type MailboxItem,
  type RuntimeReplay,
} from "@eventloom/runtime";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { resolveLogPath, type ServerConfig } from "./path-safety.js";

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

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

export const TimelineInputSchema = z.object({
  path: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
});

export const ExplainTaskInputSchema = z.object({
  path: z.string().min(1),
  taskId: z.string().min(1),
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
  maxIterations: z.number().int().positive().optional(),
});

export const ExportPathlightInputSchema = z.object({
  path: z.string().min(1),
  baseUrl: z.string().url().default(process.env.EVENTLOOM_PATHLIGHT_BASE_URL ?? "http://localhost:4100"),
  traceName: z.string().min(1).optional(),
});

export type AppendInput = z.infer<typeof AppendInputSchema>;
export type ReplayInput = z.infer<typeof ReplayInputSchema>;
export type TimelineInput = z.infer<typeof TimelineInputSchema>;
export type ExplainTaskInput = z.infer<typeof ExplainTaskInputSchema>;
export type MailboxInput = z.infer<typeof MailboxInputSchema>;
export type RunBuiltInInput = z.infer<typeof RunBuiltInInputSchema>;
export type ExportPathlightInput = z.infer<typeof ExportPathlightInputSchema>;

export async function appendEvent(config: ServerConfig, input: AppendInput): Promise<CallToolResult> {
  const path = resolveLogPath(config, input.path);
  const event = await appendExternalEvent({
    path,
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

export async function timeline(config: ServerConfig, input: TimelineInput): Promise<CallToolResult> {
  const events = await createRuntime(resolveLogPath(config, input.path)).readAll();
  const selectedEvents = input.limit ? events.slice(-input.limit) : events;
  return toolResult({
    text: formatTimeline(events),
    events: selectedEvents.map(eventSummary),
  });
}

export async function explainTask(config: ServerConfig, input: ExplainTaskInput): Promise<CallToolResult> {
  const events = await createRuntime(resolveLogPath(config, input.path)).readAll();
  const projection = projectTasks(events);
  const task = projection.tasks[input.taskId] ?? null;
  return toolResult({
    text: formatTaskExplanation(events, input.taskId),
    task,
    history: task?.history ?? [],
  });
}

export async function mailbox(config: ServerConfig, input: MailboxInput): Promise<CallToolResult> {
  const runtime = createRuntime(resolveLogPath(config, input.path));
  const items = buildMailbox(registryForWorkflow(input.workflow as BuiltInWorkflow), input.actorId, await runtime.readAll());
  return toolResult({
    text: formatMailbox(input.actorId, items),
    actorId: input.actorId,
    workflow: input.workflow,
    items: items.map((item: MailboxItem) => ({
      event: eventSummary(item.event),
      task: item.task ?? null,
    })),
  });
}

export async function runBuiltIn(config: ServerConfig, input: RunBuiltInInput): Promise<CallToolResult> {
  const path = resolveLogPath(config, input.path);
  const runtime = createRuntime(path);
  await runtime.runBuiltIn(input.workflow as BuiltInWorkflow, {
    resume: input.resume,
    maxIterations: input.maxIterations,
  });
  return toolResult(compactReplay(await runtime.replay()));
}

export async function exportPathlight(config: ServerConfig, input: ExportPathlightInput): Promise<CallToolResult> {
  const runtime = createRuntime(resolveLogPath(config, input.path));
  return toolResult({ ...await runtime.exportPathlight({
    baseUrl: input.baseUrl,
    traceName: input.traceName,
  }) });
}

function compactReplay(replay: RuntimeReplay): Record<string, unknown> {
  return {
    eventCount: replay.eventCount,
    integrity: replay.integrity,
    projectionHash: replay.projectionHash,
  };
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
