import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { sealEvent, verifyEventChain } from "../src/integrity.js";

describe("event integrity", () => {
  it("verifies a sealed hash chain", () => {
    const first = sealEvent(event("evt_first", "goal.created", null), null);
    const second = sealEvent(event("evt_second", "task.proposed", "evt_first"), first.integrity.hash);

    expect(verifyEventChain([first, second])).toEqual({ ok: true, errors: [] });
  });

  it("detects edited event contents", () => {
    const first = sealEvent(event("evt_first", "goal.created", null), null);
    const edited = {
      ...first,
      payload: { title: "Edited after sealing" },
    };

    expect(verifyEventChain([edited])).toEqual({
      ok: false,
      errors: [
        {
          eventId: "evt_first",
          message: "Event hash does not match event contents",
        },
      ],
    });
  });

  it("detects reordered events", () => {
    const first = sealEvent(event("evt_first", "goal.created", null), null);
    const second = sealEvent(event("evt_second", "task.proposed", "evt_first"), first.integrity.hash);

    const report = verifyEventChain([second, first]);

    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.eventId)).toEqual(["evt_second", "evt_first"]);
  });

  it("detects unsealed events", () => {
    expect(verifyEventChain([event("evt_first", "goal.created", null)])).toEqual({
      ok: false,
      errors: [
        {
          eventId: "evt_first",
          message: "Missing integrity metadata",
        },
      ],
    });
  });
});

function event(id: string, type: string, parentEventId: string | null) {
  return createEvent({
    id,
    type,
    actorId: "tester",
    threadId: "thread_main",
    parentEventId,
    causedBy: parentEventId ? [parentEventId] : [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { title: "Integrity test", taskId: "task_1" },
  });
}
