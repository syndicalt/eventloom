# HALO Integration

Eventloom can export a local event log to a HALO-compatible OpenTelemetry JSONL trace file.

HALO remains optional. The connector writes a file that can be passed to the local `halo` CLI or verified with HALO's demo trace verifier.

## Export Command

```bash
npm run eventloom -- export halo <events.jsonl> \
  --out <halo-traces.jsonl> \
  --project-id eventloom \
  --service-name eventloom-agent-work \
  --trace-name eventloom-agent-work
```

Defaults:

- `--out`: `eventloom-halo-traces.jsonl`
- `--project-id`: `eventloom`
- `--service-name`: `eventloom`
- `--trace-name`: `eventloom.log`

## Validate With HALO

With a local HALO checkout:

```bash
python /home/cheapseatsecon/Projects/GitHub-Clone/HALO/demo/openai-agents-sdk-demo/verify_traces.py \
  eventloom-halo-traces.jsonl
```

Run HALO analysis when `OPENAI_API_KEY` is available:

```bash
cd /home/cheapseatsecon/Projects/GitHub-Clone/HALO
uv run halo /path/to/eventloom-halo-traces.jsonl \
  -p "Find systemic failure modes in this Eventloom agent journal and suggest harness improvements."
```

## Trace Shape

The exporter creates one HALO trace for the Eventloom log:

- a root `eventloom.log` span with integrity, event counts, projection hash, thread IDs, and git provenance
- one `eventloom.actor.<actorId>.turn` agent span per actor turn when runtime turn events exist
- LLM spans from `model.started` / `model.completed` telemetry
- tool spans from `tool.started` / `tool.completed` telemetry
- reasoning summary spans from `reasoning.summary`
- one `eventloom.task.<taskId>` agent span per projected task lifecycle
- fact spans for goals, decisions, verification, release, and risk events
- fallback event spans when the log has no projected tasks or high-level facts

Each span includes the HALO-required top-level fields and `inference.*` attributes, including:

- `inference.export.schema_version`
- `inference.project_id`
- `inference.observation_kind`
- `inference.agent_name`

The export does not mutate the Eventloom log.

The built-in deterministic workflows use `modelProvider: "eventloom"` and `modelName: "deterministic-runner"` so tests and demos exercise the same telemetry shape as an LLM-backed runner. Real integrations should populate provider, model, token, cost, latency, prompt summary, tool input, and tool output fields from the underlying agent harness.

## Package API

```ts
import { createRuntime, formatHaloJsonl } from "@eventloom/runtime";
import { writeFile } from "node:fs/promises";

const runtime = createRuntime(".eventloom/agent-work.jsonl");
const result = await runtime.exportHalo({
  projectId: "eventloom",
  serviceName: "eventloom-agent-work",
  traceName: "eventloom-agent-work",
});

await writeFile("eventloom-halo-traces.jsonl", formatHaloJsonl(result), "utf8");
```

## MCP Tool

The `@eventloom/mcp` package exposes the same projection through `eventloom_export_halo`:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "out": ".eventloom/agent-work-halo.jsonl",
  "projectId": "eventloom",
  "serviceName": "eventloom-agent-work",
  "traceName": "eventloom-agent-work"
}
```

The MCP tool writes the trace file inside the configured MCP root and returns `outputPath`, `traceId`, `eventCount`, and `spanCount`.
