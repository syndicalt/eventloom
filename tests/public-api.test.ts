import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createRuntime,
  formatHaloJsonl,
  replayEvents,
  runBuiltInWorkflow,
  type BuiltInWorkflow,
} from "../src/index.js";

describe("public package API", () => {
  it("runs a built-in workflow and replays projections through the facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);

    const result = await runtime.runBuiltIn("research-pipeline");
    const replay = await runtime.replay();

    expect(result.stoppedReason).toBe("idle");
    expect(replay.integrity.ok).toBe(true);
    expect(replay.projection.research.questions.question_evented_runtime.status).toBe("finalized");
    expect(replay.projectionHash).toBe(replayEvents(await runtime.readAll()).projectionHash);
  });

  it("runs built-in workflows without manually constructing stores or registries", async () => {
    const path = await tempLog();
    const workflow: BuiltInWorkflow = "software-work";

    const result = await runBuiltInWorkflow(workflow, path);
    const runtime = createRuntime(path);

    expect(result.appended).toBe(5);
    expect((await runtime.replay()).projection.tasks.tasks.task_actor_runtime.status).toBe("approved");
  });

  it("builds visualizer views through the runtime facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);

    await runtime.runBuiltIn("software-work");
    const visualizer = await runtime.visualize();

    expect(visualizer.capture.eventCount).toBeGreaterThan(0);
    expect(visualizer.capture.events.some((event) => event.type === "goal.created")).toBe(true);
    expect(visualizer.replay.integrity.ok).toBe(true);
    expect(visualizer.replay.projection.tasks.tasks.task_actor_runtime.status).toBe("approved");
    expect(visualizer.handoff.tasks.completed).toMatchObject([
      { id: "task_actor_runtime", status: "approved" },
    ]);
  });

  it("rebuilds built-in actor mailboxes through the facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Package API mailbox" },
    });

    const mailbox = await runtime.mailbox("software-work", "planner");

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].event.type).toBe("goal.created");
  });

  it("appends external events and exports through injected fetch", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Package API goal" },
    });

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_api" });
      if (String(url).endsWith("/v1/spans")) return json({ id: "span_api" });
      return json({ ok: true });
    };

    const exported = await runtime.exportPathlight({
      baseUrl: "http://pathlight.test",
      fetchImpl: fetchImpl as typeof fetch,
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.0",
        gitCommit: null,
        gitBranch: null,
        gitDirty: null,
      },
    });

    expect(exported).toEqual({ traceId: "trace_api", spanCount: 1, eventCount: 1 });
    expect(calls.some((call) => call.url === "http://pathlight.test/v1/traces")).toBe(true);
  });

  it("exports HALO traces through the facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "task.proposed",
      actorId: "codex",
      threadId: "thread_main",
      payload: { taskId: "task_halo", title: "Export HALO traces" },
    });

    const exported = await runtime.exportHalo({
      projectId: "eventloom-api",
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.3",
        gitCommit: null,
        gitBranch: null,
        gitDirty: null,
      },
    });

    expect(exported.projectId).toBe("eventloom-api");
    expect(exported.spanCount).toBe(2);
    expect(formatHaloJsonl(exported)).toContain("\"inference.project_id\":\"eventloom-api\"");
  });
});

async function tempLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-api-"));
  return join(dir, "events.jsonl");
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
