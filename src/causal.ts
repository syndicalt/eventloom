import type { EventEnvelope } from "./events.js";

/**
 * Builds an id-indexed lookup map for an ordered Eventloom event history.
 */
export function eventById(events: readonly EventEnvelope[]): Map<string, EventEnvelope> {
  return new Map(events.map((event) => [event.id, event]));
}

/**
 * Returns the deterministic parent and caused-by event chain ending at the requested event id.
 */
export function causalChain(events: readonly EventEnvelope[], eventId: string): EventEnvelope[] {
  const byId = eventById(events);
  const chain: EventEnvelope[] = [];
  const visited = new Set<string>();

  visit(eventId);
  return chain;

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);

    const event = byId.get(id);
    if (!event) return;

    for (const causeId of event.causedBy) visit(causeId);
    if (event.parentEventId) visit(event.parentEventId);
    chain.push(event);
  }
}
