# Eventloom

[![npm version](https://img.shields.io/npm/v/@eventloom/runtime.svg)](https://www.npmjs.com/package/@eventloom/runtime)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![GitHub](https://img.shields.io/badge/github-syndicalt%2Feventloom-black.svg)](https://github.com/syndicalt/eventloom)

Eventloom is a local-first TypeScript runtime for multi-agent systems built around an append-only event log. It is a stable foundation for local agent workflows, deterministic replay, human handoff, and observability exports.

Site: [`syndicalt.github.io/eventloom`](https://syndicalt.github.io/eventloom/) | Package: [`@eventloom/runtime`](https://www.npmjs.com/package/@eventloom/runtime) | Repository: [`syndicalt/eventloom`](https://github.com/syndicalt/eventloom) | License: [MIT](LICENSE)

Instead of treating an agent run as a linear `system/user/assistant` transcript, Eventloom models runtime state as typed events. Actors receive mailbox items, emit structured intentions, and an orchestrator validates those intentions before appending accepted events. Projections rebuild state from the log, so a run can be replayed and inspected after the fact.

Eventloom is designed for local development, deterministic replay, repository-local agent journals, and integration experiments with Pathlight, HALO, OTLP, and MCP clients.

## Quick Agent Journal

Use Eventloom as a local black box recorder for agent work:

```bash
mkdir -p .eventloom

npm exec --package @eventloom/runtime -- eventloom append .eventloom/agent-work.jsonl goal.created \
  --actor user \
  --payload '{"title":"Ship a scoped agent task"}'

npm exec --package @eventloom/runtime -- eventloom append .eventloom/agent-work.jsonl task.proposed \
  --actor codex \
  --payload '{"taskId":"task_demo","title":"Make a focused change"}'

npm exec --package @eventloom/runtime -- eventloom append .eventloom/agent-work.jsonl task.claimed \
  --actor codex \
  --payload '{"taskId":"task_demo"}'

npm exec --package @eventloom/runtime -- eventloom visualize .eventloom/agent-work.jsonl
npm exec --package @eventloom/runtime -- eventloom visualize .eventloom/agent-work.jsonl --html .eventloom/agent-work.html --title "Agent Work"
npm exec --package @eventloom/runtime -- eventloom inspect .eventloom/agent-work.jsonl
npm exec --package @eventloom/runtime -- eventloom handoff .eventloom/agent-work.jsonl
npm exec --package @eventloom/runtime -- eventloom artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts --title "Agent Work"
npm exec --package @eventloom/runtime -- eventloom artifacts verify .eventloom/artifacts/manifest.json
npm exec --package @eventloom/runtime -- eventloom query .eventloom/agent-work.jsonl --actor codex --limit 10
npm exec --package @eventloom/runtime -- eventloom recover .eventloom/agent-work.jsonl --out .eventloom/agent-work.recovered.jsonl
```

Optional MCP server for editor and agent clients:

```bash
npx @eventloom/mcp --root .
```

Optional Pathlight export when a collector is running:

```bash
npm exec --package @eventloom/runtime -- eventloom export pathlight .eventloom/agent-work.jsonl \
  --base-url http://localhost:4100 \
  --trace-name eventloom-agent-work
```

Pathlight now renders Eventloom exports as a dedicated visualizer panel on the trace detail page. The panel shows the same Capture, Replay, and Handoff views produced by `eventloom visualize`, while the normal Pathlight waterfall remains available for span-level timing and inspection.

Optional HALO export for agent failure-mode analysis:

```bash
npm exec --package @eventloom/runtime -- eventloom export halo .eventloom/agent-work.jsonl \
  --out eventloom-halo-traces.jsonl \
  --project-id eventloom \
  --service-name eventloom-agent-work
```

Optional OTLP export for generic OpenTelemetry-compatible tools:

```bash
npm exec --package @eventloom/runtime -- eventloom export otlp .eventloom/agent-work.jsonl \
  --out eventloom-otlp-traces.json \
  --service-name eventloom-agent-work
```

Pathlight, HALO, and OTLP exports read verified prefixes and report `integrity`, `validPrefixCount`, and `exportedEventCount` so corrupt-tail logs can still produce reviewable traces without hiding source diagnostics.

## What It Does

- Appends sealed events to a JSONL event log.
- Verifies a tamper-evident hash chain.
- Returns versioned `eventloom.verify.v1` diagnostics from package, CLI, MCP, and artifact-bundle verify paths.
- Recovers damaged logs through non-destructive verified-prefix recovery.
- Diffs replay projections and returns stable log stats/query results for debugging.
- Returns a consolidated `eventloom.inspect.v1` model for integrity, stats, timeline, and handoff review.
- Summarizes handoffs from goals, tasks, decisions, verification events, model/tool telemetry, reasoning summaries, and observability gaps.
- Builds Capture, Replay, and Handoff visualizer models from local logs.
- Writes a static HTML visualizer and verifiable artifact bundle with `inspect.json` for CI upload or repo-local handoff.
- Provides starter templates for coding, review, release, and research tasks.
- Runs deterministic actor workflows.
- Validates actor intentions before accepting state changes.
- Records model, tool, and reasoning-summary telemetry during actor turns, including prompt versions, summaries, token counts, exit codes, result counts, excerpts, and failure details.
- Rebuilds task, research, and effect projections from the log.
- Supports human-in-the-loop approval events.
- Exports actor turns and runtime events to Pathlight traces.
- Exports external agent journals to Pathlight task lifecycle spans.
- Exports Eventloom logs to HALO-compatible OpenTelemetry JSONL traces.
- Exports Eventloom logs to generic OpenTelemetry OTLP trace JSON.
- Provides a package API for embedding Eventloom in TypeScript code.

## Quick Start

Install from npm:

```bash
npm install @eventloom/runtime
```

Run the installed CLI:

```bash
npx eventloom run software-work /tmp/eventloom-software.jsonl
npx eventloom run software-work /tmp/eventloom-software.jsonl --max-iterations 5
npx eventloom replay /tmp/eventloom-software.jsonl
npx eventloom stats /tmp/eventloom-software.jsonl
npx eventloom inspect /tmp/eventloom-software.jsonl
npx eventloom inspect /tmp/eventloom-software.jsonl --type task.proposed --limit 10
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
npm run ci:runtime-v1
npm run smoke:mcp-v1-local-runtime-bin
```

`npm run ci` currently aliases the runtime-first v1 gate. Use `npm run ci:full-v1` only after `@eventloom/runtime@1.0.0` is published and the MCP package has moved to the v1 runtime dependency.

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

The MCP server package lives in `packages/mcp` as `@eventloom/mcp`. It exposes Eventloom log operations, visualizer output, artifact bundles, and Pathlight/HALO/OTLP export to local MCP clients over stdio. See [MCP Setup](docs/mcp-setup.md) for editor setup and [MCP Package Design](docs/mcp-package.md) for the tool contract.

For v1-specific stability and extension guidance, see [Migration Notes](docs/migration-v1.md), [Public API](docs/public-api.md), and [Custom Workflows](docs/custom-workflows.md).

Release hardening commands are documented in [Release Checklist](docs/release.md). The first v1 release uses phase-specific checks. Before the runtime package is published, use the runtime-first gate plus the staged MCP local preflight:

```bash
npm run ci:runtime-v1
npm run release:preflight:runtime-v1
npm run release:preflight:mcp-v1-staged:local
```

After `@eventloom/runtime@1.0.0` is published and the checked-in MCP package metadata moves to `^1.0.0`, use the MCP/full v1 gates:

```bash
npm run ci:full-v1
npm run release:preflight:mcp-v1
```

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
- [v1.0 Roadmap](docs/roadmap-v1.md)
- [Pathlight Integration](docs/pathlight-integration.md)
- [HALO Integration](docs/halo-integration.md)
- [OTLP Integration](docs/otlp-integration.md)
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
- OTLP trace export bridge
- Rich model, tool, reasoning, and verification telemetry export
- Agent integration workflow and Codex skill
- MCP stdio server package
- MCP Pathlight, HALO, and OTLP export tools
- Cross-process append locking for local JSONL logs
- Runtime, CLI, MCP, and browser visualizer support
- Verified-prefix recovery, static HTML visualizer, artifact bundles, export fixtures, and v1 release preflight gates
