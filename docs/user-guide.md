# User Guide

This guide covers the normal ways to use Threadline from the command line and as a local TypeScript package.

## Install and Verify

Run commands from the repository root:

```bash
npm install
npm test
npm run build
```

Threadline uses TypeScript, Node.js, Vitest, and a JSONL event store. It does not require a database or Docker Compose.

## Core Idea

Threadline stores runtime history as an append-only event log. Actors do not mutate state directly. They receive mailbox items, emit intentions, and the orchestrator validates those intentions before appending accepted events.

When you replay a log, Threadline rebuilds projections from events:

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
npm run threadline -- run software-work /tmp/threadline-software.jsonl
npm run threadline -- replay /tmp/threadline-software.jsonl
```

Inspect the timeline:

```bash
npm run threadline -- timeline /tmp/threadline-software.jsonl
```

Explain the built-in task:

```bash
npm run threadline -- explain task task_actor_runtime /tmp/threadline-software.jsonl
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
npm run threadline -- run research-pipeline /tmp/threadline-research.jsonl
npm run threadline -- replay /tmp/threadline-research.jsonl
```

The replay output includes `projection.research.questions.question_evented_runtime`.

## Run Human Approval Flow

The human-ops workflow proves that external human approval can enter the log and resume actor execution.

Start the workflow:

```bash
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl
```

The first run stops with an effect in `approval_requested` state. Grant approval externally:

```bash
npm run threadline -- append /tmp/threadline-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
```

Resume the workflow:

```bash
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl --resume
npm run threadline -- replay /tmp/threadline-human-ops.jsonl
```

The effect should end in `applied` state.

## Append External Events

Use `append` to insert events from outside the actor loop:

```bash
npm run threadline -- append /tmp/threadline.jsonl goal.created --actor user --payload '{"title":"External goal"}'
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
npm run threadline -- mailbox worker /tmp/threadline-software.jsonl
```

If an actor has processed all subscribed events, the mailbox is empty.

## Export to Pathlight

If a Pathlight collector is running:

```bash
npm run threadline -- export pathlight /tmp/threadline-human-ops.jsonl --base-url http://localhost:4100 --trace-name threadline-human-ops
```

Threadline exports actor turns as Pathlight spans and related Threadline events as span events. Pathlight is optional; Threadline works without it.

## Use the Package API

```ts
import { createRuntime } from "@syndicalt/threadline";

const runtime = createRuntime("/tmp/threadline.jsonl");
await runtime.runBuiltIn("software-work");

const replay = await runtime.replay();
console.log(replay.projection.tasks.tasks.task_actor_runtime.status);
```

See [Package API](package-api.md) for custom actors, custom intentions, and Pathlight export from code.
