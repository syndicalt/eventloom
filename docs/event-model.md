# Event Model

Threadline runtime state is represented by typed events in an append-only log.

## Event Envelope

Every event has the same envelope:

```json
{
  "id": "evt_...",
  "type": "task.proposed",
  "actorId": "planner",
  "threadId": "thread_main",
  "parentEventId": "evt_goal",
  "causedBy": ["evt_goal"],
  "timestamp": "2026-04-29T12:00:00.000Z",
  "payload": {},
  "integrity": {
    "hash": "sha256:...",
    "previousHash": "sha256:..."
  }
}
```

Fields:

- `id`: event id. Must start with `evt_`.
- `type`: dot-delimited event type such as `task.proposed`.
- `actorId`: actor or external principal that emitted the event.
- `threadId`: logical event thread.
- `parentEventId`: direct parent event, or `null`.
- `causedBy`: causal dependencies.
- `timestamp`: ISO datetime with offset.
- `payload`: event-specific JSON object.
- `integrity`: hash-chain metadata added by the event store.

## Event Type Naming

Event types use lowercase dot-delimited names:

```text
goal.created
task.proposed
research.question.created
approval.granted
effect.applied
```

The first segment is usually the domain object. The final segment is the fact that occurred.

## External Events

External events enter the log through the CLI or package API:

```bash
npm run threadline -- append /tmp/threadline.jsonl goal.created --actor user --payload '{"title":"External goal"}'
```

External events are trusted only as facts in the log. If actors react to them, their follow-up state changes still go through the intention and orchestrator path.

## Intentions

Intentions are actor proposals, not accepted state.

Example:

```json
{
  "type": "task.propose",
  "actorId": "planner",
  "threadId": "thread_main",
  "parentEventId": "evt_goal",
  "causedBy": ["evt_goal"],
  "payload": {
    "taskId": "task_1",
    "title": "Write tests"
  }
}
```

The orchestrator maps intention types to event types:

```text
task.propose       -> task.proposed
task.claim         -> task.claimed
source.find        -> source.found
approval.request   -> approval.requested
effect.apply       -> effect.applied
```

The actor must be registered and allowed to emit the intention type.

## Rejection Events

Invalid intentions append explicit rejection events instead of silently failing.

Rejection event types:

- `intention.invalid`: the input did not match the intention schema.
- `intention.rejected`: the intention was well-formed but not accepted.

Examples of rejection causes:

- actor is not registered
- actor cannot emit that intention type
- task does not exist
- effect is applied before approval
- research report is finalized before a section is drafted

## Actor Turn Events

The runtime loop records actor execution with three event types:

- `actor.started`
- `actor.completed`
- `actor.processed`

`actor.started` records the source mailbox event.

`actor.completed` records emitted intention types and accepted/rejected event ids.

`actor.processed` marks a source event as processed so resumed runs skip it.

## Integrity Hashes

Every appended event is sealed with:

- `hash`: hash of the event.
- `previousHash`: hash of the prior appended event, or `null` for the first event.

Replay verifies the chain. If a line is edited, deleted, reordered, or malformed, integrity verification fails.

## Projections

Projections are deterministic reducers over events.

Current projections:

- `projectTasks`
- `projectResearch`
- `projectEffects`
- `eventTypeCounts`

Projection state is derived data. The event log is the source of truth.

## Causality

Threadline uses both:

- `parentEventId` for the main direct parent.
- `causedBy` for one or more causal dependencies.

The causal utilities rebuild a chain for inspection, such as explaining why a task has its current status.

## Adding Event Types

When adding a new event type:

1. Add the intention type if actors should emit it.
2. Add the intention-to-event mapping.
3. Add actor permission entries.
4. Add or update projection reducers.
5. Add orchestrator validation.
6. Add tests for valid and invalid transitions.
