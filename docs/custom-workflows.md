# Custom Workflows

Custom workflows can use Eventloom without patching internal modules. The extension pattern is:

1. Register actors with `ActorRegistry`.
2. Configure custom intention definitions on `Orchestrator`.
3. Validate payloads with a schema.
4. Add optional custom projection validation for state-machine rules.
5. Run actors with `runRuntimeLoop()` or submit intentions directly.
6. Project custom state with pure reducers over the event log.

See the runnable example:

```bash
npm exec tsx examples/custom-workflow.ts
```

The example creates a `notetaker` actor, accepts a custom `note.add` intention as a `note.added` event, rejects a duplicate note through custom validation, verifies the resulting log, and prints a small projection.

## Custom Intention Definitions

Use `CustomIntentionDefinition` when a workflow needs domain-specific intention and event names:

```ts
import { ActorRegistry, JsonlEventStore, Orchestrator } from "@eventloom/runtime";
import { z } from "zod";

const actors = new ActorRegistry();
actors.register({
  id: "notetaker",
  role: "Capture durable notes",
  subscriptions: ["goal.created"],
  intentions: ["note.add"],
});

const orchestrator = new Orchestrator(new JsonlEventStore(".eventloom/notes.jsonl"), actors, {
  customIntentions: [
    {
      type: "note.add",
      eventType: "note.added",
      payloadSchema: z.object({
        noteId: z.string().min(1),
        body: z.string().min(1),
        version: z.literal(1),
      }),
      validateEvent(events, event) {
        return events.some((existing) => existing.type === "note.added" && existing.payload.noteId === event.payload.noteId)
          ? `Note ${event.payload.noteId} already exists`
          : null;
      },
    },
  ],
});
```

The orchestrator still enforces actor permissions. The actor must list the custom intention type in its `intentions` array.

## Payload Versioning

Version domain payloads inside the payload object:

```json
{
  "noteId": "note_custom_1",
  "body": "Preserve the agent session context.",
  "version": 1
}
```

Keep the Eventloom envelope unchanged. Unknown top-level envelope fields are rejected. For compatible changes, add optional payload fields. For incompatible semantic changes, introduce a new payload version or a new event type and keep readers tolerant of older versions.

## Projection Rules

Custom projections should be pure functions over the full event history:

```ts
function projectNotes(events) {
  return events.reduce((notes, event) => {
    if (event.type !== "note.added") return notes;
    return {
      ...notes,
      [event.payload.noteId]: {
        id: event.payload.noteId,
        body: event.payload.body,
        version: event.payload.version,
        lastEventId: event.id,
      },
    };
  }, {});
}
```

Use custom `validateEvent()` hooks for invariants that must prevent accepted events, such as duplicate ids in domain state or invalid lifecycle transitions.
