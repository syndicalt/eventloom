import { JsonlEventStore } from "./event-store.js";
import { createEvent, type EventEnvelope } from "./events.js";
import type { SealedEvent } from "./integrity.js";

export interface AppendExternalEventInput {
  path: string;
  type: string;
  actorId: string;
  threadId: string;
  parentEventId?: string | null;
  causedBy?: string[];
  payload: Record<string, unknown>;
}

export async function appendExternalEvent(input: AppendExternalEventInput): Promise<SealedEvent> {
  const store = new JsonlEventStore(input.path);
  const event: EventEnvelope = createEvent({
    type: input.type,
    actorId: input.actorId,
    threadId: input.threadId,
    parentEventId: input.parentEventId ?? null,
    causedBy: input.causedBy ?? [],
    payload: input.payload,
  });

  return store.append(event);
}

export function parseJsonPayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
