import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlEventStore, EventStoreReadError } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { verifyEventChain } from "../src/integrity.js";

describe("JsonlEventStore", () => {
  it("appends and reloads validated events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
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

    const sealed = await store.append(event);

    expect(sealed.integrity.previousHash).toBeNull();
    await expect(store.readAll()).resolves.toEqual([sealed]);
  });

  it("preserves hash-chain integrity under concurrent appends", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));

    await Promise.all(Array.from({ length: 50 }, (_, index) => store.append(createEvent({
      id: `evt_concurrent_${index}`,
      type: "task.proposed",
      actorId: "codex",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: `2026-04-28T22:00:${String(index).padStart(2, "0")}.000Z`,
      payload: { taskId: `task_concurrent_${index}`, title: `Concurrent append ${index}` },
    }))));

    const events = await store.readAll();
    expect(events).toHaveLength(50);
    expect(verifyEventChain(events)).toEqual({ ok: true, errors: [] });
  });

  it("returns an empty list for a missing log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const store = new JsonlEventStore(join(dir, "missing.jsonl"));

    await expect(store.readAll()).resolves.toEqual([]);
  });

  it("rejects malformed event log lines with line context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, "{\"id\":\"not-valid\"}\n", "utf8");

    const store = new JsonlEventStore(path);

    await expect(store.readAll()).rejects.toThrow(EventStoreReadError);
    await expect(store.readAll()).rejects.toThrow("line 1");
  });
});
