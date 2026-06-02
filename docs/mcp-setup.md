# MCP Setup

Eventloom's MCP server runs over stdio and reads or writes local JSONL logs inside a configured workspace root.

Use the published package for normal client setup:

```bash
npx @eventloom/mcp --root /path/to/workspace
```

Use a local checkout while developing Eventloom itself:

```bash
npm run build:mcp
node packages/mcp/dist/cli.js --root /path/to/eventloom
```

The root can also be supplied with `EVENTLOOM_MCP_ROOT`. Prefer an absolute path in editor configuration so the MCP server has a predictable file boundary. Short-lived clients can tune append lock behavior with `--lock-timeout-ms`, `--lock-retry-ms`, `EVENTLOOM_LOCK_TIMEOUT_MS`, and `EVENTLOOM_LOCK_RETRY_MS`.

## Codex

For a local checkout, add an MCP server entry to your Codex configuration:

```toml
[mcp_servers.eventloom]
command = "node"
args = ["/path/to/eventloom/packages/mcp/dist/cli.js", "--root", "/path/to/workspace"]
```

For the published package:

```toml
[mcp_servers.eventloom]
command = "npx"
args = ["@eventloom/mcp", "--root", "/path/to/workspace"]
```

Restart Codex after changing MCP configuration. The available tools should include:

- `eventloom_append`
- `eventloom_replay`
- `eventloom_verify`
- `eventloom_recover`
- `eventloom_diff`
- `eventloom_stats`
- `eventloom_inspect`
- `eventloom_query`
- `eventloom_timeline`
- `eventloom_explain_task`
- `eventloom_mailbox`
- `eventloom_summarize_handoff`
- `eventloom_visualize`
- `eventloom_write_artifacts`
- `eventloom_verify_artifacts`
- `eventloom_run_builtin`
- `eventloom_export_pathlight`
- `eventloom_export_halo`
- `eventloom_export_otlp`

## Claude Desktop

Add the server to the Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "eventloom": {
      "command": "npx",
      "args": ["@eventloom/mcp", "--root", "/path/to/workspace"]
    }
  }
}
```

For a local checkout:

```json
{
  "mcpServers": {
    "eventloom": {
      "command": "node",
      "args": ["/path/to/eventloom/packages/mcp/dist/cli.js", "--root", "/path/to/workspace"]
    }
  }
}
```

Restart Claude Desktop after changing the configuration.

## Inspector Smoke Test

Use the MCP inspector to verify the server outside an editor:

```bash
npx @modelcontextprotocol/inspector npx @eventloom/mcp --root /path/to/workspace
```

From a local checkout:

```bash
npm run build:mcp
npx @modelcontextprotocol/inspector node packages/mcp/dist/cli.js --root /path/to/eventloom
```

In the inspector, call:

1. `eventloom_append` with `path` set to `.eventloom/inspector-smoke.jsonl`, `type` set to `task.proposed`, and a payload such as `{"taskId":"task_inspector_smoke","title":"Inspector smoke test"}`.
2. `eventloom_replay` for `.eventloom/inspector-smoke.jsonl`; `integrity.ok` should be `true`.
3. `eventloom_explain_task` for `task_inspector_smoke`; the task should be projected from the appended event.
4. `eventloom_write_artifacts` for `.eventloom/inspector-smoke.jsonl` with `outDir` set to `.eventloom/inspector-artifacts`; the result should include `manifest.json`, `inspect.json`, `visualizer.html`, `halo.jsonl`, and `otlp-traces.json`.
5. `eventloom_verify_artifacts` for `.eventloom/inspector-artifacts/manifest.json`; `ok` should be `true`.

Pathlight export is optional. Use `eventloom_export_pathlight` only when a Pathlight collector is running and reachable from the MCP server process.

HALO export writes a local JSONL trace file:

1. `eventloom_run_builtin` with `path` set to `.eventloom/halo-smoke.jsonl` and `workflow` set to `software-work`.
2. `eventloom_export_halo` with `path` set to `.eventloom/halo-smoke.jsonl`, `out` set to `.eventloom/halo-smoke-trace.jsonl`, and optional `projectId`, `serviceName`, or `traceName`.

Both paths are resolved inside the configured MCP root.

OTLP export writes a local OpenTelemetry trace JSON file:

1. `eventloom_run_builtin` with `path` set to `.eventloom/otlp-smoke.jsonl` and `workflow` set to `software-work`.
2. `eventloom_export_otlp` with `path` set to `.eventloom/otlp-smoke.jsonl`, `out` set to `.eventloom/otlp-smoke-trace.json`, and optional `serviceName`, `serviceVersion`, or `traceName`.

Both paths are resolved inside the configured MCP root.
