import { describe, expect, it } from "vitest";
import { createDeterministicEventFactory, EventFactoryOptionsError, EventValidationError, validateEvent } from "../src/events.js";

describe("event envelope validation", () => {
  it("throws a typed error with stable issue details for invalid envelopes", () => {
    const invalid = {
      id: "not-an-event-id",
      type: "goal",
      actorId: "",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: ["bad-cause"],
      timestamp: "not-a-date",
      payload: {},
    };

    expect(() => validateEvent(invalid)).toThrow(EventValidationError);

    try {
      validateEvent(invalid);
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: "EventValidationError",
        code: "invalid_event_envelope",
        eventId: "not-an-event-id",
      });
      expect((error as EventValidationError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "id", message: expect.any(String) }),
        expect.objectContaining({ path: "type", message: expect.any(String) }),
        expect.objectContaining({ path: "actorId", message: expect.any(String) }),
        expect.objectContaining({ path: "causedBy.0", message: expect.any(String) }),
        expect.objectContaining({ path: "timestamp", message: expect.any(String) }),
      ]));
    }
  });

  it("rejects unknown top-level envelope fields while preserving payload extensibility", () => {
    const event = {
      id: "evt_strict_envelope",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      timestamp: "2026-04-29T12:00:00.000Z",
      payload: {
        title: "Strict envelope",
        schemaVersion: 2,
        metadata: { source: "custom workflow" },
      },
      schemaVersion: 2,
    };

    expect(() => validateEvent(event)).toThrow(EventValidationError);

    try {
      validateEvent(event);
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: "EventValidationError",
        code: "invalid_event_envelope",
        eventId: "evt_strict_envelope",
      });
      expect((error as EventValidationError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "unrecognized_keys",
          path: "<root>",
          message: expect.stringContaining("schemaVersion"),
        }),
      ]));
    }

    const { schemaVersion: _schemaVersion, ...withoutExtraEnvelopeField } = event;
    expect(validateEvent(withoutExtraEnvelopeField).payload).toMatchObject({
      schemaVersion: 2,
      metadata: { source: "custom workflow" },
    });
  });

  it("throws typed diagnostics for invalid deterministic factory options", () => {
    expect(() => createDeterministicEventFactory({ timestamp: "not-a-date" })).toThrow(EventFactoryOptionsError);

    try {
      createDeterministicEventFactory({ timestamp: "not-a-date" });
      throw new Error("expected factory construction to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: "EventFactoryOptionsError",
        code: "invalid_event_factory_option",
        option: "timestamp",
        value: "not-a-date",
        suggestedAction: "Use a valid ISO timestamp and finite deterministic event factory settings.",
      });
    }
  });
});
