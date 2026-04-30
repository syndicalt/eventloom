import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { formatHandoffSummary, summarizeHandoff } from "../src/handoff.js";
import { sealEvent, type SealedEvent } from "../src/integrity.js";

describe("handoff summaries", () => {
  it("summarizes goals, task state, decisions, verification, and next actions", () => {
    const summary = summarizeHandoff(sealedEvents());

    expect(summary.integrity.ok).toBe(true);
    expect(summary.eventTypes).toMatchObject({
      "goal.created": 1,
      "model.completed": 1,
      "task.proposed": 2,
      "tool.completed": 1,
      "verification.completed": 1,
    });
    expect(summary.goals).toMatchObject([{ title: "Ship traceability" }]);
    expect(summary.tasks.active).toMatchObject([
      { id: "task_docs", status: "claimed" },
    ]);
    expect(summary.tasks.completed).toMatchObject([
      { id: "task_runtime", status: "completed" },
    ]);
    expect(summary.projectionErrors).toEqual([]);
    expect(summary.decisions[0].summary).toBe("Use deterministic summaries");
    expect(summary.verification[0].summary).toContain("Tests passed");
    expect(summary.verification[0].summary).toContain("command=npm test");
    expect(summary.releases[0].summary).toBe("Published runtime package");
    expect(summary.risks[0].summary).toBe("Collector may be offline");
    expect(summary.telemetry.models).toMatchObject([
      {
        callId: "model_docs",
        provider: "openai",
        modelName: "gpt-test",
        status: "completed",
        promptVersion: "handoff.v1",
        inputSummary: "Summarize documentation decisions.",
        outputSummary: "Recommended deterministic summaries.",
        totalTokens: 30,
      },
    ]);
    expect(summary.telemetry.tools).toMatchObject([
      {
        callId: "tool_tests",
        toolName: "shell",
        status: "completed",
        outputSummary: "Vitest passed.",
        exitCode: 0,
        resultCount: 1,
        resultExcerpt: "1 test file passed",
        decisive: true,
        latencyMs: 120,
      },
    ]);
    expect(summary.telemetry.reasoning).toMatchObject([
      { summary: "Docs need handoff evidence", confidence: 0.8, evidenceEventIds: ["evt_decision"] },
    ]);
    expect(summary.observabilityGaps).toEqual([]);
    expect(summary.recentFacts.map((fact) => fact.type)).toEqual([
      "decision.recorded",
      "verification.completed",
      "release.published",
      "risk.identified",
    ]);
    expect(summary.nextActions).toEqual(["Continue task_docs: Document handoff summaries (claimed)."]);
  });

  it("formats a compact handoff for humans", () => {
    const text = formatHandoffSummary(summarizeHandoff(sealedEvents()));

    expect(text).toContain("handoff summary");
    expect(text).toContain("integrity: ok");
    expect(text).toContain("event types:");
    expect(text).toContain("active tasks:");
    expect(text).toContain("projection errors:");
    expect(text).toContain("releases:");
    expect(text).toContain("risks:");
    expect(text).toContain("recent facts:");
    expect(text).toContain("model telemetry:");
    expect(text).toContain("tool telemetry:");
    expect(text).toContain("prompt=handoff.v1");
    expect(text).toContain("exitCode=0");
    expect(text).toContain("results=1");
    expect(text).toContain("reasoning summaries:");
    expect(text).toContain("observability gaps:");
    expect(text).toContain("- none");
    expect(text).toContain("Continue task_docs: Document handoff summaries");
  });

  it("surfaces projection errors before export", () => {
    const summary = summarizeHandoff(invalidTaskOrderEvents());

    expect(summary.integrity.ok).toBe(true);
    expect(summary.projectionErrors).toHaveLength(1);
    expect(summary.nextActions[0]).toBe("Resolve projection errors before using this log as a canonical trace.");
    expect(summary.nextActions[1]).toBe("Add missing observability evidence before treating this as a debugging-ready agent trace.");
    expect(formatHandoffSummary(summary)).toContain("Task task_docs does not exist");
  });
});

function sealedEvents(): SealedEvent[] {
  let previousHash: string | null = null;
  return [
    event("evt_goal", "goal.created", "user", { title: "Ship traceability" }),
    event("evt_task_runtime", "task.proposed", "planner", {
      taskId: "task_runtime",
      title: "Add runtime support",
    }),
    event("evt_task_runtime_claimed", "task.claimed", "worker", { taskId: "task_runtime" }),
    event("evt_task_runtime_done", "task.completed", "worker", { taskId: "task_runtime" }),
    event("evt_task_docs", "task.proposed", "planner", {
      taskId: "task_docs",
      title: "Document handoff summaries",
    }),
    event("evt_task_docs_claimed", "task.claimed", "worker", { taskId: "task_docs" }),
    event("evt_decision", "decision.recorded", "codex", { decision: "Use deterministic summaries" }),
    event("evt_model_start", "model.started", "codex", {
      modelCallId: "model_docs",
      modelProvider: "openai",
      modelName: "gpt-test",
      promptVersion: "handoff.v1",
      inputSummary: "Summarize documentation decisions.",
      inputMessages: [{ role: "user", content: "Summarize docs" }],
      parameters: { temperature: 0 },
    }),
    event("evt_reasoning", "reasoning.summary", "codex", {
      summary: "Docs need handoff evidence",
      confidence: 0.8,
      evidenceEventIds: ["evt_decision"],
    }),
    event("evt_model_done", "model.completed", "codex", {
      modelCallId: "model_docs",
      modelProvider: "openai",
      modelName: "gpt-test",
      outputText: "Use deterministic summaries",
      outputSummary: "Recommended deterministic summaries.",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      latencyMs: 250,
    }),
    event("evt_tool_start", "tool.started", "codex", {
      toolCallId: "tool_tests",
      toolName: "shell",
      inputSummary: "Run focused handoff tests.",
      input: { cmd: "npm test" },
    }),
    event("evt_tool_done", "tool.completed", "codex", {
      toolCallId: "tool_tests",
      toolName: "shell",
      output: { passed: true },
      outputSummary: "Vitest passed.",
      exitCode: 0,
      resultCount: 1,
      resultExcerpt: "1 test file passed",
      decisive: true,
      latencyMs: 120,
    }),
    event("evt_verification", "verification.completed", "codex", {
      summary: "Tests passed",
      command: "npm test",
      checks: ["handoff.test.ts"],
      assertions: ["handoff includes telemetry"],
      evidenceEventIds: ["evt_tool_done"],
      artifactIds: ["artifact_handoff_test"],
      passCount: 1,
      failCount: 0,
    }),
    event("evt_release", "release.published", "codex", { summary: "Published runtime package" }),
    event("evt_risk", "risk.identified", "codex", { summary: "Collector may be offline" }),
  ].map((item) => {
    const sealed = sealEvent(createEvent(item), previousHash);
    previousHash = sealed.integrity.hash;
    return sealed;
  });
}

function invalidTaskOrderEvents(): SealedEvent[] {
  let previousHash: string | null = null;
  return [
    event("evt_task_docs_claimed", "task.claimed", "worker", { taskId: "task_docs" }),
    event("evt_task_docs", "task.proposed", "planner", {
      taskId: "task_docs",
      title: "Document handoff summaries",
    }),
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
