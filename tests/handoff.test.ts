import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { formatHandoffSummary, summarizeHandoff } from "../src/handoff.js";
import { sealEvent, type SealedEvent } from "../src/integrity.js";

describe("handoff summaries", () => {
  it("summarizes goals, task state, decisions, verification, and next actions", () => {
    const summary = summarizeHandoff(sealedEvents());

    expect(summary.integrity.ok).toBe(true);
    expect(summary.goals).toMatchObject([{ title: "Ship traceability" }]);
    expect(summary.tasks.active).toMatchObject([
      { id: "task_docs", status: "claimed" },
    ]);
    expect(summary.tasks.completed).toMatchObject([
      { id: "task_runtime", status: "completed" },
    ]);
    expect(summary.decisions[0].summary).toBe("Use deterministic summaries");
    expect(summary.verification[0].summary).toBe("Tests passed");
    expect(summary.nextActions).toEqual(["Continue task_docs: Document handoff summaries (claimed)."]);
  });

  it("formats a compact handoff for humans", () => {
    const text = formatHandoffSummary(summarizeHandoff(sealedEvents()));

    expect(text).toContain("handoff summary");
    expect(text).toContain("integrity: ok");
    expect(text).toContain("active tasks:");
    expect(text).toContain("Continue task_docs: Document handoff summaries");
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
    event("evt_verification", "verification.completed", "codex", { summary: "Tests passed" }),
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
