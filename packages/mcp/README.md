# @eventloom/mcp

MCP server for Eventloom local event logs.

Install from npm:

```bash
npx @eventloom/mcp --root .
```

Run from a local checkout:

```bash
npm run build:mcp
node packages/mcp/dist/cli.js --root .
```

The server exposes tools for appending sealed events, replaying logs, viewing timelines, explaining task state, running built-in workflows, and exporting logs to Pathlight or HALO-compatible JSONL traces.

By default, log paths are restricted to the configured root directory. Use `--root <dir>` or `EVENTLOOM_MCP_ROOT` to choose the allowed workspace root.

See [MCP Setup](../../docs/mcp-setup.md) for Codex, Claude Desktop, and MCP inspector configuration examples.

Tools:

- `eventloom_append`
- `eventloom_replay`
- `eventloom_timeline`
- `eventloom_explain_task`
- `eventloom_mailbox`
- `eventloom_summarize_handoff`
- `eventloom_run_builtin`
- `eventloom_export_pathlight`
- `eventloom_export_halo`
