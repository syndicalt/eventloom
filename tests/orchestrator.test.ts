import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ActorRegistry } from "../src/actors.js";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { Orchestrator } from "../src/orchestrator.js";
import { projectTasks } from "../src/task-projection.js";

describe("Orchestrator", () => {
  it("accepts supported actor intentions as sealed events", async () => {
    const { store, orchestrator } = await setup();
    const goal = await store.append(createEvent({
      id: "evt_goal",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      payload: { title: "Test goal" },
    }));

    const result = await orchestrator.submitIntention({
      type: "task.propose",
      actorId: "planner",
      threadId: "thread_main",
      parentEventId: goal.id,
      causedBy: [goal.id],
      payload: { taskId: "task_1", title: "Test task" },
    });

    expect(result.accepted).toBe(true);
    expect(result.event.type).toBe("task.proposed");
    expect(result.event.integrity.previousHash).toBe(goal.integrity.hash);
    expect((await store.verify()).ok).toBe(true);
    expect(projectTasks(await store.readAll()).tasks.task_1.status).toBe("proposed");
  });

  it("rejects unsupported actor intentions as sealed rejection events", async () => {
    const { store, orchestrator } = await setup();

    const result = await orchestrator.submitIntention({
      type: "review.approve",
      actorId: "planner",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      payload: { taskId: "task_1" },
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.rejected");
    expect(result.event.payload.reason).toBe("Actor planner cannot emit review.approve");
    expect((await store.verify()).ok).toBe(true);
  });

  it("rejects state-machine-invalid intentions before accepting events", async () => {
    const { store, orchestrator } = await setup();
    const result = await orchestrator.submitIntention({
      type: "task.claim",
      actorId: "worker",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      payload: { taskId: "missing" },
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.rejected");
    expect(result.event.payload.reason).toBe("Task missing does not exist");
    expect(projectTasks(await store.readAll()).errors).toEqual([]);
  });

  it("rejects malformed intentions", async () => {
    const { store, orchestrator } = await setup();

    const result = await orchestrator.submitIntention({
      type: "not.real",
      actorId: "planner",
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.invalid");
    expect((await store.verify()).ok).toBe(true);
  });
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "threadline-orchestrator-"));
  const store = new JsonlEventStore(join(dir, "events.jsonl"));
  const actors = new ActorRegistry();
  actors.register({
    id: "planner",
    role: "Plans tasks",
    subscriptions: ["goal.created"],
    intentions: ["task.propose"],
  });
  actors.register({
    id: "worker",
    role: "Works tasks",
    subscriptions: ["task.proposed"],
    intentions: ["task.claim"],
  });

  return {
    store,
    orchestrator: new Orchestrator(store, actors),
  };
}
