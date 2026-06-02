import { createHash } from "node:crypto";
import type { EventEnvelope } from "./events.js";

export type Reducer<TProjection> = (
  projection: TProjection,
  event: EventEnvelope,
) => TProjection;

/**
 * Applies a deterministic reducer over append-ordered events to rebuild a
 * projection from an initial value.
 */
export function replay<TProjection>(
  events: readonly EventEnvelope[],
  initialProjection: TProjection,
  reducer: Reducer<TProjection>,
): TProjection {
  return events.reduce(reducer, initialProjection);
}

/**
 * Counts events by type using the same replay primitive as richer
 * projections.
 */
export function eventTypeCounts(events: readonly EventEnvelope[]): Record<string, number> {
  return replay<Record<string, number>>(events, {}, (counts, event) => ({
    ...counts,
    [event.type]: (counts[event.type] ?? 0) + 1,
  }));
}

/**
 * Returns a stable SHA-256 hash for canonicalized projection data.
 */
export function projectionHash(projection: unknown): string {
  return createHash("sha256").update(canonicalJson(projection)).digest("hex");
}

/**
 * Serializes JSON-compatible data with recursively sorted object keys for
 * deterministic hashing and comparisons.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
