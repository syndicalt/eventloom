# OTLP Integration

Eventloom can export a local event log to generic OpenTelemetry OTLP trace JSON. The exporter always writes a local JSON payload that can be stored in CI or attached to a pull request, and it can optionally POST the same payload to an OpenTelemetry HTTP traces endpoint.

## Export Command

```bash
npx eventloom export otlp <events.jsonl> [--out <otlp-traces.json>] \
  [--endpoint http://localhost:4318/v1/traces] \
  --service-name eventloom-agent-work \
  --service-version 1.0.0 \
  --trace-name eventloom-agent-work
```

Defaults:

- `--out`: `eventloom-otlp-traces.json`
- `--endpoint`: unset; when provided, must be an absolute `http://` or `https://` OTLP traces endpoint
- `--service-name`: `eventloom`
- `--service-version`: the runtime package version
- `--trace-name`: `eventloom.log`

When `--endpoint` is set, Eventloom writes the JSON file first and then sends that exact payload with `content-type: application/json`. The CLI response includes `endpoint` and HTTP `status` on success. Failed delivery does not mutate the source log and returns typed diagnostics:

- `otlp_invalid_endpoint`: the endpoint is not an absolute HTTP(S) URL.
- `otlp_request_failed`: the network request failed before an HTTP response was available.
- `otlp_response_failed`: the collector returned a non-2xx response.

## Trace Shape

The export creates one OTLP `resourceSpans` payload:

- one root span for the log with integrity, event counts, projection hash, thread ids, and runtime provenance
- actor turn spans when runtime turn events are present
- model, tool, and reasoning spans from telemetry events
- projected task lifecycle spans
- journal fact spans for goals, decisions, verification, releases, and risks
- fallback event spans when the log has no projected tasks or high-signal facts

Span attributes include Eventloom-specific fields such as `eventloom.event_count`, `eventloom.valid_prefix_count`, `eventloom.integrity.ok`, `eventloom.projection_hash`, and `eventloom.thread_ids`. The exporter also emits OpenInference-style `inference.*` attributes so model and tool telemetry remains legible in LLM observability tools.

## Verified Prefix

OTLP export reads the verified prefix of the source log. If the file has a corrupt tail, the CLI still writes a trace payload for recoverable events and returns `integrity.ok: false`, `validPrefixCount`, `exportedEventCount`, and diagnostics. The root span carries the same diagnostics in `eventloom.integrity.diagnostics`.

This preserves the v1 invariant that damaged source logs are inspectable without silently mutating or truncating the canonical JSONL file.

## Artifact Bundles

`eventloom artifacts` writes `otlp-traces.json` alongside verification JSON, stats JSON, `inspect.json`, visualizer JSON/HTML, `handoff.md`, `halo.jsonl`, and `manifest.json`:

```bash
npx eventloom artifacts .eventloom/agent-work.jsonl \
  --out .eventloom/artifacts \
  --title "Agent Work"
```

Use the artifact bundle when a CI job or local agent session should preserve the raw log and all derived review outputs in one directory.

## Offline Fixtures

The package ships deterministic OTLP fixtures under `fixtures/export/`:

- `otlp-success.json`: parsed `resourceSpans` and the exact JSON payload for a successful software-work export.
- `otlp-negative.json`: parsed `resourceSpans` and JSON for a failed-integrity negative path.

Fixture `result` objects are versioned as `eventloom.export.otlp.v1` and include `traceCount`, `spanCount`, `exportedEventCount`, `validPrefixCount`, and `integrity`. The negative fixture includes a `STATUS_CODE_ERROR` root span and serialized integrity diagnostics.

```bash
npm run fixtures:export
npm run fixtures:check
npm test -- tests/export-fixtures.test.ts
```

Regenerate fixtures only when the OTLP export contract intentionally changes.

## Package API

```ts
import { createRuntime, formatOtlpJson, pushOtlpJson } from "@eventloom/runtime";
import { writeFile } from "node:fs/promises";

const runtime = createRuntime(".eventloom/agent-work.jsonl");
const result = await runtime.exportOtlp({
  serviceName: "eventloom-agent-work",
  serviceVersion: "1.0.0",
  traceName: "eventloom-agent-work",
});

await writeFile("eventloom-otlp-traces.json", formatOtlpJson(result), "utf8");

await pushOtlpJson(result, {
  endpoint: "http://localhost:4318/v1/traces",
});
```

`runtime.exportOtlp()` returns the versioned `eventloom.export.otlp.v1` result. `pushOtlpJson()` returns a delivery result versioned as `eventloom.export.otlp-push.v1`, while `formatOtlpJson()` keeps the OTLP wire payload as an unwrapped `resourceSpans` document.

Adapter-specific imports are also available from `@eventloom/runtime/export/otlp`.

## MCP Tool

The `@eventloom/mcp` package exposes the same projection through `eventloom_export_otlp`:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "out": ".eventloom/agent-work-otlp.json",
  "endpoint": "http://localhost:4318/v1/traces",
  "serviceName": "eventloom-agent-work",
  "serviceVersion": "1.0.0",
  "traceName": "eventloom-agent-work"
}
```

The MCP tool writes the trace file inside the configured MCP root and returns the versioned `eventloom.export.otlp.v1` result with `outputPath`, `traceCount`, `spanCount`, `exportedEventCount`, `validPrefixCount`, and `integrity`. When `endpoint` is provided, the tool POSTs the same JSON payload to the OTLP HTTP traces endpoint and also returns `endpoint` and HTTP `status`; delivery failures use the same `otlp_invalid_endpoint`, `otlp_request_failed`, and `otlp_response_failed` diagnostics as the runtime API.
