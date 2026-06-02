import type { EventEnvelope } from "./events.js";
import type { EventLogVerificationReport } from "./event-store.js";
import { verifyEventChain, type IntegrityReport } from "./integrity.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectRuntime } from "./runtime.js";

/**
 * Stable read-only statistics model for an Eventloom event sequence.
 */
export interface EventLogStats {
  version: "eventloom.stats.v1";
  eventCount: number;
  integrity: IntegrityReport | EventLogVerificationReport;
  projectionHash: string;
  eventTypes: EventTypeStat[];
  actors: ActorStat[];
  threads: ThreadStat[];
}

/**
 * Count for one event type in sorted statistics output.
 */
export interface EventTypeStat {
  type: string;
  count: number;
}

/**
 * Count for one actor id in sorted statistics output.
 */
export interface ActorStat {
  actorId: string;
  count: number;
}

/**
 * Count for one thread id in sorted statistics output.
 */
export interface ThreadStat {
  threadId: string;
  count: number;
}

/**
 * Filter options for stable event summary queries.
 */
export interface EventQuery {
  type?: string;
  actorId?: string;
  threadId?: string;
  limit?: number;
}

/**
 * Stable compact event shape returned by read-only query helpers.
 */
export interface EventSummary {
  id: string;
  type: string;
  actorId: string;
  threadId: string;
  timestamp: string;
  parentEventId: string | null;
  causedBy: string[];
  payload: Record<string, unknown>;
}

/**
 * Versioned result for exact-match event summary queries over a verified event
 * prefix.
 */
export interface EventQueryResult {
  version: "eventloom.query.v1";
  count: number;
  integrity: IntegrityReport | EventLogVerificationReport;
  events: EventSummary[];
}

/**
 * Builds deterministic event log statistics, integrity status, and projection
 * hash data for inspection and CLI queries.
 */
export function buildEventLogStats(
  events: readonly EventEnvelope[],
  integrity: IntegrityReport | EventLogVerificationReport = verifyEventChain(events),
): EventLogStats {
  return {
    version: "eventloom.stats.v1",
    eventCount: events.length,
    integrity,
    projectionHash: projectionHash(projectRuntime(events)),
    eventTypes: countBy(events, (event) => event.type, "type"),
    actors: countBy(events, (event) => event.actorId, "actorId"),
    threads: countBy(events, (event) => event.threadId, "threadId"),
  };
}

/**
 * Builds a versioned, deterministic event query result with source integrity
 * diagnostics preserved from the verified prefix scan.
 */
export function buildEventQueryResult(
  events: readonly EventEnvelope[],
  query: EventQuery = {},
  integrity: IntegrityReport | EventLogVerificationReport = verifyEventChain(events),
): EventQueryResult {
  const selected = filterEvents(events, query);
  return {
    version: "eventloom.query.v1",
    count: selected.length,
    integrity,
    events: selected,
  };
}

/**
 * Returns stable event summaries filtered by type, actor, thread, and optional
 * trailing result limit.
 */
export function filterEvents(events: readonly EventEnvelope[], query: EventQuery = {}): EventSummary[] {
  const selected = events
    .filter((event) => !query.type || event.type === query.type)
    .filter((event) => !query.actorId || event.actorId === query.actorId)
    .filter((event) => !query.threadId || event.threadId === query.threadId)
    .map(eventSummary);

  return typeof query.limit === "number" ? selected.slice(-query.limit) : selected;
}

function eventSummary(event: EventEnvelope): EventSummary {
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    threadId: event.threadId,
    timestamp: event.timestamp,
    parentEventId: event.parentEventId,
    causedBy: [...event.causedBy],
    payload: event.payload,
  };
}

function countBy<TKey extends "type" | "actorId" | "threadId">(
  events: readonly EventEnvelope[],
  selector: (event: EventEnvelope) => string,
  key: TKey,
): Array<Record<TKey, string> & { count: number }> {
  const counts = eventTypeCounts(events.map((event) => ({
    ...event,
    type: selector(event),
  })));
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ [key]: value, count }) as Record<TKey, string> & { count: number });
}
