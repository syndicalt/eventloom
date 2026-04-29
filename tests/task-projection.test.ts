import { describe, expect, it } from "vitest";
import { createEvent, type EventEnvelope } from "../src/events.js";
import { causalChain } from "../src/causal.js";
import { explainTask, projectTasks } from "../src/task-projection.js";

describe("task projection", () => {
  it("advances tasks through valid state-machine transitions", () => {
    const events = taskLifecycleEvents();

    const projection = projectTasks(events);

    expect(projection.errors).toEqual([]);
    expect(projection.tasks.task_1).toMatchObject({
      id: "task_1",
      title: "Implement task projection",
      status: "approved",
      actorId: "reviewer",
      lastEventId: "evt_review_approved",
    });
    expect(explainTask(projection, "task_1")).toEqual([
      "evt_task_proposed",
      "evt_task_claimed",
      "evt_task_completed",
      "evt_review_requested",
      "evt_review_approved",
    ]);
  });

  it("records projection errors for impossible transitions", () => {
    const events = [
      event("evt_task_proposed", "task.proposed", "planner", null, { taskId: "task_1" }),
      event("evt_review_approved", "review.approved", "reviewer", "evt_task_proposed", { taskId: "task_1" }),
    ];

    const projection = projectTasks(events);

    expect(projection.tasks.task_1.status).toBe("proposed");
    expect(projection.errors).toEqual([
      {
        eventId: "evt_review_approved",
        type: "review.approved",
        message: "Cannot apply review.approved to task task_1 in proposed state",
      },
    ]);
  });

  it("can rebuild a causal chain for the final task event", () => {
    const events = taskLifecycleEvents();

    expect(causalChain(events, "evt_review_approved").map((event) => event.id)).toEqual([
      "evt_task_proposed",
      "evt_task_claimed",
      "evt_task_completed",
      "evt_review_requested",
      "evt_review_approved",
    ]);
  });
});

function taskLifecycleEvents(): EventEnvelope[] {
  return [
    event("evt_task_proposed", "task.proposed", "planner", null, {
      taskId: "task_1",
      title: "Implement task projection",
    }),
    event("evt_task_claimed", "task.claimed", "worker", "evt_task_proposed", { taskId: "task_1" }),
    event("evt_task_completed", "task.completed", "worker", "evt_task_claimed", { taskId: "task_1" }),
    event("evt_review_requested", "review.requested", "worker", "evt_task_completed", { taskId: "task_1" }),
    event("evt_review_approved", "review.approved", "reviewer", "evt_review_requested", { taskId: "task_1" }),
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
    threadId: "thread_main",
    parentEventId,
    causedBy: parentEventId ? [parentEventId] : [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload,
  });
}
