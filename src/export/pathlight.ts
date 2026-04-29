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
        turnId,
        actorId: started.actorId,
        startedEventId: started.id,
        completedEventId: completed?.id ?? null,
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
      output: completed ? spanOutput(completed) : null,
      error: completed ? undefined : "Missing actor.completed event",
    });
  }

  if (actorStartedEvents.length === 0) {
    const exported = await exportTaskLifecycleSpans(fetcher, baseUrl, trace.id, events, tasks.tasks, byId);
    spanCount += exported.spanCount;
    pathlightEventCount += exported.eventCount;
  }

  await patch(fetcher, `${baseUrl}/v1/traces/${trace.id}`, {
    status: integrity.ok ? "completed" : "failed",
    output: { spanCount, eventCount: pathlightEventCount },
    error: integrity.ok ? undefined : "Eventloom integrity verification failed",
  });

  return { traceId: trace.id, spanCount, eventCount: pathlightEventCount };
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
  };
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

function spanOutput(completed: EventEnvelope): Record<string, unknown> {
  const rejected = asStringArray(completed.payload.rejectedEvents);
  const output: Record<string, unknown> = {
    turnId: completed.payload.turnId,
    sourceEventId: completed.payload.sourceEventId,
    intentions: completed.payload.intentions,
    acceptedEvents: completed.payload.acceptedEvents,
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
