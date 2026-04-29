import type { EventEnvelope } from "./events.js";
import { verifyEventChain, type IntegrityReport } from "./integrity.js";
import { projectTasks, type TaskState } from "./task-projection.js";

export interface HandoffSummary {
  eventCount: number;
  integrity: IntegrityReport;
  goals: HandoffGoal[];
  tasks: {
    active: HandoffTask[];
    completed: HandoffTask[];
  };
  decisions: HandoffFact[];
  verification: HandoffFact[];
  nextActions: string[];
}

export interface HandoffGoal {
  id: string;
  actorId: string;
  title: string;
  timestamp: string;
}

export interface HandoffTask {
  id: string;
  title?: string;
  status: TaskState["status"];
  actorId: string;
  lastEventId: string;
}

export interface HandoffFact {
  id: string;
  type: string;
  actorId: string;
  timestamp: string;
  summary: string;
}

const completedStatuses = new Set<TaskState["status"]>(["completed", "approved"]);

export function summarizeHandoff(events: readonly EventEnvelope[]): HandoffSummary {
  const tasks = Object.values(projectTasks(events).tasks)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(taskSummary);
  const active = tasks.filter((task) => !completedStatuses.has(task.status));
  const completed = tasks.filter((task) => completedStatuses.has(task.status));

  return {
    eventCount: events.length,
    integrity: verifyEventChain(events),
    goals: events
      .filter((event) => event.type === "goal.created")
      .map(goalSummary),
    tasks: { active, completed },
    decisions: factsFor(events, "decision.recorded"),
    verification: events
      .filter((event) => event.type.startsWith("verification."))
      .map(factSummary),
    nextActions: nextActions(active),
  };
}

export function formatHandoffSummary(summary: HandoffSummary): string {
  return [
    "handoff summary",
    `events: ${summary.eventCount}`,
    `integrity: ${summary.integrity.ok ? "ok" : "failed"}`,
    "",
    section("goals", summary.goals.map((goal) => `- ${goal.title} (${goal.id})`)),
    "",
    section("active tasks", summary.tasks.active.map(formatTask)),
    "",
    section("completed tasks", summary.tasks.completed.map(formatTask)),
    "",
    section("decisions", summary.decisions.map(formatFact)),
    "",
    section("verification", summary.verification.map(formatFact)),
    "",
    section("next actions", summary.nextActions.map((action) => `- ${action}`)),
  ].join("\n");
}

function goalSummary(event: EventEnvelope): HandoffGoal {
  return {
    id: event.id,
    actorId: event.actorId,
    title: stringPayload(event, "title") ?? "(untitled goal)",
    timestamp: event.timestamp,
  };
}

function taskSummary(task: TaskState): HandoffTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    actorId: task.actorId,
    lastEventId: task.lastEventId,
  };
}

function factsFor(events: readonly EventEnvelope[], type: string): HandoffFact[] {
  return events.filter((event) => event.type === type).map(factSummary);
}

function factSummary(event: EventEnvelope): HandoffFact {
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    timestamp: event.timestamp,
    summary: (
      stringPayload(event, "summary") ??
      stringPayload(event, "decision") ??
      stringPayload(event, "title") ??
      JSON.stringify(event.payload)
    ),
  };
}

function nextActions(active: readonly HandoffTask[]): string[] {
  if (active.length === 0) return ["No active tasks remain."];
  return active.map((task) => {
    const label = task.title ? `${task.id}: ${task.title}` : task.id;
    return `Continue ${label} (${task.status}).`;
  });
}

function stringPayload(event: EventEnvelope, key: string): string | null {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function section(title: string, lines: string[]): string {
  return [title + ":", ...(lines.length > 0 ? lines : ["- none"])].join("\n");
}

function formatTask(task: HandoffTask): string {
  const title = task.title ? ` ${task.title}` : "";
  return `- ${task.id}${title} status=${task.status} lastActor=${task.actorId}`;
}

function formatFact(fact: HandoffFact): string {
  return `- ${fact.summary} (${fact.type} by ${fact.actorId})`;
}
