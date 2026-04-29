# Threadline Product Spec

## Product Thesis

Multi-agent AI should be modeled as an evented system, not a linear chat transcript. The runtime should make actors, causality, external events, state transitions, replay, and audit history first-class concepts.

Threadline is an append-only event log for AI systems. Named actors read projected state, emit structured intentions, and let a deterministic orchestrator validate, append, reduce, and apply effects.

## Target User

The first target user is a developer building multi-agent workflows that need traceability: coding agents, research pipelines, operational assistants, or compliance-sensitive automations.

The initial product should optimize for local development and inspection before distributed scale.

## MVP Scope

The MVP must prove that a multi-actor workflow can run without relying on a `system/user/assistant` transcript as the source of truth.

Required capabilities:

- Append typed events to a durable log.
- Register named actors with roles and subscriptions.
- Deliver events to actor mailboxes.
- Require actor outputs to match JSON schemas.
- Validate intentions before appending follow-up events.
- Build deterministic projections from the log.
- Replay the log to reconstruct state.
- Inspect event history, actor activity, and causal links.

Non-goals for the MVP:

- Distributed execution.
- Kafka-scale throughput.
- Visual workflow editing.
- Long-term memory or vector search.
- Multi-tenant auth.

## Core Concepts

### Event

An event is the immutable unit of history.

```json
{
  "id": "evt_01",
  "type": "task.created",
  "actorId": "user",
  "threadId": "thread_main",
  "parentEventId": null,
  "causedBy": [],
  "timestamp": "2026-04-28T22:00:00Z",
  "payload": {
    "title": "Research Threadline runtimes"
  }
}
```

### Actor

An actor is a named compute unit with a mailbox, role, subscriptions, and output schema. Actors do not mutate state directly. They read projections and emit intentions.

Example actors:

- `planner`: decomposes goals into tasks.
- `researcher`: gathers evidence and produces notes.
- `reviewer`: checks outputs against acceptance criteria.
- `orchestrator`: validates intentions and appends events.

### Intention

An intention is a structured request from an actor. It is not trusted until validated by the orchestrator.

Examples:

- `task.claim`
- `task.complete`
- `issue.report`
- `effect.request`
- `message.emit`

### Projection

A projection is a deterministic read model derived from the log. It can be rebuilt at any time.

Initial projections:

- `tasks`: current task status by id.
- `actors`: actor health, mailbox length, and latest activity.
- `threads`: event order and causal graph per thread.

## System Architecture

The runtime has four primary modules:

- `event_store`: append and read immutable events.
- `actor_registry`: define actors, subscriptions, and schemas.
- `orchestrator`: route events, validate intentions, and apply approved effects.
- `projector`: rebuild materialized views from events.

For the first implementation, use a local JSONL event store. Keep the storage interface narrow so Postgres can replace JSONL later without changing actor logic.

## First Use Case

Build a software-work tracking workflow:

1. A user creates a goal.
2. `planner` emits task creation intentions.
3. `worker` claims and completes tasks.
4. `reviewer` emits approval or issue events.
5. The runtime replays the log and proves the final projection matches the live projection.

This use case is small enough for an MVP and naturally exercises actors, threads, causal links, validation, and replay.

## Success Criteria

The MVP is successful when:

- A sample workflow runs from an empty log to completion.
- Every state change is represented by an event.
- Replaying the event log recreates the same projections.
- Invalid actor output is rejected and logged as an error event.
- A developer can inspect the causal chain for any task.

## Milestone Plan

### Milestone 1: Local Event Log

- Define the event envelope.
- Implement append-only JSONL storage.
- Add event loading and canonical ordering.
- Add a small replay command.

Verification: append sample events, reload them, and compare projection hashes.

### Milestone 2: Actors and Schemas

- Add actor definitions.
- Add subscriptions and mailboxes.
- Validate actor intentions with JSON Schema or Pydantic.

Verification: valid intentions append follow-up events; invalid intentions produce error events.

### Milestone 3: Orchestrated Workflow

- Implement the software-work tracking example.
- Add task, actor, and thread projections.
- Add a CLI command to run the sample workflow.

Verification: the sample workflow completes and replay produces the same final state.

### Milestone 4: Inspection UI or CLI

- Show events by thread.
- Show task status and causal parents.
- Show actor activity.

Verification: a developer can answer "why is this task in this state?" from the log alone.

## Open Questions

- Should the first implementation be Python or TypeScript?
- Should actor execution be synchronous for determinism, or async from the start?
- Should effects be modeled as events only, or should the orchestrator also execute local filesystem/API effects in MVP?
- Should causal links use simple parent IDs first, then vector clocks later?
