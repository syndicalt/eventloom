import { JsonlEventStore, type JsonlEventStoreOptions } from "./event-store.js";
import { createEvent, type EventEnvelope } from "./events.js";
import type { SealedEvent } from "./integrity.js";

/**
 * Input for appending a trusted external event through the root ingest helper.
 */
export interface AppendExternalEventInput {
  path: string;
  eventStore?: JsonlEventStoreOptions;
  id?: string;
  type: string;
  actorId: string;
  threadId: string;
  parentEventId?: string | null;
  causedBy?: string[];
  payload: Record<string, unknown>;
}

/**
 * Stable diagnostic for invalid CLI-style JSON payload strings.
 */
export class JsonPayloadParseError extends Error {
  readonly code = "invalid_json_payload";

  constructor(
    message: string,
    readonly value: string,
    readonly suggestedAction = "Pass --payload as a valid JSON object string.",
    cause?: unknown,
  ) {
    super(message);
    this.name = "JsonPayloadParseError";
    this.cause = cause;
  }
}

/**
 * Create, validate, seal, and append one trusted external event to a JSONL log.
 */
export async function appendExternalEvent(input: AppendExternalEventInput): Promise<SealedEvent> {
  const store = new JsonlEventStore(input.path, input.eventStore);
  const event: EventEnvelope = createEvent({
    id: input.id,
    type: input.type,
    actorId: input.actorId,
    threadId: input.threadId,
    parentEventId: input.parentEventId ?? null,
    causedBy: input.causedBy ?? [],
    payload: input.payload,
  });

  return store.append(event);
}

/**
 * Parse a CLI-style JSON payload string and require an object payload.
 */
export function parseJsonPayload(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new JsonPayloadParseError("Payload must be valid JSON", value, undefined, error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JsonPayloadParseError("Payload must be a JSON object", value);
  }
  return parsed as Record<string, unknown>;
}
