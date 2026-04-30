import type { EventEnvelope } from "../events.js";
import { projectEffects } from "../effect-projection.js";
import { verifyEventChain } from "../integrity.js";
import { projectionHash } from "../projection.js";
import { collectRuntimeProvenance, type RuntimeProvenance } from "../provenance.js";
import { projectResearch } from "../research-projection.js";
import { projectTasks, type TaskState } from "../task-projection.js";

export interface PathlightExportOptions {
  baseUrl: string;
  traceName?: string;
  fetchImpl?: typeof fetch;
  provenance?: RuntimeProvenance;
  provenanceImpl?: () => Promise<RuntimeProvenance>;
}

export interface PathlightExportResult {
  traceId: string;
  spanCount: number;
  eventCount: number;
}

interface JsonResponse {
  id?: string;
}

export async function exportToPathlight(
  events: readonly EventEnvelope[],
  options: PathlightExportOptions,
): Promise<PathlightExportResult> {
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const provenance = options.provenance ?? await (options.provenanceImpl ?? collectRuntimeProvenance)();
  const effects = projectEffects(events);
  const integrity = verifyEventChain(events);
  const research = projectResearch(events);
  const tasks = projectTasks(events);
  const trace = await post<JsonResponse>(fetcher, `${baseUrl}/v1/traces`, {
    name: options.traceName ?? "eventloom-runtime",
    input: { eventCount: events.length },
    metadata: {
      source: "eventloom",
      integrity,
      projectionHash: projectionHash({ effects, eventTypes: eventTypeCounts(events), research, tasks }),
      projectionKinds: projectionKinds({ effects, research, tasks }),
      runtime: {
        name: provenance.packageName,
        version: provenance.packageVersion,
      },
      threadIds: [...new Set(events.map((event) => event.threadId))],
    },
    tags: ["eventloom"],
    gitCommit: provenance.gitCommit ?? undefined,
    gitBranch: provenance.gitBranch ?? undefined,
    gitDirty: provenance.gitDirty ?? undefined,
  });

  if (!trace.id) throw new Error("Pathlight trace create response did not include id");

  let spanCount = 0;
  let pathlightEventCount = 0;
  const byId = new Map(events.map((event) => [event.id, event]));

  const actorStartedEvents = events.filter((event) => event.type === "actor.started");
  for (const started of actorStartedEvents) {
    const turnId = String(started.payload.turnId ?? "");
    const completed = events.find((event) => (
      event.type === "actor.completed" &&
      event.actorId === started.actorId &&
      event.payload.turnId === turnId
    ));

    const span = await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans`, {
      traceId: trace.id,
      name: `${started.actorId}.turn`,
      type: "agent",
      input: { sourceEventId: started.payload.sourceEventId, mailboxEventType: started.payload.mailboxEventType },
      metadata: {
        source: "eventloom",
        exportKind: "actor_turn",
        turnId,
        actorId: started.actorId,
        startedEventId: started.id,
        completedEventId: completed?.id ?? null,
        acceptedEventIds: asStringArray(completed?.payload.acceptedEvents),
        rejectedEventIds: asStringArray(completed?.payload.rejectedEvents),
      },
    });
    if (!span.id) throw new Error("Pathlight span create response did not include id");
    spanCount += 1;

    const relatedIds = relatedEventIds(started, completed);
    for (const id of relatedIds) {
      const event = byId.get(id);
      if (!event) continue;
      await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans/${span.id}/events`, {
        name: event.type,
        level: event.type.includes("rejected") || event.type.includes("invalid") ? "warn" : "info",
        body: event,
      });
      pathlightEventCount += 1;
    }

    await patch(fetcher, `${baseUrl}/v1/spans/${span.id}`, {
      status: completed ? "completed" : "failed",
      output: completed ? spanOutput(completed, events) : null,
      error: completed ? undefined : "Missing actor.completed event",
    });
  }

  const telemetryExport = await exportTelemetrySpans(fetcher, baseUrl, trace.id, events);
  spanCount += telemetryExport.spanCount;
  pathlightEventCount += telemetryExport.eventCount;

  if (actorStartedEvents.length === 0) {
    const exported = await exportTaskLifecycleSpans(fetcher, baseUrl, trace.id, events, tasks.tasks, byId);
    spanCount += exported.spanCount;
    pathlightEventCount += exported.eventCount;
  }

  const factExport = await exportFactSpans(fetcher, baseUrl, trace.id, events);
  spanCount += factExport.spanCount;
  pathlightEventCount += factExport.eventCount;

  await patch(fetcher, `${baseUrl}/v1/traces/${trace.id}`, {
    status: integrity.ok ? "completed" : "failed",
    output: { spanCount, eventCount: pathlightEventCount },
    error: integrity.ok ? undefined : "Eventloom integrity verification failed",
  });

  return { traceId: trace.id, spanCount, eventCount: pathlightEventCount };
}

async function exportTelemetrySpans(
  fetcher: typeof fetch,
  baseUrl: string,
  traceId: string,
  events: readonly EventEnvelope[],
): Promise<{ spanCount: number; eventCount: number }> {
  let spanCount = 0;
  let eventCount = 0;
  const byId = new Map(events.map((event) => [event.id, event]));
  for (const started of events.filter((event) => event.type === "model.started")) {
    const modelCallId = String(started.payload.modelCallId ?? started.id);
    const completed = events.find((event) => (
      (event.type === "model.completed" || event.type === "model.failed") &&
      event.payload.modelCallId === modelCallId
    ));
    const provider = stringOrNull(completed?.payload.modelProvider) ?? stringOrNull(started.payload.modelProvider) ?? "unknown";
    const model = stringOrNull(completed?.payload.modelName) ?? stringOrNull(started.payload.modelName) ?? "unknown";
    const failed = !completed || completed.type === "model.failed";
    const span = await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans`, {
      traceId,
      name: `${provider}.${model}`,
      type: "llm",
      input: {
        modelCallId,
        turnId: started.payload.turnId ?? null,
        promptVersion: started.payload.promptVersion ?? null,
        inputSummary: started.payload.inputSummary ?? null,
        parameters: started.payload.parameters ?? null,
        inputMessages: started.payload.inputMessages ?? [],
      },
      metadata: {
        source: "eventloom",
        exportKind: "model_invocation",
        actorId: started.actorId,
        modelCallId,
        turnId: started.payload.turnId ?? null,
        modelProvider: provider,
        modelName: model,
      },
    });
    if (!span.id) throw new Error("Pathlight span create response did not include id");
    spanCount += 1;
    eventCount += await postRelatedEvents(fetcher, baseUrl, span.id, byId, [started.id, completed?.id]);
    await patch(fetcher, `${baseUrl}/v1/spans/${span.id}`, {
      status: failed ? "failed" : "completed",
      output: {
        outputText: completed?.payload.outputText ?? null,
        outputSummary: completed?.payload.outputSummary ?? null,
        inputTokens: completed?.payload.inputTokens ?? null,
        outputTokens: completed?.payload.outputTokens ?? null,
        totalTokens: completed?.payload.totalTokens ?? null,
        cost: completed?.payload.cost ?? null,
        latencyMs: completed?.payload.latencyMs ?? null,
        error: completed?.payload.error ?? null,
      },
      error: failed ? stringOrNull(completed?.payload.error) ?? "Missing model.completed event" : undefined,
    });
  }

  for (const started of events.filter((event) => event.type === "tool.started")) {
    const toolCallId = String(started.payload.toolCallId ?? started.id);
    const completed = events.find((event) => (
      (event.type === "tool.completed" || event.type === "tool.failed") &&
      event.payload.toolCallId === toolCallId
    ));
    const toolName = stringOrNull(completed?.payload.toolName) ?? stringOrNull(started.payload.toolName) ?? "unknown";
    const failed = !completed || completed.type === "tool.failed";
    const span = await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans`, {
      traceId,
      name: toolName,
      type: "tool",
      input: {
        input: started.payload.input ?? null,
        inputSummary: started.payload.inputSummary ?? null,
      },
      metadata: {
        source: "eventloom",
        exportKind: "tool_invocation",
        actorId: started.actorId,
        toolCallId,
        turnId: started.payload.turnId ?? null,
        toolName,
      },
    });
    if (!span.id) throw new Error("Pathlight span create response did not include id");
    spanCount += 1;
    eventCount += await postRelatedEvents(fetcher, baseUrl, span.id, byId, [started.id, completed?.id]);
    await patch(fetcher, `${baseUrl}/v1/spans/${span.id}`, {
      status: failed ? "failed" : "completed",
      output: {
        output: completed?.payload.output ?? null,
        outputSummary: completed?.payload.outputSummary ?? null,
        exitCode: completed?.payload.exitCode ?? null,
        resultCount: completed?.payload.resultCount ?? null,
        resultExcerpt: completed?.payload.resultExcerpt ?? null,
        decisive: completed?.payload.decisive ?? null,
        latencyMs: completed?.payload.latencyMs ?? null,
      },
      error: failed ? stringOrNull(completed?.payload.error) ?? "Missing tool.completed event" : undefined,
    });
  }

  for (const event of events.filter((item) => item.type === "reasoning.summary")) {
    const span = await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans`, {
      traceId,
      name: "reasoning.summary",
      type: "chain",
      input: {
        turnId: event.payload.turnId ?? null,
        evidenceEventIds: event.payload.evidenceEventIds ?? [],
      },
      metadata: {
        source: "eventloom",
        exportKind: "reasoning_summary",
        actorId: event.actorId,
        turnId: event.payload.turnId ?? null,
      },
    });
    if (!span.id) throw new Error("Pathlight span create response did not include id");
    spanCount += 1;
    eventCount += await postRelatedEvents(fetcher, baseUrl, span.id, byId, [event.id]);
    await patch(fetcher, `${baseUrl}/v1/spans/${span.id}`, {
      status: "completed",
      output: event.payload,
    });
  }

  return { spanCount, eventCount };
}

async function postRelatedEvents(
  fetcher: typeof fetch,
  baseUrl: string,
  spanId: string,
  byId: ReadonlyMap<string, EventEnvelope>,
  ids: readonly (string | undefined)[],
): Promise<number> {
  let eventCount = 0;
  for (const id of ids) {
    if (!id) continue;
    const event = byId.get(id);
    if (!event) continue;
    await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans/${spanId}/events`, {
      name: event.type,
      level: eventLevel(event),
      body: event,
    });
    eventCount += 1;
  }
  return eventCount;
}

async function exportFactSpans(
  fetcher: typeof fetch,
  baseUrl: string,
  traceId: string,
  events: readonly EventEnvelope[],
): Promise<{ spanCount: number; eventCount: number }> {
  let spanCount = 0;
  let eventCount = 0;
  for (const event of events.filter(shouldExportFactSpan)) {
    const span = await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans`, {
      traceId,
      name: event.type,
      type: "event",
      input: {
        eventId: event.id,
        eventType: event.type,
        actorId: event.actorId,
        threadId: event.threadId,
      },
      metadata: {
        source: "eventloom",
        exportKind: "journal_fact",
        eventId: event.id,
        eventType: event.type,
        actorId: event.actorId,
        threadId: event.threadId,
        parentEventId: event.parentEventId,
        causedBy: event.causedBy,
      },
    });
    if (!span.id) throw new Error("Pathlight span create response did not include id");
    spanCount += 1;

    await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans/${span.id}/events`, {
      name: event.type,
      level: eventLevel(event),
      body: event,
    });
    eventCount += 1;

    await patch(fetcher, `${baseUrl}/v1/spans/${span.id}`, {
      status: event.type.includes("failed") || event.type.includes("issue") ? "failed" : "completed",
      output: event.payload,
      error: event.type.includes("failed") || event.type.includes("issue") ? event.type : undefined,
    });
  }

  return { spanCount, eventCount };
}

async function exportTaskLifecycleSpans(
  fetcher: typeof fetch,
  baseUrl: string,
  traceId: string,
  events: readonly EventEnvelope[],
  tasks: Record<string, TaskState>,
  byId: ReadonlyMap<string, EventEnvelope>,
): Promise<{ spanCount: number; eventCount: number }> {
  let spanCount = 0;
  let eventCount = 0;
  for (const task of Object.values(tasks).sort((left, right) => left.id.localeCompare(right.id))) {
    const history = task.history
      .map((eventId) => byId.get(eventId))
      .filter((event): event is EventEnvelope => !!event);

    const span = await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans`, {
      traceId,
      name: `task.${task.id}`,
      type: "agent",
      input: {
        taskId: task.id,
        title: task.title ?? null,
        firstEventId: history.at(0)?.id ?? null,
      },
      metadata: {
        source: "eventloom",
        exportKind: "task_lifecycle",
        taskId: task.id,
        taskStatus: task.status,
        actorId: task.actorId,
        historyEventIds: task.history,
        threadIds: [...new Set(history.map((event) => event.threadId))],
      },
    });
    if (!span.id) throw new Error("Pathlight span create response did not include id");
    spanCount += 1;

    for (const event of history) {
      await post<JsonResponse>(fetcher, `${baseUrl}/v1/spans/${span.id}/events`, {
        name: event.type,
        level: eventLevel(event),
        body: event,
      });
      eventCount += 1;
    }

    await patch(fetcher, `${baseUrl}/v1/spans/${span.id}`, {
      status: taskSpanStatus(task),
      output: taskSpanOutput(task, history, events),
      error: task.status === "issue_reported" ? "Task has an issue_reported status" : undefined,
    });
  }

  return { spanCount, eventCount };
}

function taskSpanStatus(task: TaskState): string {
  if (task.status === "issue_reported") return "failed";
  return "completed";
}

function taskSpanOutput(
  task: TaskState,
  history: readonly EventEnvelope[],
  events: readonly EventEnvelope[],
): Record<string, unknown> {
  return {
    taskId: task.id,
    title: task.title ?? null,
    status: task.status,
    lastActor: task.actorId,
    lastEventId: task.lastEventId,
    eventTypes: eventTypeCounts(history),
    decisions: factsForTask(events, task.id, "decision.recorded"),
    verification: events
      .filter((event) => event.type.startsWith("verification."))
      .map((event) => event.payload),
    modelCalls: telemetryForTask(events, task.id, "model"),
    toolCalls: telemetryForTask(events, task.id, "tool"),
    reasoning: events
      .filter((event) => event.type === "reasoning.summary")
      .filter((event) => event.payload.taskId === task.id || event.payload.taskId === undefined)
      .map((event) => event.payload),
  };
}

function telemetryForTask(
  events: readonly EventEnvelope[],
  taskId: string,
  kind: "model" | "tool",
): Record<string, unknown>[] {
  const startType = `${kind}.started`;
  const terminalTypes = new Set([`${kind}.completed`, `${kind}.failed`]);
  const idKey = kind === "model" ? "modelCallId" : "toolCallId";
  return events
    .filter((event) => event.type === startType)
    .filter((event) => event.payload.taskId === taskId || event.payload.taskId === undefined)
    .map((started) => {
      const callId = String(started.payload[idKey] ?? started.id);
      const terminal = events.find((event) => terminalTypes.has(event.type) && event.payload[idKey] === callId);
      return {
        callId,
        status: terminal?.type.endsWith(".completed") ? "completed" : terminal?.type.endsWith(".failed") ? "failed" : "missing",
        startedEventId: started.id,
        terminalEventId: terminal?.id ?? null,
        inputSummary: started.payload.inputSummary ?? null,
        outputSummary: terminal?.payload.outputSummary ?? null,
        exitCode: terminal?.payload.exitCode ?? null,
        resultCount: terminal?.payload.resultCount ?? null,
        resultExcerpt: terminal?.payload.resultExcerpt ?? null,
        error: terminal?.payload.error ?? null,
      };
    });
}

function factsForTask(
  events: readonly EventEnvelope[],
  taskId: string,
  type: string,
): Record<string, unknown>[] {
  return events
    .filter((event) => event.type === type)
    .filter((event) => event.payload.taskId === taskId || event.payload.taskId === undefined)
    .map((event) => event.payload);
}

function eventLevel(event: EventEnvelope): string {
  if (event.type.includes("rejected") || event.type.includes("invalid") || event.type.includes("issue")) return "warn";
  return "info";
}

function shouldExportFactSpan(event: EventEnvelope): boolean {
  return event.type === "goal.created" ||
    event.type === "decision.recorded" ||
    event.type.startsWith("verification.") ||
    event.type.startsWith("release.") ||
    event.type.startsWith("risk.");
}

function spanOutput(completed: EventEnvelope, events: readonly EventEnvelope[]): Record<string, unknown> {
  const rejected = asStringArray(completed.payload.rejectedEvents);
  const turnId = String(completed.payload.turnId ?? "");
  const output: Record<string, unknown> = {
    turnId,
    sourceEventId: completed.payload.sourceEventId,
    intentions: completed.payload.intentions,
    acceptedEvents: completed.payload.acceptedEvents,
    modelCalls: events
      .filter((event) => event.type === "model.completed" && event.payload.turnId === turnId)
      .map((event) => ({
        modelProvider: event.payload.modelProvider,
        modelName: event.payload.modelName,
        promptVersion: events.find((started) => started.type === "model.started" && started.payload.modelCallId === event.payload.modelCallId)?.payload.promptVersion,
        inputSummary: events.find((started) => started.type === "model.started" && started.payload.modelCallId === event.payload.modelCallId)?.payload.inputSummary,
        outputSummary: event.payload.outputSummary,
        inputTokens: event.payload.inputTokens,
        outputTokens: event.payload.outputTokens,
        totalTokens: event.payload.totalTokens,
        cost: event.payload.cost,
      })),
    toolCalls: events
      .filter((event) => event.type === "tool.completed" && event.payload.turnId === turnId)
      .map((event) => ({
        toolName: event.payload.toolName,
        inputSummary: events.find((started) => started.type === "tool.started" && started.payload.toolCallId === event.payload.toolCallId)?.payload.inputSummary,
        outputSummary: event.payload.outputSummary,
        exitCode: event.payload.exitCode,
        resultCount: event.payload.resultCount,
        resultExcerpt: event.payload.resultExcerpt,
        decisive: event.payload.decisive,
        latencyMs: event.payload.latencyMs,
      })),
    reasoning: events
      .filter((event) => event.type === "reasoning.summary" && event.payload.turnId === turnId)
      .map((event) => event.payload.summary),
  };

  if (rejected.length > 0) {
    output.rejectionEventIds = rejected;
  }

  return output;
}

function relatedEventIds(started: EventEnvelope, completed?: EventEnvelope): string[] {
  const ids = [started.id];
  if (completed) {
    ids.push(
      ...asStringArray(completed.payload.acceptedEvents),
      ...asStringArray(completed.payload.rejectedEvents),
      completed.id,
    );
  }
  return ids;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventTypeCounts(events: readonly EventEnvelope[]): Record<string, number> {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
}

function projectionKinds(projections: {
  effects: ReturnType<typeof projectEffects>;
  research: ReturnType<typeof projectResearch>;
  tasks: ReturnType<typeof projectTasks>;
}): string[] {
  const kinds = [];
  if (Object.keys(projections.effects.effects).length > 0) kinds.push("effects");
  if (Object.keys(projections.research.questions).length > 0) kinds.push("research");
  if (Object.keys(projections.tasks.tasks).length > 0) kinds.push("tasks");
  return kinds;
}

async function post<T>(fetcher: typeof fetch, url: string, body: unknown): Promise<T> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response, url);
}

async function patch(fetcher: typeof fetch, url: string, body: unknown): Promise<void> {
  const response = await fetcher(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await parseResponse<unknown>(response, url);
}

async function parseResponse<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`Pathlight request failed: ${response.status} ${url}`);
  }
  return await response.json() as T;
}
