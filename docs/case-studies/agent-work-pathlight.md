# Agent Work Log Pathlight Case Study

This case study exports a clean local Eventloom agent work journal into Pathlight so the same release and product-direction work can be inspected as a trace.

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

## Export Command

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
  "traceId": "eKtn859nGRTbG79N_airG",
  "spanCount": 16,
  "eventCount": 47
}
```

The log is an external agent journal, so it does not contain runtime `actor.started` / `actor.completed` turns. Eventloom exports projected task lifecycles as Pathlight spans in this case. Each task span contains its task status, actor, history event ids, and span events for the task lifecycle events.

The handoff summary is the local-first companion to the exported trace. It includes event type counts, active and completed task state, projection errors, decisions, verification results, releases, risks, recent facts, and next actions.

## What This Proves

- Eventloom agent journals can be exported without changing their local JSONL workflow.
- Pathlight can act as the visual inspection surface for task lifecycle spans, trace metadata, and provenance.
- Runtime workflow logs with actor turn events produce actor-turn spans; external agent journals produce task-lifecycle spans.

## Product Implication

The next useful Pathlight improvement is a journal-oriented view that groups Eventloom task spans with handoff summaries, decisions, verification events, and active task state.
