import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlEventStore, EventStoreReadError } from "../src/event-store.js";
import { createEvent } from "../src/events.js";

describe("JsonlEventStore", () => {
  it("appends and reloads validated events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-store-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));
    const event = createEvent({
      id: "evt_append_test",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Test append" },
    });

    await store.append(event);

    await expect(store.readAll()).resolves.toEqual([event]);
  });

  it("returns an empty list for a missing log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-store-"));
    const store = new JsonlEventStore(join(dir, "missing.jsonl"));

    await expect(store.readAll()).resolves.toEqual([]);
  });

  it("rejects malformed event log lines with line context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-store-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, "{\"id\":\"not-valid\"}\n", "utf8");

    const store = new JsonlEventStore(path);

    await expect(store.readAll()).rejects.toThrow(EventStoreReadError);
    await expect(store.readAll()).rejects.toThrow("line 1");
  });
});
