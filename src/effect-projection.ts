import { z } from "zod";
import type { EventEnvelope } from "./events.js";
import { replay } from "./projection.js";

const effectPayloadSchema = z.object({
  effectId: z.string().min(1),
  action: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

const approvalPayloadSchema = z.object({
  effectId: z.string().min(1),
  approvalId: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export type EffectStatus =
  | "requested"
  | "approval_requested"
  | "approved"
  | "rejected"
  | "applied";

export interface EffectState {
  id: string;
  action?: string;
  target?: string;
  description?: string;
  approvalId?: string;
  status: EffectStatus;
  actorId: string;
  lastEventId: string;
  history: string[];
}

export interface EffectProjection {
  effects: Record<string, EffectState>;
  errors: EffectProjectionError[];
}

export interface EffectProjectionError {
  eventId: string;
  type: string;
  message: string;
}

export function projectEffects(events: readonly EventEnvelope[]): EffectProjection {
  return replay(events, emptyEffectProjection(), applyEffectEvent);
}

export function validateEffectEvent(
  events: readonly EventEnvelope[],
  event: EventEnvelope,
): EffectProjectionError | null {
  const before = projectEffects(events);
  const after = applyEffectEvent(before, event);
  return after.errors.at(-1) ?? null;
}

export function emptyEffectProjection(): EffectProjection {
  return { effects: {}, errors: [] };
}

export function applyEffectEvent(projection: EffectProjection, event: EventEnvelope): EffectProjection {
  if (event.type === "effect.requested") return applyEffectRequested(projection, event);
  if (event.type === "approval.requested") return applyApprovalRequested(projection, event);
  if (event.type === "approval.granted") return applyApprovalDecision(projection, event, "approved");
  if (event.type === "approval.rejected") return applyApprovalDecision(projection, event, "rejected");
  if (event.type === "effect.applied") return applyEffectApplied(projection, event);
  if (event.type === "effect.rejected") return applyEffectRejected(projection, event);
  return projection;
}

export function explainEffect(projection: EffectProjection, effectId: string): string[] {
  return projection.effects[effectId]?.history ?? [];
}

function applyEffectRequested(projection: EffectProjection, event: EventEnvelope): EffectProjection {
  const payload = parsePayload(projection, event, effectPayloadSchema, "effect");
  if (!payload) return projection;

  if (projection.effects[payload.effectId]) {
    return appendError(projection, event, `Effect ${payload.effectId} already exists`);
  }

  return {
    ...projection,
    effects: {
      ...projection.effects,
      [payload.effectId]: {
        id: payload.effectId,
        action: payload.action,
        target: payload.target,
        description: payload.description,
        status: "requested",
        actorId: event.actorId,
        lastEventId: event.id,
        history: [event.id],
      },
    },
  };
}

function applyApprovalRequested(projection: EffectProjection, event: EventEnvelope): EffectProjection {
  const payload = parsePayload(projection, event, approvalPayloadSchema, "approval");
  if (!payload) return projection;

  const effect = requireEffect(projection, event, payload.effectId);
  if (!effect) return projection;
  if (effect.status !== "requested") {
    return appendError(projection, event, `Cannot apply ${event.type} to effect ${effect.id} in ${effect.status} state`);
  }

  return updateEffect(projection, effect, event, {
    approvalId: payload.approvalId,
    status: "approval_requested",
  });
}

function applyApprovalDecision(
  projection: EffectProjection,
  event: EventEnvelope,
  status: "approved" | "rejected",
): EffectProjection {
  const payload = parsePayload(projection, event, approvalPayloadSchema, "approval");
  if (!payload) return projection;

  const effect = requireEffect(projection, event, payload.effectId);
  if (!effect) return projection;
  if (effect.status !== "approval_requested") {
    return appendError(projection, event, `Cannot apply ${event.type} to effect ${effect.id} in ${effect.status} state`);
  }
  if (effect.approvalId !== payload.approvalId) {
    return appendError(projection, event, `Approval ${payload.approvalId} does not match effect ${effect.id}`);
  }

  return updateEffect(projection, effect, event, { status });
}

function applyEffectApplied(projection: EffectProjection, event: EventEnvelope): EffectProjection {
  const payload = parsePayload(projection, event, effectPayloadSchema, "effect");
  if (!payload) return projection;

  const effect = requireEffect(projection, event, payload.effectId);
  if (!effect) return projection;
  if (effect.status !== "approved") {
    return appendError(projection, event, `Cannot apply ${event.type} to effect ${effect.id} in ${effect.status} state`);
  }

  return updateEffect(projection, effect, event, { status: "applied" });
}

function applyEffectRejected(projection: EffectProjection, event: EventEnvelope): EffectProjection {
  const payload = parsePayload(projection, event, effectPayloadSchema, "effect");
  if (!payload) return projection;

  const effect = requireEffect(projection, event, payload.effectId);
  if (!effect) return projection;
  if (effect.status !== "requested" && effect.status !== "approval_requested") {
    return appendError(projection, event, `Cannot apply ${event.type} to effect ${effect.id} in ${effect.status} state`);
  }

  return updateEffect(projection, effect, event, { status: "rejected" });
}

function requireEffect(
  projection: EffectProjection,
  event: EventEnvelope,
  effectId: string,
): EffectState | null {
  const effect = projection.effects[effectId];
  if (!effect) {
    projection.errors.push({
      eventId: event.id,
      type: event.type,
      message: `Effect ${effectId} does not exist`,
    });
    return null;
  }
  return effect;
}

function updateEffect(
  projection: EffectProjection,
  effect: EffectState,
  event: EventEnvelope,
  updates: Partial<EffectState>,
): EffectProjection {
  return {
    ...projection,
    effects: {
      ...projection.effects,
      [effect.id]: {
        ...effect,
        ...updates,
        actorId: event.actorId,
        lastEventId: event.id,
        history: [...effect.history, event.id],
      },
    },
  };
}

function parsePayload<T extends z.ZodTypeAny>(
  projection: EffectProjection,
  event: EventEnvelope,
  schema: T,
  label: string,
): z.infer<T> | null {
  const result = schema.safeParse(event.payload);
  if (result.success) return result.data;

  projection.errors.push({
    eventId: event.id,
    type: event.type,
    message: `Invalid ${label} payload: ${result.error.issues.map((issue) => issue.message).join(", ")}`,
  });
  return null;
}

function appendError(
  projection: EffectProjection,
  event: EventEnvelope,
  message: string,
): EffectProjection {
  return {
    ...projection,
    errors: [
      ...projection.errors,
      {
        eventId: event.id,
        type: event.type,
        message,
      },
    ],
  };
}
