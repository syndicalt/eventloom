# Contributor Guide

This guide covers the development loop and expectations for changing Threadline.

## Local Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build TypeScript:

```bash
npm run build
```

Run the CLI:

```bash
npm run threadline -- replay fixtures/sample.jsonl
```

## Code Organization

```text
src/
  actors.ts                 Actor registries
  causal.ts                 Causal chain helpers
  cli.ts                    CLI entrypoint
  demo.ts                   Static demo generation
  effect-projection.ts      Effect approval projection
  event-store.ts            JSONL event persistence
  events.ts                 Event envelope schema
  export/pathlight.ts       Pathlight adapter
  ingest.ts                 External event append helpers
  inspect.ts                Timeline/task/mailbox formatters
  integrity.ts              Hash-chain sealing and verification
  intentions.ts             Intention schema and event mapping
  mailbox.ts                Mailbox rebuild logic
  orchestrator.ts           Intention validation and append boundary
  projection.ts             Generic projection/hash helpers
  provenance.ts             Package/git provenance collection
  research-projection.ts    Research workflow projection
  runners.ts                Runtime loop and built-in runners
  runtime.ts                Public package facade
  task-projection.ts        Task workflow projection
```

Tests live in `tests/` and should be named after the behavior they verify.

## Testing Strategy

Use focused tests for each layer:

- Event store tests for append/read/integrity behavior.
- Projection tests for valid transitions and invalid transitions.
- Orchestrator tests for actor permission and state-machine rejection.
- Runtime tests for end-to-end actor loops and resume behavior.
- Export tests for Pathlight payload shape.
- Public API tests for package-facing usage.

When fixing a bug, add a regression test near the layer where the bug belongs.

## Adding a Projection

A projection should:

1. Export a `projectX(events)` function.
2. Export a `validateXEvent(events, event)` function if the orchestrator should prevent invalid transitions.
3. Return derived state plus an `errors` array.
4. Avoid side effects.
5. Use deterministic data structures and stable ordering.

Projection errors are useful during replay. Orchestrator validation should prevent invalid accepted events from being appended.

## Adding an Intention

To add an intention:

1. Add the intention type in `src/intentions.ts`.
2. Add the intention-to-event mapping.
3. Add actor permissions in the relevant registry.
4. Add projection validation if the event changes projected state.
5. Add tests for accepted and rejected paths.

## Adding a Built-In Workflow

To add a built-in workflow:

1. Define actors in `src/actors.ts`.
2. Define deterministic runners in `src/runners.ts`.
3. Add projection support for workflow state.
4. Add CLI routing in `src/cli.ts`.
5. Add runtime facade support in `src/runtime.ts`.
6. Add docs in `docs/workflows.md`.
7. Add runtime tests that verify final projection state and resume behavior.

## CLI Changes

When adding or changing CLI behavior:

1. Update `src/cli.ts`.
2. Add or update tests when behavior is non-trivial.
3. Update [CLI Reference](cli-reference.md).
4. Update [User Guide](user-guide.md) if the workflow changes.
5. Update `AGENTS.md` when repository-level commands change.

## Documentation Changes

Documentation should stay aligned with runnable commands. Prefer examples that can be executed from the repository root.

When adding a new public concept, update:

- `README.md`
- `docs/README.md`
- the relevant user guide or technical guide
- `docs/package-api.md` if the package API changes

## Pathlight Changes

Keep Pathlight-specific behavior inside `src/export/pathlight.ts` unless there is a strong reason to change the core runtime.

Pathlight export should remain an adapter over existing event logs. Export must not mutate Threadline logs.

## Git Hygiene

Keep changes focused. Do not commit generated `dist/` output unless distribution requirements change.

Before handing off work:

```bash
npm test
npm run build
```

If you ran optional Pathlight integration checks, record the trace id in your handoff.
