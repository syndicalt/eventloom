# Agent Work Log Export Case Study

This case study exports a clean local Eventloom agent work journal into Pathlight and HALO so the same agent work can be inspected as a trace and as HALO-compatible OpenTelemetry JSONL.

## Source Log

```text
.eventloom/agent-work.jsonl
```

The log records external agent workflow facts: goals, task lifecycle events, decisions, verification, releases, risks, and handoff-oriented summaries. It is intentionally local and append-only.

Before using a journal as a canonical dogfood trace, verify its integrity and inspect its handoff summary:

```bash
npm run eventloom -- replay .eventloom/agent-work.jsonl
npm run eventloom -- handoff .eventloom/agent-work.jsonl
```

If `integrity.ok` is false, archive or regenerate the local journal before exporting it. Eventloom uses append locking for new writes, but old logs created before locking may already contain conflicting hash links.

Also check the handoff summary for projection errors. Append locking preserves hash-chain integrity, but causally dependent facts such as `task.claimed` after `task.proposed` should still be written in dependency order.

## Pathlight Export

Build first if you are using the compiled CLI:

```bash
npm run build
```

Then export to a running Pathlight collector:

```bash
node dist/cli.js export pathlight .eventloom/agent-work.jsonl \
  --base-url http://localhost:4100 \
  --trace-name eventloom-agent-work-product-direction
```

Observed local export:

```json
{
  "traceId": "waytAUwiusqMpKwvA4kU4",
  "spanCount": 5,
  "eventCount": 7
}
```

The log is an external agent journal, so it does not contain runtime `actor.started` / `actor.completed` turns. Eventloom exports projected task lifecycles as Pathlight spans in this case. Each task span contains its task status, actor, history event ids, and span events for the task lifecycle events.

The handoff summary is the local-first companion to the exported trace. It includes event type counts, active and completed task state, projection errors, decisions, verification results, releases, risks, recent facts, and next actions.

## HALO Export

Export the same journal to HALO-compatible JSONL:

```bash
node dist/cli.js export halo .eventloom/agent-work.jsonl \
  --out /tmp/eventloom-agent-work-halo.jsonl \
  --project-id eventloom-agent-work \
  --service-name eventloom \
  --trace-name eventloom-agent-work
```

Observed local export:

```json
{
  "out": "/tmp/eventloom-agent-work-halo.jsonl",
  "projectId": "eventloom-agent-work",
  "traceId": "85abf7e2534463bb4dee98c1171a220c",
  "traceCount": 1,
  "spanCount": 6
}
```

Validate the output with a local HALO checkout:

```bash
python3 /home/cheapseatsecon/Projects/GitHub-Clone/HALO/demo/openai-agents-sdk-demo/verify_traces.py \
  /tmp/eventloom-agent-work-halo.jsonl
```

Observed verifier output:

```text
OK: 6 spans passed all spec assertions
```

## What This Proves

- Eventloom agent journals can be exported without changing their local JSONL workflow.
- Pathlight can act as the visual inspection surface for task lifecycle spans, trace metadata, and provenance.
- HALO can validate the same journal as OpenTelemetry-shaped JSONL with Eventloom trace metadata.
- Runtime workflow logs with actor turn events produce actor-turn spans; external agent journals produce task-lifecycle spans.

## Product Implication

The next useful Pathlight improvement is a journal-oriented view that groups Eventloom task spans with handoff summaries, decisions, verification events, and active task state.
