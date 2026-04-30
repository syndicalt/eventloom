import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { sealEvent, type SealedEvent } from "../src/integrity.js";
import { buildVisualizerModel } from "../src/visualizer.js";

describe("visualizer model", () => {
  it("builds capture, replay, and handoff views from one event log", () => {
    const model = buildVisualizerModel(sealedEvents());

    expect(model.capture.eventCount).toBe(9);
    expect(model.capture.eventTypes).toMatchObject({
      "goal.created": 1,
      "task.proposed": 1,
      "task.claimed": 1,
      "model.started": 1,
      "model.completed": 1,
      "tool.started": 1,
      "tool.completed": 1,
      "reasoning.summary": 1,
      "verification.completed": 1,
    });
    expect(model.capture.events[0]).toMatchObject({
      id: "evt_goal",
      type: "goal.created",
      actorId: "user",
      summary: "Ship visualizer",
      previousHash: null,
    });
    expect(model.capture.events[4]).toMatchObject({
      type: "model.completed",
      summary: "Rendered visualizer model",
    });

    expect(model.replay.integrity.ok).toBe(true);
    expect(model.replay.projection.tasks.tasks.task_visualizer.status).toBe("claimed");
    expect(model.replay.projectionHash).toMatch(/^[a-f0-9]{64}$/);

    expect(model.handoff.tasks.active).toMatchObject([
      { id: "task_visualizer", status: "claimed" },
    ]);
    expect(model.handoff.telemetry.models).toMatchObject([
      { callId: "model_visualizer", modelName: "gpt-test", totalTokens: 33 },
    ]);
    expect(model.handoff.telemetry.tools).toMatchObject([
      { callId: "tool_visualizer", toolName: "shell", exitCode: 0 },
    ]);
    expect(model.handoff.observabilityGaps).toEqual([]);
  });
});

function sealedEvents(): SealedEvent[] {
  let previousHash: string | null = null;
  return [
    event("evt_goal", "goal.created", "user", { title: "Ship visualizer" }),
    event("evt_task", "task.proposed", "planner", {
      taskId: "task_visualizer",
      title: "Add visualizer model",
    }),
    event("evt_claim", "task.claimed", "codex", { taskId: "task_visualizer" }),
    event("evt_model_start", "model.started", "codex", {
      modelCallId: "model_visualizer",
      modelProvider: "openai",
      modelName: "gpt-test",
      inputSummary: "Build visualizer model",
    }),
    event("evt_model", "model.completed", "codex", {
      modelCallId: "model_visualizer",
      modelProvider: "openai",
      modelName: "gpt-test",
      outputSummary: "Rendered visualizer model",
      totalTokens: 33,
    }),
    event("evt_tool_start", "tool.started", "codex", {
      toolCallId: "tool_visualizer",
      toolName: "shell",
      inputSummary: "Run visualizer tests",
    }),
    event("evt_tool", "tool.completed", "codex", {
      toolCallId: "tool_visualizer",
      toolName: "shell",
      outputSummary: "Tests passed",
      exitCode: 0,
    }),
    event("evt_reasoning", "reasoning.summary", "codex", {
      summary: "Visualizer model should be shared by UI, CLI, and API.",
      evidenceEventIds: ["evt_tool"],
      confidence: 0.9,
    }),
    event("evt_verification", "verification.completed", "codex", {
      summary: "Visualizer checks passed",
      command: "npm test -- tests/visualizer.test.ts",
      checks: ["visualizer.test.ts"],
      assertions: ["visualizer model includes capture replay handoff"],
      evidenceEventIds: ["evt_tool"],
      passCount: 1,
      failCount: 0,
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
    timestamp: "2026-04-30T12:00:00.000Z",
    payload,
  };
}
