# Development Plan

## Positioning

Threadline should start as a clean runtime prototype, then graduate into Pathlight if the model proves useful. Pathlight observes agent runs after or during execution. Threadline coordinates execution through an append-only event log, named actors, validated intentions, deterministic projections, and replay.

The product promise is: agents become debuggable because their runtime state is built from explicit events, not hidden conversation state.

## Development Pipeline

Use a narrow, verification-heavy pipeline:

1. Specify the event contract before implementation.
2. Implement the smallest local runtime that can append, replay, and project events.
3. Add actors only after replay is deterministic.
4. Add orchestration only after actor intentions are schema-validated.
5. Add UI or Pathlight integration only after the CLI can explain state from the log.

Every sprint should produce:

- A runnable example.
- Tests for replay determinism.
- A short demo script.
- A decision note for any architecture choice that affects Pathlight integration.

## Core Stack

Use TypeScript first. Pathlight already uses TypeScript, Hono, Drizzle, SQLite/libSQL, Vitest, and a dashboard/collector split. Reusing that ecosystem reduces integration risk.

Initial stack:

- Runtime: TypeScript on Node.js.
- CLI/dev runner: `tsx`.
- Tests: Vitest.
- Event store: JSONL file for Sprint 1.
- Schema validation: Zod or JSON Schema.
- IDs: `nanoid`.
- Projections: deterministic pure TypeScript reducers.

Pathlight integration stack:

- Collector API: Hono.
- Storage: SQLite/libSQL through Drizzle.
- Dashboard: reuse Pathlight's trace/timeline concepts where possible.

Avoid Temporal, Kafka, LangGraph, and distributed actors until the local model is proven. They are scale tools, not MVP requirements.

## Target Use Cases

### 1. Agentic Software Work Tracking

Actors plan, claim, complete, and review tasks. This is the first target because it exercises causality, task state, actor identity, replay, and auditability without needing external systems.

Key events:

- `goal.created`
- `task.proposed`
- `task.claimed`
- `task.completed`
- `review.requested`
- `issue.reported`
- `review.approved`

### 2. Multi-Agent Research Pipeline

Actors gather sources, extract claims, critique evidence, and produce a report. This tests parallel threads and provenance.

Key events:

- `research.question.created`
- `source.found`
- `claim.extracted`
- `claim.challenged`
- `report.section.drafted`
- `report.finalized`

### 3. Human-in-the-Loop Operations

External events enter the log, agents propose actions, and humans approve or reject effects. This tests external triggers, safety boundaries, and audit history.

Key events:

- `external.alert.received`
- `actor.intention.emitted`
- `approval.requested`
- `approval.granted`
- `effect.applied`
- `effect.rejected`

### 4. Pathlight Runtime Trace Bridge

Runtime events are exported into Pathlight as inspectable traces/spans. This validates whether the new event model can become a Pathlight product surface.

Key mapping:

- Runtime thread -> Pathlight trace.
- Actor turn -> Pathlight span.
- Runtime event -> Pathlight event row or future Threadline event table.
- Projection hash -> trace metadata.

## Initial Sprints

### Sprint 0: Repository Bootstrap

Goal: create the project skeleton and executable test loop.

Deliverables:

- `package.json`, TypeScript config, Vitest config.
- `src/` and `tests/` layout.
- Basic CLI entrypoint.
- Documentation for local commands.

Verification: `npm test` runs successfully from a fresh checkout.

### Sprint 1: Append-Only Event Store

Goal: make immutable local events real.

Deliverables:

- Event envelope type.
- JSONL append and read operations.
- Canonical event ordering.
- Validation for required envelope fields.
- Projection hash helper.

Verification: tests append sample events, reload them, replay them, and produce the same projection hash.

### Sprint 2: Projections and Causal Queries

Goal: prove state can be rebuilt from the log.

Deliverables:

- Task projection.
- Actor projection.
- Thread projection.
- Query helpers for parent/child causal chains.

Verification: a test can answer why a task is in its current state using only events.

### Sprint 3: Actors and Intentions

Goal: separate actor proposals from accepted state changes.

Deliverables:

- Actor registry.
- Subscription matching.
- Mailbox construction from event history.
- Intention schemas.
- Valid and invalid intention handling.

Verification: valid intentions become accepted events; invalid intentions become explicit rejection events.

### Sprint 4: Orchestrated Sample Workflow

Goal: run the software-work tracking use case end to end.

Deliverables:

- `planner`, `worker`, and `reviewer` sample actors.
- CLI command to run the sample workflow.
- Replay command.
- Event log fixture for demos.

Verification: live run and replay produce identical task, actor, and thread projections.

### Sprint 5: Inspection Surface

Goal: make the event log understandable without reading JSONL manually.

Deliverables:

- CLI timeline view.
- CLI task-state explanation view.
- CLI actor activity view.
- Export format compatible with Pathlight ingestion experiments.

Verification: a developer can inspect a task and see the causal chain from goal to final state.

### Sprint 6: Pathlight Bridge Spike

Goal: determine whether this should merge into Pathlight or remain separate.

Deliverables:

- Export runtime events into Pathlight traces/spans.
- Prototype schema extension if Pathlight's trace/span/event model is insufficient.
- Comparison document covering reuse, migration, and product naming.

Verification: one runtime workflow appears in Pathlight with useful actor, event, and projection context.

## Key Decisions

### TypeScript Before Python

TypeScript matches Pathlight and keeps the bridge cheap. Python can come later as an SDK or actor host.

### JSONL Before SQLite

JSONL makes append-only semantics obvious and easy to inspect. SQLite should replace it only when queries, indexes, or Pathlight integration need it.

### Parent IDs Before Vector Clocks

Start with `parentEventId` and `causedBy`. Vector clocks are only needed once true concurrent writes create ambiguity that simple causal links cannot explain.

### CLI Before UI

A CLI proves the runtime semantics faster than a dashboard. Pathlight already provides the long-term UI direction.

## Open Risks

- The runtime may duplicate Pathlight concepts unless the boundary stays clear: Pathlight observes, this coordinates.
- If actors execute nondeterministic LLM calls during replay, replay must separate historical outputs from new execution.
- Event schemas can become too generic. Keep the first use case concrete.
- Effects need a safety model before filesystem or API mutation is allowed.

## Current Status

Sprints 0-6 are implemented for the local prototype:

- JSONL event storage, validation, replay, and projection hashing.
- Task, actor, thread, mailbox, and causal inspection surfaces.
- Actor registry, intention validation, orchestrated software-work runtime, and processed markers.
- External event ingestion and tamper-evident event-chain verification.
- Pathlight export adapter verified against a local collector.
- Multi-agent research pipeline as a second deterministic workflow.
- Human-in-the-loop effect approvals with external approval ingestion and resume.
- Git/project provenance and projection metadata in Pathlight exports.
- Documented package API around runtime primitives.

Next, choose a new runtime milestone beyond the original roadmap.
