import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createRuntime,
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
      return json({ ok: true });
    };

    const exported = await runtime.exportPathlight({
      baseUrl: "http://pathlight.test",
      fetchImpl: fetchImpl as typeof fetch,
      provenance: {
        packageName: "threadline",
        packageVersion: "0.1.0",
        gitCommit: null,
        gitBranch: null,
        gitDirty: null,
      },
    });

    expect(exported).toEqual({ traceId: "trace_api", spanCount: 0, eventCount: 0 });
    expect(calls.some((call) => call.url === "http://pathlight.test/v1/traces")).toBe(true);
  });
});

async function tempLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "threadline-api-"));
  return join(dir, "events.jsonl");
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
