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
      server.ts
      tools/
        append.ts
        replay.ts
        timeline.ts
        explain_task.ts
        run_builtin.ts
        export_pathlight.ts
    tests/
```

The package should publish a binary:

```text
eventloom-mcp
```

The MCP package should depend on `@eventloom/runtime` and call its public API. If a needed behavior exists only in CLI formatting code, promote a small runtime helper instead of copying that logic into the MCP package.

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
  "path": ".eventloom/agent-work.jsonl"
}
```

Output should match the runtime replay result closely:

```json
{
  "eventCount": 9,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "projectionHash": "..."
}
```

The tool may include the projection object when the client asks for verbose output, but the default output should stay compact.

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
  "events": [
    {
      "id": "evt_...",
      "type": "task.proposed",
      "actorId": "codex",
      "threadId": "thread_roadmap"
    }
  ]
}
```

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
  "task": {
    "id": "task_mcp_design_doc",
    "status": "completed",
    "actorId": "codex",
    "lastEventId": "evt_..."
  },
  "history": ["evt_...", "evt_..."]
}
```

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
  "actorId": "worker",
  "workflow": "software-work",
  "items": [
    {
      "event": {
        "id": "evt_...",
        "type": "task.proposed",
        "actorId": "planner",
        "threadId": "thread_roadmap",
        "timestamp": "2026-04-29T12:00:00.000Z",
        "parentEventId": null,
        "causedBy": [],
        "payload": {
          "taskId": "task_1"
        }
      },
      "task": {
        "id": "task_1",
        "status": "proposed"
      }
    }
  ]
}
```

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
  "eventCount": 12,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "goals": [],
  "tasks": {
    "active": [],
    "completed": []
  },
  "decisions": [],
  "verification": [],
  "nextActions": []
}
```

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
  "eventCount": 18,
  "integrity": {
    "ok": true,
    "errors": []
  },
  "projectionHash": "..."
}
```

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

Output:

```json
{
  "traceId": "...",
  "eventCount": 9,
  "spanCount": 4
}
```

This tool performs a network request and should be documented as optional. Eventloom remains useful without Pathlight.

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
  "outputPath": "/workspace/.eventloom/agent-work-halo.jsonl",
  "traceId": "...",
  "eventCount": 9,
  "spanCount": 4
}
```

Both `path` and `out` are resolved inside the configured MCP root. The tool writes a local JSONL file and does not perform network requests.

## Deferred Tools

Possible later tools:

- `eventloom_verify`
- `eventloom_read_events`
- `eventloom_summarize_handoff`

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
```

Local checkout usage:

```bash
npm --prefix packages/mcp run build
node packages/mcp/dist/cli.js --root .
```

Candidate environment variables:

```text
EVENTLOOM_MCP_ROOT
EVENTLOOM_PATHLIGHT_BASE_URL
```

CLI flags should win over environment variables.

## Client Setup

Document setup after the package is implemented and published. The guide should cover at least:

- Codex-style local MCP configuration.
- Claude Desktop local MCP configuration.
- Direct smoke test with the MCP inspector or SDK client.

## SDK Notes

Use the official TypeScript MCP SDK. The current package pins `@modelcontextprotocol/sdk` in `packages/mcp/package.json`. The official MCP documentation lists TypeScript as a Tier 1 SDK, and the SDK repository has been evolving toward split packages, so revisit the dependency before each MCP package release.

References:

- <https://modelcontextprotocol.io/docs/sdk>
- <https://github.com/modelcontextprotocol/typescript-sdk>

## Test Plan

Use fixture-backed tests and avoid depending on a real MCP client for every assertion.

Current coverage:

- `eventloom_append` creates a sealed event and preserves hash-chain integrity.
- `eventloom_replay` returns integrity and projection status for a local log.
- `eventloom_timeline` returns ordered event summaries.
- `eventloom_explain_task` returns the expected projected task state.
- `eventloom_mailbox` returns rebuilt actor mailbox items for a built-in workflow.
- `eventloom_run_builtin` can create and resume a deterministic workflow log.
- `eventloom_export_pathlight` maps a workflow log through the MCP adapter and mocked Pathlight fetch calls.
- `eventloom_export_halo` writes HALO-compatible JSONL and returns trace metadata.
- Path safety rejects paths outside the configured root.
- MCP stdio smoke coverage verifies append and replay through the protocol.

Avoid real network listeners in package tests; sandboxed environments may reject loopback binds. Stub `fetch` for Pathlight export coverage unless the test is explicitly marked as an optional integration check.

## Release Criteria

`@eventloom/mcp` is ready for local use when:

- The package exposes the MVP tools over stdio.
- Tool schemas and outputs are documented.
- Fixture-backed tests pass.
- A local MCP client can append an event, replay the log, and inspect a task.
- The public site and README link to the MCP package docs.

Remaining adoption work:

- Dogfood a fresh editor configuration from the published `@eventloom/mcp` package after each release.
- Keep Codex, Claude Desktop, and MCP inspector setup snippets current as MCP client conventions change.
- Add screenshots or transcript excerpts if a client-specific setup step becomes ambiguous.
