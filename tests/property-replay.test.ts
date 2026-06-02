import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { buildVisualizerModel, createRuntime, projectionHash, replayEvents } from "../src/index.js";

describe("property replay equivalence", () => {
  it("replays generated task lifecycles equivalently from memory and from sealed JSONL", async () => {
    await fc.assert(
      fc.asyncProperty(taskLifecycleArbitrary(), async (lifecycle) => {
        const dir = await mkdtemp(join(tmpdir(), "eventloom-property-replay-"));
        const path = join(dir, "events.jsonl");
        const store = new JsonlEventStore(path);

        for (const event of lifecycle) {
          await store.append(event);
        }

        const events = await store.readAll();
        const direct = replayEvents(events);
        const runtime = await createRuntime(path).replay();

        expect(runtime.integrity.ok).toBe(true);
        expect(runtime.projectionHash).toBe(direct.projectionHash);
        expect(runtime.projection).toEqual(direct.projection);
        expect(buildVisualizerModel(events).replay.projectionHash).toBe(direct.projectionHash);
        expect(projectionHash(runtime.projection)).toBe(runtime.projectionHash);
      }),
      { numRuns: 40 },
    );
  });
});

function taskLifecycleArbitrary() {
  return fc
    .record({
      taskId: fc.stringMatching(/^task_[a-z0-9]{1,12}$/),
      title: fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value.trim().length > 0),
      finalStep: fc.integer({ min: 0, max: 4 }),
    })
    .map(({ taskId, title, finalStep }) => {
      const threadId = `thread_${taskId}`;
      const events = [
        createEvent({
          id: `evt_${taskId}_proposed`,
          type: "task.proposed",
          actorId: "planner",
          threadId,
          parentEventId: null,
          causedBy: [],
          timestamp: "2026-04-28T22:00:00.000Z",
          payload: { taskId, title },
        }),
      ];
      const transitions = [
        ["task.claimed", "worker", "claimed"],
        ["task.completed", "worker", "completed"],
        ["review.requested", "worker", "review"],
        ["review.approved", "reviewer", "approved"],
      ] as const;

      for (const [index, [type, actorId, suffix]] of transitions.entries()) {
        if (index >= finalStep) break;
        const parent = events.at(-1);
        if (!parent) throw new Error("missing parent event");
        events.push(createEvent({
          id: `evt_${taskId}_${suffix}`,
          type,
          actorId,
          threadId,
          parentEventId: parent.id,
          causedBy: [parent.id],
          timestamp: new Date(Date.parse("2026-04-28T22:00:00.000Z") + index + 1).toISOString(),
          payload: { taskId },
        }));
      }

      return events;
    });
}
