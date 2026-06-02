import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActorRegistry } from "../src/actors.js";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { Orchestrator } from "../src/orchestrator.js";
import { projectEffects } from "../src/effect-projection.js";
import { projectResearch } from "../src/research-projection.js";
import { projectTasks } from "../src/task-projection.js";

describe("Orchestrator", () => {
  it("accepts supported actor intentions as sealed events", async () => {
    const { store, orchestrator } = await setup();
    const goal = await store.append(createEvent({
      id: "evt_goal",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      payload: { title: "Test goal" },
    }));

    const result = await orchestrator.submitIntention({
      type: "task.propose",
      actorId: "planner",
      threadId: "thread_main",
      parentEventId: goal.id,
      causedBy: [goal.id],
      payload: { taskId: "task_1", title: "Test task" },
    });

    expect(result.accepted).toBe(true);
    expect(result.event.type).toBe("task.proposed");
    expect(result.event.integrity.previousHash).toBe(goal.integrity.hash);
    expect((await store.verify()).ok).toBe(true);
    expect(projectTasks(await store.readAll()).tasks.task_1.status).toBe("proposed");
  });

  it("rejects unsupported actor intentions as sealed rejection events", async () => {
    const { store, orchestrator } = await setup();

    const result = await orchestrator.submitIntention({
      type: "review.approve",
      actorId: "planner",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      payload: { taskId: "task_1" },
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.rejected");
    expect(result.event.payload.reason).toBe("Actor planner cannot emit review.approve");
    expect(result.event.payload).toMatchObject({
      code: "actor_intention_not_allowed",
      category: "permission",
      message: "Actor planner cannot emit review.approve",
    });
    expect((await store.verify()).ok).toBe(true);
  });

  it("rejects state-machine-invalid intentions before accepting events", async () => {
    const { store, orchestrator } = await setup();
    const result = await orchestrator.submitIntention({
      type: "task.claim",
      actorId: "worker",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      payload: { taskId: "missing" },
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.rejected");
    expect(result.event.payload.reason).toBe("Task missing does not exist");
    expect(result.event.payload).toMatchObject({
      code: "projection_state_rejected",
      category: "projection_state",
      message: "Task missing does not exist",
      projectionError: {
        projectionKind: "tasks",
        code: "missing_dependency",
        eventId: expect.any(String),
        type: "task.claimed",
        message: "Task missing does not exist",
      },
    });
    expect(projectTasks(await store.readAll()).errors).toEqual([]);
  });

  it("validates accepted events against the locked append snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-orchestrator-"));
    const path = join(dir, "events.jsonl");
    const store = new RacingValidationStore(path, async (baseStore) => {
      await baseStore.append(createEvent({
        id: "evt_race_claim",
        type: "task.claimed",
        actorId: "other_worker",
        threadId: "thread_main",
        parentEventId: "evt_race_task",
        causedBy: ["evt_race_task"],
        payload: { taskId: "task_race" },
      }));
    });
    const actors = new ActorRegistry();
    actors.register({
      id: "worker",
      role: "Works tasks",
      subscriptions: ["task.proposed"],
      intentions: ["task.claim"],
    });
    const orchestrator = new Orchestrator(store, actors);
    const proposed = await store.append(createEvent({
      id: "evt_race_task",
      type: "task.proposed",
      actorId: "planner",
      threadId: "thread_main",
      parentEventId: null,
      payload: { taskId: "task_race", title: "Race task" },
    }));

    const result = await orchestrator.submitIntention({
      type: "task.claim",
      actorId: "worker",
      threadId: "thread_main",
      parentEventId: proposed.id,
      causedBy: [proposed.id],
      payload: { taskId: "task_race" },
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.rejected");
    expect(result.event.payload.reason).toBe("Cannot apply task.claimed to task task_race in claimed state");
    const projection = projectTasks(await store.readAll());
    expect(projection.tasks.task_race.status).toBe("claimed");
    expect(projection.errors).toEqual([]);
  });

  it("rejects invalid research state transitions before accepting events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-orchestrator-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));
    const actors = new ActorRegistry();
    actors.register({
      id: "editor",
      role: "Finalizes research reports",
      subscriptions: ["report.section.drafted"],
      intentions: ["report.finalize"],
    });
    const orchestrator = new Orchestrator(store, actors);
    await store.append(createEvent({
      id: "evt_question",
      type: "research.question.created",
      actorId: "user",
      threadId: "thread_research",
      parentEventId: null,
      payload: {
        questionId: "question_1",
        question: "How should agents preserve provenance?",
      },
    }));

    const result = await orchestrator.submitIntention({
      type: "report.finalize",
      actorId: "editor",
      threadId: "thread_research",
      parentEventId: "evt_question",
      causedBy: ["evt_question"],
      payload: {
        questionId: "question_1",
        reportId: "report_1",
        summary: "Too early",
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.rejected");
    expect(result.event.threadId).toBe("thread_research");
    expect(result.event.payload).toMatchObject({
      actorId: "editor",
      intentionType: "report.finalize",
      eventType: "report.finalized",
    });
    expect(result.event.payload.reason).toBe(
      "Cannot apply report.finalized to research question question_1 in created state",
    );
    expect(projectResearch(await store.readAll()).errors).toEqual([]);
  });

  it("rejects effects applied before approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-orchestrator-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));
    const actors = new ActorRegistry();
    actors.register({
      id: "applier",
      role: "Applies approved effects",
      subscriptions: ["approval.granted"],
      intentions: ["effect.apply"],
    });
    const orchestrator = new Orchestrator(store, actors);
    await store.append(createEvent({
      id: "evt_effect",
      type: "effect.requested",
      actorId: "responder",
      threadId: "thread_ops",
      parentEventId: null,
      payload: {
        effectId: "effect_1",
        action: "notify",
      },
    }));

    const result = await orchestrator.submitIntention({
      type: "effect.apply",
      actorId: "applier",
      threadId: "thread_ops",
      parentEventId: "evt_effect",
      causedBy: ["evt_effect"],
      payload: {
        effectId: "effect_1",
        action: "notify",
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.rejected");
    expect(result.event.payload.reason).toBe("Cannot apply effect.applied to effect effect_1 in requested state");
    expect(projectEffects(await store.readAll()).errors).toEqual([]);
  });

  it("rejects malformed intentions", async () => {
    const { store, orchestrator } = await setup();

    const result = await orchestrator.submitIntention({
      type: "not.real",
      actorId: "planner",
    });

    expect(result.accepted).toBe(false);
    expect(result.event.type).toBe("intention.invalid");
    expect(result.event.payload).toMatchObject({
      code: "intention_schema_invalid",
      category: "schema",
      message: expect.any(String),
    });
    expect((await store.verify()).ok).toBe(true);
  });

  it("accepts custom intention definitions without changing built-in schemas", async () => {
    const { store, actors } = await setup();
    actors.register({
      id: "notetaker",
      role: "Capture durable notes",
      subscriptions: ["goal.created"],
      intentions: ["note.add"],
    });
    const orchestrator = new Orchestrator(store, actors, {
      customIntentions: [
        {
          type: "note.add",
          eventType: "note.added",
          payloadSchema: z.object({
            noteId: z.string().min(1),
            body: z.string().min(1),
            version: z.literal(1),
          }),
        },
      ],
    });

    const result = await orchestrator.submitIntention({
      type: "note.add",
      actorId: "notetaker",
      threadId: "thread_notes",
      parentEventId: null,
      causedBy: [],
      payload: { noteId: "note_1", body: "Custom workflow note", version: 1 },
    });

    expect(result.accepted).toBe(true);
    expect(result.event).toMatchObject({
      type: "note.added",
      actorId: "notetaker",
      payload: { noteId: "note_1", body: "Custom workflow note", version: 1 },
    });
  });

  it("rejects custom intentions with invalid payloads or custom projection validation failures", async () => {
    const { store, actors } = await setup();
    actors.register({
      id: "notetaker",
      role: "Capture durable notes",
      subscriptions: ["goal.created"],
      intentions: ["note.add"],
    });
    const customIntentions = [
      {
        type: "note.add",
        eventType: "note.added",
        payloadSchema: z.object({
          noteId: z.string().min(1),
          body: z.string().min(1),
          version: z.literal(1),
        }),
        validateEvent: (events, event) => {
          const noteId = event.payload.noteId;
          if (typeof noteId !== "string") return "noteId must be a string";
          return events.some((existing) => existing.type === "note.added" && existing.payload.noteId === noteId)
            ? `Note ${noteId} already exists`
            : null;
        },
      },
    ] satisfies ConstructorParameters<typeof Orchestrator>[2]["customIntentions"];
    const orchestrator = new Orchestrator(store, actors, { customIntentions });

    const invalidPayload = await orchestrator.submitIntention({
      type: "note.add",
      actorId: "notetaker",
      threadId: "thread_notes",
      parentEventId: null,
      causedBy: [],
      payload: { noteId: "note_1", body: "", version: 1 },
    });
    expect(invalidPayload.accepted).toBe(false);
    expect(invalidPayload.event).toMatchObject({
      type: "intention.invalid",
      payload: { reason: expect.stringContaining("String must contain at least 1 character") },
    });

    await orchestrator.submitIntention({
      type: "note.add",
      actorId: "notetaker",
      threadId: "thread_notes",
      parentEventId: null,
      causedBy: [],
      payload: { noteId: "note_1", body: "First note", version: 1 },
    });
    const duplicate = await orchestrator.submitIntention({
      type: "note.add",
      actorId: "notetaker",
      threadId: "thread_notes",
      parentEventId: null,
      causedBy: [],
      payload: { noteId: "note_1", body: "Duplicate note", version: 1 },
    });

    expect(duplicate.accepted).toBe(false);
    expect(duplicate.event).toMatchObject({
      type: "intention.rejected",
      payload: { reason: "Note note_1 already exists" },
    });
  });
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-orchestrator-"));
  const store = new JsonlEventStore(join(dir, "events.jsonl"));
  const actors = new ActorRegistry();
  actors.register({
    id: "planner",
    role: "Plans tasks",
    subscriptions: ["goal.created"],
    intentions: ["task.propose"],
  });
  actors.register({
    id: "worker",
    role: "Works tasks",
    subscriptions: ["task.proposed"],
    intentions: ["task.claim"],
  });

  return {
    store,
    actors,
    orchestrator: new Orchestrator(store, actors),
  };
}

class RacingValidationStore extends JsonlEventStore {
  private raced = false;

  constructor(path: string, private readonly race: (baseStore: JsonlEventStore) => Promise<void>) {
    super(path);
  }

  override async appendValidated(
    event: Parameters<JsonlEventStore["appendValidated"]>[0],
    validate: Parameters<JsonlEventStore["appendValidated"]>[1],
  ) {
    if (!this.raced) {
      this.raced = true;
      await this.race(this);
    }
    return super.appendValidated(event, validate);
  }
}
