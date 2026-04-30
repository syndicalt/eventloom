import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { JsonlEventStore } from "../src/event-store.js";
import { exportToPathlight } from "../src/export/pathlight.js";
import { sealEvent } from "../src/integrity.js";
import { runSoftwareWorkRuntime } from "../src/runners.js";

describe("Pathlight export", () => {
  it("maps Eventloom actor turns to Pathlight traces and spans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-pathlight-"));
    const path = join(dir, "events.jsonl");
    await runSoftwareWorkRuntime(path);
    const events = await new JsonlEventStore(path).readAll();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let span = 0;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_1" });
      if (String(url).endsWith("/v1/spans")) return json({ id: `span_${span += 1}` });
      if (String(url).includes("/events")) return json({ id: "event_1" });
      return json({ ok: true });
    };

    const result = await exportToPathlight(events, {
      baseUrl: "http://pathlight.test",
      traceName: "eventloom-test",
      fetchImpl: fetchImpl as typeof fetch,
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.0",
        gitCommit: "abc123",
        gitBranch: "main",
        gitDirty: true,
      },
    });

    expect(result.traceId).toBe("trace_1");
    expect(result.spanCount).toBe(21);
    expect(calls.filter((call) => call.url === "http://pathlight.test/v1/traces")).toHaveLength(1);
    expect(calls.filter((call) => call.url === "http://pathlight.test/v1/spans")).toHaveLength(21);
    expect(calls.some((call) => call.url === "http://pathlight.test/v1/traces/trace_1")).toBe(true);

    const traceCreate = JSON.parse(String(calls[0].init.body));
    expect(traceCreate.name).toBe("eventloom-test");
    expect(traceCreate.metadata.source).toBe("eventloom");
    expect(traceCreate.metadata.integrity.ok).toBe(true);
    expect(typeof traceCreate.metadata.projectionHash).toBe("string");
    expect(traceCreate.metadata.projectionKinds).toEqual(["tasks"]);
    expect(traceCreate.metadata.runtime).toEqual({ name: "eventloom", version: "0.1.0" });
    expect(traceCreate.gitCommit).toBe("abc123");
    expect(traceCreate.gitBranch).toBe("main");
    expect(traceCreate.gitDirty).toBe(true);

    const spanPatches = calls.filter((call) => (
      call.init.method === "PATCH" &&
      call.url.startsWith("http://pathlight.test/v1/spans/span_")
    ));
    expect(spanPatches).toHaveLength(21);
    for (const call of spanPatches) {
      const body = JSON.parse(String(call.init.body));
      expect(body.output.rejectedEvents).toBeUndefined();
      expect(body.output.rejectionEventIds).toBeUndefined();
    }

    const spanCreates = calls
      .filter((call) => call.url === "http://pathlight.test/v1/spans")
      .map((call) => JSON.parse(String(call.init.body)));
    expect(spanCreates.filter((span) => span.metadata.exportKind === "actor_turn")).toHaveLength(5);
    expect(spanCreates.filter((span) => span.metadata.exportKind === "model_invocation")).toHaveLength(5);
    expect(spanCreates.filter((span) => span.metadata.exportKind === "tool_invocation")).toHaveLength(5);
    expect(spanCreates.filter((span) => span.metadata.exportKind === "reasoning_summary")).toHaveLength(5);
    expect(spanCreates.filter((span) => span.metadata.exportKind === "journal_fact")).toHaveLength(1);
  });

  it("maps external task journals to task lifecycle spans when actor turns are absent", async () => {
    const events = taskJournalEvents();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let span = 0;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_tasks" });
      if (String(url).endsWith("/v1/spans")) return json({ id: `task_span_${span += 1}` });
      if (String(url).includes("/events")) return json({ id: "event_1" });
      return json({ ok: true });
    };

    const result = await exportToPathlight(events, {
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

    expect(result).toMatchObject({ traceId: "trace_tasks", spanCount: 4, eventCount: 7 });
    expect(calls.filter((call) => call.url === "http://pathlight.test/v1/spans")).toHaveLength(4);

    const spanCreates = calls
      .filter((call) => call.url === "http://pathlight.test/v1/spans")
      .map((call) => JSON.parse(String(call.init.body)));
    expect(spanCreates.slice(0, 2)).toMatchObject([
      { name: "task.task_docs", metadata: { exportKind: "task_lifecycle", taskStatus: "claimed" } },
      { name: "task.task_runtime", metadata: { exportKind: "task_lifecycle", taskStatus: "completed" } },
    ]);
    expect(spanCreates.slice(2)).toMatchObject([
      { name: "goal.created", metadata: { exportKind: "journal_fact" } },
      { name: "verification.completed", metadata: { exportKind: "journal_fact" } },
    ]);

    const spanPatches = calls.filter((call) => (
      call.init.method === "PATCH" &&
      call.url.startsWith("http://pathlight.test/v1/spans/task_span_")
    ));
    expect(spanPatches).toHaveLength(4);
    const output = JSON.parse(String(spanPatches[0].init.body)).output;
    expect(output).toMatchObject({ taskId: "task_docs", status: "claimed" });
  });
});

function taskJournalEvents() {
  let previousHash: string | null = null;
  return [
    event("evt_goal", "goal.created", "user", { title: "Ship agent journal spans" }),
    event("evt_runtime_proposed", "task.proposed", "codex", {
      taskId: "task_runtime",
      title: "Build exporter",
    }),
    event("evt_runtime_claimed", "task.claimed", "codex", { taskId: "task_runtime" }),
    event("evt_runtime_done", "task.completed", "codex", { taskId: "task_runtime" }),
    event("evt_docs_proposed", "task.proposed", "codex", {
      taskId: "task_docs",
      title: "Document exporter",
    }),
    event("evt_docs_claimed", "task.claimed", "codex", { taskId: "task_docs" }),
    event("evt_verification", "verification.completed", "codex", { summary: "Exporter tests passed" }),
  ].map((item) => {
    const sealed = sealEvent(createEvent(item), previousHash);
    previousHash = sealed.integrity.hash;
    return sealed;
  });
}

function event(
  id: string,
  type: string,
  actorId: string,
  payload: Record<string, unknown>,
) {
  return {
    id,
    type,
    actorId,
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-29T12:00:00.000Z",
    payload,
  };
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
