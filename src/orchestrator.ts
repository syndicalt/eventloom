import { ZodError } from "zod";
import type { ActorRegistry } from "./actors.js";
import type { JsonlEventStore } from "./event-store.js";
import { createEvent, type EventEnvelope } from "./events.js";
import { intentionEventTypeMap, validateIntention, type Intention } from "./intentions.js";
import type { SealedEvent } from "./integrity.js";
import { validateTaskEvent } from "./task-projection.js";

export interface OrchestratorResult {
  accepted: boolean;
  event: SealedEvent;
}

export class Orchestrator {
  constructor(
    private readonly store: JsonlEventStore,
    private readonly actors: ActorRegistry,
  ) {}

  async submitIntention(value: unknown): Promise<OrchestratorResult> {
    const parsed = parseIntention(value);
    if (!parsed.ok) {
      return this.reject("unknown", null, [], "intention.invalid", {
        reason: parsed.error,
        original: value,
      });
    }

    const intention = parsed.intention;
    const actor = this.actors.get(intention.actorId);
    if (!actor) {
      return this.reject(intention.actorId, intention.parentEventId, intention.causedBy, "intention.rejected", {
        reason: `Actor ${intention.actorId} is not registered`,
        intention,
      });
    }

    if (!actor.intentions.includes(intention.type)) {
      return this.reject(intention.actorId, intention.parentEventId, intention.causedBy, "intention.rejected", {
        reason: `Actor ${intention.actorId} cannot emit ${intention.type}`,
        intention,
      });
    }

    const event = createEvent({
      type: intentionEventTypeMap[intention.type],
      actorId: intention.actorId,
      threadId: intention.threadId,
      parentEventId: intention.parentEventId,
      causedBy: intention.causedBy,
      payload: intention.payload,
    });

    const rejectionReason = await this.validateEventBeforeAppend(event);
    if (rejectionReason) {
      return this.reject(intention.actorId, intention.parentEventId, intention.causedBy, "intention.rejected", {
        reason: rejectionReason,
        intention,
      });
    }

    return {
      accepted: true,
      event: await this.store.append(event),
    };
  }

  private async validateEventBeforeAppend(event: EventEnvelope): Promise<string | null> {
    const error = validateTaskEvent(await this.store.readAll(), event);
    return error?.message ?? null;
  }

  private async reject(
    actorId: string,
    parentEventId: string | null,
    causedBy: string[],
    type: string,
    payload: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    const event = createEvent({
      type,
      actorId,
      threadId: "thread_main",
      parentEventId,
      causedBy,
      payload,
    });

    return {
      accepted: false,
      event: await this.store.append(event),
    };
  }
}

type ParseResult =
  | { ok: true; intention: Intention }
  | { ok: false; error: string };

function parseIntention(value: unknown): ParseResult {
  try {
    return { ok: true, intention: validateIntention(value) };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((issue) => issue.message).join(", ") };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
