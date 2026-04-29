# CLI Reference

Run all commands from the repository root with:

```bash
npm run threadline -- <command>
```

The CLI entrypoint is `src/cli.ts`.

## `replay`

Replay an event log, verify integrity, and print projections.

```bash
npm run threadline -- replay <events.jsonl>
```

Example:

```bash
npm run threadline -- replay fixtures/sample.jsonl
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
npm run threadline -- append <events.jsonl> <event.type> --actor <actorId> --payload '<json>'
```

Flags:

- `--actor <actorId>`: actor that emitted the event. Defaults to `external`.
- `--thread <threadId>`: thread identifier. Defaults to `thread_main`.
- `--parent <eventId>`: direct parent event id.
- `--caused-by <eventId,eventId>`: causal dependencies.
- `--payload '<json>'`: event payload. Must be a JSON object.

Examples:

```bash
npm run threadline -- append /tmp/threadline.jsonl goal.created --actor user --payload '{"title":"External goal"}'
```

```bash
npm run threadline -- append /tmp/threadline-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
```

Output includes the new event id, hash, and previous hash.

## `demo software-work`

Generate a deterministic software-work demo log.

```bash
npm run threadline -- demo software-work [events.jsonl]
```

If no path is given, Threadline writes `.threadline/events.jsonl`.

## `run software-work`

Run the deterministic software-work actor loop.

```bash
npm run threadline -- run software-work [events.jsonl] [--resume]
```

Without `--resume`, the target log is replaced. With `--resume`, Threadline continues from the existing log and skips actor mailbox items already marked as processed.

## `run research-pipeline`

Run the deterministic research actor loop.

```bash
npm run threadline -- run research-pipeline [events.jsonl] [--resume]
```

Default path: `.threadline/research-events.jsonl`.

The final projection is available under `projection.research`.

## `run human-ops`

Run the deterministic human approval workflow.

```bash
npm run threadline -- run human-ops [events.jsonl] [--resume]
```

Default path: `.threadline/human-ops-events.jsonl`.

The first run stops after `approval.requested`. Append an `approval.granted` event and resume to apply the effect.

## `timeline`

Print an ordered event timeline with integrity status.

```bash
npm run threadline -- timeline <events.jsonl>
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
npm run threadline -- explain task <taskId> <events.jsonl>
```

Example:

```bash
npm run threadline -- explain task task_actor_runtime /tmp/threadline-software.jsonl
```

## `mailbox`

Show a rebuilt actor mailbox for the software-work registry.

```bash
npm run threadline -- mailbox <actorId> <events.jsonl>
```

Example:

```bash
npm run threadline -- mailbox worker /tmp/threadline-software.jsonl
```

## `export pathlight`

Export a Threadline log to a Pathlight collector.

```bash
npm run threadline -- export pathlight <events.jsonl> --base-url <url> [--trace-name <name>]
```

Defaults:

- `--base-url`: `http://localhost:4100`
- `--trace-name`: `threadline-runtime`

The export creates:

- one Pathlight trace
- one agent span per `actor.started` / `actor.completed` turn
- span events for related Threadline events

Trace metadata includes integrity, projection hash, projection kinds, runtime package metadata, thread IDs, and git provenance when available.
