# Architecture

Eventloom is a local-first runtime built around an append-only event log. The runtime coordinates actors through validated intentions and rebuilds state through deterministic projections.

## Runtime Components

### Event Store

`JsonlEventStore` stores one event per line in a JSONL file.

Responsibilities:

- Load and validate event envelopes.
- Append new events.
- Seal events with integrity hashes.
- Verify the hash chain.

The event store does not understand task, research, or effect semantics. It only owns persistence and integrity.

### Events

Events are immutable runtime facts. Every state transition that matters should be represented as an event.

Examples:

- `goal.created`
- `task.proposed`
- `research.question.created`
- `source.found`
- `effect.requested`
- `approval.granted`

Events are validated by the envelope schema in `src/events.ts`.

### Actors

Actors are named compute units with:

- `id`
- `role`
- subscribed event types
- allowed intention types

Actors do not directly write state. They receive mailbox items and emit intentions.

### Mailboxes

Mailboxes are rebuilt from event history. An actor receives events matching its subscriptions unless it has already processed them.

The runtime appends `actor.processed` events so resumed runs do not reprocess the same source event.

### Intentions

Intentions are structured proposals from actors. They are validated by:

- intention schema
- actor permission checks
- projection state-machine checks

Only accepted intentions become domain events.

### Orchestrator

The orchestrator is the trust boundary between actors and state.

It:

- parses intentions
- verifies the actor is registered
- verifies the actor may emit the requested intention type
- maps intention types to event types
- validates projected state transitions
- appends accepted events
- appends rejection events for invalid intentions

### Projections

Projections are deterministic read models rebuilt from event history.

Current projections:

- task projection: task lifecycle state
- research projection: question/source/claim/challenge/report state
- effect projection: approval and effect application state
- event type counts

Projection errors are recorded in projection output during replay, but the orchestrator prevents invalid state-machine transitions from entering accepted events.

### Runtime Loop

`runRuntimeLoop` drives actor execution:

1. Read all events.
2. Rebuild each actor mailbox.
3. Append `actor.started`.
4. Run the actor runner for one mailbox item.
5. Submit returned intentions to the orchestrator.
6. Append `actor.completed`.
7. Append `actor.processed`.
8. Repeat until no new events are appended or `maxIterations` is reached.

## Data Flow

```text
event log
  -> mailbox rebuild
  -> actor runner
  -> intentions
  -> orchestrator validation
  -> accepted/rejected events
  -> event log
  -> projection replay
```

## Determinism Model

Replay is deterministic because projections are pure reducers over event history.

Actor execution is deterministic for the built-in workflows because runners are local functions. If future actors call LLMs or external APIs, replay should not re-run those calls. Instead, it should replay the already-recorded actor output events.

## Integrity Model

Each appended event is sealed with:

- `integrity.hash`
- `integrity.previousHash`

The hash is computed over a canonical representation of the event. The previous hash links each event to the prior event in append order. `verifyEventChain` detects malformed, missing, or reordered links.

## Pathlight Boundary

Eventloom coordinates execution. Pathlight observes and visualizes execution.

The Pathlight adapter is intentionally separate from the core runtime. It translates an Eventloom event log into Pathlight traces, spans, and span events without making Eventloom depend on Pathlight storage internals.

## Extension Points

To add a new workflow:

1. Add event and intention names.
2. Add actor definitions.
3. Add a projection if the workflow has new state.
4. Wire projection validation into the orchestrator.
5. Add actor runners.
6. Add CLI/package API entry points if it is a built-in workflow.
7. Add tests for projection transitions, orchestrator rejection, and runtime loop behavior.
