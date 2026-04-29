import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { appendExternalEvent } from "../src/ingest.js";
import { projectResearch } from "../src/research-projection.js";
import { projectEffects } from "../src/effect-projection.js";
import { runHumanOpsRuntime, runResearchPipelineRuntime, runSoftwareWorkRuntime } from "../src/runners.js";
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
    expect(result.turns).toBe(5);
    expect(result.rejected).toBe(0);
    expect(result.skipped).toBe(0);
    expect((await store.verify()).ok).toBe(true);
    expect(projection.errors).toEqual([]);
    expect(projection.tasks.task_actor_runtime.status).toBe("approved");
    expect(events.filter((event) => event.type === "actor.started")).toHaveLength(5);
    expect(events.filter((event) => event.type === "actor.completed")).toHaveLength(5);
    expect(events.filter((event) => event.type === "actor.processed")).toHaveLength(5);
  });

  it("does not reprocess mailbox items on resume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-runtime-"));
    const path = join(dir, "events.jsonl");

    await runSoftwareWorkRuntime(path);
    const resumed = await runSoftwareWorkRuntime(path, { resume: true });

    expect(resumed.appended).toBe(0);
    expect(resumed.processed).toBe(0);
    expect(resumed.turns).toBe(0);
    expect(resumed.rejected).toBe(0);
  });

  it("runs research-pipeline actors until idle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-research-runtime-"));
    const path = join(dir, "events.jsonl");

    const result = await runResearchPipelineRuntime(path);
    const store = new JsonlEventStore(path);
    const events = await store.readAll();
    const projection = projectResearch(events);

    expect(result.stoppedReason).toBe("idle");
    expect(result.appended).toBe(5);
    expect(result.processed).toBe(5);
    expect(result.turns).toBe(5);
    expect(result.rejected).toBe(0);
    expect(result.skipped).toBe(0);
    expect((await store.verify()).ok).toBe(true);
    expect(projection.errors).toEqual([]);
    expect(projection.questions.question_evented_runtime.status).toBe("finalized");
    expect(events.filter((event) => event.type === "actor.started")).toHaveLength(5);
    expect(events.filter((event) => event.type === "actor.completed")).toHaveLength(5);
    expect(events.filter((event) => event.type === "actor.processed")).toHaveLength(5);
  });

  it("pauses human-ops until approval then applies the effect on resume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-human-ops-"));
    const path = join(dir, "events.jsonl");

    const first = await runHumanOpsRuntime(path);
    let store = new JsonlEventStore(path);
    let events = await store.readAll();
    let projection = projectEffects(events);

    expect(first.stoppedReason).toBe("idle");
    expect(first.appended).toBe(2);
    expect(first.processed).toBe(2);
    expect(projection.errors).toEqual([]);
    expect(projection.effects.effect_runtime_mitigation.status).toBe("approval_requested");

    const approvalRequest = events.find((event) => event.type === "approval.requested");
    expect(approvalRequest).toBeDefined();
    await appendExternalEvent({
      path,
      type: "approval.granted",
      actorId: "human",
      threadId: "thread_ops",
      parentEventId: approvalRequest?.id,
      causedBy: approvalRequest ? [approvalRequest.id] : [],
      payload: {
        effectId: "effect_runtime_mitigation",
        approvalId: "approval_runtime_mitigation",
        reason: "Approved for local runtime test",
      },
    });

    const resumed = await runHumanOpsRuntime(path, { resume: true });
    store = new JsonlEventStore(path);
    events = await store.readAll();
    projection = projectEffects(events);

    expect(resumed.appended).toBe(1);
    expect(resumed.processed).toBe(1);
    expect(resumed.rejected).toBe(0);
    expect((await store.verify()).ok).toBe(true);
    expect(projection.errors).toEqual([]);
    expect(projection.effects.effect_runtime_mitigation.status).toBe("applied");
  });
});
