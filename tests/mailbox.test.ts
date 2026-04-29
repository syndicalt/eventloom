import { describe, expect, it } from "vitest";
import { createSoftwareWorkRegistry } from "../src/actors.js";
import { createEvent } from "../src/events.js";
import { formatMailbox } from "../src/inspect.js";
import { buildMailbox } from "../src/mailbox.js";

describe("mailboxes", () => {
  it("delivers subscribed event types to an actor", () => {
    const registry = createSoftwareWorkRegistry();
    const events = [
      event("evt_goal", "goal.created", "user", null, { title: "Build" }),
      event("evt_task", "task.proposed", "planner", "evt_goal", {
        taskId: "task_1",
        title: "Implement mailbox",
      }),
    ];

    expect(buildMailbox(registry, "planner", events).map((item) => item.event.type)).toEqual([
      "goal.created",
    ]);
    expect(buildMailbox(registry, "worker", events).map((item) => item.event.type)).toEqual([
      "task.proposed",
    ]);
  });

  it("does not deliver unrelated event types", () => {
    const registry = createSoftwareWorkRegistry();
    const events = [
      event("evt_task", "task.proposed", "planner", null, { taskId: "task_1" }),
    ];

    expect(buildMailbox(registry, "reviewer", events)).toEqual([]);
  });

  it("errors clearly for unknown actors", () => {
    const registry = createSoftwareWorkRegistry();

    expect(() => buildMailbox(registry, "missing", [])).toThrow("Actor missing is not registered");
  });

  it("excludes events already processed by the actor", () => {
    const registry = createSoftwareWorkRegistry();
    const events = [
      event("evt_task", "task.proposed", "planner", null, { taskId: "task_1" }),
      event("evt_processed", "actor.processed", "worker", "evt_task", { sourceEventId: "evt_task" }),
    ];

    expect(buildMailbox(registry, "worker", events)).toEqual([]);
  });

  it("formats mailbox items with task context", () => {
    const registry = createSoftwareWorkRegistry();
    const events = [
      event("evt_task", "task.proposed", "planner", null, {
        taskId: "task_1",
        title: "Implement mailbox",
      }),
    ];

    expect(formatMailbox("worker", buildMailbox(registry, "worker", events))).toContain(
      "01 evt_task task.proposed from=planner task=task_1 status=proposed",
    );
  });
});

function event(
  id: string,
  type: string,
  actorId: string,
  parentEventId: string | null,
  payload: Record<string, unknown>,
) {
  return createEvent({
    id,
    type,
    actorId,
    threadId: "thread_main",
    parentEventId,
    causedBy: parentEventId ? [parentEventId] : [],
    timestamp: "2026-04-29T12:00:00.000Z",
    payload,
  });
}
