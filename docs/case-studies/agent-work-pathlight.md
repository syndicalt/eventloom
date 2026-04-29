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
  "traceId": "H2Zeka78vYjw0yfp28toP",
  "spanCount": 0,
  "eventCount": 0
}
```

The span count is zero because `.eventloom/agent-work.jsonl` is an external journal. It records agent work facts directly and does not contain runtime `actor.started` / `actor.completed` turns. Pathlight still receives a trace with Eventloom integrity, projection, thread, runtime, and git metadata.

## What This Proves

- Eventloom agent journals can be exported without changing their local JSONL workflow.
- Pathlight can act as the visual inspection surface for trace metadata and provenance.
- Runtime workflow logs with actor turn events will produce spans and span events; external agent journals currently produce trace-level context.

## Product Implication

The next useful Pathlight improvement is not a new exporter. It is a better visual affordance for Eventloom journal traces that have rich metadata but no actor spans, especially agent handoff summaries, decisions, verification events, and active task state.
