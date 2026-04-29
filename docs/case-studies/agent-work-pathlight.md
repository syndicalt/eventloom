# Agent Work Log Pathlight Case Study

This case study exports the local Eventloom agent work journal into Pathlight so the same release and product-direction work can be inspected as a trace.

## Source Log

```text
.eventloom/agent-work.jsonl
```

The log records external agent workflow facts: goals, task lifecycle events, decisions, verification, releases, and handoff-oriented summaries. It is intentionally local and append-only.

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

## What This Proves

- Eventloom agent journals can be exported without changing their local JSONL workflow.
- Pathlight can act as the visual inspection surface for task lifecycle spans, trace metadata, and provenance.
- Runtime workflow logs with actor turn events produce actor-turn spans; external agent journals produce task-lifecycle spans.

## Product Implication

The next useful Pathlight improvement is a journal-oriented view that groups Eventloom task spans with handoff summaries, decisions, verification events, and active task state.
