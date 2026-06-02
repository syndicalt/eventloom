# MCP Package Design

Eventloom should expose MCP support through a separate package:

```text
@eventloom/mcp
```

The runtime package should stay focused on local JSONL event logs, replay, projections, workflow runners, and export adapters. The MCP package should be a thin protocol adapter over that runtime API.

## Goals

- Let MCP clients append, replay, inspect, and export Eventloom logs without shelling out manually.
- Preserve Eventloom's local-first model: no hosted service, database, or daemon required.
- Keep tool outputs structured enough for agents to reason over, while still returning useful text for human-facing MCP clients.
- Make file access explicit and bounded so an MCP client cannot accidentally write outside the intended workspace.

## Non-Goals

- Replacing the `eventloom` CLI.
- Adding a long-running Eventloom server as a core runtime requirement.
- Duplicating event parsing, projection, workflow, or export logic inside the MCP package.
- Supporting remote multi-user hosting in the first MCP release.

## Package Shape

Repository layout:

```text
packages/
  mcp/
    package.json
    src/
      cli.ts
      path-safety.ts
      server.ts
      tools.ts
    tests/
```

The package should publish a binary:

```text
eventloom-mcp
```

The MCP package should depend on `@eventloom/runtime` and call its public API. Tool adapters are consolidated in `src/tools.ts`; if a needed behavior exists only in CLI formatting code, promote a small runtime helper instead of copying that logic into the MCP package.

## Transport

Start with stdio only. It is the most common local MCP integration path and fits Eventloom's local-first model.

Streamable HTTP can be added later if a real hosted or team-shared use case appears.

## Tool Surface

### `eventloom_append`

Append one sealed external event.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "type": "task.completed",
  "actorId": "codex",
  "threadId": "thread_roadmap",
  "parentEventId": "evt_parent",
  "causedBy": ["evt_cause"],
  "payload": {
    "taskId": "task_example"
  }
}
```

Output:

```json
{
  "event": {
    "id": "evt_...",
    "type": "task.completed",
    "actorId": "codex",
    "timestamp": "..."
  },
  "hash": "sha256:...",
  "previousHash": "sha256:..."
}
```

### `eventloom_replay`

Replay a log and return integrity and projection state.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "verbose": false
}
```

- `verbose`: include the full projection instead of the compact replay summary.

Output uses the same versioned `eventloom.replay.v1` model as the runtime package and CLI JSON output. Compact output includes:

```json
{
  "version": "eventloom.replay.v1",
  "eventCount": 9,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "projectionHash": "..."
}
```

### `eventloom_verify`

Stream-verify a local Eventloom JSONL log and return structured diagnostics. This tool is intended for agent clients that need to diagnose a damaged local log before replay, export, or handoff.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl"
}
```

Output:

```json
{
  "version": "eventloom.verify.v1",
  "ok": false,
  "eventCount": 1,
  "validPrefixCount": 1,
  "lastGoodLine": 1,
  "lastGoodHash": "sha256:...",
  "diagnostics": [
    {
      "code": "malformed_json",
      "eventId": null,
      "line": 2,
      "message": "Expected property name or '}' in JSON..."
    }
  ],
  "errors": [
    {
      "code": "malformed_json",
      "eventId": null,
      "line": 2,
      "message": "Expected property name or '}' in JSON..."
    }
  ]
}
```

Output uses the same versioned `eventloom.verify.v1` report as the runtime package, CLI `verify`, CLI `validate`, and artifact-bundle `verify.json`.

### `eventloom_recover`

Write a damaged log's verified prefix to a separate JSONL path. The source log is never truncated or rewritten. Optionally preserve rejected physical tail lines in a quarantine artifact.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "out": ".eventloom/agent-work.recovered.jsonl",
  "quarantineTail": ".eventloom/agent-work.bad-tail.jsonl"
}
```

`quarantineTail` is optional. Both output paths are restricted to the configured MCP root and must be distinct from the source log and each other. When the source log is already fully verified, `quarantineTail` still creates an empty quarantine artifact so MCP clients can rely on a stable output set. Existing recovered or quarantine paths return a structured `recovery_output_exists` error before any recovery artifact is written.

Output:

```json
{
  "outputPath": "/workspace/.eventloom/agent-work.recovered.jsonl",
  "recoveredEventCount": 12,
  "lastGoodLine": 12,
  "lastGoodHash": "sha256:...",
  "diagnostics": [
    {
      "code": "malformed_json",
      "eventId": null,
      "line": 13,
      "message": "Expected property name or '}' in JSON..."
    }
  ],
  "quarantinedTailPath": "/workspace/.eventloom/agent-work.bad-tail.jsonl",
  "quarantinedLineCount": 1
}
```

### `eventloom_diff`

Replay two local logs and return structured projection differences.

Input:

```json
{
  "leftPath": "fixtures/golden/software-work.jsonl",
  "rightPath": ".eventloom/software-work.jsonl"
}
```

Output uses the same versioned `eventloom.projection-diff.v1` model as the runtime package and CLI JSON output. It includes:

- `version`
- `sameProjectionHash`
- `left` and `right` event counts, projection hashes, and integrity status
- `eventTypes.added`, `eventTypes.removed`, and `eventTypes.changed`
- `tasks.added`, `tasks.removed`, and `tasks.changed`
- `projectionErrors.left` and `projectionErrors.right`

Projection errors include `projectionKind` (`task`, `effect`, or `research`) so MCP clients can route diagnostics without parsing event type strings.

### `eventloom_stats`

Return stable counts and hashes for one local log.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl"
}
```

Output uses the same versioned `eventloom.stats.v1` model as the runtime package and CLI JSON output: event count, integrity, projection hash, sorted event-type counts, sorted actor counts, and sorted thread counts. If the log has a corrupt tail, stats uses the verified prefix and returns `integrity.ok: false` with diagnostics.

### `eventloom_inspect`

Return a consolidated inspection model for one local log.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "type": "task.proposed",
  "actorId": "codex",
  "threadId": "thread_roadmap",
  "limit": 25
}
```

`type`, `actorId`, `threadId`, and `limit` are optional and match `eventloom_query` semantics. Output is a versioned `eventloom.inspect.v1` object combining source-log `integrity`, stable `stats`, ordered `timeline`, and agent `handoff` summary data in one read-only result. When filters are provided, `stats` and `handoff` still describe the full verified prefix while `timeline` is narrowed to the selected event window and `selection` records `totalEventCount`, `matchedEventCount`, the effective query, and stable event summaries. If the log has a corrupt tail, inspect uses the verified prefix and preserves the original scan diagnostics in every included read model.

### `eventloom_query`

Return filtered event summaries from the verified prefix of one local log.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "type": "task.proposed",
  "actorId": "codex",
  "threadId": "thread_roadmap",
  "limit": 25
}
```

All filters except `path` are optional. `type`, `actorId`, and `threadId` are exact matches. `limit` returns the last matching events, capped by tool validation to keep MCP responses bounded. Invalid limits return `invalid_tool_input` with the rejected `option` and `value`.

Output uses the same versioned `eventloom.query.v1` model as the CLI JSON output: `count`, source-log `integrity`, and `events` with stable event summaries containing id, type, actor, thread, timestamp, parent, causes, and payload. If a log has a corrupt tail, query uses the verified prefix and returns `integrity.ok: false` with diagnostics.

### Tool Errors

MCP tool failures return structured tool error results instead of requiring clients to parse thrown exception text. Error results set `isError: true`, include JSON text content, and include `structuredContent.error`.

Example:

```json
{
  "error": {
    "code": "path_outside_root",
    "message": "Log path is outside the configured Eventloom root: /tmp/outside.jsonl",
    "path": "../outside.jsonl",
    "suggestedAction": "Use a path inside the configured Eventloom MCP root."
  }
}
```

Common codes include `path_outside_root`, `invalid_tool_input`, `invalid_mcp_server_option`, `event_store_read_failed`, `event_store_lock_timeout`, `invalid_event_store_option`, `invalid_runtime_option`, `runtime_projection_failed`, `actor_runner_failed`, `actor_runner_invalid_output`, and Eventloom log diagnostic codes such as `duplicate_event_id`, `malformed_json`, `partial_trailing_line`, and `hash_mismatch`.

Schema validation failures use `invalid_tool_input` and include the first rejected input `option` plus its rejected `value` when the error can be mapped to a tool argument.

Tool-level numeric validation also uses `invalid_tool_input`; query and timeline limits include the rejected `option`, rejected `value`, and a targeted suggested action.

Runtime loop tool failures preserve structured runtime diagnostics in `structuredContent.error`. Built-in workflow projection failures include `workflow`, `projectionKind`, and `projectionErrors`; actor runner failures include actor, turn, source event, and cause details.

The MCP server reads `EVENTLOOM_LOCK_TIMEOUT_MS` and `EVENTLOOM_LOCK_RETRY_MS` as non-negative integer millisecond values for append and built-in workflow runs. Invalid startup lock timing from environment variables or `--lock-timeout-ms` / `--lock-retry-ms` exits before stdio startup with `invalid_mcp_server_option`, the rejected option, and the rejected value. Unknown or missing stdio startup options use the same structured code and include the rejected option before the server connects stdio. Unexpected stdio startup failures use JSON stderr diagnostics with `mcp_server_start_failed` instead of free-form stderr. Invalid programmatic runtime lock timing options return `invalid_event_store_option` with the rejected option and value. These settings are mainly useful for tests and short-lived local agent clients; leave them unset for the runtime defaults of `5000` and `10`.

### `eventloom_timeline`

Return ordered event history for a log.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "limit": 50
}
```

Output:

```json
{
  "text": "...human-readable timeline...",
  "version": "eventloom.timeline.v1",
  "eventCount": 1,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "events": [
    {
      "ordinal": 1,
      "id": "evt_...",
      "type": "task.proposed",
      "actorId": "codex",
      "threadId": "thread_roadmap",
      "parentEventId": null,
      "causedBy": [],
      "timestamp": "2026-06-01T20:00:00.000Z",
      "hash": "sha256:...",
      "previousHash": "sha256:..."
    }
  ]
}
```

The structured payload uses the same versioned `eventloom.timeline.v1` model as the runtime package and CLI JSON output, plus `text` for human-facing MCP clients. `limit` returns the last matching events from the verified prefix and must be a positive integer no greater than 500.

This tool reads the verified prefix. If a log has a corrupt tail, the returned events come from the recoverable prefix and `integrity` preserves the original scan diagnostics.

### `eventloom_explain_task`

Explain one projected task lifecycle.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "taskId": "task_mcp_design_doc"
}
```

Output:

```json
{
  "text": "...human-readable task explanation...",
  "version": "eventloom.task-explanation.v1",
  "found": true,
  "taskId": "task_mcp_design_doc",
  "integrity": {
    "ok": true,
    "errors": []
  },
  "task": {
    "id": "task_mcp_design_doc",
    "status": "completed",
    "actorId": "codex",
    "lastEventId": "evt_..."
  },
  "history": [
    {
      "id": "evt_...",
      "type": "task.proposed",
      "actorId": "codex",
      "threadId": "thread_roadmap",
      "parentEventId": null,
      "causedBy": [],
      "timestamp": "2026-06-01T20:00:00.000Z",
      "hash": "sha256:...",
      "previousHash": "sha256:..."
    }
  ],
  "causalChain": [],
  "projectionErrors": []
}
```

The structured payload uses the same versioned `eventloom.task-explanation.v1` model as the runtime package and CLI JSON output, plus `text` for human-facing MCP clients. Missing tasks return `found: false`, `task: null`, empty `history` and `causalChain` arrays, and any projection errors.

This tool reads the verified prefix and includes the scan report in `integrity`.

### `eventloom_mailbox`

Rebuild one actor mailbox for a built-in workflow.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "workflow": "software-work",
  "actorId": "worker"
}
```

`workflow` defaults to `software-work` and accepts:

- `software-work`
- `research-pipeline`
- `human-ops`

Output:

```json
{
  "text": "mailbox: worker\n\n01 evt_... task.proposed from=planner task=task_1 status=proposed",
  "version": "eventloom.mailbox.v1",
  "workflow": "software-work",
  "actorId": "worker",
  "count": 1,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "items": [
    {
      "ordinal": 1,
      "event": {
        "id": "evt_...",
        "type": "task.proposed",
        "actorId": "planner",
        "threadId": "thread_roadmap",
        "parentEventId": null,
        "causedBy": [],
        "timestamp": "2026-04-29T12:00:00.000Z",
        "hash": "sha256:...",
        "previousHash": "sha256:..."
      },
      "task": {
        "id": "task_1",
        "status": "proposed"
      }
    }
  ]
}
```

The structured payload uses the same versioned `eventloom.mailbox.v1` model as the runtime package and CLI JSON output, plus `text` for human-facing MCP clients.

This tool rebuilds the mailbox from the verified prefix and includes the scan report in `integrity`.

### `eventloom_summarize_handoff`

Summarize goals, task state, decisions, verification, and next actions from a local Eventloom log.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl"
}
```

Output includes text for humans and structured content for agents:

```json
{
  "text": "handoff summary\n...",
  "version": "eventloom.handoff.v1",
  "eventCount": 12,
  "eventTypes": {
    "goal.created": 1
  },
  "integrity": {
    "ok": true,
    "errors": []
  },
  "goals": [],
  "tasks": {
    "active": [],
    "completed": []
  },
  "projectionErrors": [],
  "decisions": [],
  "verification": [],
  "releases": [],
  "risks": [],
  "recentFacts": [],
  "telemetry": {
    "models": [],
    "tools": [],
    "reasoning": []
  },
  "observabilityGaps": [],
  "nextActions": []
}
```

The structured payload uses the same versioned `eventloom.handoff.v1` model as the CLI JSON output and the same typed summary produced by the runtime `summarizeHandoff()` helper, plus `text` for human-facing MCP clients.

This tool reads the verified prefix. If the source log has a corrupt tail, the summary is based on recoverable events and `integrity` keeps the original diagnostics.

### `eventloom_visualize`

Build the structured, versioned `eventloom.visualizer.v1` Capture, Replay, and Handoff model used by Eventloom visualizer UIs.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl"
}
```

Output:

```json
{
  "version": "eventloom.visualizer.v1",
  "capture": {
    "eventCount": 12,
    "eventTypes": {},
    "events": []
  },
  "replay": {
    "eventCount": 12,
    "integrity": {
      "ok": true,
      "errors": []
    },
    "projection": {},
    "projectionHash": "..."
  },
  "handoff": {
    "eventCount": 12,
    "tasks": {
      "active": [],
      "completed": []
    },
    "observabilityGaps": [],
    "nextActions": []
  }
}
```

This tool returns the same versioned `eventloom.visualizer.v1` model as the runtime package and CLI JSON output. It reads the verified prefix and carries the original scan report through `replay.integrity` and `handoff.integrity`.

### `eventloom_write_artifacts`

Write a repository-local artifact bundle for agent handoff or CI upload.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "out": ".eventloom/artifacts",
  "title": "Agent Work"
}
```

Output:

```json
{
  "version": "eventloom.artifact-bundle.v1",
  "outDir": "/workspace/.eventloom/artifacts",
  "eventCount": 12,
  "integrityOk": true,
  "projectionHash": "...",
  "files": {
    "verify": "/workspace/.eventloom/artifacts/verify.json",
    "stats": "/workspace/.eventloom/artifacts/stats.json",
    "queryJson": "/workspace/.eventloom/artifacts/query.json",
    "inspectJson": "/workspace/.eventloom/artifacts/inspect.json",
    "visualizerJson": "/workspace/.eventloom/artifacts/visualizer.json",
    "visualizerHtml": "/workspace/.eventloom/artifacts/visualizer.html",
    "handoff": "/workspace/.eventloom/artifacts/handoff.md",
    "haloJsonl": "/workspace/.eventloom/artifacts/halo.jsonl",
    "otlpJson": "/workspace/.eventloom/artifacts/otlp-traces.json",
    "manifest": "/workspace/.eventloom/artifacts/manifest.json"
  }
}
```

Both `path` and `out` are restricted to the configured MCP root. The bundle uses the verified prefix and writes versioned `eventloom.verify.v1` `verify.json`, `query.json`, `inspect.json`, HALO JSONL, and generic OTLP trace JSON for local inspection or later upload. The manifest includes `inputDigest` for the canonical source JSONL log and `fileDigests` with byte counts and SHA-256 hashes for generated artifacts other than the manifest itself.

### `eventloom_verify_artifacts`

Verify the source log and generated artifact files against an Eventloom artifact bundle manifest.

Input:

```json
{
  "manifest": ".eventloom/artifacts/manifest.json"
}
```

Output:

```json
{
  "manifestPath": "/workspace/.eventloom/artifacts/manifest.json",
  "version": "eventloom.artifact-bundle-verification.v1",
  "ok": true,
  "checkedFiles": 10,
  "issues": []
}
```

The tool restricts the manifest, the `inputDigest` path, and every valid manifest digest path to the configured MCP root. Output uses the same versioned `eventloom.artifact-bundle-verification.v1` model as the runtime package and CLI JSON output. Issues use the same stable codes as the package API: `invalid_manifest`, `missing_file`, `unreadable_file`, `byte_count_mismatch`, and `sha256_mismatch`.

### `eventloom_run_builtin`

Run or resume one built-in deterministic workflow.

Input:

```json
{
  "path": ".eventloom/demo.jsonl",
  "workflow": "software-work",
  "resume": true,
  "maxIterations": 10
}
```

Supported workflows should match the runtime and CLI:

- `software-work`
- `research-pipeline`
- `human-ops`

Output:

```json
{
  "iterations": 4,
  "appended": 46,
  "processed": 8,
  "turns": 8,
  "skipped": 0,
  "rejected": 0,
  "stoppedReason": "idle",
  "eventCount": 46,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "projectionHash": "..."
}
```

If a numeric runtime limit is invalid, the tool returns `isError: true` with code `invalid_runtime_option`, the rejected option, the rejected value, and a suggested action before mutating the target log. If a resumed workflow log contains invalid projection state, the tool returns `isError: true` with code `runtime_projection_failed`, the requested workflow, `projectionKind`, and structured `projectionErrors` instead of flattening the failure into prose.

### `eventloom_export_pathlight`

Export a log to a Pathlight collector.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "baseUrl": "http://localhost:4100",
  "traceName": "eventloom-agent-work"
}
```

`baseUrl` is optional; when it is omitted, the tool uses `EVENTLOOM_PATHLIGHT_BASE_URL` and then `http://localhost:4100`. The resolved value must be an absolute `http://` or `https://` URL. MCP input validation rejects malformed values and non-HTTP URL schemes before the tool reads the log or calls the collector, and diagnostics include the rejected `option` and `value`.

Output:

```json
{
  "version": "eventloom.export.pathlight.v1",
  "traceId": "...",
  "exportedEventCount": 12,
  "validPrefixCount": 12,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "eventCount": 9,
  "spanCount": 4
}
```

This tool returns the same versioned `eventloom.export.pathlight.v1` model as the runtime and CLI. Runtime and CLI export results use `exportedEventCount` and `validPrefixCount` for Eventloom source-log counters. Pathlight `eventCount` remains the Pathlight span-event count, not the Eventloom source-log count.

It performs a network request and should be documented as optional. Eventloom remains useful without Pathlight. If the source log has a corrupt tail, the tool exports the verified prefix and returns the original scan diagnostics in `integrity`.

### `eventloom_export_halo`

Export a log to a HALO-compatible OpenTelemetry JSONL trace file.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "out": ".eventloom/agent-work-halo.jsonl",
  "projectId": "eventloom-agent-work",
  "serviceName": "eventloom",
  "traceName": "eventloom-agent-work"
}
```

Output:

```json
{
  "version": "eventloom.export.halo.v1",
  "outputPath": "/workspace/.eventloom/agent-work-halo.jsonl",
  "traceId": "...",
  "eventCount": 9,
  "exportedEventCount": 9,
  "validPrefixCount": 9,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "spanCount": 4
}
```

Both `path` and `out` are resolved inside the configured MCP root. The tool returns the same versioned `eventloom.export.halo.v1` model as the runtime and CLI, writes a local JSONL file, and does not perform network requests. Runtime and CLI export results use `exportedEventCount` and `validPrefixCount` for Eventloom source-log counters. MCP HALO adds `eventCount` only as a compatibility alias for `exportedEventCount`.

The output file is written through a same-directory temporary file, flushed, atomically renamed into place, and followed by a best-effort containing-directory sync on platforms that support directory fsync. If the source log has a corrupt tail, the tool exports the verified prefix and carries the original diagnostics into `integrity` and the HALO root span attributes.

### `eventloom_export_otlp`

Export a log to generic OpenTelemetry OTLP trace JSON.

Input:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "out": ".eventloom/agent-work-otlp.json",
  "endpoint": "http://localhost:4318/v1/traces",
  "serviceName": "eventloom",
  "serviceVersion": "1.0.0",
  "traceName": "eventloom-agent-work"
}
```

Output:

```json
{
  "version": "eventloom.export.otlp.v1",
  "outputPath": "/workspace/.eventloom/agent-work-otlp.json",
  "endpoint": "http://localhost:4318/v1/traces",
  "status": 202,
  "traceCount": 1,
  "spanCount": 4,
  "exportedEventCount": 9,
  "validPrefixCount": 9,
  "integrity": {
    "ok": true,
    "errors": []
  }
}
```

Both `path` and `out` are resolved inside the configured MCP root. The optional `endpoint` is an HTTP(S) OTLP traces endpoint and is not treated as a filesystem path. The tool returns the same versioned `eventloom.export.otlp.v1` model as the runtime and CLI, writes a local OTLP JSON payload first, and when `endpoint` is present, POSTs that same JSON payload with `content-type: application/json` and returns the collector HTTP `status`. The output file is written through a same-directory temporary file, flushed, atomically renamed into place, and followed by a best-effort containing-directory sync on platforms that support directory fsync. If the source log has a corrupt tail, the tool exports the verified prefix and carries the original diagnostics into `integrity` and the root span attributes. Collector failures return structured `otlp_invalid_endpoint`, `otlp_request_failed`, or `otlp_response_failed` diagnostics.

## Deferred Tools

Possible later tools:

- `eventloom_read_events`

## Path Safety

The MCP server should restrict log paths by default.

Recommended behavior:

- Default root: `process.cwd()`.
- Optional CLI flag: `--root <dir>`.
- Reject any log path that resolves outside the configured root.
- Allow absolute paths only when they still resolve inside the configured root.
- Consider a future `--allow-outside-root` escape hatch only for trusted local setups.

This keeps normal client setup simple while preventing accidental writes across the filesystem.

## Configuration

Install from npm:

```bash
npx @eventloom/mcp --root .
npx @eventloom/mcp --root . --lock-timeout-ms 1000 --lock-retry-ms 10
```

Local checkout usage:

```bash
npm --prefix packages/mcp run build
node packages/mcp/dist/cli.js --root .
node packages/mcp/dist/cli.js --root . --lock-timeout-ms 1000 --lock-retry-ms 10
```

Environment variables:

```text
EVENTLOOM_MCP_ROOT
EVENTLOOM_PATHLIGHT_BASE_URL
EVENTLOOM_LOCK_TIMEOUT_MS
EVENTLOOM_LOCK_RETRY_MS
```

CLI flags win over environment variables for root and lock timing. `--lock-timeout-ms` and `--lock-retry-ms` are non-negative integer millisecond values; leave them unset for the runtime defaults unless a short-lived local client needs faster lock failure.

## Client Setup

Use [MCP Setup](mcp-setup.md) for Codex, Claude Desktop, and MCP inspector configuration.
After installing the package, a direct local smoke test is:

```bash
npx @eventloom/mcp --root .
```

The setup guide also documents root path restrictions, lock timing flags, and client JSON snippets.

## SDK Notes

Use the official TypeScript MCP SDK. The current package pins `@modelcontextprotocol/sdk` in `packages/mcp/package.json`. The official MCP documentation lists TypeScript as a Tier 1 SDK, and the SDK repository has been evolving toward split packages, so revisit the dependency before each MCP package release.

References:

- <https://modelcontextprotocol.io/docs/sdk>
- <https://github.com/modelcontextprotocol/typescript-sdk>

## Test Plan

Use fixture-backed tests and avoid depending on a real MCP client for every assertion.

Current coverage:

- `eventloom_append` creates a sealed event and preserves hash-chain integrity.
- `eventloom_replay` returns the versioned `eventloom.replay.v1` integrity and projection status for a local log.
- `eventloom_verify` streams integrity verification and returns the versioned `eventloom.verify.v1` diagnostics model.
- `eventloom_recover` writes a verified-prefix recovery artifact and optional quarantine tail inside the configured root.
- `eventloom_diff` returns versioned `eventloom.projection-diff.v1` structured projection differences between two replayed logs.
- `eventloom_stats` returns the versioned `eventloom.stats.v1` model with event counts, actor/thread/type counts, integrity, and projection hash.
- `eventloom_inspect` returns the consolidated integrity, stats, timeline, handoff, and optional filtered `selection` inspection model.
- `eventloom_query` returns the versioned `eventloom.query.v1` model with filtered verified-prefix event summaries.
- `eventloom_timeline` returns the versioned `eventloom.timeline.v1` model plus human-readable text.
- `eventloom_explain_task` returns the versioned `eventloom.task-explanation.v1` model plus human-readable text.
- `eventloom_mailbox` returns the versioned `eventloom.mailbox.v1` model plus human-readable text.
- `eventloom_summarize_handoff` returns the versioned `eventloom.handoff.v1` model plus human-readable text.
- `eventloom_visualize` returns the versioned `eventloom.visualizer.v1` Capture, Replay, and Handoff visualizer model.
- `eventloom_write_artifacts` writes a repository-local artifact bundle for CI or handoff.
- `eventloom_verify_artifacts` checks generated artifact bundle files against manifest byte counts and SHA-256 digests.
- `eventloom_run_builtin` can create and resume a deterministic workflow log.
- `eventloom_export_pathlight` maps a workflow log through the MCP adapter and mocked Pathlight fetch calls, returning `eventloom.export.pathlight.v1`.
- `eventloom_export_halo` writes HALO-compatible JSONL and returns `eventloom.export.halo.v1` trace metadata.
- `eventloom_export_otlp` writes generic OTLP trace JSON, can POST it to an OTLP HTTP endpoint, and returns `eventloom.export.otlp.v1` trace plus delivery metadata.
- Path safety rejects paths outside the configured root.
- MCP stdio smoke coverage verifies append, replay, built-in workflow runs, artifact bundle writes, artifact bundle verification, and OTLP export through the protocol.

Avoid real network listeners in package tests; sandboxed environments may reject loopback binds. Stub `fetch` for Pathlight export coverage unless the test is explicitly marked as an optional integration check.

## v1 Release Readiness

`@eventloom/mcp` reaches the v1 release boundary only after `@eventloom/runtime@1.0.0` is published and npm can resolve it. Until then, the checked-in package may remain pinned to the latest published compatible runtime while the staged local preflight proves the future v1 metadata against a packed runtime tarball.

Before publishing MCP v1, run the phase-specific gate from the repository root:

```bash
npm run ci:mcp-v1
npm run release:preflight:mcp-v1
```

The MCP v1 gate includes:

- `npm run test:mcp`
- `npm run build:mcp`
- `npm run audit:mcp`
- `npm run smoke:mcp-installed-bin`
- `npm run pack:check`
- `npm pack --dry-run ./packages/mcp`

The release preflight verifies the MCP package version, server metadata, lockfile version, and dependency on `@eventloom/runtime@^1.0.0`. It also checks the published runtime tarball metadata before MCP publication.

Before the runtime v1 package is published, use `npm run release:preflight:mcp-v1-staged:local` for local readiness only. That staged check temporarily points MCP at a packed runtime tarball and does not replace the registry-backed MCP preflight.

After each MCP release, dogfood a fresh editor configuration from the published `@eventloom/mcp` package and keep Codex, Claude Desktop, and MCP inspector setup snippets current as MCP client conventions change. Add screenshots or transcript excerpts if a client-specific setup step becomes ambiguous.
