import type { EventEnvelope } from "../events.js";
import { verifyEventChain } from "../integrity.js";
import { projectionHash } from "../projection.js";
import { projectTasks } from "../task-projection.js";

export interface PathlightExportOptions {
  baseUrl: string;
  traceName?: string;
  fetchImpl?: typeof fetch;
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
  const integrity = verifyEventChain(events);
  const tasks = projectTasks(events);
  const trace = await post<JsonResponse>(fetcher, `${baseUrl}/v1/traces`, {
    name: options.traceName ?? "threadline-runtime",
    input: { eventCount: events.length },
    metadata: {
      source: "threadline",
      integrity,
      projectionHash: projectionHash({ eventTypes: eventTypeCounts(events), tasks }),
      threadIds: [...new Set(events.map((event) => event.threadId))],
    },
    tags: ["threadline"],
  });

  if (!trace.id) throw new Error("Pathlight trace create response did not include id");

  let spanCount = 0;
  let pathlightEventCount = 0;
  const byId = new Map(events.map((event) => [event.id, event]));

  for (const started of events.filter((event) => event.type === "actor.started")) {
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
        source: "threadline",
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
      output: completed?.payload ?? null,
      error: completed ? undefined : "Missing actor.completed event",
    });
  }

  await patch(fetcher, `${baseUrl}/v1/traces/${trace.id}`, {
    status: integrity.ok ? "completed" : "failed",
    output: { spanCount, eventCount: pathlightEventCount },
    error: integrity.ok ? undefined : "Threadline integrity verification failed",
  });

  return { traceId: trace.id, spanCount, eventCount: pathlightEventCount };
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
