import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { diffRuntimeReplays, replayEvents } from "../src/index.js";

describe("projection diff", () => {
  it("reports event type and task status changes between replay results", () => {
    const left = replayEvents([
      event("evt_goal", "goal.created", { title: "Diff projections" }),
      event("evt_task", "task.proposed", { taskId: "task_diff", title: "Diff task" }),
    ]);
    const right = replayEvents([
      event("evt_goal", "goal.created", { title: "Diff projections" }),
      event("evt_task", "task.proposed", { taskId: "task_diff", title: "Diff task" }),
      event("evt_claim", "task.claimed", { taskId: "task_diff" }),
    ]);

    expect(diffRuntimeReplays(left, right)).toMatchObject({
      version: "eventloom.projection-diff.v1",
      sameProjectionHash: false,
      eventTypes: {
        added: [{ type: "task.claimed", right: 1 }],
        removed: [],
        changed: [],
      },
      tasks: {
        added: [],
        removed: [],
        changed: [
          {
            taskId: "task_diff",
            left: { status: "proposed", lastEventId: "evt_task" },
            right: { status: "claimed", lastEventId: "evt_claim" },
          },
        ],
      },
    });
  });

  it("returns a stable empty diff for equivalent projections", () => {
    const left = replayEvents([event("evt_goal", "goal.created", { title: "Same" })]);
    const right = replayEvents([event("evt_goal", "goal.created", { title: "Same" })]);

    expect(diffRuntimeReplays(left, right)).toEqual({
      version: "eventloom.projection-diff.v1",
      sameProjectionHash: true,
      left: {
        eventCount: 1,
        projectionHash: left.projectionHash,
        integrityOk: false,
      },
      right: {
        eventCount: 1,
        projectionHash: right.projectionHash,
        integrityOk: false,
      },
      eventTypes: { added: [], removed: [], changed: [] },
      tasks: { added: [], removed: [], changed: [] },
      effects: { added: [], removed: [], changed: [] },
      researchQuestions: { added: [], removed: [], changed: [] },
      projectionErrors: { left: [], right: [] },
    });
  });

  it("reports effect and research projection changes", () => {
    const left = replayEvents([
      event("evt_effect", "effect.requested", { effectId: "effect_diff", action: "notify" }),
      event("evt_question", "research.question.created", { questionId: "question_diff", question: "What changed?" }),
    ]);
    const right = replayEvents([
      event("evt_effect", "effect.requested", { effectId: "effect_diff", action: "notify" }),
      event("evt_approval", "approval.requested", { effectId: "effect_diff", approvalId: "approval_diff" }),
      event("evt_question", "research.question.created", { questionId: "question_diff", question: "What changed?" }),
      event("evt_source", "source.found", {
        questionId: "question_diff",
        sourceId: "source_diff",
        title: "Diff source",
        url: "eventloom://diff-source",
      }),
    ]);

    expect(diffRuntimeReplays(left, right)).toMatchObject({
      effects: {
        changed: [{ effectId: "effect_diff", left: { status: "requested" }, right: { status: "approval_requested" } }],
      },
      researchQuestions: {
        changed: [{ questionId: "question_diff", left: { status: "created" }, right: { status: "source_found" } }],
      },
    });
  });

  it("includes task, effect, and research projection errors with routing metadata", () => {
    const left = replayEvents([
      event("evt_task_missing", "task.claimed", { taskId: "task_missing" }),
      event("evt_effect_missing", "approval.requested", { effectId: "effect_missing", approvalId: "approval_missing" }),
      event("evt_source_missing", "source.found", {
        questionId: "question_missing",
        sourceId: "source_missing",
        title: "Missing question source",
        url: "eventloom://missing-question",
      }),
    ]);
    const right = replayEvents([]);

    expect(diffRuntimeReplays(left, right).projectionErrors.left).toEqual([
      expect.objectContaining({
        projectionKind: "task",
        code: "missing_dependency",
        eventId: "evt_task_missing",
      }),
      expect.objectContaining({
        projectionKind: "effect",
        code: "missing_dependency",
        eventId: "evt_effect_missing",
      }),
      expect.objectContaining({
        projectionKind: "research",
        code: "missing_dependency",
        eventId: "evt_source_missing",
      }),
    ]);
  });
});

function event(id: string, type: string, payload: Record<string, unknown>) {
  return createEvent({
    id,
    type,
    actorId: "tester",
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload,
  });
}
