import { z, ZodError, type ZodType } from "zod";
import type { ActorRegistry } from "./actors.js";
import type { JsonlEventStore } from "./event-store.js";
import { validateEffectEvent } from "./effect-projection.js";
import { defaultEventFactory, type EventEnvelope, type EventFactory } from "./events.js";
import { intentionEventTypeMap, validateIntention, type Intention } from "./intentions.js";
import type { SealedEvent } from "./integrity.js";
import { validateResearchEvent } from "./research-projection.js";
import { validateTaskEvent } from "./task-projection.js";

/**
 * Result of submitting an intention through the orchestrator.
 *
 * Rejected submissions still append an explicit rejection/invalid event.
 */
export interface OrchestratorResult {
  accepted: boolean;
  event: SealedEvent;
}

/**
 * Stable machine-readable reasons an intention can be rejected.
 */
export type OrchestratorRejectionCode =
  | "actor_not_registered"
  | "actor_intention_not_allowed"
  | "intention_schema_invalid"
  | "projection_state_rejected";

/**
 * Coarse rejection classes for routing diagnostics in clients and tools.
 */
export type OrchestratorRejectionCategory = "permission" | "schema" | "projection_state";

/**
 * Projection domain that rejected a proposed event during orchestration.
 */
export type ProjectionRejectionKind = "tasks" | "research" | "effects" | "custom";

/**
 * Structured projection-state diagnostic preserved on rejection payloads.
 */
export interface ProjectionRejectionDiagnostic {
  projectionKind: ProjectionRejectionKind;
  code?: string;
  eventId?: string;
  type?: string;
  message: string;
}

/**
 * Additive custom intention mapping for domain-specific workflows.
 *
 * Custom definitions extend the orchestrator with new intention/event pairs
 * without changing built-in schemas or the Eventloom event envelope.
 */
export interface CustomIntentionDefinition {
  type: string;
  eventType: string;
  payloadSchema?: ZodType<Record<string, unknown>>;
  validateEvent?: (events: readonly EventEnvelope[], event: EventEnvelope) => string | null | Promise<string | null>;
}

/**
 * Optional orchestrator configuration for deterministic factories and custom domains.
 */
export interface OrchestratorOptions {
  eventFactory?: EventFactory;
  customIntentions?: readonly CustomIntentionDefinition[];
}

/**
 * Validates actor intentions and appends accepted events or explicit rejection events.
 *
 * The orchestrator is the trust boundary between actor proposals and canonical
 * log mutations: actor permissions, payload schemas, and projection-state
 * validation all run before accepted events are sealed.
 */
export class Orchestrator {
  constructor(
    private readonly store: JsonlEventStore,
    private readonly actors: ActorRegistry,
    private readonly options: OrchestratorOptions = {},
  ) {}

  async submitIntention(value: unknown): Promise<OrchestratorResult> {
    const parsed = parseIntention(value, this.customIntentionsByType());
    if (!parsed.ok) {
      return this.reject("unknown", "thread_main", null, [], "intention.invalid", {
        ...rejectionPayload("intention_schema_invalid", "schema", parsed.error),
        original: value,
      });
    }

    const intention = parsed.intention;
    const actor = this.actors.get(intention.actorId);
    if (!actor) {
      return this.reject(intention.actorId, intention.threadId, intention.parentEventId, intention.causedBy, "intention.rejected", {
        ...rejectionPayload(
          "actor_not_registered",
          "permission",
          `Actor ${intention.actorId} is not registered`,
        ),
        ...intentionDiagnostic(intention, parsed.eventType),
        intention,
      });
    }

    if (!actor.intentions.includes(intention.type)) {
      return this.reject(intention.actorId, intention.threadId, intention.parentEventId, intention.causedBy, "intention.rejected", {
        ...rejectionPayload(
          "actor_intention_not_allowed",
          "permission",
          `Actor ${intention.actorId} cannot emit ${intention.type}`,
        ),
        ...intentionDiagnostic(intention, parsed.eventType),
        intention,
      });
    }

    const event = this.eventFactory().create({
      type: parsed.eventType,
      actorId: intention.actorId,
      threadId: intention.threadId,
      parentEventId: intention.parentEventId,
      causedBy: intention.causedBy,
      payload: intention.payload,
    });

    const appendResult = await this.store.appendValidated(event, (events, currentEvent) => (
      this.validateEventAgainstSnapshot(events, currentEvent, parsed.customDefinition)
    ));
    if (!appendResult.ok) {
      const projectionError = projectionDiagnosticFromAppendFailure(appendResult);
      return this.reject(intention.actorId, intention.threadId, intention.parentEventId, intention.causedBy, "intention.rejected", {
        ...rejectionPayload("projection_state_rejected", "projection_state", projectionError.message),
        projectionError,
        ...intentionDiagnostic(intention, parsed.eventType),
        intention,
      });
    }

    return {
      accepted: true,
      event: appendResult.event,
    };
  }

  private async validateEventAgainstSnapshot(
    events: readonly EventEnvelope[],
    event: EventEnvelope,
    customDefinition?: CustomIntentionDefinition,
  ): Promise<ProjectionRejectionDiagnostic | null> {
    const taskError = validateTaskEvent(events, event);
    if (taskError) return { projectionKind: "tasks", ...taskError };

    const researchError = validateResearchEvent(events, event);
    if (researchError) return { projectionKind: "research", ...researchError };

    const effectError = validateEffectEvent(events, event);
    if (effectError) return { projectionKind: "effects", ...effectError };

    const customError = await customDefinition?.validateEvent?.(events, event) ?? null;
    return customError ? { projectionKind: "custom", message: customError } : null;
  }

  private async reject(
    actorId: string,
    threadId: string,
    parentEventId: string | null,
    causedBy: string[],
    type: string,
    payload: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    const event = this.eventFactory().create({
      type,
      actorId,
      threadId,
      parentEventId,
      causedBy,
      payload,
    });

    return {
      accepted: false,
      event: await this.store.append(event),
    };
  }

  private eventFactory(): EventFactory {
    return this.options.eventFactory ?? defaultEventFactory();
  }

  private customIntentionsByType(): Map<string, CustomIntentionDefinition> {
    return new Map((this.options.customIntentions ?? []).map((definition) => [definition.type, definition]));
  }
}

function projectionDiagnosticFromAppendFailure(
  failure: Extract<Awaited<ReturnType<JsonlEventStore["appendValidated"]>>, { ok: false }>,
): ProjectionRejectionDiagnostic {
  if (isProjectionRejectionDiagnostic(failure.diagnostic)) return failure.diagnostic;
  return {
    projectionKind: "custom",
    message: failure.reason,
  };
}

function isProjectionRejectionDiagnostic(value: unknown): value is ProjectionRejectionDiagnostic {
  return typeof value === "object" &&
    value !== null &&
    "projectionKind" in value &&
    typeof (value as { projectionKind?: unknown }).projectionKind === "string" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string";
}

function intentionDiagnostic(
  intention: Intention | CustomIntention,
  eventType: string,
): Record<string, unknown> {
  return {
    actorId: intention.actorId,
    intentionType: intention.type,
    eventType,
  };
}

function rejectionPayload(
  code: OrchestratorRejectionCode,
  category: OrchestratorRejectionCategory,
  message: string,
): Record<string, unknown> {
  return {
    code,
    category,
    message,
    reason: message,
  };
}

type ParseResult =
  | {
      ok: true;
      intention: Intention | CustomIntention;
      eventType: string;
      customDefinition?: CustomIntentionDefinition;
    }
  | { ok: false; error: string };

const customIntentionSchema = z.object({
  type: z.string().min(1),
  actorId: z.string().min(1),
  threadId: z.string().min(1),
  parentEventId: z.string().regex(/^evt_[A-Za-z0-9_-]+$/).nullable(),
  causedBy: z.array(z.string().regex(/^evt_[A-Za-z0-9_-]+$/)).default([]),
  payload: z.record(z.unknown()),
});

type CustomIntention = z.infer<typeof customIntentionSchema>;

function parseIntention(value: unknown, customIntentions: Map<string, CustomIntentionDefinition>): ParseResult {
  try {
    const intention = validateIntention(value);
    return {
      ok: true,
      intention,
      eventType: intentionEventTypeMap[intention.type],
    };
  } catch (error) {
    const builtInError = error;
    const custom = parseCustomIntention(value, customIntentions);
    if (custom.ok) return custom;
    if (custom.reason !== "unknown_custom_intention") return { ok: false, error: custom.error };
    if (builtInError instanceof ZodError) {
      return { ok: false, error: builtInError.issues.map((issue) => issue.message).join(", ") };
    }
    return { ok: false, error: builtInError instanceof Error ? builtInError.message : String(builtInError) };
  }
}

type CustomParseResult =
  | {
      ok: true;
      intention: CustomIntention;
      eventType: string;
      customDefinition: CustomIntentionDefinition;
    }
  | { ok: false; reason: "invalid_custom_intention" | "unknown_custom_intention"; error: string };

function parseCustomIntention(value: unknown, customIntentions: Map<string, CustomIntentionDefinition>): CustomParseResult {
  const base = customIntentionSchema.safeParse(value);
  if (!base.success) {
    return {
      ok: false,
      reason: "invalid_custom_intention",
      error: base.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const definition = customIntentions.get(base.data.type);
  if (!definition) {
    return {
      ok: false,
      reason: "unknown_custom_intention",
      error: `Unknown custom intention ${base.data.type}`,
    };
  }

  if (definition.payloadSchema) {
    const payload = definition.payloadSchema.safeParse(base.data.payload);
    if (!payload.success) {
      return {
        ok: false,
        reason: "invalid_custom_intention",
        error: payload.error.issues.map((issue) => issue.message).join(", "),
      };
    }
  }

  return {
    ok: true,
    intention: base.data,
    eventType: definition.eventType,
    customDefinition: definition,
  };
}
