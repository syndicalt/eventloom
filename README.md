# Threadline

Threadline is the prototype name for the Eventloom runtime, a local-first TypeScript runtime for multi-agent systems built around an append-only event log.

Instead of treating an agent run as a linear `system/user/assistant` transcript, Threadline models runtime state as typed events. Actors receive mailbox items, emit structured intentions, and an orchestrator validates those intentions before appending accepted events. Projections rebuild state from the log, so a run can be replayed and inspected after the fact.

Threadline is currently a runtime prototype. It is designed for local development, deterministic replay, and integration experiments with Pathlight.

## What It Does

- Appends sealed events to a JSONL event log.
- Verifies a tamper-evident hash chain.
- Runs deterministic actor workflows.
- Validates actor intentions before accepting state changes.
- Rebuilds task, research, and effect projections from the log.
- Supports human-in-the-loop approval events.
- Exports actor turns and runtime events to Pathlight traces.
- Provides a package API for embedding Threadline in TypeScript code.

## Quick Start

```bash
npm install
npm test
npm run build
```

Run a deterministic software-work workflow:

```bash
npm run threadline -- run software-work /tmp/threadline-software.jsonl
npm run threadline -- replay /tmp/threadline-software.jsonl
```

Run a research workflow:

```bash
npm run threadline -- run research-pipeline /tmp/threadline-research.jsonl
npm run threadline -- timeline /tmp/threadline-research.jsonl
```

Run a human approval workflow:

```bash
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl
npm run threadline -- append /tmp/threadline-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl --resume
```

## Use as a Library

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/threadline.jsonl");
await runtime.runBuiltIn("research-pipeline");

const replay = await runtime.replay();
console.log(replay.integrity.ok);
console.log(replay.projection.research);
```

The npm package is published as `@eventloom/runtime`. See [Package API](docs/package-api.md) for the full package-facing API.

## Documentation

- [Documentation Index](docs/README.md)
- [User Guide](docs/user-guide.md)
- [CLI Reference](docs/cli-reference.md)
- [Package API](docs/package-api.md)
- [Architecture](docs/architecture.md)
- [Event Model](docs/event-model.md)
- [Workflow Guide](docs/workflows.md)
- [Pathlight Integration](docs/pathlight-integration.md)
- [Contributor Guide](docs/contributor-guide.md)

## Project Layout

```text
src/        Runtime and CLI source
tests/      Vitest unit and integration tests
fixtures/   Sample event logs
docs/       User, technical, and planning docs
```

## Status

The original prototype roadmap is implemented:

- Local JSONL event log
- Deterministic projections
- Actors and intention validation
- Orchestrated software-work workflow
- CLI inspection surface
- Pathlight export bridge
- Multi-agent research workflow
- Human-in-the-loop effect approval workflow
- Runtime provenance metadata
- Public package API
