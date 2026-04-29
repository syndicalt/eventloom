import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { canonicalJson, eventTypeCounts, projectionHash, replay } from "../src/projection.js";

describe("projection replay", () => {
  it("replays events into deterministic projections", () => {
    const events = [
      createEvent({
        id: "evt_goal_created",
        type: "goal.created",
        actorId: "user",
        threadId: "thread_main",
        parentEventId: null,
        timestamp: "2026-04-28T22:00:00.000Z",
        payload: { title: "Build Threadline" },
      }),
      createEvent({
        id: "evt_task_proposed",
        type: "task.proposed",
        actorId: "planner",
        threadId: "thread_main",
        parentEventId: "evt_goal_created",
        causedBy: ["evt_goal_created"],
        timestamp: "2026-04-28T22:01:00.000Z",
        payload: { taskId: "task_event_store" },
      }),
    ];

    const firstProjection = eventTypeCounts(events);
    const secondProjection = replay(events, {}, (projection, event) => ({
      ...projection,
      [event.type]: (projection[event.type] ?? 0) + 1,
    }));

    expect(firstProjection).toEqual({ "goal.created": 1, "task.proposed": 1 });
    expect(projectionHash(firstProjection)).toEqual(projectionHash(secondProjection));
  });

  it("canonicalizes object keys before hashing", () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe("{\"a\":{\"c\":3,\"d\":4},\"b\":1}");
  });
});
