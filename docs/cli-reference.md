# CLI Reference

Install the published package with:

```bash
npm install @eventloom/runtime
```

Run the installed CLI with:

```bash
npx eventloom <command>
```

When developing from the repository root, run the source CLI with:

```bash
npm run eventloom -- <command>
```

The repository CLI entrypoint is `src/cli.ts`.

## `replay`

Replay an event log, verify integrity, and print projections.

```bash
npm run eventloom -- replay <events.jsonl>
```

Example:

```bash
npm run eventloom -- replay fixtures/sample.jsonl
```

Output includes:

- `eventCount`
- `integrity`
- `projection.eventTypes`
- `projection.effects`
- `projection.research`
- `projection.tasks`
- `projectionHash`

## `append`

Append a sealed external event.

```bash
npm run eventloom -- append <events.jsonl> <event.type> --actor <actorId> --payload '<json>'
```

Flags:

- `--actor <actorId>`: actor that emitted the event. Defaults to `external`.
- `--thread <threadId>`: thread identifier. Defaults to `thread_main`.
- `--parent <eventId>`: direct parent event id.
- `--caused-by <eventId,eventId>`: causal dependencies.
- `--payload '<json>'`: event payload. Must be a JSON object.

Examples:

```bash
npm run eventloom -- append /tmp/eventloom.jsonl goal.created --actor user --payload '{"title":"External goal"}'
```

```bash
npm run eventloom -- append /tmp/eventloom-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
```

Output includes the new event id, hash, and previous hash.

## `demo software-work`

Generate a deterministic software-work demo log.

```bash
npm run eventloom -- demo software-work [events.jsonl]
```

If no path is given, Eventloom writes `.eventloom/events.jsonl`.

## `run software-work`

Run the deterministic software-work actor loop.

```bash
npm run eventloom -- run software-work [events.jsonl] [--resume]
```

Without `--resume`, the target log is replaced. With `--resume`, Eventloom continues from the existing log and skips actor mailbox items already marked as processed.

## `run research-pipeline`

Run the deterministic research actor loop.

```bash
npm run eventloom -- run research-pipeline [events.jsonl] [--resume]
```

Default path: `.eventloom/research-events.jsonl`.

The final projection is available under `projection.research`.

## `run human-ops`

Run the deterministic human approval workflow.

```bash
npm run eventloom -- run human-ops [events.jsonl] [--resume]
```

Default path: `.eventloom/human-ops-events.jsonl`.

The first run stops after `approval.requested`. Append an `approval.granted` event and resume to apply the effect.

## `timeline`

Print an ordered event timeline with integrity status.

```bash
npm run eventloom -- timeline <events.jsonl>
```

Each line includes:

- ordinal
- event id
- actor id
- event type
- parent event id when present

## `explain task`

Explain task state from projection history and causal chain.

```bash
npm run eventloom -- explain task <taskId> <events.jsonl>
```

Example:

```bash
npm run eventloom -- explain task task_actor_runtime /tmp/eventloom-software.jsonl
```

## `mailbox`

Show a rebuilt actor mailbox for the software-work registry.

```bash
npm run eventloom -- mailbox <actorId> <events.jsonl>
```

Example:

```bash
npm run eventloom -- mailbox worker /tmp/eventloom-software.jsonl
```

## `handoff`

Summarize goals, tasks, projection errors, decisions, verification, releases, risks, recent facts, model/tool telemetry, reasoning summaries, observability gaps, event type counts, and next actions from an Eventloom log.

```bash
npm run eventloom -- handoff <events.jsonl>
```

Example:

```bash
npm run eventloom -- handoff .eventloom/agent-work.jsonl
```

## `templates`

List or inspect starter templates for common agent workflows.

```bash
npm run eventloom -- templates
npm run eventloom -- templates <templateId>
```

Available templates:

- `coding-task`
- `review-task`
- `release-task`
- `research-task`

## `export pathlight`

Export an Eventloom log to a Pathlight collector.

```bash
npm run eventloom -- export pathlight <events.jsonl> --base-url <url> [--trace-name <name>]
```

Defaults:

- `--base-url`: `http://localhost:4100`
- `--trace-name`: `eventloom-runtime`

The export creates:

- one Pathlight trace
- one agent span per `actor.started` / `actor.completed` turn
- for external agent journals without actor turns, one task lifecycle span per projected task
- span events for related Eventloom events

Trace metadata includes integrity, projection hash, projection kinds, runtime package metadata, thread IDs, and git provenance when available.

## `export halo`

Export an Eventloom log to a HALO-compatible OpenTelemetry JSONL trace file.

```bash
npm run eventloom -- export halo <events.jsonl> --out <traces.jsonl> [--project-id <id>] [--service-name <name>] [--trace-name <name>]
```

Defaults:

- `--out`: `eventloom-halo-traces.jsonl`
- `--project-id`: `eventloom`
- `--service-name`: `eventloom`
- `--trace-name`: `eventloom.log`

The export creates one trace with a root log span, task lifecycle spans, and high-level fact spans for goals, decisions, verification, release, and risk events.

Validate the output with a local HALO checkout:

```bash
python /home/cheapseatsecon/Projects/GitHub-Clone/HALO/demo/openai-agents-sdk-demo/verify_traces.py <traces.jsonl>
```
