# Stack Review

## Recommendation

Build Threadline as a TypeScript runtime first, with a local JSONL event store and deterministic projection tests. Reuse Pathlight's ecosystem where it helps, but do not start by embedding Threadline inside Pathlight.

The immediate goal is to prove the runtime model:

- Events are append-only.
- Actor outputs are validated before acceptance.
- Projections replay deterministically.
- A developer can explain state from the log alone.

## Core Runtime Stack

### Language: TypeScript

Use TypeScript because Pathlight already uses it and the likely integration path is cheaper. It also gives us strong event-envelope types, schema inference, and a straightforward CLI/runtime package.

Python remains useful later for SDKs or actor hosts, but it should not be the first implementation language.

### Runtime: Node.js

Use modern Node.js with ESM. Keep the runtime library free of browser and framework assumptions.

Initial package shape:

```text
src/
  event-store.ts
  events.ts
  projection.ts
  causal.ts
  cli.ts
tests/
  event-store.test.ts
  projection.test.ts
```

### CLI Runner: tsx

Use `tsx` for local development commands. It avoids a build step during early iteration while keeping TypeScript source authoritative.

Expected commands:

```bash
npm test
npm run build
npm run threadline -- replay ./fixtures/sample.jsonl
```

### Tests: Vitest

Use Vitest to match Pathlight. The most important test class is deterministic replay: given the same event log, projections and hashes must match exactly.

## Data and Validation

### Event Store: JSONL First

Start with a local JSONL append-only store. It is inspectable, easy to diff, and forces us to model the log clearly before adding database behavior.

Rules:

- Appends only.
- One event per line.
- No in-place mutation.
- Loading must reject malformed lines.
- Replay must sort only by canonical append order.

SQLite/libSQL should come after the event model is stable or when Pathlight integration needs indexed queries.

### Schema Validation: Zod

Use Zod for event and intention schemas. It fits TypeScript well, supports runtime validation, and can infer types from schemas.

JSON Schema export can be added later if actor contracts need to cross language boundaries.

### IDs: nanoid

Use `nanoid` for compact event, actor, thread, and task IDs. Prefer prefixed IDs for readability:

```text
evt_...
actor_...
thread_...
task_...
```

## Architecture Boundaries

### Runtime Library

The runtime library owns:

- Event envelope definitions.
- Append/read operations.
- Projection reducers.
- Causal queries.
- Actor registry.
- Intention validation.

It should not own dashboard UI, database migrations, LLM provider clients, or distributed scheduling in the first sprints.

### CLI

The CLI is the first inspection surface. It should support:

- `append` for test/demo events.
- `replay` for projection reconstruction.
- `timeline` for thread/event inspection.
- `explain task <id>` for causal state explanation.

### Pathlight Bridge

The Pathlight bridge should be a separate adapter. It should translate Threadline runtime history into Pathlight traces/spans/events without coupling the core runtime to Pathlight internals.

Initial mapping:

- Threadline thread -> Pathlight trace.
- Actor turn -> Pathlight span.
- Runtime event -> Pathlight event or future event-log table.
- Projection hash -> trace metadata.

## Deferred Stack

Do not add these in the first implementation:

- Temporal: valuable later for durable distributed workflows, too heavy for proving the event model.
- Kafka or Redpanda: useful for scale, unnecessary for local replay semantics.
- LangGraph: useful for graph-shaped agent workflows, but Threadline first needs its own event contract.
- Redis: useful for projection caches, premature before projections exist.
- Vector DB: out of scope until memory/RAG is a concrete use case.
- Web UI: Pathlight is the likely UI host; prove CLI semantics first.

## First Build Slice

The first build slice should include:

1. `package.json`, `tsconfig.json`, and Vitest setup.
2. Event envelope schema with Zod.
3. JSONL append/read store.
4. Deterministic projection hash helper.
5. Tests for valid events, malformed events, append/read round trips, and replay hashing.

Success criteria:

- `npm test` passes.
- A sample JSONL log can be replayed.
- Replaying the same log twice produces the same hash.
- Invalid event data fails before entering projections.

## Decision Summary

Threadline starts as a small TypeScript runtime with JSONL persistence, Zod validation, Vitest verification, and a CLI-first inspection surface. Pathlight is the integration target, not the starting point.
