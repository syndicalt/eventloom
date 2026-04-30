import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { exportToHalo, formatHaloJsonl } from "../src/export/halo.js";
import { JsonlEventStore } from "../src/event-store.js";
import { sealEvent } from "../src/integrity.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSoftwareWorkRuntime } from "../src/runners.js";

describe("HALO export", () => {
  it("maps task journals to HALO-compatible OTLP JSONL spans", async () => {
    const result = await exportToHalo(taskJournalEvents(), {
      projectId: "eventloom-test",
      serviceName: "eventloom-tests",
      traceName: "eventloom-agent-work",
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.3",
        gitCommit: "abc123",
        gitBranch: "main",
        gitDirty: false,
      },
    });

    expect(result).toMatchObject({
      projectId: "eventloom-test",
      traceCount: 1,
      spanCount: 5,
    });
    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);

    const [root, docsTask, runtimeTask] = result.spans;
    expect(root).toMatchObject({
      name: "eventloom-agent-work",
      parent_span_id: "",
      kind: "SPAN_KIND_INTERNAL",
      status: { code: "STATUS_CODE_OK" },
      resource: { attributes: { "service.name": "eventloom-tests" } },
      scope: { name: "@eventloom/runtime", version: "0.1.3" },
    });
    expect(root.attributes["inference.export.schema_version"]).toBe(1);
    expect(root.attributes["inference.project_id"]).toBe("eventloom-test");
    expect(root.attributes["inference.observation_kind"]).toBe("SPAN");
    expect(root.start_time).toMatch(/\.\d{9}Z$/);

    expect(docsTask).toMatchObject({
      name: "eventloom.task.task_docs",
      parent_span_id: root.span_id,
      status: { code: "STATUS_CODE_OK" },
    });
    expect(docsTask.attributes["openinference.span.kind"]).toBe("AGENT");
    expect(docsTask.attributes["inference.observation_kind"]).toBe("AGENT");
    expect(docsTask.attributes["eventloom.task.status"]).toBe("claimed");

    expect(runtimeTask.name).toBe("eventloom.task.task_runtime");
    expect(runtimeTask.attributes["eventloom.task.status"]).toBe("completed");

    const jsonl = formatHaloJsonl(result);
    const parsed = jsonl.trim().split("\n").map((line) => JSON.parse(line));
    expect(parsed).toHaveLength(result.spanCount);
    for (const span of parsed) {
      expect(Object.keys(span)).toEqual([
        "trace_id",
        "span_id",
        "parent_span_id",
        "trace_state",
        "name",
        "kind",
        "start_time",
        "end_time",
        "status",
        "resource",
        "scope",
        "attributes",
      ]);
      expect(span.attributes["inference.project_id"]).toBe("eventloom-test");
    }
  });

  it("maps runtime telemetry to HALO LLM, tool, and reasoning spans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-halo-runtime-"));
    const path = join(dir, "events.jsonl");
    await runSoftwareWorkRuntime(path);
    const events = await new JsonlEventStore(path).readAll();

    const result = await exportToHalo(events, {
      projectId: "eventloom-runtime-test",
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.3",
        gitCommit: null,
        gitBranch: null,
        gitDirty: null,
      },
    });

    const kinds = result.spans.map((span) => span.attributes["inference.observation_kind"]);
    expect(kinds.filter((kind) => kind === "LLM")).toHaveLength(5);
    expect(kinds.filter((kind) => kind === "TOOL")).toHaveLength(5);
    expect(result.spans.filter((span) => span.name === "eventloom.reasoning.summary")).toHaveLength(5);

    const modelSpan = result.spans.find((span) => span.attributes["inference.observation_kind"] === "LLM");
    expect(modelSpan?.attributes).toMatchObject({
      "llm.provider": "eventloom",
      "llm.model_name": "deterministic-runner",
      "inference.llm.provider": "eventloom",
      "inference.llm.model_name": "deterministic-runner",
    });
    expect(modelSpan?.attributes["inference.llm.input_tokens"]).toEqual(expect.any(Number));

    const toolSpan = result.spans.find((span) => span.attributes["inference.observation_kind"] === "TOOL");
    expect(toolSpan?.attributes["tool.name"]).toBe("eventloom.mailbox.read");
  });
});

function taskJournalEvents() {
  let previousHash: string | null = null;
  return [
    event("evt_goal", "goal.created", "user", { title: "Ship HALO connector" }),
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
