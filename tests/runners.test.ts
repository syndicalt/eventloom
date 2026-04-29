import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { runSoftwareWorkRuntime } from "../src/runners.js";
import { projectTasks } from "../src/task-projection.js";

describe("deterministic actor runners", () => {
  it("runs software-work actors until idle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-runtime-"));
    const path = join(dir, "events.jsonl");

    const result = await runSoftwareWorkRuntime(path);
    const store = new JsonlEventStore(path);
    const events = await store.readAll();
    const projection = projectTasks(events);

    expect(result.stoppedReason).toBe("idle");
    expect(result.appended).toBe(5);
    expect(result.processed).toBe(5);
    expect(result.rejected).toBe(0);
    expect(result.skipped).toBe(0);
    expect((await store.verify()).ok).toBe(true);
    expect(projection.errors).toEqual([]);
    expect(projection.tasks.task_actor_runtime.status).toBe("approved");
  });

  it("does not reprocess mailbox items on resume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-runtime-"));
    const path = join(dir, "events.jsonl");

    await runSoftwareWorkRuntime(path);
    const resumed = await runSoftwareWorkRuntime(path, { resume: true });

    expect(resumed.appended).toBe(0);
    expect(resumed.processed).toBe(0);
    expect(resumed.rejected).toBe(0);
  });
});
