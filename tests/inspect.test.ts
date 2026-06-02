import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { sealEvent } from "../src/integrity.js";
import { formatTaskExplanation, formatTimeline } from "../src/inspect.js";

describe("inspection formatters", () => {
  it("formats a timeline with integrity status", () => {
    const events = sealedTaskEvents();

    expect(formatTimeline(events)).toContain("integrity: ok");
    expect(formatTimeline(events)).toContain("01 evt_task_proposed planner task.proposed");
    expect(formatTimeline(events)).toContain("02 evt_task_claimed worker task.claimed parent=evt_task_proposed");
  });

  it("formats a task explanation from projection history and causal chain", () => {
    const output = formatTaskExplanation(sealedTaskEvents(), "task_1");

    expect(output).toContain("task: task_1");
    expect(output).toContain("status: claimed");
    expect(output).toContain("- task.proposed by planner (evt_task_proposed)");
    expect(output).toContain("- evt_task_claimed task.claimed by worker");
  });

  it("explains missing tasks explicitly", () => {
    expect(formatTaskExplanation(sealedTaskEvents(), "missing")).toBe("Task missing was not found.");
  });
});

function sealedTaskEvents() {
  const first = sealEvent(createEvent({
    id: "evt_task_proposed",
    type: "task.proposed",
    actorId: "planner",
    threadId: "thread_main",
    parentEventId: null,
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { taskId: "task_1", title: "Inspect logs" },
  }), null);
  const second = sealEvent(createEvent({
    id: "evt_task_claimed",
    type: "task.claimed",
    actorId: "worker",
    threadId: "thread_main",
    parentEventId: first.id,
    causedBy: [first.id],
    timestamp: "2026-04-28T22:01:00.000Z",
    payload: { taskId: "task_1" },
  }), first.integrity.hash);

  return [first, second];
}
