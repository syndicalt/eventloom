# Agent Work Log Export Case Study

This case study exports a clean local Eventloom agent work journal into Pathlight, HALO, and generic OTLP so the same agent work can be inspected as a trace, as HALO-compatible OpenTelemetry JSONL, and as portable OpenTelemetry trace JSON.

## Source Log

```text
.eventloom/agent-work.jsonl
```

The log records external agent workflow facts: goals, task lifecycle events, decisions, verification, releases, risks, and handoff-oriented summaries. It is intentionally local and append-only.

Before using a journal as a canonical dogfood trace, verify its integrity and inspect its handoff summary:

```bash
npx eventloom replay .eventloom/agent-work.jsonl
npx eventloom handoff .eventloom/agent-work.jsonl
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
  "traceId": "exFYUwbreTh1p5rXnKRYN",
  "spanCount": 7,
  "eventCount": 6
}
```

The log is an external agent journal, so it does not contain runtime `actor.started` / `actor.completed` turns. Eventloom exports projected task lifecycles as Pathlight spans in this case. Each task span contains its task status, actor, history event ids, and span events for the task lifecycle events.

The handoff summary is the local-first companion to the exported trace. It includes event type counts, active and completed task state, projection errors, decisions, verification results, releases, risks, recent facts, and next actions.

For debugging-grade traces, the handoff summary should also show model calls, tool calls, reasoning summaries, and no observability gaps. If the summary reports missing model/tool/reasoning telemetry or vague verification evidence, HALO can still validate the trace shape, but it will not have enough evidence to explain agent behavior.

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
  "out": "/tmp/eventloom-agent-work-halo-rich.jsonl",
  "projectId": "eventloom-agent-work",
  "traceId": "33dc292fb0097ee2f5b2685b5163eb67",
  "traceCount": 1,
  "spanCount": 8
}
```

Validate the output with a local HALO checkout:

```bash
python3 /home/cheapseatsecon/Projects/GitHub-Clone/HALO/demo/openai-agents-sdk-demo/verify_traces.py \
  /tmp/eventloom-agent-work-halo-rich.jsonl
```

Observed verifier output:

```text
OK: 8 spans passed all spec assertions
```

HALO analysis of the enriched trace found it substantially more debugging-ready than a shallow milestone-only trace. Evidence included:

- `model_names: ["gpt-5"]`
- `total_input_tokens: 420`
- `total_output_tokens: 110`
- one LLM span, one tool span, and one reasoning summary span
- `eventloom.integrity.ok: true`
- verification evidence containing the runtime and MCP test/build commands

HALO still identified instrumentation gaps:

- model-call payloads should include richer structured prompt sections, output classifications, and prompt/version identifiers
- tool-call outputs should include matched paths, counts, excerpts, exit codes, and whether the result changed the plan
- verification evidence should link to exact command output, pass/fail counts, failed assertions, and artifact ids
- the trace set should include negative-path examples such as tool failures, model errors, retries, timeouts, and projection errors

## OTLP Export

Export the same journal to generic OpenTelemetry trace JSON:

```bash
node dist/cli.js export otlp .eventloom/agent-work.jsonl \
  --out /tmp/eventloom-agent-work-otlp.json \
  --service-name eventloom \
  --service-version 1.0.0 \
  --trace-name eventloom-agent-work
```

Expected local export:

```json
{
  "out": "/tmp/eventloom-agent-work-otlp.json",
  "traceCount": 1,
  "spanCount": 8
}
```

The OTLP artifact is useful when the review path should stay vendor-neutral. It contains the same Eventloom root, task, model, tool, reasoning, verification, and provenance attributes as the HALO projection, encoded as an OTLP `resourceSpans` JSON payload. The root span preserves `eventloom.integrity.ok`, `eventloom.valid_prefix_count`, `eventloom.integrity.diagnostics`, and the runtime provenance attributes so the file can be uploaded later without losing source-log context.

For CI or pull request handoff, prefer the complete artifact bundle:

```bash
node dist/cli.js artifacts .eventloom/agent-work.jsonl \
  --out .eventloom/artifacts \
  --title "Agent Work"
```

The bundle writes `otlp-traces.json` next to `halo.jsonl`, `visualizer.html`, `handoff.md`, `stats.json`, `query.json`, `inspect.json`, versioned `eventloom.verify.v1` `verify.json`, and `manifest.json`.

## What This Proves

- Eventloom agent journals can be exported without changing their local JSONL workflow.
- Pathlight can act as the visual inspection surface for task lifecycle spans, trace metadata, and provenance.
- HALO can validate and analyze the same journal as OpenTelemetry-shaped JSONL with Eventloom trace, model, tool, reasoning, and verification metadata.
- OTLP trace JSON preserves the same local evidence in a vendor-neutral artifact for CI storage or later collector upload.
- Runtime workflow logs with actor turn events produce actor-turn spans; external agent journals produce task-lifecycle spans.

## Product Implication

The next useful Pathlight improvement is a journal-oriented view that groups Eventloom task spans with handoff summaries, decisions, verification events, and active task state.

The next useful Eventloom instrumentation improvement is to make every real agent journal include model/tool telemetry and verification evidence by default. Without those events, external analysis can confirm milestone auditability but cannot diagnose the model or tool behavior behind a completed task.
