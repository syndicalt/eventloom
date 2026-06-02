import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";

const execFileAsync = promisify(execFile);

describe("CLI projection diff", () => {
  it("prints a structured diff for two logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-diff-"));
    const left = join(dir, "left.jsonl");
    const right = join(dir, "right.jsonl");
    await append(left, "evt_task", "task.proposed", { taskId: "task_diff", title: "Diff" });
    await append(right, "evt_task", "task.proposed", { taskId: "task_diff", title: "Diff" });
    await append(right, "evt_claim", "task.claimed", { taskId: "task_diff" });

    const { stdout } = await execFileAsync("npx", ["tsx", "src/cli.ts", "diff", left, right]);

    expect(JSON.parse(stdout)).toMatchObject({
      sameProjectionHash: false,
      eventTypes: { added: [{ type: "task.claimed", right: 1 }] },
      tasks: {
        changed: [{ taskId: "task_diff", left: { status: "proposed" }, right: { status: "claimed" } }],
      },
    });
  });

  it("accepts --json as an explicit machine-output flag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-diff-json-"));
    const left = join(dir, "left.jsonl");
    const right = join(dir, "right.jsonl");
    await append(left, "evt_task", "task.proposed", { taskId: "task_diff_json", title: "Diff JSON" });
    await append(right, "evt_task", "task.proposed", { taskId: "task_diff_json", title: "Diff JSON" });
    await append(right, "evt_claim", "task.claimed", { taskId: "task_diff_json" });

    const { stdout } = await execFileAsync("npx", ["tsx", "src/cli.ts", "diff", left, right, "--json"]);

    expect(JSON.parse(stdout)).toMatchObject({
      sameProjectionHash: false,
      eventTypes: { added: [{ type: "task.claimed", right: 1 }] },
      tasks: {
        changed: [{ taskId: "task_diff_json", left: { status: "proposed" }, right: { status: "claimed" } }],
      },
    });
  });

  it("prints projection error routing metadata in structured diff output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-diff-errors-"));
    const left = join(dir, "left.jsonl");
    const right = join(dir, "right.jsonl");
    await append(left, "evt_task_missing", "task.claimed", { taskId: "task_missing" });
    await append(left, "evt_effect_missing", "approval.requested", { effectId: "effect_missing", approvalId: "approval_missing" });
    await append(left, "evt_source_missing", "source.found", {
      questionId: "question_missing",
      sourceId: "source_missing",
      title: "Missing question source",
      url: "eventloom://missing-question",
    });

    const { stdout } = await execFileAsync("npx", ["tsx", "src/cli.ts", "diff", left, right]);

    expect(JSON.parse(stdout).projectionErrors.left).toEqual([
      expect.objectContaining({ projectionKind: "task", code: "missing_dependency", eventId: "evt_task_missing" }),
      expect.objectContaining({ projectionKind: "effect", code: "missing_dependency", eventId: "evt_effect_missing" }),
      expect.objectContaining({ projectionKind: "research", code: "missing_dependency", eventId: "evt_source_missing" }),
    ]);
  });
});

async function append(path: string, id: string, type: string, payload: Record<string, unknown>) {
  await new JsonlEventStore(path).append(createEvent({
    id,
    type,
    actorId: "tester",
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload,
  }));
}
