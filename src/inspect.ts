import { causalChain, eventById } from "./causal.js";
import type { EventEnvelope } from "./events.js";
import type { EventLogVerificationReport } from "./event-store.js";
import { summarizeHandoff, type HandoffSummary } from "./handoff.js";
import { verifyEventChain } from "./integrity.js";
import type { MailboxItem } from "./mailbox.js";
import { buildEventLogStats, filterEvents, type EventLogStats, type EventQuery, type EventSummary } from "./query.js";
import { projectTasks } from "./task-projection.js";

export interface TimelineEntry {
  ordinal: number;
  id: string;
  type: string;
  actorId: string;
  threadId: string;
  parentEventId: string | null;
  causedBy: string[];
  timestamp: string;
  hash?: string;
  previousHash?: string | null;
}

export interface TimelineModel {
  version: "eventloom.timeline.v1";
  eventCount: number;
  integrity: ReturnType<typeof verifyEventChain> | EventLogVerificationReport;
  events: TimelineEntry[];
}

export interface TaskExplanationEvent {
  id: string;
  type: string;
  actorId: string;
  threadId: string;
  parentEventId: string | null;
  causedBy: string[];
  timestamp: string;
  hash?: string;
  previousHash?: string | null;
}

export type TaskExplanationModel =
  | {
      version: "eventloom.task-explanation.v1";
      found: true;
      taskId: string;
      task: ReturnType<typeof projectTasks>["tasks"][string];
      history: TaskExplanationEvent[];
      causalChain: TaskExplanationEvent[];
      projectionErrors: ReturnType<typeof projectTasks>["errors"];
    }
  | {
      version: "eventloom.task-explanation.v1";
      found: false;
      taskId: string;
      task: null;
      history: [];
      causalChain: [];
      projectionErrors: ReturnType<typeof projectTasks>["errors"];
    };

export interface MailboxModel {
  version: "eventloom.mailbox.v1";
  workflow: "software-work";
  actorId: string;
  count: number;
  items: Array<{
    ordinal: number;
    event: TaskExplanationEvent;
    task: MailboxItem["task"] | null;
  }>;
}

/**
 * Versioned consolidated inspection model for one Eventloom log.
 *
 * The model is intentionally composed from stable read models so CLI and
 * package callers can fetch integrity, stats, timeline, and handoff context in
 * one read-only operation without changing replay semantics.
 */
export interface EventLogInspectionModel {
  version: "eventloom.inspect.v1";
  integrity: EventLogStats["integrity"];
  stats: EventLogStats;
  timeline: TimelineModel;
  handoff: HandoffSummary;
  selection?: EventLogInspectionSelection;
}

/**
 * Optional bounded event selection included when inspect callers provide query
 * filters. Full-log stats and handoff data remain unchanged.
 */
export interface EventLogInspectionSelection {
  totalEventCount: number;
  matchedEventCount: number;
  query: EventQuery;
  events: EventSummary[];
}

/**
 * Builds a consolidated log inspection model from replayed events and an
 * optional verified-prefix integrity report.
 */
export function buildEventLogInspectionModel(
  events: readonly EventEnvelope[],
  integrity: EventLogVerificationReport | ReturnType<typeof verifyEventChain> = verifyEventChain(events),
  query?: EventQuery,
): EventLogInspectionModel {
  const selectedQuery = hasEventQuery(query) ? query : undefined;
  const selectedEvents = selectedQuery ? selectEventEnvelopes(events, selectedQuery) : events;
  const model: EventLogInspectionModel = {
    version: "eventloom.inspect.v1",
    integrity,
    stats: buildEventLogStats(events, integrity),
    timeline: buildTimelineModel(selectedEvents, integrity),
    handoff: summarizeHandoff(events, integrity),
  };
  if (selectedQuery) {
    const selectedSummaries = filterEvents(events, selectedQuery);
    model.selection = {
      totalEventCount: events.length,
      matchedEventCount: selectedSummaries.length,
      query: compactEventQuery(selectedQuery),
      events: selectedSummaries,
    };
  }
  return model;
}

/**
 * Builds the versioned timeline read model used by CLI, MCP, and package
 * callers to inspect ordered event history.
 */
export function buildTimelineModel(
  events: readonly EventEnvelope[],
  integrity: ReturnType<typeof verifyEventChain> | EventLogVerificationReport = verifyEventChain(events),
): TimelineModel {
  return {
    version: "eventloom.timeline.v1",
    eventCount: events.length,
    integrity,
    events: events.map((event, index) => ({
      ordinal: index + 1,
      id: event.id,
      type: event.type,
      actorId: event.actorId,
      threadId: event.threadId,
      parentEventId: event.parentEventId,
      causedBy: event.causedBy,
      timestamp: event.timestamp,
      hash: event.integrity?.hash,
      previousHash: event.integrity?.previousHash,
    })),
  };
}

/**
 * Formats a timeline read model as stable human-readable text for CLI output
 * while preserving integrity failures in the rendered summary.
 */
export function formatTimeline(events: readonly EventEnvelope[]): string {
  const timeline = buildTimelineModel(events);
  const integrity = timeline.integrity;
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

/**
 * Formats one task explanation as stable human-readable text with lifecycle
 * history and causal-chain context.
 */
export function formatTaskExplanation(events: readonly EventEnvelope[], taskId: string): string {
  const explanation = buildTaskExplanationModel(events, taskId);
  if (!explanation.found) return `Task ${taskId} was not found.`;

  const task = explanation.task;
  return [
    `task: ${task.id}`,
    `title: ${task.title ?? "(untitled)"}`,
    `status: ${task.status}`,
    `lastActor: ${task.actorId}`,
    `lastEvent: ${task.lastEventId}`,
    "",
    "history:",
    ...explanation.history.map((event) => `- ${event.type} by ${event.actorId} (${event.id})`),
    "",
    "causal chain:",
    ...explanation.causalChain.map((event) => `- ${event.id} ${event.type} by ${event.actorId}`),
  ].join("\n");
}

/**
 * Builds the versioned task explanation read model for a task id from replayed
 * events, including projection errors and causal history.
 */
export function buildTaskExplanationModel(events: readonly EventEnvelope[], taskId: string): TaskExplanationModel {
  const projection = projectTasks(events);
  const task = projection.tasks[taskId];
  if (!task) {
    return {
      version: "eventloom.task-explanation.v1",
      found: false,
      taskId,
      task: null,
      history: [],
      causalChain: [],
      projectionErrors: projection.errors,
    };
  }

  const byId = eventById(events);
  const history = task.history
    .map((eventId) => byId.get(eventId))
    .filter((event): event is EventEnvelope => !!event);
  const causalEvents = causalChain(events, task.lastEventId);

  return {
    version: "eventloom.task-explanation.v1",
    found: true,
    taskId,
    task,
    history: history.map(explanationEvent),
    causalChain: causalEvents.map(explanationEvent),
    projectionErrors: projection.errors,
  };
}

/**
 * Builds the versioned actor mailbox read model from rebuilt mailbox items for
 * package, CLI, and MCP consumers.
 */
export function buildMailboxModel(actorId: string, items: readonly MailboxItem[]): MailboxModel {
  return {
    version: "eventloom.mailbox.v1",
    workflow: "software-work",
    actorId,
    count: items.length,
    items: items.map((item, index) => ({
      ordinal: index + 1,
      event: explanationEvent(item.event),
      task: item.task ?? null,
    })),
  };
}

/**
 * Formats rebuilt actor mailbox items as stable human-readable text for CLI
 * output.
 */
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

function explanationEvent(event: EventEnvelope): TaskExplanationEvent {
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    threadId: event.threadId,
    parentEventId: event.parentEventId,
    causedBy: event.causedBy,
    timestamp: event.timestamp,
    hash: event.integrity?.hash,
    previousHash: event.integrity?.previousHash,
  };
}

function hasEventQuery(query: EventQuery | undefined): query is EventQuery {
  return !!query
    && (query.type !== undefined
      || query.actorId !== undefined
      || query.threadId !== undefined
      || query.limit !== undefined);
}

function compactEventQuery(query: EventQuery): EventQuery {
  return {
    ...(query.type !== undefined ? { type: query.type } : {}),
    ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
    ...(query.threadId !== undefined ? { threadId: query.threadId } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  };
}

function selectEventEnvelopes(events: readonly EventEnvelope[], query: EventQuery): EventEnvelope[] {
  const selected = events
    .filter((event) => !query.type || event.type === query.type)
    .filter((event) => !query.actorId || event.actorId === query.actorId)
    .filter((event) => !query.threadId || event.threadId === query.threadId);

  return typeof query.limit === "number" ? selected.slice(-query.limit) : selected;
}
