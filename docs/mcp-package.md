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

## Deferred Tools

`eventloom_mailbox` is useful, but should wait until mailbox rebuilding is exposed as a stable runtime capability rather than being tied to one workflow registry.

Possible later tools:

- `eventloom_mailbox`
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

Minimum tests:

- `eventloom_append` creates a sealed event and preserves hash-chain integrity.
- `eventloom_replay` matches the runtime replay result for `fixtures/sample.jsonl`.
- `eventloom_timeline` returns ordered event summaries.
- `eventloom_explain_task` returns the expected projected task state.
- `eventloom_run_builtin` can create and resume a deterministic workflow log.
- Path safety rejects paths outside the configured root.

Add one end-to-end MCP stdio smoke test before publishing.

## Release Criteria

Publish `@eventloom/mcp` when:

- The package exposes the MVP tools over stdio.
- Tool schemas and outputs are documented.
- Fixture-backed tests pass.
- A local MCP client can append an event, replay the log, and inspect a task.
- The public site and README link to the MCP package docs.
