import { createHash } from "node:crypto";
import type { EventEnvelope } from "../events.js";
import { verifyEventChain } from "../integrity.js";
import { eventTypeCounts, projectionHash } from "../projection.js";
import { collectRuntimeProvenance, type RuntimeProvenance } from "../provenance.js";
import { projectTasks, type TaskState } from "../task-projection.js";

export interface HaloExportOptions {
  projectId?: string;
  serviceName?: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  traceName?: string;
  provenance?: RuntimeProvenance;
  provenanceImpl?: () => Promise<RuntimeProvenance>;
}

export interface HaloExportResult {
  projectId: string;
  traceId: string;
  traceCount: number;
  spanCount: number;
  spans: HaloSpanRecord[];
}

export interface HaloSpanRecord {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  trace_state: string;
  name: string;
  kind: string;
  start_time: string;
  end_time: string;
  status: {
    code: string;
    message: string;
  };
  resource: {
    attributes: Record<string, unknown>;
  };
  scope: {
    name: string;
    version: string;
  };
  attributes: Record<string, unknown>;
}

interface SpanInput {
  id: string;
  parentId?: string;
  name: string;
  kind?: string;
  observationKind?: "AGENT" | "LLM" | "TOOL" | "SPAN";
  startTime: string;
  endTime: string;
  statusCode?: "STATUS_CODE_OK" | "STATUS_CODE_ERROR";
  statusMessage?: string;
  actorId?: string;
  attributes?: Record<string, unknown>;
}

export async function exportToHalo(
  events: readonly EventEnvelope[],
  options: HaloExportOptions = {},
): Promise<HaloExportResult> {
  const provenance = options.provenance ?? await (options.provenanceImpl ?? collectRuntimeProvenance)();
  const projectId = options.projectId ?? "eventloom";
  const traceId = stableId("trace", events.map((event) => event.id).join("|") || "empty");
  const tasks = projectTasks(events);
  const integrity = verifyEventChain(events);
  const resourceAttributes = {
    "service.name": options.serviceName ?? "eventloom",
    "service.version": options.serviceVersion ?? provenance.packageVersion,
    "deployment.environment": options.deploymentEnvironment ?? "local",
  };
  const scope = {
    name: "@eventloom/runtime",
    version: provenance.packageVersion,
  };

  const root = makeSpan({
    id: "root",
    name: options.traceName ?? "eventloom.log",
    observationKind: "SPAN",
    startTime: firstTimestamp(events),
    endTime: lastTimestamp(events),
    statusCode: integrity.ok ? "STATUS_CODE_OK" : "STATUS_CODE_ERROR",
    statusMessage: integrity.ok ? "" : "Eventloom integrity verification failed",
    actorId: "eventloom",
    attributes: {
      "openinference.span.kind": "CHAIN",
      "eventloom.event_count": events.length,
      "eventloom.event_types": eventTypeCounts(events),
      "eventloom.integrity.ok": integrity.ok,
      "eventloom.projection_hash": projectionHash({ eventTypes: eventTypeCounts(events), tasks }),
      "eventloom.thread_ids": [...new Set(events.map((event) => event.threadId))],
      "eventloom.git.commit": provenance.gitCommit,
      "eventloom.git.branch": provenance.gitBranch,
      "eventloom.git.dirty": provenance.gitDirty,
    },
  }, { traceId, projectId, resourceAttributes, scope });

  const actorTurnSpans = events
    .filter((event) => event.type === "actor.started")
    .map((event) => makeActorTurnSpan(event, events, root.span_id, {
      traceId,
      projectId,
      resourceAttributes,
      scope,
    }));

  const telemetrySpans = makeTelemetrySpans(events, root.span_id, {
    traceId,
    projectId,
    resourceAttributes,
    scope,
  });

  const taskSpans = Object.values(tasks.tasks)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((task) => makeTaskSpan(task, events, root.span_id, {
      traceId,
      projectId,
      resourceAttributes,
      scope,
    }));

  const factSpans = events
    .filter((event) => shouldExportFactSpan(event))
    .map((event) => makeEventSpan(event, root.span_id, {
      traceId,
      projectId,
      resourceAttributes,
      scope,
    }));

  const fallbackEventSpans = taskSpans.length === 0 && factSpans.length === 0
    ? events.map((event) => makeEventSpan(event, root.span_id, {
      traceId,
      projectId,
      resourceAttributes,
      scope,
    }))
    : [];

  const spans = [root, ...actorTurnSpans, ...telemetrySpans, ...taskSpans, ...factSpans, ...fallbackEventSpans];
  return { projectId, traceId, traceCount: spans.length > 0 ? 1 : 0, spanCount: spans.length, spans };
}

export function formatHaloJsonl(result: HaloExportResult): string {
  return `${result.spans.map((span) => JSON.stringify(span)).join("\n")}\n`;
}

function makeTaskSpan(
  task: TaskState,
  events: readonly EventEnvelope[],
  parentSpanId: string,
  context: SpanContext,
): HaloSpanRecord {
  const history = task.history
    .map((eventId) => events.find((event) => event.id === eventId))
    .filter((event): event is EventEnvelope => !!event);
  const startTime = history.at(0)?.timestamp ?? firstTimestamp(events);
  const endTime = history.at(-1)?.timestamp ?? startTime;
  const hasIssue = task.status === "issue_reported";

  return makeSpan({
    id: `task:${task.id}`,
    parentId: parentSpanId,
    name: `eventloom.task.${task.id}`,
    observationKind: "AGENT",
    startTime,
    endTime,
    statusCode: hasIssue ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
    statusMessage: hasIssue ? "Task has issue_reported status" : "",
    actorId: task.actorId,
    attributes: {
      "openinference.span.kind": "AGENT",
      "agent.name": task.actorId,
      "agent.workflow.name": "Eventloom task lifecycle",
      "inference.agent_name": task.actorId,
      "eventloom.task.id": task.id,
      "eventloom.task.title": task.title ?? null,
      "eventloom.task.status": task.status,
      "eventloom.task.history_event_ids": task.history,
      "input.value": JSON.stringify({ taskId: task.id, title: task.title ?? null }),
      "output.value": JSON.stringify({
        status: task.status,
        lastEventId: task.lastEventId,
        eventTypes: eventTypeCounts(history),
      }),
    },
  }, context);
}

function makeActorTurnSpan(
  started: EventEnvelope,
  events: readonly EventEnvelope[],
  parentSpanId: string,
  context: SpanContext,
): HaloSpanRecord {
  const turnId = String(started.payload.turnId ?? started.id);
  const completed = events.find((event) => (
    event.type === "actor.completed" &&
    event.actorId === started.actorId &&
    event.payload.turnId === turnId
  ));
  const processed = events.find((event) => (
    event.type === "actor.processed" &&
    event.actorId === started.actorId &&
    event.payload.turnId === turnId
  ));
  const acceptedEvents = asStringArray(completed?.payload.acceptedEvents);
  const rejectedEvents = asStringArray(completed?.payload.rejectedEvents);
  const hasError = !completed || rejectedEvents.length > 0;

  return makeSpan({
    id: `actor:${started.actorId}:${turnId}`,
    parentId: parentSpanId,
    name: `eventloom.actor.${started.actorId}.turn`,
    observationKind: "AGENT",
    startTime: started.timestamp,
    endTime: processed?.timestamp ?? completed?.timestamp ?? started.timestamp,
    statusCode: hasError ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
    statusMessage: !completed ? "Missing actor.completed event" : rejectedEvents.length > 0 ? "Actor turn had rejected events" : "",
    actorId: started.actorId,
    attributes: {
      "openinference.span.kind": "AGENT",
      "agent.name": started.actorId,
      "agent.workflow.name": "Eventloom actor turn",
      "inference.agent_name": started.actorId,
      "eventloom.turn.id": turnId,
      "eventloom.actor_id": started.actorId,
      "eventloom.source_event_id": stringOrNull(started.payload.sourceEventId),
      "eventloom.mailbox_event_type": stringOrNull(started.payload.mailboxEventType),
      "eventloom.accepted_event_ids": acceptedEvents,
      "eventloom.rejected_event_ids": rejectedEvents,
      "eventloom.processed_event_id": processed?.id ?? null,
      "input.value": JSON.stringify({
        sourceEventId: started.payload.sourceEventId ?? null,
        mailboxEventType: started.payload.mailboxEventType ?? null,
      }),
      "output.value": JSON.stringify({
        completedEventId: completed?.id ?? null,
        processedEventId: processed?.id ?? null,
        acceptedEvents,
        rejectedEvents,
      }),
    },
  }, context);
}

function makeEventSpan(
  event: EventEnvelope,
  parentSpanId: string,
  context: SpanContext,
): HaloSpanRecord {
  const isError = event.type.includes("issue") || event.type.includes("invalid") || event.type.includes("rejected");
  return makeSpan({
    id: `event:${event.id}`,
    parentId: parentSpanId,
    name: `eventloom.event.${event.type}`,
    observationKind: "SPAN",
    startTime: event.timestamp,
    endTime: event.timestamp,
    statusCode: isError ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
    statusMessage: isError ? event.type : "",
    actorId: event.actorId,
    attributes: {
      "openinference.span.kind": "CHAIN",
      "agent.workflow.name": "Eventloom event journal",
      "inference.agent_name": event.actorId,
      "eventloom.event.id": event.id,
      "eventloom.event.type": event.type,
      "eventloom.actor_id": event.actorId,
      "eventloom.thread_id": event.threadId,
      "eventloom.parent_event_id": event.parentEventId,
      "eventloom.caused_by": event.causedBy,
      "input.value": JSON.stringify(event.payload),
    },
  }, context);
}

function makeTelemetrySpans(
  events: readonly EventEnvelope[],
  rootSpanId: string,
  context: SpanContext,
): HaloSpanRecord[] {
  const spans: HaloSpanRecord[] = [];
  for (const started of events.filter((event) => event.type === "model.started")) {
    const modelCallId = String(started.payload.modelCallId ?? started.id);
    const completed = events.find((event) => event.type === "model.completed" && event.payload.modelCallId === modelCallId);
    spans.push(makeModelSpan(started, completed, parentSpanForTurn(started, rootSpanId, context.traceId), context));
  }

  for (const started of events.filter((event) => event.type === "tool.started")) {
    const toolCallId = String(started.payload.toolCallId ?? started.id);
    const completed = events.find((event) => event.type === "tool.completed" && event.payload.toolCallId === toolCallId);
    spans.push(makeToolSpan(started, completed, parentSpanForTurn(started, rootSpanId, context.traceId), context));
  }

  for (const event of events.filter((item) => item.type === "reasoning.summary")) {
    spans.push(makeReasoningSpan(event, parentSpanForTurn(event, rootSpanId, context.traceId), context));
  }

  return spans;
}

function makeModelSpan(
  started: EventEnvelope,
  completed: EventEnvelope | undefined,
  parentSpanId: string,
  context: SpanContext,
): HaloSpanRecord {
  const provider = stringOrNull(completed?.payload.modelProvider) ?? stringOrNull(started.payload.modelProvider) ?? "unknown";
  const model = stringOrNull(completed?.payload.modelName) ?? stringOrNull(started.payload.modelName) ?? "unknown";
  const inputTokens = numberOrNull(completed?.payload.inputTokens);
  const outputTokens = numberOrNull(completed?.payload.outputTokens);
  const failed = !completed || completed.type === "model.failed";
  return makeSpan({
    id: `model:${String(started.payload.modelCallId ?? started.id)}`,
    parentId: parentSpanId,
    name: `${provider}.${model}`,
    kind: "SPAN_KIND_CLIENT",
    observationKind: "LLM",
    startTime: started.timestamp,
    endTime: completed?.timestamp ?? started.timestamp,
    statusCode: failed ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
    statusMessage: failed ? "Model invocation did not complete" : "",
    actorId: started.actorId,
    attributes: {
      "openinference.span.kind": "LLM",
      "llm.provider": provider,
      "llm.model_name": model,
      "llm.token_count.prompt": inputTokens,
      "llm.token_count.completion": outputTokens,
      "llm.token_count.total": numberOrNull(completed?.payload.totalTokens),
      "inference.llm.provider": provider,
      "inference.llm.model_name": model,
      "inference.llm.input_tokens": inputTokens,
      "inference.llm.output_tokens": outputTokens,
      "inference.llm.cost.total": completed?.payload.cost ?? null,
      "eventloom.turn.id": stringOrNull(started.payload.turnId),
      "eventloom.model_call_id": stringOrNull(started.payload.modelCallId),
      "input.value": JSON.stringify(started.payload.inputMessages ?? []),
      "output.value": JSON.stringify(completed?.payload.outputText ?? null),
    },
  }, context);
}

function makeToolSpan(
  started: EventEnvelope,
  completed: EventEnvelope | undefined,
  parentSpanId: string,
  context: SpanContext,
): HaloSpanRecord {
  const failed = !completed || completed.type === "tool.failed";
  const toolName = stringOrNull(completed?.payload.toolName) ?? stringOrNull(started.payload.toolName) ?? "unknown";
  return makeSpan({
    id: `tool:${String(started.payload.toolCallId ?? started.id)}`,
    parentId: parentSpanId,
    name: `function.${toolName}`,
    kind: "SPAN_KIND_INTERNAL",
    observationKind: "TOOL",
    startTime: started.timestamp,
    endTime: completed?.timestamp ?? started.timestamp,
    statusCode: failed ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
    statusMessage: failed ? String(completed?.payload.error ?? "Tool invocation did not complete") : "",
    actorId: started.actorId,
    attributes: {
      "openinference.span.kind": "TOOL",
      "tool.name": toolName,
      "eventloom.turn.id": stringOrNull(started.payload.turnId),
      "eventloom.tool_call_id": stringOrNull(started.payload.toolCallId),
      "input.value": JSON.stringify(started.payload.input ?? null),
      "output.value": JSON.stringify(completed?.payload.output ?? null),
    },
  }, context);
}

function makeReasoningSpan(
  event: EventEnvelope,
  parentSpanId: string,
  context: SpanContext,
): HaloSpanRecord {
  return makeSpan({
    id: `reasoning:${event.id}`,
    parentId: parentSpanId,
    name: "eventloom.reasoning.summary",
    observationKind: "SPAN",
    startTime: event.timestamp,
    endTime: event.timestamp,
    actorId: event.actorId,
    attributes: {
      "openinference.span.kind": "CHAIN",
      "eventloom.turn.id": stringOrNull(event.payload.turnId),
      "eventloom.reasoning.summary": stringOrNull(event.payload.summary),
      "eventloom.reasoning.evidence_event_ids": asStringArray(event.payload.evidenceEventIds),
      "eventloom.reasoning.confidence": event.payload.confidence ?? null,
      "input.value": JSON.stringify(event.payload),
    },
  }, context);
}

interface SpanContext {
  traceId: string;
  projectId: string;
  resourceAttributes: Record<string, unknown>;
  scope: { name: string; version: string };
}

function makeSpan(input: SpanInput, context: SpanContext): HaloSpanRecord {
  const observationKind = input.observationKind ?? "SPAN";
  const attributes = {
    "openinference.span.kind": observationKind === "AGENT" || observationKind === "LLM" || observationKind === "TOOL"
      ? observationKind
      : "CHAIN",
    "inference.export.schema_version": 1,
    "inference.project_id": context.projectId,
    "inference.observation_kind": observationKind,
    "inference.llm.provider": null,
    "inference.llm.model_name": null,
    "inference.llm.input_tokens": null,
    "inference.llm.output_tokens": null,
    "inference.llm.cost.total": null,
    "inference.user_id": null,
    "inference.session_id": null,
    "inference.agent_name": input.actorId ?? "",
    ...input.attributes,
  };

  return {
    trace_id: context.traceId,
    span_id: stableId("span", `${context.traceId}:${input.id}`),
    parent_span_id: input.parentId ?? "",
    trace_state: "",
    name: input.name,
    kind: input.kind ?? "SPAN_KIND_INTERNAL",
    start_time: toHaloTimestamp(input.startTime),
    end_time: toHaloTimestamp(input.endTime),
    status: {
      code: input.statusCode ?? "STATUS_CODE_OK",
      message: input.statusMessage ?? "",
    },
    resource: {
      attributes: context.resourceAttributes,
    },
    scope: context.scope,
    attributes,
  };
}

function shouldExportFactSpan(event: EventEnvelope): boolean {
  return event.type === "goal.created" ||
    event.type === "decision.recorded" ||
    event.type.startsWith("verification.") ||
    event.type.startsWith("release.") ||
    event.type.startsWith("risk.");
}

function firstTimestamp(events: readonly EventEnvelope[]): string {
  return events.at(0)?.timestamp ?? new Date(0).toISOString();
}

function lastTimestamp(events: readonly EventEnvelope[]): string {
  return events.at(-1)?.timestamp ?? firstTimestamp(events);
}

function toHaloTimestamp(value: string): string {
  const date = new Date(value);
  const iso = Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
  return iso.replace(/\.(\d{3})Z$/, ".$1000000Z");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parentSpanForTurn(event: EventEnvelope, fallback: string, traceId: string): string {
  const turnId = stringOrNull(event.payload.turnId);
  if (!turnId) return fallback;
  return stableId("span", `${traceId}:actor:${event.actorId}:${turnId}`);
}

function stableId(prefix: "trace" | "span", value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return prefix === "trace" ? digest.slice(0, 32) : digest.slice(0, 24);
}
