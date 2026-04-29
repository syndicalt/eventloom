import { createHash } from "node:crypto";
import type { EventEnvelope } from "./events.js";
import { canonicalJson } from "./projection.js";

export interface SealedEvent extends EventEnvelope {
  integrity: {
    hash: string;
    previousHash: string | null;
  };
}

export interface IntegrityError {
  eventId: string;
  message: string;
}

export interface IntegrityReport {
  ok: boolean;
  errors: IntegrityError[];
}

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

export function verifyEventChain(events: readonly EventEnvelope[]): IntegrityReport {
  const errors: IntegrityError[] = [];
  let previousHash: string | null = null;

  for (const event of events) {
    if (!event.integrity) {
      errors.push({
        eventId: event.id,
        message: "Missing integrity metadata",
      });
      previousHash = null;
      continue;
    }

    if (event.integrity.previousHash !== previousHash) {
      errors.push({
        eventId: event.id,
        message: `Expected previous hash ${previousHash ?? "null"} but found ${event.integrity.previousHash ?? "null"}`,
      });
    }

    const expectedHash = hashEvent(stripIntegrity(event), event.integrity.previousHash);
    if (event.integrity.hash !== expectedHash) {
      errors.push({
        eventId: event.id,
        message: "Event hash does not match event contents",
      });
    }

    previousHash = event.integrity.hash;
  }

  return { ok: errors.length === 0, errors };
}

export function hashEvent(event: EventEnvelope, previousHash: string | null): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson({ event: stripIntegrity(event), previousHash }))
    .digest("hex")}`;
}

export function stripIntegrity(event: EventEnvelope): EventEnvelope {
  const { integrity: _integrity, ...unsigned } = event;
  return unsigned;
}
