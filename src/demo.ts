import { rm } from "node:fs/promises";
import { createSoftwareWorkRegistry } from "./actors.js";
import { JsonlEventStore } from "./event-store.js";
import { createEvent } from "./events.js";
import { Orchestrator } from "./orchestrator.js";

export async function runSoftwareWorkDemo(path: string): Promise<void> {
  await rm(path, { force: true });

  const store = new JsonlEventStore(path);
  const actors = createSoftwareWorkRegistry();
  const orchestrator = new Orchestrator(store, actors);
  const goal = await store.append(createEvent({
    id: "evt_demo_goal",
    type: "goal.created",
    actorId: "user",
    threadId: "thread_main",
    parentEventId: null,
    payload: { title: "Build actor/intention workflow" },
  }));

  const proposed = await orchestrator.submitIntention({
    type: "task.propose",
    actorId: "planner",
    threadId: "thread_main",
    parentEventId: goal.id,
    causedBy: [goal.id],
    payload: {
      taskId: "task_actor_intentions",
      title: "Add actor registry and intention orchestration",
    },
  });
  const claimed = await orchestrator.submitIntention({
    type: "task.claim",
    actorId: "worker",
    threadId: "thread_main",
    parentEventId: proposed.event.id,
    causedBy: [proposed.event.id],
    payload: { taskId: "task_actor_intentions" },
  });
  const completed = await orchestrator.submitIntention({
    type: "task.complete",
    actorId: "worker",
    threadId: "thread_main",
    parentEventId: claimed.event.id,
    causedBy: [claimed.event.id],
    payload: { taskId: "task_actor_intentions" },
  });
  const review = await orchestrator.submitIntention({
    type: "review.request",
    actorId: "worker",
    threadId: "thread_main",
    parentEventId: completed.event.id,
    causedBy: [completed.event.id],
    payload: { taskId: "task_actor_intentions" },
  });
  await orchestrator.submitIntention({
    type: "review.approve",
    actorId: "reviewer",
    threadId: "thread_main",
    parentEventId: review.event.id,
    causedBy: [review.event.id],
    payload: { taskId: "task_actor_intentions" },
  });
}
