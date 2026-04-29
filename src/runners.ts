import { rm } from "node:fs/promises";
import type { ActorDefinition, ActorRegistry } from "./actors.js";
import { createSoftwareWorkRegistry } from "./actors.js";
import { JsonlEventStore } from "./event-store.js";
import { createEvent, type EventEnvelope } from "./events.js";
import type { Intention } from "./intentions.js";
import { buildMailboxForActor, type MailboxItem } from "./mailbox.js";
import { Orchestrator } from "./orchestrator.js";
import { canonicalJson } from "./projection.js";

export interface ActorRunnerContext {
  actor: ActorDefinition;
  mailbox: MailboxItem[];
  events: EventEnvelope[];
}

export type ActorRunner = (context: ActorRunnerContext) => Intention[];

export interface RuntimeLoopResult {
  iterations: number;
  appended: number;
  skipped: number;
  rejected: number;
  stoppedReason: "idle" | "max_iterations";
}

export interface RuntimeLoopOptions {
  maxIterations?: number;
}

export async function runRuntimeLoop(
  store: JsonlEventStore,
  registry: ActorRegistry,
  runners: Record<string, ActorRunner>,
  options: RuntimeLoopOptions = {},
): Promise<RuntimeLoopResult> {
  const maxIterations = options.maxIterations ?? 20;
  const submitted = new Set<string>();
  let appended = 0;
  let skipped = 0;
  let rejected = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const events = await store.readAll();
    const orchestrator = new Orchestrator(store, registry);
    let appendedThisIteration = 0;

    for (const actor of registry.all()) {
      const runner = runners[actor.id];
      if (!runner) continue;

      const mailbox = buildMailboxForActor(actor, events);
      const intentions = runner({ actor, mailbox, events });
      for (const intention of intentions) {
        const key = canonicalJson(intention);
        if (submitted.has(key)) {
          skipped += 1;
          continue;
        }
        submitted.add(key);

        const result = await orchestrator.submitIntention(intention);
        if (result.accepted) {
          appended += 1;
          appendedThisIteration += 1;
        } else {
          rejected += 1;
        }
      }
    }

    if (appendedThisIteration === 0) {
      return { iterations: iteration, appended, skipped, rejected, stoppedReason: "idle" };
    }
  }

  return { iterations: maxIterations, appended, skipped, rejected, stoppedReason: "max_iterations" };
}

export function createSoftwareWorkRunners(): Record<string, ActorRunner> {
  return {
    planner: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "goal.created")
      .map((item) => ({
        type: "task.propose",
        actorId: "planner",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          taskId: "task_actor_runtime",
          title: "Run actors from rebuilt mailboxes",
        },
      })),
    worker: ({ mailbox }) => mailbox.flatMap((item): Intention[] => {
      if (item.event.type === "task.proposed" && item.task?.status === "proposed") {
        return [{
          type: "task.claim",
          actorId: "worker",
          threadId: item.event.threadId,
          parentEventId: item.event.id,
          causedBy: [item.event.id],
          payload: { taskId: item.task.id },
        }];
      }
      if (item.event.type === "task.claimed" && item.task?.status === "claimed") {
        return [{
          type: "task.complete",
          actorId: "worker",
          threadId: item.event.threadId,
          parentEventId: item.event.id,
          causedBy: [item.event.id],
          payload: { taskId: item.task.id },
        }];
      }
      if (item.event.type === "task.completed" && item.task?.status === "completed") {
        return [{
          type: "review.request",
          actorId: "worker",
          threadId: item.event.threadId,
          parentEventId: item.event.id,
          causedBy: [item.event.id],
          payload: { taskId: item.task.id },
        }];
      }
      return [];
    }),
    reviewer: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "review.requested" && item.task?.status === "review_requested")
      .map((item) => ({
        type: "review.approve",
        actorId: "reviewer",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: { taskId: item.task?.id },
      })),
  };
}

export async function runSoftwareWorkRuntime(path: string): Promise<RuntimeLoopResult> {
  await rm(path, { force: true });

  const store = new JsonlEventStore(path);
  await store.append(createEvent({
    id: "evt_runtime_goal",
    type: "goal.created",
    actorId: "user",
    threadId: "thread_main",
    parentEventId: null,
    payload: { title: "Build deterministic actor runners" },
  }));

  return runRuntimeLoop(
    store,
    createSoftwareWorkRegistry(),
    createSoftwareWorkRunners(),
  );
}
