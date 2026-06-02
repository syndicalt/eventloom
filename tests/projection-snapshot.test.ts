import { appendFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { createProjectionSnapshot, createRuntime, replayFromProjectionSnapshot, SnapshotReplayError, type ProjectionSnapshot } from "../src/index.js";
import { sealEvent } from "../src/integrity.js";
import { replayEvents } from "../src/runtime.js";

describe("projection snapshots", () => {
  it("replays a snapshot plus tail to the same projection hash as full replay", () => {
    const events = sealChain([
      createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot"),
      createTaskEvent("evt_task_claimed", "task.claimed", "task_snapshot"),
      createTaskEvent("evt_task_completed", "task.completed", "task_snapshot"),
      createTaskEvent("evt_review_requested", "review.requested", "task_snapshot"),
      createTaskEvent("evt_review_approved", "review.approved", "task_snapshot"),
    ]);
    const snapshot = roundTripSnapshot(createProjectionSnapshot(events.slice(0, 3), {
      createdAt: "2026-06-01T00:00:00.000Z",
    }));

    const replay = replayFromProjectionSnapshot(snapshot, events.slice(3));
    const fullReplay = replayEvents(events);

    expect(replay).toMatchObject({
      version: "eventloom.replay.v1",
      eventCount: fullReplay.eventCount,
      projectionHash: fullReplay.projectionHash,
      projection: fullReplay.projection,
      snapshot: {
        eventCount: 3,
        eventIds: ["evt_task_proposed", "evt_task_claimed", "evt_task_completed"],
        lastEventId: "evt_task_completed",
      },
      tailEventCount: 2,
    });
  });

  it("matches full replay for every split point in a serialized snapshot", () => {
    const events = sealChain([
      createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot", { title: "Snapshot task" }),
      createTaskEvent("evt_task_claimed", "task.claimed", "task_snapshot"),
      createTaskEvent("evt_task_completed", "task.completed", "task_snapshot"),
      createTaskEvent("evt_review_requested", "review.requested", "task_snapshot"),
      createTaskEvent("evt_review_approved", "review.approved", "task_snapshot"),
    ]);
    const fullReplay = replayEvents(events);

    for (let split = 0; split <= events.length; split += 1) {
      const snapshot = roundTripSnapshot(createProjectionSnapshot(events.slice(0, split), {
        createdAt: "2026-06-01T00:00:00.000Z",
      }));

      const replay = replayFromProjectionSnapshot(snapshot, events.slice(split));

      expect(replay.eventCount).toBe(fullReplay.eventCount);
      expect(replay.projection).toEqual(fullReplay.projection);
      expect(replay.projectionHash).toBe(fullReplay.projectionHash);
    }
  });

  it("replays from a runtime snapshot cache after verifying the log tail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-snapshot-cache-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const events = await store.appendMany([
      createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot", { title: "Snapshot task" }),
      createTaskEvent("evt_task_claimed", "task.claimed", "task_snapshot"),
      createTaskEvent("evt_task_completed", "task.completed", "task_snapshot"),
      createTaskEvent("evt_review_requested", "review.requested", "task_snapshot"),
      createTaskEvent("evt_review_approved", "review.approved", "task_snapshot"),
    ]);
    const cache = roundTripSnapshot(createProjectionSnapshot(events.slice(0, 3), {
      createdAt: "2026-06-01T00:00:00.000Z",
    }));

    const cached = await createRuntime(path).replayCached({ snapshot: cache });
    const full = await createRuntime(path).replay();

    expect(cached.cache).toEqual({ hit: true, reason: null });
    expect(cached.eventCount).toBe(full.eventCount);
    expect(cached.projection).toEqual(full.projection);
    expect(cached.projectionHash).toBe(full.projectionHash);
  });

  it("uses an empty snapshot as a valid runtime cache anchor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-empty-snapshot-cache-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.appendMany([
      createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot", { title: "Snapshot task" }),
      createTaskEvent("evt_task_claimed", "task.claimed", "task_snapshot"),
    ]);
    const cache = roundTripSnapshot(createProjectionSnapshot([], {
      createdAt: "2026-06-01T00:00:00.000Z",
    }));

    const cached = await createRuntime(path).replayCached({ snapshot: cache });
    const full = await createRuntime(path).replay();

    expect(cached.cache).toEqual({ hit: true, reason: null });
    expect(cached.projectionHash).toBe(full.projectionHash);
    expect(cached.projection).toEqual(full.projection);
  });

  it("falls back to full runtime replay when a snapshot anchor is stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-stale-snapshot-cache-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot"));
    const staleSnapshot = roundTripSnapshot({
      ...createProjectionSnapshot([], { createdAt: "2026-06-01T00:00:00.000Z" }),
      eventCount: 2,
      eventIds: ["evt_stale_missing_1", "evt_stale_missing_2"],
      lastEventHash: "sha256:stale",
    });

    const cached = await createRuntime(path).replayCached({ snapshot: staleSnapshot });
    const full = await createRuntime(path).replay();

    expect(cached.cache).toEqual({ hit: false, reason: "snapshot_anchor_mismatch" });
    expect(cached.projectionHash).toBe(full.projectionHash);
    expect(cached.projection).toEqual(full.projection);
  });

  it("falls back to full runtime replay when snapshot event ids are malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-malformed-snapshot-cache-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot"));
    const malformedSnapshot = roundTripSnapshot({
      ...createProjectionSnapshot([], { createdAt: "2026-06-01T00:00:00.000Z" }),
      eventCount: 1,
      eventIds: [],
    });

    const cached = await createRuntime(path).replayCached({ snapshot: malformedSnapshot });
    const full = await createRuntime(path).replay();

    expect(cached.cache).toEqual({ hit: false, reason: "unsupported_snapshot_format" });
    expect(cached.projectionHash).toBe(full.projectionHash);
    expect(cached.projection).toEqual(full.projection);
  });

  it("falls back to full runtime replay when snapshot projection hash is stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-stale-projection-snapshot-cache-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const events = await store.appendMany([
      createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot"),
      createTaskEvent("evt_task_claimed", "task.claimed", "task_snapshot"),
    ]);
    const staleSnapshot = roundTripSnapshot({
      ...createProjectionSnapshot(events.slice(0, 1), { createdAt: "2026-06-01T00:00:00.000Z" }),
      projection: {
        eventTypes: { "task.proposed": 42 },
        effects: { effects: {}, errors: [] },
        research: { questions: {}, sources: {}, claims: {}, reports: {}, errors: [] },
        tasks: { tasks: {}, errors: [] },
      },
    });

    const cached = await createRuntime(path).replayCached({ snapshot: staleSnapshot });
    const full = await createRuntime(path).replay();

    expect(cached.cache).toEqual({ hit: false, reason: "snapshot_projection_hash_mismatch" });
    expect(cached.projectionHash).toBe(full.projectionHash);
    expect(cached.projection).toEqual(full.projection);
  });

  it("falls back to full runtime replay when the verified tail has integrity diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-corrupt-tail-snapshot-cache-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const events = await store.appendMany([
      createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot"),
      createTaskEvent("evt_task_claimed", "task.claimed", "task_snapshot"),
    ]);
    const cache = roundTripSnapshot(createProjectionSnapshot(events.slice(0, 1), {
      createdAt: "2026-06-01T00:00:00.000Z",
    }));
    await appendFile(path, "{bad-json\n", "utf8");

    const cached = await createRuntime(path).replayCached({ snapshot: cache });
    const full = await createRuntime(path).replay();

    expect(cached.cache).toEqual({ hit: false, reason: "snapshot_integrity_failed" });
    expect(cached.integrity).toMatchObject({
      ok: false,
      validPrefixCount: 2,
      diagnostics: [{ code: "malformed_json", line: 3 }],
    });
    expect(cached.projectionHash).toBe(full.projectionHash);
    expect(cached.projection).toEqual(full.projection);
  });

  it("rejects a tail that does not continue from the snapshot hash", () => {
    const snapshotEvents = sealChain([
      createTaskEvent("evt_task_proposed", "task.proposed", "task_snapshot"),
    ]);
    const tailEvents = sealChain([
      createTaskEvent("evt_unrelated_task", "task.proposed", "task_unrelated"),
    ]);
    const snapshot = createProjectionSnapshot(snapshotEvents, {
      createdAt: "2026-06-01T00:00:00.000Z",
    });

    expect(() => replayFromProjectionSnapshot(snapshot, tailEvents)).toThrow(SnapshotReplayError);
    expect(() => replayFromProjectionSnapshot(snapshot, tailEvents)).toThrow(
      "Snapshot tail does not continue from snapshot hash",
    );
  });

  it("rejects a tail that reuses an event id from the snapshot prefix", () => {
    const snapshotEvents = sealChain([
      createTaskEvent("evt_duplicate_snapshot_id", "task.proposed", "task_snapshot"),
    ]);
    const snapshot = createProjectionSnapshot(snapshotEvents, {
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    const duplicateTailEvent = sealEvent(
      createTaskEvent("evt_duplicate_snapshot_id", "task.claimed", "task_snapshot"),
      snapshot.lastEventHash,
    );

    expect(() => replayFromProjectionSnapshot(snapshot, [duplicateTailEvent])).toThrow(SnapshotReplayError);
    expect(() => replayFromProjectionSnapshot(snapshot, [duplicateTailEvent])).toThrow(
      "Snapshot tail reuses event id from snapshot prefix",
    );
  });

  it("rejects malformed snapshot event id metadata", () => {
    const snapshot = {
      ...createProjectionSnapshot([], { createdAt: "2026-06-01T00:00:00.000Z" }),
      eventCount: 1,
      eventIds: [],
    };

    expect(() => replayFromProjectionSnapshot(snapshot, [])).toThrow(SnapshotReplayError);
    expect(() => replayFromProjectionSnapshot(snapshot, [])).toThrow(
      "Projection snapshot event ids do not match its event count",
    );
  });
});

function createTaskEvent(id: string, type: string, taskId: string, payload: Record<string, unknown> = {}) {
  return createEvent({
    id,
    type,
    actorId: "agent",
    threadId: "thread_snapshot",
    parentEventId: null,
    timestamp: "2026-06-01T00:00:00.000Z",
    payload: { taskId, ...payload },
  });
}

function roundTripSnapshot(snapshot: ProjectionSnapshot): ProjectionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ProjectionSnapshot;
}

function sealChain(events: ReturnType<typeof createTaskEvent>[]) {
  let previousHash: string | null = null;
  return events.map((event) => {
    const sealed = sealEvent(event, previousHash);
    previousHash = sealed.integrity.hash;
    return sealed;
  });
}
