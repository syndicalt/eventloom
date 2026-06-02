import { createHash } from "node:crypto";
import type { EventEnvelope } from "./events.js";
import { canonicalJson } from "./projection.js";

/**
 * Event envelope after hash-chain integrity metadata has been sealed onto it.
 */
export interface SealedEvent extends EventEnvelope {
  integrity: {
    hash: string;
    previousHash: string | null;
  };
}

/**
 * Structured integrity verification failure for one event or physical log line.
 */
export interface IntegrityError {
  code: "missing_integrity" | "previous_hash_mismatch" | "hash_mismatch" | "duplicate_event_id";
  eventId: string | null;
  line?: number;
  expected?: string | null;
  actual?: string | null;
  message: string;
}

/**
 * Integrity verification result for an ordered event sequence.
 */
export interface IntegrityReport {
  ok: boolean;
  errors: IntegrityError[];
}

/**
 * Seals an event with SHA-256 hash-chain integrity metadata for the supplied
 * previous event hash.
 */
export function sealEvent(event: EventEnvelope, previousHash: string | null): SealedEvent {
  const unsigned = stripIntegrity(event);
  const hash = hashEvent(unsigned, previousHash);

  return {
    ...unsigned,
    integrity: {
      hash,
      previousHash,
    },
  };
}

/**
 * Verifies an append-ordered event sequence for missing integrity, duplicate
 * ids, previous-hash mismatches, and content hash mismatches.
 */
export function verifyEventChain(events: readonly EventEnvelope[]): IntegrityReport {
  const errors: IntegrityError[] = [];
  let previousHash: string | null = null;
  const seenIds = new Set<string>();

  for (const [index, event] of events.entries()) {
    const line = index + 1;
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

/**
 * Computes the canonical SHA-256 event hash from an unsigned event and its
 * previous chain hash.
 */
export function hashEvent(event: EventEnvelope, previousHash: string | null): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson({ event: stripIntegrity(event), previousHash }))
    .digest("hex")}`;
}

/**
 * Returns an event envelope without integrity metadata for hashing,
 * comparison, or re-sealing workflows.
 */
export function stripIntegrity(event: EventEnvelope): EventEnvelope {
  const { integrity: _integrity, ...unsigned } = event;
  return unsigned;
}
