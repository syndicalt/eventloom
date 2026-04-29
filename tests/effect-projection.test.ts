import { describe, expect, it } from "vitest";
import { causalChain } from "../src/causal.js";
import { createEvent, type EventEnvelope } from "../src/events.js";
import { explainEffect, projectEffects } from "../src/effect-projection.js";

describe("effect projection", () => {
  it("advances effects through human approval and application", () => {
    const events = effectLifecycleEvents();

    const projection = projectEffects(events);

    expect(projection.errors).toEqual([]);
    expect(projection.effects.effect_1).toMatchObject({
      id: "effect_1",
      action: "notify",
      target: "ops",
      approvalId: "approval_1",
      status: "applied",
      actorId: "applier",
      lastEventId: "evt_effect_applied",
    });
    expect(explainEffect(projection, "effect_1")).toEqual([
      "evt_effect_requested",
      "evt_approval_requested",
      "evt_approval_granted",
      "evt_effect_applied",
    ]);
  });

  it("records projection errors for applying before approval", () => {
    const events = [
      event("evt_effect_requested", "effect.requested", "responder", null, {
        effectId: "effect_1",
        action: "notify",
      }),
      event("evt_effect_applied", "effect.applied", "applier", "evt_effect_requested", {
        effectId: "effect_1",
      }),
    ];

    const projection = projectEffects(events);

    expect(projection.effects.effect_1.status).toBe("requested");
    expect(projection.errors).toEqual([
      {
        eventId: "evt_effect_applied",
        type: "effect.applied",
        message: "Cannot apply effect.applied to effect effect_1 in requested state",
      },
    ]);
  });

  it("can rebuild a causal chain for an applied effect", () => {
    const events = effectLifecycleEvents();

    expect(causalChain(events, "evt_effect_applied").map((event) => event.id)).toEqual([
      "evt_effect_requested",
      "evt_approval_requested",
      "evt_approval_granted",
      "evt_effect_applied",
    ]);
  });
});

function effectLifecycleEvents(): EventEnvelope[] {
  return [
    event("evt_effect_requested", "effect.requested", "responder", null, {
      effectId: "effect_1",
      action: "notify",
      target: "ops",
      description: "Notify ops",
    }),
    event("evt_approval_requested", "approval.requested", "safety", "evt_effect_requested", {
      effectId: "effect_1",
      approvalId: "approval_1",
      reason: "Needs a human",
    }),
    event("evt_approval_granted", "approval.granted", "human", "evt_approval_requested", {
      effectId: "effect_1",
      approvalId: "approval_1",
      reason: "Approved",
    }),
    event("evt_effect_applied", "effect.applied", "applier", "evt_approval_granted", {
      effectId: "effect_1",
      action: "notify",
      target: "ops",
    }),
  ];
}

function event(
  id: string,
  type: string,
  actorId: string,
  parentEventId: string | null,
  payload: Record<string, unknown>,
): EventEnvelope {
  return createEvent({
    id,
    type,
    actorId,
    threadId: "thread_ops",
    parentEventId,
    causedBy: parentEventId ? [parentEventId] : [],
    timestamp: "2026-04-29T12:00:00.000Z",
    payload,
  });
}
