import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ActorRegistry } from "../src/actors.js";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { appendExternalEvent } from "../src/ingest.js";
import { projectResearch } from "../src/research-projection.js";
import { projectEffects } from "../src/effect-projection.js";
import { RuntimeOptionsError, RuntimeProjectionError, RuntimeRunnerError, runHumanOpsRuntime, runResearchPipelineRuntime, runRuntimeLoop, runSoftwareWorkRuntime } from "../src/runners.js";
import { projectTasks } from "../src/task-projection.js";

describe("deterministic actor runners", () => {
  it("runs software-work actors until idle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-runtime-"));
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
    expect(events.filter((event) => event.type === "model.started")).toHaveLength(5);
    expect(events.filter((event) => event.type === "model.completed")).toHaveLength(5);
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(5);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(5);
    expect(events.filter((event) => event.type === "reasoning.summary")).toHaveLength(5);
    expect(events.find((event) => event.type === "model.completed")?.payload).toMatchObject({
      modelProvider: "eventloom",
      modelName: "deterministic-runner",
      cost: 0,
    });
  });

  it("does not reprocess mailbox items on resume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-runtime-"));
    const path = join(dir, "events.jsonl");

    await runSoftwareWorkRuntime(path);
    const resumed = await runSoftwareWorkRuntime(path, { resume: true });

    expect(resumed.appended).toBe(0);
    expect(resumed.processed).toBe(0);
    expect(resumed.turns).toBe(0);
    expect(resumed.rejected).toBe(0);
  });

  it("runs research-pipeline actors until idle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-research-runtime-"));
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
    expect(events.filter((event) => event.type === "model.completed")).toHaveLength(5);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(5);
    expect(events.filter((event) => event.type === "reasoning.summary")).toHaveLength(5);
  });

  it("pauses human-ops until approval then applies the effect on resume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-human-ops-"));
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

  it("records typed failure events when an actor runner throws", async () => {
    const { store, registry } = await failingRuntimeSetup();

    await expect(runRuntimeLoop(store, registry, {
      worker: () => {
        throw new Error("boom");
      },
    })).rejects.toMatchObject({
      name: "RuntimeRunnerError",
      code: "actor_runner_failed",
      actorId: "worker",
      sourceEventId: "evt_runner_source",
      causeMessage: "boom",
    });

    const events = await store.readAll();
    expect(events.some((event) => event.type === "actor.processed")).toBe(false);
    const failed = events.find((event) => event.type === "actor.failed");
    expect(failed?.payload).toMatchObject({
      code: "actor_runner_failed",
      actorId: "worker",
      sourceEventId: "evt_runner_source",
      turnId: "turn_000001",
      message: "boom",
    });
    expect(events.find((event) => event.type === "model.failed")?.payload).toMatchObject({
      code: "actor_runner_failed",
      turnId: "turn_000001",
      modelCallId: "model_turn_000001",
    });
  });

  it("records typed failure events when an actor runner returns invalid output", async () => {
    const { store, registry } = await failingRuntimeSetup();

    await expect(runRuntimeLoop(store, registry, {
      worker: () => undefined as unknown as ReturnType<Parameters<typeof runRuntimeLoop>[2][string]>,
    })).rejects.toBeInstanceOf(RuntimeRunnerError);

    const events = await store.readAll();
    expect(events.some((event) => event.type === "actor.processed")).toBe(false);
    expect(events.find((event) => event.type === "actor.failed")?.payload).toMatchObject({
      code: "actor_runner_invalid_output",
      actorId: "worker",
      sourceEventId: "evt_runner_source",
      turnId: "turn_000001",
    });
  });

  it("rejects invalid runtime loop limits before reading actor mailboxes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-runtime-options-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));
    const registry = new ActorRegistry();

    await expect(runRuntimeLoop(store, registry, {}, { maxIterations: 0 })).rejects.toMatchObject({
      name: "RuntimeOptionsError",
      code: "invalid_runtime_option",
      option: "maxIterations",
      value: 0,
      suggestedAction: "Use positive integer values for Eventloom runtime loop limits.",
    });
    await expect(runRuntimeLoop(store, registry, {}, { maxIterations: 1.5 })).rejects.toBeInstanceOf(RuntimeOptionsError);
  });

  it("rejects invalid built-in workflow loop limits before mutating the log path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-runtime-options-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, "preserve me\n", "utf8");

    await expect(runSoftwareWorkRuntime(path, { maxIterations: 0 })).rejects.toBeInstanceOf(RuntimeOptionsError);

    expect(await readFile(path, "utf8")).toBe("preserve me\n");
  });

  it("throws typed projection errors for invalid software-work resume logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-software-projection-error-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(createEvent({
      id: "evt_bad_task_complete",
      type: "task.completed",
      actorId: "worker",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { taskId: "missing_task" },
    }));

    await expect(runSoftwareWorkRuntime(path, { resume: true })).rejects.toMatchObject({
      name: "RuntimeProjectionError",
      code: "runtime_projection_failed",
      workflow: "software-work",
      projectionKind: "tasks",
      errors: [
        {
          code: "missing_dependency",
          eventId: "evt_bad_task_complete",
          type: "task.completed",
        },
      ],
    });
  });

  it("throws typed projection errors for invalid research-pipeline resume logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-research-projection-error-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(createEvent({
      id: "evt_bad_report_finalized",
      type: "report.finalized",
      actorId: "editor",
      threadId: "thread_research",
      parentEventId: null,
      causedBy: [],
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { questionId: "missing_question", reportId: "report_bad", summary: "bad" },
    }));

    await expect(runResearchPipelineRuntime(path, { resume: true })).rejects.toBeInstanceOf(RuntimeProjectionError);
    await expect(runResearchPipelineRuntime(path, { resume: true })).rejects.toMatchObject({
      code: "runtime_projection_failed",
      workflow: "research-pipeline",
      projectionKind: "research",
      errors: [
        {
          code: "missing_dependency",
          eventId: "evt_bad_report_finalized",
          type: "report.finalized",
        },
      ],
    });
  });

  it("throws typed projection errors for invalid human-ops resume logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-effect-projection-error-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(createEvent({
      id: "evt_bad_effect_applied",
      type: "effect.applied",
      actorId: "applier",
      threadId: "thread_ops",
      parentEventId: null,
      causedBy: [],
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { effectId: "missing_effect" },
    }));

    await expect(runHumanOpsRuntime(path, { resume: true })).rejects.toMatchObject({
      name: "RuntimeProjectionError",
      code: "runtime_projection_failed",
      workflow: "human-ops",
      projectionKind: "effects",
      errors: [
        {
          code: "missing_dependency",
          eventId: "evt_bad_effect_applied",
          type: "effect.applied",
        },
      ],
    });
  });
});

async function failingRuntimeSetup() {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-runtime-failure-"));
  const path = join(dir, "events.jsonl");
  const store = new JsonlEventStore(path);
  await store.append(createEvent({
    id: "evt_runner_source",
    type: "task.proposed",
    actorId: "planner",
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { taskId: "task_runner_failure", title: "Runner failure" },
  }));
  const registry = new ActorRegistry();
  registry.register({
    id: "worker",
    role: "Fails intentionally",
    subscriptions: ["task.proposed"],
    intentions: ["task.claim"],
  });
  return { store, registry };
}
