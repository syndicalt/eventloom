import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  ActorRegistry,
  JsonlEventStore,
  Orchestrator,
  createEvent,
  eventTypeCounts,
  type EventEnvelope,
} from "@eventloom/runtime";

interface NoteState {
  id: string;
  body: string;
  version: 1;
  lastEventId: string;
}

const notePayloadSchema = z.object({
  noteId: z.string().min(1),
  body: z.string().min(1),
  version: z.literal(1),
});

const dir = await mkdtemp(join(tmpdir(), "eventloom-custom-workflow-"));
const store = new JsonlEventStore(join(dir, "events.jsonl"));
const actors = new ActorRegistry();
actors.register({
  id: "notetaker",
  role: "Capture durable workflow notes",
  subscriptions: ["goal.created"],
  intentions: ["note.add"],
});

const orchestrator = new Orchestrator(store, actors, {
  customIntentions: [
    {
      type: "note.add",
      eventType: "note.added",
      payloadSchema: notePayloadSchema,
      validateEvent(events, event) {
        const payload = notePayloadSchema.parse(event.payload);
        return events.some((existing) => existing.type === "note.added" && existing.payload.noteId === payload.noteId)
          ? `Note ${payload.noteId} already exists`
          : null;
      },
    },
  ],
});

const goal = await store.append(createEvent({
  id: "evt_custom_goal",
  type: "goal.created",
  actorId: "user",
  threadId: "thread_custom",
  parentEventId: null,
  causedBy: [],
  timestamp: "2026-06-01T00:00:00.000Z",
  payload: { title: "Preserve agent session context" },
}));

await orchestrator.submitIntention({
  type: "note.add",
  actorId: "notetaker",
  threadId: "thread_custom",
  parentEventId: goal.id,
  causedBy: [goal.id],
  payload: {
    noteId: "note_custom_1",
    body: "Preserve the human-to-agent conversation as a durable artifact.",
    version: 1,
  },
});

await orchestrator.submitIntention({
  type: "note.add",
  actorId: "notetaker",
  threadId: "thread_custom",
  parentEventId: goal.id,
  causedBy: [goal.id],
  payload: {
    noteId: "note_custom_1",
    body: "Duplicate note rejected by custom projection validation.",
    version: 1,
  },
});

const events = await store.readAll();
const verification = await store.verify();
const notes = projectNotes(events);

console.log(JSON.stringify({
  eventCount: events.length,
  integrityOk: verification.ok,
  note: notes.note_custom_1,
  eventTypes: eventTypeCounts(events),
}, null, 2));

function projectNotes(events: readonly EventEnvelope[]): Record<string, NoteState> {
  const notes: Record<string, NoteState> = {};
  for (const event of events) {
    if (event.type !== "note.added") continue;
    const payload = notePayloadSchema.parse(event.payload);
    notes[payload.noteId] = {
      id: payload.noteId,
      body: payload.body,
      version: payload.version,
      lastEventId: event.id,
    };
  }
  return notes;
}
