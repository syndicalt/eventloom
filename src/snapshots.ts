import type { EventEnvelope } from "./events.js";
import { hashEvent, stripIntegrity, verifyEventChain, type IntegrityReport } from "./integrity.js";
import { projectionHash } from "./projection.js";
import {
  applyRuntimeEvent,
  projectRuntime,
  type RuntimeProjection,
  type RuntimeReplay,
} from "./runtime.js";

export const projectionSnapshotFormat = "eventloom.projection-snapshot.v1";

/**
 * Cache-only runtime projection snapshot anchored to a verified event prefix.
 */
export interface ProjectionSnapshot {
  format: typeof projectionSnapshotFormat;
  createdAt: string;
  eventCount: number;
  eventIds: string[];
  lastEventId: string | null;
  lastEventHash: string | null;
  projection: RuntimeProjection;
  projectionHash: string;
}

/**
 * Options for deterministic or caller-specified projection snapshot metadata.
 */
export interface ProjectionSnapshotOptions {
  createdAt?: string;
}

/**
 * Runtime replay result produced by applying verified tail events to a
 * projection snapshot.
 */
export interface SnapshotReplay extends RuntimeReplay {
  snapshot: ProjectionSnapshot;
  tailEventCount: number;
}

/**
 * Stable error for invalid projection snapshot formats or tails that do not
 * continue from the snapshot anchor.
 */
export class SnapshotReplayError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_snapshot_format" | "invalid_snapshot_tail",
    readonly eventId: string | null = null,
  ) {
    super(message);
    this.name = "SnapshotReplayError";
  }
}

/**
 * Creates a cache-only runtime projection snapshot after verifying the source
 * event chain, without changing canonical full-replay semantics.
 */
export function createProjectionSnapshot(
  events: readonly EventEnvelope[],
  options: ProjectionSnapshotOptions = {},
): ProjectionSnapshot {
  const integrity = verifyEventChain(events);
  if (!integrity.ok) {
    const firstError = integrity.errors[0];
    throw new SnapshotReplayError(
      firstError?.message ?? "Cannot snapshot an invalid event chain",
      "invalid_snapshot_tail",
      firstError?.eventId ?? null,
    );
  }

  const projection = projectRuntime(events);
  const lastEvent = events.at(-1);
  return {
    format: projectionSnapshotFormat,
    createdAt: options.createdAt ?? new Date().toISOString(),
    eventCount: events.length,
    eventIds: events.map((event) => event.id),
    lastEventId: lastEvent?.id ?? null,
    lastEventHash: lastEvent?.integrity?.hash ?? null,
    projection,
    projectionHash: projectionHash(projection),
  };
}

/**
 * Replays tail events from a verified projection snapshot and returns a
 * runtime replay result equivalent to full replay when the tail is valid.
 */
export function replayFromProjectionSnapshot(
  snapshot: ProjectionSnapshot,
  tailEvents: readonly EventEnvelope[],
  integrity?: IntegrityReport,
): SnapshotReplay {
  assertSnapshotFormat(snapshot);
  assertTailContinuesSnapshot(snapshot, tailEvents);

  const projection = tailEvents.reduce(applyRuntimeEvent, snapshot.projection);
  return {
    version: "eventloom.replay.v1",
    eventCount: snapshot.eventCount + tailEvents.length,
    integrity: integrity ?? verifySnapshotTail(snapshot, tailEvents),
    projection,
    projectionHash: projectionHash(projection),
    snapshot,
    tailEventCount: tailEvents.length,
  };
}

function assertSnapshotFormat(snapshot: ProjectionSnapshot): void {
  if (snapshot.format !== projectionSnapshotFormat) {
    throw new SnapshotReplayError(
      `Unsupported projection snapshot format ${snapshot.format}`,
      "invalid_snapshot_format",
    );
  }
  if (!hasValidSnapshotEventIds(snapshot)) {
    throw new SnapshotReplayError("Projection snapshot event ids do not match its event count", "invalid_snapshot_format");
  }
  if (projectionHash(snapshot.projection) !== snapshot.projectionHash) {
    throw new SnapshotReplayError("Projection snapshot hash does not match its projection", "invalid_snapshot_format");
  }
}

function hasValidSnapshotEventIds(snapshot: ProjectionSnapshot): boolean {
  return Array.isArray(snapshot.eventIds) &&
    snapshot.eventIds.length === snapshot.eventCount &&
    snapshot.eventIds.every((eventId) => typeof eventId === "string");
}

function assertTailContinuesSnapshot(snapshot: ProjectionSnapshot, tailEvents: readonly EventEnvelope[]): void {
  let previousHash = snapshot.lastEventHash;
  const seenIds = new Set(snapshot.eventIds);
  for (const event of tailEvents) {
    if (seenIds.has(event.id)) {
      throw new SnapshotReplayError(
        "Snapshot tail reuses event id from snapshot prefix",
        "invalid_snapshot_tail",
        event.id,
      );
    }
    seenIds.add(event.id);

    if (!event.integrity || event.integrity.previousHash !== previousHash) {
      throw new SnapshotReplayError(
        "Snapshot tail does not continue from snapshot hash",
        "invalid_snapshot_tail",
        event.id,
      );
    }

    const expectedHash = hashEvent(stripIntegrity(event), event.integrity.previousHash);
    if (event.integrity.hash !== expectedHash) {
      throw new SnapshotReplayError("Snapshot tail event hash does not match event contents", "invalid_snapshot_tail", event.id);
    }
    previousHash = event.integrity.hash;
  }
}

function verifySnapshotTail(snapshot: ProjectionSnapshot, tailEvents: readonly EventEnvelope[]): IntegrityReport {
  const errors: IntegrityReport["errors"] = [];
  let previousHash = snapshot.lastEventHash;
  const seenIds = new Set(snapshot.eventIds);

  for (const [index, event] of tailEvents.entries()) {
    const line = snapshot.eventCount + index + 1;
    if (seenIds.has(event.id)) {
      errors.push({
        code: "duplicate_event_id",
        eventId: event.id,
        line,
        message: `Duplicate event id ${event.id}`,
      });
    }
    seenIds.add(event.id);

    if (!event.integrity) {
      errors.push({
        code: "missing_integrity",
        eventId: event.id,
        line,
        message: "Missing integrity metadata",
      });
      previousHash = null;
      continue;
    }

    if (event.integrity.previousHash !== previousHash) {
      errors.push({
        code: "previous_hash_mismatch",
        eventId: event.id,
        line,
        expected: previousHash,
        actual: event.integrity.previousHash,
        message: `Expected previous hash ${previousHash ?? "null"} but found ${event.integrity.previousHash ?? "null"}`,
      });
    }

    const expectedHash = hashEvent(stripIntegrity(event), event.integrity.previousHash);
    if (event.integrity.hash !== expectedHash) {
      errors.push({
        code: "hash_mismatch",
        eventId: event.id,
        line,
        expected: expectedHash,
        actual: event.integrity.hash,
        message: "Event hash does not match event contents",
      });
    }

    previousHash = event.integrity.hash;
  }

  return { ok: errors.length === 0, errors };
}
