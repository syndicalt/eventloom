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
  return events.flatMap((event, index) => {
    if (!actor.subscriptions.includes(event.type)) return [];

    const taskProjection = projectTasks(events.slice(0, index + 1));
    return [{
      event,
      task: taskForEvent(event, taskProjection.tasks),
    }];
  });
}

function taskForEvent(
  event: EventEnvelope,
  tasks: Record<string, TaskState>,
): TaskState | undefined {
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : null;
  if (!taskId) return undefined;
  return tasks[taskId];
}
