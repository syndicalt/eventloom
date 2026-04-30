# User Guide

This guide covers the normal ways to use Eventloom from the command line and as a TypeScript package.

## Install From Npm

For application code or command-line use, install the published package:

```bash
npm install @eventloom/runtime
```

Run the installed CLI with `npx`:

```bash
npx eventloom run software-work /tmp/eventloom-software.jsonl
npx eventloom replay /tmp/eventloom-software.jsonl
```

Use the package API from TypeScript:

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/eventloom.jsonl");
await runtime.runBuiltIn("software-work");

const replay = await runtime.replay();
console.log(replay.integrity.ok);
```

## Develop Locally

Run commands from the repository root:

```bash
npm install
npm test
npm run build
```

Eventloom uses TypeScript, Node.js, Vitest, and a JSONL event store. It does not require a database or Docker Compose.

## Core Idea

Eventloom stores runtime history as an append-only event log. Actors do not mutate state directly. They receive mailbox items, emit intentions, and the orchestrator validates those intentions before appending accepted events.

When you replay a log, Eventloom rebuilds projections from events:

- `tasks`: software-work task state.
- `research`: research questions, sources, claims, challenges, sections, and reports.
- `effects`: human-approved operational effects.
- `eventTypes`: event counts.

Replay also verifies the tamper-evident hash chain.

## Run Software Work

The software-work workflow models a small coding-agent style lifecycle:

1. A user creates a goal.
2. `planner` proposes a task.
3. `worker` claims and completes it.
4. `worker` requests review.
5. `reviewer` approves it.

```bash
npm run eventloom -- run software-work /tmp/eventloom-software.jsonl
npm run eventloom -- replay /tmp/eventloom-software.jsonl
```

Inspect the timeline:

```bash
npm run eventloom -- timeline /tmp/eventloom-software.jsonl
```

Explain the built-in task:

```bash
npm run eventloom -- explain task task_actor_runtime /tmp/eventloom-software.jsonl
```

## Run Research Pipeline

The research-pipeline workflow exercises a provenance-heavy multi-agent path:

1. A user creates a research question.
2. `researcher` finds a source.
3. `analyst` extracts a claim.
4. `critic` challenges the claim.
5. `writer` drafts a report section.
6. `editor` finalizes the report.

```bash
npm run eventloom -- run research-pipeline /tmp/eventloom-research.jsonl
npm run eventloom -- replay /tmp/eventloom-research.jsonl
```

The replay output includes `projection.research.questions.question_evented_runtime`.

## Run Human Approval Flow

The human-ops workflow proves that external human approval can enter the log and resume actor execution.

Start the workflow:

```bash
npm run eventloom -- run human-ops /tmp/eventloom-human-ops.jsonl
```

The first run stops with an effect in `approval_requested` state. Grant approval externally:

```bash
npm run eventloom -- append /tmp/eventloom-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
```

Resume the workflow:

```bash
npm run eventloom -- run human-ops /tmp/eventloom-human-ops.jsonl --resume
npm run eventloom -- replay /tmp/eventloom-human-ops.jsonl
```

The effect should end in `applied` state.

## Append External Events

Use `append` to insert events from outside the actor loop:

```bash
npm run eventloom -- append /tmp/eventloom.jsonl goal.created --actor user --payload '{"title":"External goal"}'
```

Optional flags:

- `--thread <threadId>`
- `--parent <eventId>`
- `--caused-by <eventId,eventId>`
- `--payload '<json object>'`

Every appended event is sealed into the hash chain.

## Inspect Mailboxes

Mailboxes are rebuilt from event history. For the software-work registry:

```bash
npm run eventloom -- mailbox worker /tmp/eventloom-software.jsonl
```

If an actor has processed all subscribed events, the mailbox is empty.

## Export to Pathlight

If a Pathlight collector is running:

```bash
npm run eventloom -- export pathlight /tmp/eventloom-human-ops.jsonl --base-url http://localhost:4100 --trace-name eventloom-human-ops
```

Eventloom exports actor turns as Pathlight spans and related Eventloom events as span events. Pathlight is optional; Eventloom works without it.

## Export to HALO

Export an Eventloom log to HALO-compatible trace JSONL:

```bash
npm run eventloom -- export halo /tmp/eventloom-human-ops.jsonl \
  --out /tmp/eventloom-halo-traces.jsonl \
  --project-id eventloom \
  --service-name eventloom-human-ops
```

Then validate with a local HALO checkout:

```bash
python /home/cheapseatsecon/Projects/GitHub-Clone/HALO/demo/openai-agents-sdk-demo/verify_traces.py \
  /tmp/eventloom-halo-traces.jsonl
```

HALO can analyze the exported trace file when its CLI and model credentials are available.

Built-in workflows emit deterministic model, tool, and reasoning-summary telemetry so exported traces include LLM, tool, and chain spans. Real agent integrations should fill the same event fields from their model and tool calls.

## Use the Package API

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/eventloom.jsonl");
await runtime.runBuiltIn("software-work");

const replay = await runtime.replay();
console.log(replay.projection.tasks.tasks.task_actor_runtime.status);
```

See [Package API](package-api.md) for custom actors, custom intentions, and export adapters from code.
