# Pathlight Integration

Threadline can export event logs to a Pathlight collector for visual inspection.

Pathlight is optional. Threadline does not require Docker Compose, a collector, or a database to run locally.

## Export Command

```bash
npm run threadline -- export pathlight <events.jsonl> --base-url http://localhost:4100 --trace-name threadline-run
```

Example:

```bash
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl
npm run threadline -- append /tmp/threadline-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl --resume
npm run threadline -- export pathlight /tmp/threadline-human-ops.jsonl --base-url http://localhost:4100 --trace-name threadline-human-ops
```

## Mapping

Threadline maps runtime history to Pathlight like this:

| Threadline | Pathlight |
|---|---|
| Runtime event log | Trace |
| Actor turn | Agent span |
| Runtime event related to a turn | Span event |
| Integrity and projection data | Trace metadata |
| Git/package provenance | Native trace fields and metadata |

## Trace Metadata

Threadline trace metadata includes:

- `source: "threadline"`
- `integrity`
- `projectionHash`
- `projectionKinds`
- `runtime.name`
- `runtime.version`
- `threadIds`

When git metadata is available, Threadline also sends:

- `gitCommit`
- `gitBranch`
- `gitDirty`

## Span Metadata

Each actor turn span includes:

- `source: "threadline"`
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
import { createRuntime } from "@syndicalt/threadline";

const runtime = createRuntime("/tmp/threadline-human-ops.jsonl");

await runtime.exportPathlight({
  baseUrl: "http://localhost:4100",
  traceName: "threadline-human-ops",
});
```

## Collector Availability

If the collector is unavailable, export fails with a request error. The event log is not modified by export.

## Docker Compose

Threadline itself is not a Compose service. Use Compose only to run optional infrastructure such as Pathlight collector and dashboard.

A typical local setup is:

1. Start Pathlight separately.
2. Run Threadline locally with `npm run threadline`.
3. Export a log to the collector.

This keeps the runtime simple and preserves the local JSONL development model.

## Bridge Decision

See [Pathlight Bridge Spike](decisions/pathlight-bridge-spike.md) for the decision to keep Threadline as a separate runtime prototype and integrate through an export adapter.
