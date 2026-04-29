import { nanoid } from "nanoid";
import { z } from "zod";

export const eventIdSchema = z.string().regex(/^evt_[A-Za-z0-9_-]+$/);
export const actorIdSchema = z.string().min(1);
export const threadIdSchema = z.string().min(1);
export const eventTypeSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
export const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const eventIntegritySchema = z.object({
  hash: sha256Schema,
  previousHash: sha256Schema.nullable(),
});

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
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export type NewEvent = Omit<EventEnvelope, "id" | "timestamp" | "causedBy"> & {
  id?: string;
  timestamp?: string;
  causedBy?: string[];
};

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

export function validateEvent(value: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(value);
}
