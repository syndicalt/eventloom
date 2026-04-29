import type { ActorDefinition, ActorRegistry } from "./actors.js";
import type { EventEnvelope } from "./events.js";
import { projectTasks, type TaskState } from "./task-projection.js";

export interface MailboxItem {
  event: EventEnvelope;
  task?: TaskState;
}

export function buildMailbox(
  registry: ActorRegistry,
  actorId: string,
  events: readonly EventEnvelope[],
): MailboxItem[] {
  const actor = registry.require(actorId);
  return buildMailboxForActor(actor, events);
}

export function buildMailboxForActor(
  actor: ActorDefinition,
  events: readonly EventEnvelope[],
): MailboxItem[] {
  const processed = processedSourceEvents(actor.id, events);

  return events.flatMap((event, index) => {
    if (!actor.subscriptions.includes(event.type)) return [];
    if (processed.has(event.id)) return [];

    const taskProjection = projectTasks(events.slice(0, index + 1));
    return [{
      event,
      task: taskForEvent(event, taskProjection.tasks),
    }];
  });
}

export function processedSourceEvents(
  actorId: string,
  events: readonly EventEnvelope[],
): Set<string> {
  const processed = new Set<string>();
  for (const event of events) {
    if (event.type !== "actor.processed" || event.actorId !== actorId) continue;
    if (typeof event.payload.sourceEventId === "string") {
      processed.add(event.payload.sourceEventId);
    }
  }
  return processed;
}

function taskForEvent(
  event: EventEnvelope,
  tasks: Record<string, TaskState>,
): TaskState | undefined {
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : null;
  if (!taskId) return undefined;
  return tasks[taskId];
}
