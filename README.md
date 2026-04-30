# Eventloom

[![npm version](https://img.shields.io/npm/v/@eventloom/runtime.svg)](https://www.npmjs.com/package/@eventloom/runtime)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![GitHub](https://img.shields.io/badge/github-syndicalt%2Feventloom-black.svg)](https://github.com/syndicalt/eventloom)

Eventloom is a local-first TypeScript runtime for multi-agent systems built around an append-only event log.

Site: [`syndicalt.github.io/eventloom`](https://syndicalt.github.io/eventloom/) | Package: [`@eventloom/runtime`](https://www.npmjs.com/package/@eventloom/runtime) | Repository: [`syndicalt/eventloom`](https://github.com/syndicalt/eventloom) | License: [MIT](LICENSE)

Instead of treating an agent run as a linear `system/user/assistant` transcript, Eventloom models runtime state as typed events. Actors receive mailbox items, emit structured intentions, and an orchestrator validates those intentions before appending accepted events. Projections rebuild state from the log, so a run can be replayed and inspected after the fact.

Eventloom is currently a runtime prototype. It is designed for local development, deterministic replay, and integration experiments with Pathlight.

## MVP Quickstart

Use Eventloom as a local black box recorder for agent work:

```bash
mkdir -p .eventloom

npx eventloom append .eventloom/agent-work.jsonl goal.created \
  --actor user \
  --payload '{"title":"Ship a scoped agent task"}'

npx eventloom append .eventloom/agent-work.jsonl task.proposed \
  --actor codex \
  --payload '{"taskId":"task_demo","title":"Make a focused change"}'

npx eventloom append .eventloom/agent-work.jsonl task.claimed \
  --actor codex \
  --payload '{"taskId":"task_demo"}'

npx eventloom visualize .eventloom/agent-work.jsonl
npx eventloom handoff .eventloom/agent-work.jsonl
```

Optional MCP server for editor and agent clients:

```bash
npx @eventloom/mcp --root .
```

Optional Pathlight export when a collector is running:

```bash
npx eventloom export pathlight .eventloom/agent-work.jsonl \
  --base-url http://localhost:4100 \
  --trace-name eventloom-agent-work
```

Optional HALO export for agent failure-mode analysis:

```bash
npx eventloom export halo .eventloom/agent-work.jsonl \
  --out eventloom-halo-traces.jsonl \
  --project-id eventloom \
  --service-name eventloom-agent-work
```

## What It Does

- Appends sealed events to a JSONL event log.
- Verifies a tamper-evident hash chain.
- Summarizes handoffs from goals, tasks, decisions, verification events, model/tool telemetry, reasoning summaries, and observability gaps.
- Builds Capture, Replay, and Handoff visualizer models from local logs.
- Provides starter templates for coding, review, release, and research tasks.
- Runs deterministic actor workflows.
- Validates actor intentions before accepting state changes.
- Records model, tool, and reasoning-summary telemetry during actor turns, including prompt versions, summaries, token counts, exit codes, result counts, excerpts, and failure details.
- Rebuilds task, research, and effect projections from the log.
- Supports human-in-the-loop approval events.
- Exports actor turns and runtime events to Pathlight traces.
- Exports external agent journals to Pathlight task lifecycle spans.
- Exports Eventloom logs to HALO-compatible OpenTelemetry JSONL traces.
- Provides a package API for embedding Eventloom in TypeScript code.

## Quick Start

Install from npm:

```bash
npm install @eventloom/runtime
```

Run the installed CLI:

```bash
npx eventloom run software-work /tmp/eventloom-software.jsonl
npx eventloom replay /tmp/eventloom-software.jsonl
npx eventloom templates coding-task
```

Use the package from TypeScript:

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/eventloom.jsonl");
await runtime.runBuiltIn("software-work");

const replay = await runtime.replay();
console.log(replay.integrity.ok);
```

## Develop Locally

```bash
npm install
npm test
npm run build
```

Run a deterministic software-work workflow:

```bash
npm run eventloom -- run software-work /tmp/eventloom-software.jsonl
npm run eventloom -- replay /tmp/eventloom-software.jsonl
```

Run a research workflow:

```bash
npm run eventloom -- run research-pipeline /tmp/eventloom-research.jsonl
npm run eventloom -- timeline /tmp/eventloom-research.jsonl
```

Run a human approval workflow:

```bash
npm run eventloom -- run human-ops /tmp/eventloom-human-ops.jsonl
npm run eventloom -- append /tmp/eventloom-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
npm run eventloom -- run human-ops /tmp/eventloom-human-ops.jsonl --resume
```

## Use as a Library

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/eventloom.jsonl");
await runtime.runBuiltIn("research-pipeline");

const replay = await runtime.replay();
console.log(replay.integrity.ok);
console.log(replay.projection.research);
```

The npm package is published as `@eventloom/runtime`. See [Package API](docs/package-api.md) for the full package-facing API.

The MCP server package lives in `packages/mcp` as `@eventloom/mcp`. It exposes Eventloom log operations, visualizer output, and Pathlight/HALO export to local MCP clients over stdio. See [MCP Setup](docs/mcp-setup.md) for editor setup and [MCP Package Design](docs/mcp-package.md) for the tool contract.

## Documentation

- [Documentation Index](docs/README.md)
- [User Guide](docs/user-guide.md)
- [CLI Reference](docs/cli-reference.md)
- [Package API](docs/package-api.md)
- [Agent Integration](docs/agent-integration.md)
- [MCP Setup](docs/mcp-setup.md)
- [MCP Package Design](docs/mcp-package.md)
- [Agent Work Export Case Study](docs/case-studies/agent-work-pathlight.md)
- [Architecture](docs/architecture.md)
- [Event Model](docs/event-model.md)
- [Workflow Guide](docs/workflows.md)
- [Pathlight Integration](docs/pathlight-integration.md)
- [HALO Integration](docs/halo-integration.md)
- [Contributor Guide](docs/contributor-guide.md)

## Project Layout

```text
src/           Runtime and CLI source
tests/         Vitest unit and integration tests
packages/mcp/  MCP stdio server package
fixtures/      Sample event logs
docs/          User, technical, and planning docs
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
- HALO trace export bridge
- Rich model, tool, reasoning, and verification telemetry export
- Agent integration workflow and Codex skill
- MCP stdio server package
- MCP Pathlight and HALO export tools
- Cross-process append locking for local JSONL logs
- Runtime, CLI, MCP, and browser visualizer support
