import { nanoid } from "nanoid";
import { z, ZodError } from "zod";

/**
 * Schema for Eventloom event ids.
 */
export const eventIdSchema = z.string().regex(/^evt_[A-Za-z0-9_-]+$/);

/**
 * Schema for actor ids in event envelopes.
 */
export const actorIdSchema = z.string().min(1);

/**
 * Schema for logical thread ids in event envelopes.
 */
export const threadIdSchema = z.string().min(1);

/**
 * Schema for lowercase dot-delimited event type names.
 */
export const eventTypeSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);

/**
 * Schema for Eventloom SHA-256 hash-chain values.
 */
export const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * Schema for optional hash-chain integrity metadata on sealed events.
 */
export const eventIntegritySchema = z.object({
  hash: sha256Schema,
  previousHash: sha256Schema.nullable(),
}).strict();

/**
 * Strict schema for the stable Eventloom event envelope.
 */
export const eventEnvelopeSchema = z.object({
  id: eventIdSchema,
  type: eventTypeSchema,
  actorId: actorIdSchema,
  threadId: threadIdSchema,
  parentEventId: eventIdSchema.nullable(),
  causedBy: z.array(eventIdSchema),
  timestamp: z.string().datetime({ offset: true }),
  payload: z.record(z.unknown()),
  integrity: eventIntegritySchema.optional(),
}).strict();

/**
 * Stable Eventloom event envelope shape.
 */
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/**
 * Structured validation issue reported for malformed event envelopes.
 */
export interface EventValidationIssue {
  code: string;
  path: string;
  message: string;
}

/**
 * Stable validation error for malformed Eventloom event envelopes.
 */
export class EventValidationError extends Error {
  readonly code = "invalid_event_envelope";
  readonly eventId: string | null;
  readonly issues: EventValidationIssue[];

  constructor(value: unknown, cause: ZodError) {
    const issues = cause.issues.map((issue) => ({
      code: issue.code,
      path: formatIssuePath(issue.path),
      message: issue.message,
    }));
    super(`Invalid Eventloom event envelope: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "EventValidationError";
    this.eventId = eventIdFromUnknown(value);
    this.issues = issues;
    this.cause = cause;
  }
}

/**
 * Stable diagnostic for invalid deterministic event factory options.
 */
export class EventFactoryOptionsError extends Error {
  readonly code = "invalid_event_factory_option";

  constructor(
    readonly option: keyof DeterministicEventFactoryOptions,
    readonly value: unknown,
    readonly suggestedAction = "Use a valid ISO timestamp and finite deterministic event factory settings.",
  ) {
    super(`${option} is invalid`);
    this.name = "EventFactoryOptionsError";
  }
}

/**
 * Input accepted by event factories before id, timestamp, and causality defaults.
 */
export type NewEvent = Omit<EventEnvelope, "id" | "timestamp" | "causedBy"> & {
  id?: string;
  timestamp?: string;
  causedBy?: string[];
};

/**
 * Event factory interface used by deterministic runtimes and tests.
 */
export interface EventFactory {
  create(input: NewEvent): EventEnvelope;
}

/**
 * Options for deterministic event id and timestamp generation.
 */
export interface DeterministicEventFactoryOptions {
  idPrefix?: string;
  timestamp?: string;
  timestampStepMs?: number;
  startSequence?: number;
}

/**
 * Creates a validated Eventloom event envelope, filling id, timestamp, and
 * causality defaults when callers omit them.
 */
export function createEvent(input: NewEvent): EventEnvelope {
  return validateEvent({
    id: input.id ?? `evt_${nanoid()}`,
    type: input.type,
    actorId: input.actorId,
    threadId: input.threadId,
    parentEventId: input.parentEventId,
    causedBy: input.causedBy ?? [],
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: input.payload,
  });
}

/**
 * Returns the default event factory backed by nondeterministic ids and wall
 * clock timestamps from `createEvent`.
 */
export function defaultEventFactory(): EventFactory {
  return { create: createEvent };
}

/**
 * Returns an event factory with predictable ids and timestamps for fixtures,
 * reproducible demos, and deterministic tests.
 */
export function createDeterministicEventFactory(options: DeterministicEventFactoryOptions = {}): EventFactory {
  const idPrefix = options.idPrefix ?? "evt_deterministic";
  const initialSequence = options.startSequence ?? 1;
  const timestamp = options.timestamp ?? "1970-01-01T00:00:00.000Z";
  const timestampStepMs = options.timestampStepMs ?? 1;
  const baseMs = Date.parse(timestamp);
  if (Number.isNaN(baseMs)) throw new EventFactoryOptionsError("timestamp", timestamp);
  let sequence = initialSequence;

  return {
    create(input: NewEvent): EventEnvelope {
      const current = sequence;
      sequence += 1;
      return createEvent({
        ...input,
        id: input.id ?? `${idPrefix}_${String(current).padStart(6, "0")}`,
        timestamp: input.timestamp ?? new Date(baseMs + ((current - initialSequence) * timestampStepMs)).toISOString(),
      });
    },
  };
}

/**
 * Validates unknown input as a strict Eventloom event envelope and throws
 * `EventValidationError` with typed issues on failure.
 */
export function validateEvent(value: unknown): EventEnvelope {
  const parsed = eventEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new EventValidationError(value, parsed.error);
  return parsed.data;
}

function formatIssuePath(path: readonly (string | number)[]): string {
  return path.length > 0 ? path.join(".") : "<root>";
}

function eventIdFromUnknown(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("id" in value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}
