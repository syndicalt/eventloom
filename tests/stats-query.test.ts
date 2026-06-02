import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { buildEventLogInspectionModel, buildEventLogStats, buildEventQueryResult, filterEvents } from "../src/index.js";

const execFileAsync = promisify(execFile);

describe("stats and query inspection", () => {
  it("returns stable sorted API stats and filtered event summaries", async () => {
    const path = await fixtureLog();
    const events = await new JsonlEventStore(path).readAll();

    expect(buildEventLogStats(events)).toMatchObject({
      version: "eventloom.stats.v1",
      eventCount: 3,
      integrity: { ok: true },
      eventTypes: [
        { type: "goal.created", count: 1 },
        { type: "task.claimed", count: 1 },
        { type: "task.proposed", count: 1 },
      ],
    });

    expect(filterEvents(events, { type: "task.proposed", actorId: "planner" })).toMatchObject([
      { id: "evt_task", type: "task.proposed", actorId: "planner" },
    ]);
    expect(buildEventQueryResult(events, { type: "task.proposed", actorId: "planner" })).toMatchObject({
      version: "eventloom.query.v1",
      count: 1,
      integrity: { ok: true },
      events: [{ id: "evt_task", type: "task.proposed", actorId: "planner" }],
    });
  });

  it("prints JSON stats and filtered query results from the CLI", async () => {
    const path = await fixtureLog();

    const stats = JSON.parse((await execFileAsync("npx", ["tsx", "src/cli.ts", "stats", path])).stdout);
    expect(stats).toMatchObject({
      version: "eventloom.stats.v1",
      eventCount: 3,
      eventTypes: [
        { type: "goal.created", count: 1 },
        { type: "task.claimed", count: 1 },
        { type: "task.proposed", count: 1 },
      ],
    });

    const query = JSON.parse((await execFileAsync("npx", [
      "tsx",
      "src/cli.ts",
      "query",
      path,
      "--type",
      "task.proposed",
      "--actor",
      "planner",
      "--json",
    ])).stdout);
    expect(query).toMatchObject({
      version: "eventloom.query.v1",
      count: 1,
      events: [{ id: "evt_task", type: "task.proposed", actorId: "planner" }],
    });
  });

  it("builds and prints a consolidated inspect model from the verified prefix", async () => {
    const path = await fixtureLog();
    await writeFile(path, `${await readFile(path, "utf8")}{broken-json\n`, "utf8");
    const events = (await new JsonlEventStore(path).readVerifiedSnapshot()).validEvents;

    expect(buildEventLogInspectionModel(events)).toMatchObject({
      version: "eventloom.inspect.v1",
      stats: {
        eventCount: 3,
        eventTypes: [
          { type: "goal.created", count: 1 },
          { type: "task.claimed", count: 1 },
          { type: "task.proposed", count: 1 },
        ],
      },
      timeline: {
        version: "eventloom.timeline.v1",
        eventCount: 3,
      },
      handoff: {
        eventCount: 3,
      },
    });

    const inspect = JSON.parse((await execFileAsync("npx", ["tsx", "src/cli.ts", "inspect", path])).stdout);

    expect(inspect).toMatchObject({
      version: "eventloom.inspect.v1",
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 4 }],
      },
      stats: {
        eventCount: 3,
      },
      timeline: {
        events: [
          { ordinal: 1, id: "evt_goal", type: "goal.created" },
          { ordinal: 2, id: "evt_task", type: "task.proposed" },
          { ordinal: 3, id: "evt_claim", type: "task.claimed" },
        ],
      },
      handoff: {
        eventCount: 3,
        eventTypes: {
          "goal.created": 1,
          "task.proposed": 1,
          "task.claimed": 1,
        },
      },
    });
  });

  it("builds and prints a filtered inspect model with full-log stats", async () => {
    const path = await fixtureLog();
    const events = await new JsonlEventStore(path).readAll();

    expect(buildEventLogInspectionModel(events, undefined, { type: "task.proposed", actorId: "planner" })).toMatchObject({
      version: "eventloom.inspect.v1",
      stats: {
        eventCount: 3,
      },
      selection: {
        totalEventCount: 3,
        matchedEventCount: 1,
        query: {
          type: "task.proposed",
          actorId: "planner",
        },
        events: [{ id: "evt_task", type: "task.proposed", actorId: "planner" }],
      },
      timeline: {
        eventCount: 1,
        events: [{ ordinal: 1, id: "evt_task", type: "task.proposed", actorId: "planner" }],
      },
      handoff: {
        eventCount: 3,
      },
    });

    const inspect = JSON.parse((await execFileAsync("npx", [
      "tsx",
      "src/cli.ts",
      "inspect",
      path,
      "--type",
      "task.proposed",
      "--actor",
      "planner",
      "--limit",
      "1",
      "--json",
    ])).stdout);

    expect(inspect).toMatchObject({
      version: "eventloom.inspect.v1",
      integrity: {
        ok: true,
      },
      stats: {
        eventCount: 3,
      },
      selection: {
        totalEventCount: 3,
        matchedEventCount: 1,
        query: {
          type: "task.proposed",
          actorId: "planner",
          limit: 1,
        },
        events: [{ id: "evt_task", type: "task.proposed", actorId: "planner" }],
      },
      timeline: {
        eventCount: 1,
        events: [{ ordinal: 1, id: "evt_task", type: "task.proposed", actorId: "planner" }],
      },
      handoff: {
        eventCount: 3,
      },
    });
  });

  it("prints stats for the verified prefix when a log has a corrupt tail", async () => {
    const path = await fixtureLog();
    await writeFile(path, `${await readFile(path, "utf8")}{broken-json\n`, "utf8");

    const stats = JSON.parse((await execFileAsync("npx", ["tsx", "src/cli.ts", "stats", path])).stdout);

    expect(stats).toMatchObject({
      version: "eventloom.stats.v1",
      eventCount: 3,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 4 }],
      },
      eventTypes: [
        { type: "goal.created", count: 1 },
        { type: "task.claimed", count: 1 },
        { type: "task.proposed", count: 1 },
      ],
    });
  });
});

async function fixtureLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-stats-query-"));
  const path = join(dir, "events.jsonl");
  await append(path, "evt_goal", "goal.created", "user", { title: "Stats" });
  await append(path, "evt_task", "task.proposed", "planner", { taskId: "task_stats", title: "Stats task" });
  await append(path, "evt_claim", "task.claimed", "worker", { taskId: "task_stats" });
  return path;
}

async function append(path: string, id: string, type: string, actorId: string, payload: Record<string, unknown>) {
  await new JsonlEventStore(path).append(createEvent({
    id,
    type,
    actorId,
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload,
  }));
}
