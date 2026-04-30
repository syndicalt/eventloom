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
| Model invocation telemetry | LLM span |
| Tool invocation telemetry | Tool span |
| Reasoning summary telemetry | Chain span |
| Runtime event related to a turn | Span event |
| Goal, decision, verification, release, and risk facts | Journal fact spans |
| Integrity and projection data | Trace metadata |
| Git/package provenance | Native trace fields and metadata |
| Capture, Replay, and Handoff visualizer model | Trace output under `visualizer` |
| Visualizer display contract | Trace metadata under `visualizer` |

For external agent journals that do not contain `actor.started` / `actor.completed` runtime turns, Eventloom exports projected task lifecycles as Pathlight agent spans. Eventloom also exports high-signal journal facts as first-class spans so goals, decisions, verification, release notes, and risks remain visible even when they are not part of a task history.

## Visualizer Contract

Every Pathlight export includes a trace-level display contract for the Eventloom visualizer:

```json
{
  "version": "eventloom.pathlight.visualizer.v1",
  "outputPath": "visualizer",
  "panels": [
    { "id": "capture", "title": "Capture", "outputPath": "visualizer.capture" },
    { "id": "replay", "title": "Replay", "outputPath": "visualizer.replay" },
    { "id": "handoff", "title": "Handoff", "outputPath": "visualizer.handoff" }
  ]
}
```

Pathlight can render those panels from the final trace output without reading or mutating the source JSONL log:

- `visualizer.capture` contains ordered captured facts, event type counts, actor ids, thread ids, causality links, and hash-chain links.
- `visualizer.replay` contains integrity status, projection state, projection errors, and a projection hash.
- `visualizer.handoff` contains goals, active/completed tasks, model/tool/reasoning telemetry, verification evidence, observability gaps, and next actions.

This is intentionally trace-level data. Existing Pathlight spans still show actor turns, model calls, tool calls, task lifecycles, and journal facts. The visualizer contract gives a Pathlight UI a deterministic product affordance over the same exported trace.

## Visualizer Smoke Flow

Generate one local workflow, inspect the same model locally, then export it to Pathlight:

```bash
npm run eventloom -- run software-work /tmp/eventloom-pathlight-viz.jsonl
npm run eventloom -- visualize /tmp/eventloom-pathlight-viz.jsonl
npm run eventloom -- export pathlight /tmp/eventloom-pathlight-viz.jsonl \
  --base-url http://localhost:4100 \
  --trace-name eventloom-pathlight-viz
```

Expected result:

- The local `visualize` command prints top-level `capture`, `replay`, and `handoff` keys.
- The Pathlight trace metadata includes `visualizer.version: "eventloom.pathlight.visualizer.v1"`.
- The final Pathlight trace output includes `visualizer.capture`, `visualizer.replay`, and `visualizer.handoff`.
- The Eventloom JSONL file is unchanged by both commands.

## Trace Metadata

Eventloom trace metadata includes:

- `source: "eventloom"`
- `integrity`
- `projectionHash`
- `projectionKinds`
- `runtime.name`
- `runtime.version`
- `threadIds`
- `visualizer`

When git metadata is available, Eventloom also sends:

- `gitCommit`
- `gitBranch`
- `gitDirty`

## Span Metadata

Each actor turn span includes:

- `source: "eventloom"`
- `exportKind: "actor_turn"`
- `turnId`
- `actorId`
- `startedEventId`
- `completedEventId`
- `acceptedEventIds`
- `rejectedEventIds`

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

Journal fact spans include the source event id, event type, actor id, thread id, parent event id, and caused-by ids in metadata. The original Eventloom event is also attached as a span event.

Model and tool telemetry spans include model/provider names, prompt versions, input/output summaries, token counts, cost, latency, tool names, inputs, outputs, exit codes, result counts, result excerpts, decisive flags, errors, and related turn ids when the Eventloom log contains those fields. Pathlight task lifecycle output also includes task-scoped model calls, tool calls, and reasoning summaries so external journals remain inspectable even when they were not produced by Eventloom's actor loop.

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
