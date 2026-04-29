import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { appendExternalEvent, parseJsonPayload } from "../src/ingest.js";
import { runSoftwareWorkRuntime } from "../src/runners.js";
import { projectTasks } from "../src/task-projection.js";

describe("external event ingestion", () => {
  it("appends sealed external events and chains hashes", async () => {
    const path = await tempLog();
    const first = await appendExternalEvent({
      path,
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "External goal" },
    });
    const second = await appendExternalEvent({
      path,
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Second goal" },
    });

    expect(second.integrity.previousHash).toBe(first.integrity.hash);
    expect((await new JsonlEventStore(path).verify()).ok).toBe(true);
  });

  it("can resume runtime from an externally appended goal", async () => {
    const path = await tempLog();
    await appendExternalEvent({
      path,
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "External trigger" },
    });

    const result = await runSoftwareWorkRuntime(path, { resume: true });
    const events = await new JsonlEventStore(path).readAll();

    expect(result.appended).toBe(5);
    expect(projectTasks(events).tasks.task_actor_runtime.status).toBe("approved");
  });

  it("rejects non-object JSON payloads", () => {
    expect(() => parseJsonPayload("[]")).toThrow("Payload must be a JSON object");
  });
});

async function tempLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-ingest-"));
  return join(dir, "events.jsonl");
}
