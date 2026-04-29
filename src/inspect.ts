import { causalChain, eventById } from "./causal.js";
import type { EventEnvelope } from "./events.js";
import { verifyEventChain } from "./integrity.js";
import type { MailboxItem } from "./mailbox.js";
import { projectTasks } from "./task-projection.js";

export function formatTimeline(events: readonly EventEnvelope[]): string {
  const integrity = verifyEventChain(events);
  const lines = [
    `integrity: ${integrity.ok ? "ok" : "failed"}`,
    "",
    ...events.map((event, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      const parent = event.parentEventId ? ` parent=${event.parentEventId}` : "";
      return `${ordinal} ${event.id} ${event.actorId} ${event.type}${parent}`;
    }),
  ];

  if (!integrity.ok) {
    lines.push("", "integrity errors:");
    for (const error of integrity.errors) {
      lines.push(`- ${error.eventId}: ${error.message}`);
    }
  }

  return lines.join("\n");
}

export function formatTaskExplanation(events: readonly EventEnvelope[], taskId: string): string {
  const projection = projectTasks(events);
  const task = projection.tasks[taskId];
  if (!task) return `Task ${taskId} was not found.`;

  const byId = eventById(events);
  const history = task.history
    .map((eventId) => byId.get(eventId))
    .filter((event): event is EventEnvelope => !!event);
  const causalEvents = causalChain(events, task.lastEventId);

  return [
    `task: ${task.id}`,
    `title: ${task.title ?? "(untitled)"}`,
    `status: ${task.status}`,
    `lastActor: ${task.actorId}`,
    `lastEvent: ${task.lastEventId}`,
    "",
    "history:",
    ...history.map((event) => `- ${event.type} by ${event.actorId} (${event.id})`),
    "",
    "causal chain:",
    ...causalEvents.map((event) => `- ${event.id} ${event.type} by ${event.actorId}`),
  ].join("\n");
}

export function formatMailbox(actorId: string, items: readonly MailboxItem[]): string {
  if (items.length === 0) return `mailbox: ${actorId}\n\n(empty)`;

  return [
    `mailbox: ${actorId}`,
    "",
    ...items.map((item, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      const parent = item.event.parentEventId ? ` parent=${item.event.parentEventId}` : "";
      const task = item.task ? ` task=${item.task.id} status=${item.task.status}` : "";
      return `${ordinal} ${item.event.id} ${item.event.type} from=${item.event.actorId}${parent}${task}`;
    }),
  ].join("\n");
}
