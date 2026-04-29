# Pathlight Integration

Eventloom can export event logs to a Pathlight collector for visual inspection.

Pathlight is optional. Eventloom does not require Docker Compose, a collector, or a database to run locally.

## Export Command

```bash
npm run eventloom -- export pathlight <events.jsonl> --base-url http://localhost:4100 --trace-name eventloom-run
```

Example:

```bash
npm run eventloom -- run human-ops /tmp/eventloom-human-ops.jsonl
npm run eventloom -- append /tmp/eventloom-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
npm run eventloom -- run human-ops /tmp/eventloom-human-ops.jsonl --resume
npm run eventloom -- export pathlight /tmp/eventloom-human-ops.jsonl --base-url http://localhost:4100 --trace-name eventloom-human-ops
```

## Mapping

Eventloom maps runtime history to Pathlight like this:

| Eventloom | Pathlight |
|---|---|
| Runtime event log | Trace |
| Actor turn | Agent span |
| Runtime event related to a turn | Span event |
| Integrity and projection data | Trace metadata |
| Git/package provenance | Native trace fields and metadata |

For external agent journals that do not contain `actor.started` / `actor.completed` runtime turns, Eventloom exports projected task lifecycles as Pathlight agent spans. This gives `.eventloom/agent-work.jsonl` logs a useful visual shape without requiring agents to emit runtime actor-turn events.

## Trace Metadata

Eventloom trace metadata includes:

- `source: "eventloom"`
- `integrity`
- `projectionHash`
- `projectionKinds`
- `runtime.name`
- `runtime.version`
- `threadIds`

When git metadata is available, Eventloom also sends:

- `gitCommit`
- `gitBranch`
- `gitDirty`

## Span Metadata

Each actor turn span includes:

- `source: "eventloom"`
- `turnId`
- `actorId`
- `startedEventId`
- `completedEventId`

Span input includes:

- `sourceEventId`
- `mailboxEventType`

Span output includes:

- `turnId`
- `sourceEventId`
- `intentions`
- `acceptedEvents`
- `rejectionEventIds` only when there are actual rejections

Empty rejection arrays are intentionally omitted because Pathlight's issue heuristics flag span output containing words such as `rejected`.

## Package API Export

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/eventloom-human-ops.jsonl");

await runtime.exportPathlight({
  baseUrl: "http://localhost:4100",
  traceName: "eventloom-human-ops",
});
```

## Collector Availability

If the collector is unavailable, export fails with a request error. The event log is not modified by export.

## Docker Compose

Eventloom itself is not a Compose service. Use Compose only to run optional infrastructure such as Pathlight collector and dashboard.

A typical local setup is:

1. Start Pathlight separately.
2. Run Eventloom locally with `npm run eventloom`.
3. Export a log to the collector.

This keeps the runtime simple and preserves the local JSONL development model.

## Bridge Decision

See [Pathlight Bridge Spike](decisions/pathlight-bridge-spike.md) for the decision to keep Eventloom as a separate runtime prototype and integrate through an export adapter.

See [Agent Work Log Pathlight Case Study](case-studies/agent-work-pathlight.md) for an example of exporting a real `.eventloom/agent-work.jsonl` journal.
