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
npx eventloom run software-work /tmp/eventloom-software.jsonl
npx eventloom replay /tmp/eventloom-software.jsonl
```

Use `verify` to diagnose a log without manually reading JSONL:

```bash
npx eventloom verify /tmp/eventloom-software.jsonl
```

If a log has a damaged tail, write the verified prefix to a new file:

```bash
npx eventloom recover /tmp/eventloom-software.jsonl --out /tmp/eventloom-software.recovered.jsonl
```

To preserve the rejected tail for later inspection, add a quarantine output:

```bash
npx eventloom recover /tmp/eventloom-software.jsonl --out /tmp/eventloom-software.recovered.jsonl --quarantine-tail /tmp/eventloom-software.bad-tail.jsonl
```

Recovery is non-destructive, lock-coordinated with append, and refuses to overwrite existing recovery artifacts. When `--quarantine-tail` is present on a fully verified log, Eventloom writes an empty quarantine file so scripts can treat the recovered log and quarantine path as a stable pair. Appends refuse to continue a log that fails verification.

Inspect the timeline:

```bash
npx eventloom timeline /tmp/eventloom-software.jsonl
npx eventloom timeline /tmp/eventloom-software.jsonl --limit 20
npx eventloom timeline /tmp/eventloom-software.jsonl --json
```

Explain the built-in task:

```bash
npx eventloom explain task task_actor_runtime /tmp/eventloom-software.jsonl
npx eventloom explain task task_actor_runtime /tmp/eventloom-software.jsonl --json
```

`timeline` and `explain task` read the verified prefix. JSON output includes the original integrity scan report, so logs with corrupt tails remain inspectable while preserving diagnostics.

## Run Research Pipeline

The research-pipeline workflow exercises a provenance-heavy multi-agent path:

1. A user creates a research question.
2. `researcher` finds a source.
3. `analyst` extracts a claim.
4. `critic` challenges the claim.
5. `writer` drafts a report section.
6. `editor` finalizes the report.

```bash
npx eventloom run research-pipeline /tmp/eventloom-research.jsonl
npx eventloom replay /tmp/eventloom-research.jsonl
```

The replay output includes `projection.research.questions.question_evented_runtime`.

## Run Human Approval Flow

The human-ops workflow proves that external human approval can enter the log and resume actor execution.

Start the workflow:

```bash
npx eventloom run human-ops /tmp/eventloom-human-ops.jsonl
```

The first run stops with an effect in `approval_requested` state. Grant approval externally:

```bash
npx eventloom append /tmp/eventloom-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
```

Resume the workflow:

```bash
npx eventloom run human-ops /tmp/eventloom-human-ops.jsonl --resume
npx eventloom replay /tmp/eventloom-human-ops.jsonl
```

The effect should end in `applied` state.

## Append External Events

Use `append` to insert events from outside the actor loop:

```bash
npx eventloom append /tmp/eventloom.jsonl goal.created --actor user --payload '{"title":"External goal"}'
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
npx eventloom mailbox worker /tmp/eventloom-software.jsonl
```

If an actor has processed all subscribed events, the mailbox is empty.

The CLI rebuilds mailboxes from the verified prefix. Use `mailbox --json` to include the source `integrity` report with the mailbox items.

## Export to Pathlight

If a Pathlight collector is running:

```bash
npx eventloom export pathlight /tmp/eventloom-human-ops.jsonl --base-url http://localhost:4100 --trace-name eventloom-human-ops
```

Eventloom exports actor turns, telemetry, facts, task lifecycle events, and related Eventloom events as Pathlight spans or span events. These are verified-prefix exports: corrupt-tail logs export only recoverable events and return the versioned `eventloom.export.pathlight.v1` result with `exportedEventCount`, `validPrefixCount`, and `integrity`. Pathlight trace status and metadata expose failed integrity while preserving the recoverable prefix.

## Export to HALO

Export an Eventloom log to HALO-compatible trace JSONL:

```bash
npx eventloom export halo /tmp/eventloom-human-ops.jsonl \
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

HALO export reads the verified prefix. CLI stdout includes `version: "eventloom.export.halo.v1"`, `out`, `projectId`, `traceId`, `traceCount`, `spanCount`, `exportedEventCount`, `validPrefixCount`, and `integrity`. Corrupt-tail diagnostics are preserved on the root span attributes.

## Export to OTLP

Export an Eventloom log to vendor-neutral OpenTelemetry trace JSON:

```bash
npx eventloom export otlp /tmp/eventloom-human-ops.jsonl \
  --out /tmp/eventloom-otlp-traces.json \
  --service-name eventloom-human-ops
```

OTLP export writes a JSON payload with `resourceSpans`, `scopeSpans`, and spans that preserve Eventloom task, telemetry, integrity, and provenance attributes. It reads the verified prefix, so CLI stdout includes `version: "eventloom.export.otlp.v1"`, `out`, `traceCount`, `spanCount`, `exportedEventCount`, `validPrefixCount`, and `integrity` even when a damaged tail is present.

Built-in workflows emit deterministic model, tool, and reasoning-summary telemetry so exported traces include LLM, tool, and chain spans. Real agent integrations should fill the same event fields from their model and tool calls.

For real agent journals, include:

- `model.started` / `model.completed` with provider, model name, request id, prompt version, input/output summaries, token counts, latency, cost, parameters, and errors when available.
- `tool.started` / `tool.completed` with tool name, call id, redacted input, input/output summaries, exit code, result count, result excerpt, decisive flag, error, and latency.
- `reasoning.summary` with safe rationale summaries, evidence event ids, alternatives considered, and confidence.
- `verification.completed` with the command, checks, assertions, evidence event ids, artifacts, and pass/fail counts behind the verification claim.

The `handoff` command reports missing model, tool, reasoning, or verification evidence as observability gaps before you export a trace for debugging. `handoff --json` includes `integrity` and remains usable on corrupt-tail logs because it summarizes the verified prefix.

## Write Visualizer HTML

Build a local visualizer model or self-contained HTML report:

```bash
npx eventloom visualize <events.jsonl>
npx eventloom visualize <events.jsonl> --html <visualizer.html>
```

Visualizer output is verified-prefix safe. JSON/model output preserves the integrity report so damaged tails remain visible during review.

## Write Artifact Bundles

Package the log-derived review artifacts for CI upload or repo-local handoff:

```bash
npx eventloom artifacts <events.jsonl> --out <artifact-dir> --title "Agent Work"
```

Artifact bundles are built from the verified prefix and preserve diagnostics in versioned `eventloom.verify.v1` `verify.json`, `query.json`, `inspect.json`, visualizer JSON/HTML, `handoff.md`, `halo.jsonl`, `otlp-traces.json`, and the manifest. The manifest also includes an `inputDigest` for the canonical source JSONL log and SHA-256 file digests for generated artifacts so later reviewers can verify the bundle contents with `verifyArtifactBundleFiles()`.
Use `npx eventloom artifacts verify <manifest.json>` to check a preserved bundle from the CLI.

## Use the Package API

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/eventloom.jsonl");
await runtime.runBuiltIn("software-work");

const replay = await runtime.replay();
console.log(replay.projection.tasks.tasks.task_actor_runtime.status);
```

See [Package API](package-api.md) for custom actors, custom intentions, and export adapters from code.
