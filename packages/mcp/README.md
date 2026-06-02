# @eventloom/mcp

MCP server for Eventloom local event logs.

`@eventloom/mcp` stays a thin stdio adapter over the `@eventloom/runtime` public API. Tools return MCP `structuredContent`; read, inspect, artifact, and export tools include `integrity` where relevant so clients can reason over diagnostics without parsing prose.

The checked-in MCP package remains `0.1.6` and depends on `@eventloom/runtime@^0.1.7` until `@eventloom/runtime@1.0.0` is published and npm can resolve it. For the first v1 release, publish the runtime package first, then move MCP metadata and its runtime dependency to `1.0.0`/`^1.0.0` and run the MCP v1 gate from the release checklist.

Install from npm:

```bash
npx @eventloom/mcp --root .
```

Run from a local checkout:

```bash
npm run build:mcp
node packages/mcp/dist/cli.js --root .
```

The server exposes tools for appending sealed events, replaying logs, verifying logs with structured diagnostics, recovering verified prefixes, diffing replay projections, returning log stats, consolidated inspection, querying filtered event summaries, viewing timelines, explaining task state, building visualizer output, writing artifact bundles, running built-in workflows, and exporting logs to Pathlight, HALO-compatible JSONL traces, or generic OTLP trace JSON.

Read-model and export tools use the verified prefix when a log has a corrupt tail and return verified-prefix diagnostics in structured output. Pathlight, HALO, and OTLP export results include `exportedEventCount`, `validPrefixCount`, and `integrity` so agents can distinguish recoverable source events from adapter-specific span or event counts.

Tool failures return `isError: true` with `structuredContent.error.code`, `message`, and a suggested action so agents can handle failures without parsing prose.

By default, log paths are restricted to the configured root directory. Use `--root <dir>` or `EVENTLOOM_MCP_ROOT` to choose the allowed workspace root.

For short-lived local clients and tests, append lock timing can be tuned with `EVENTLOOM_LOCK_TIMEOUT_MS` and `EVENTLOOM_LOCK_RETRY_MS`, or with `--lock-timeout-ms` and `--lock-retry-ms` on the stdio server command. Invalid, unknown, or incomplete startup options exit before stdio startup with a structured `invalid_mcp_server_option` diagnostic. Unexpected startup failures also use a JSON stderr diagnostic with `mcp_server_start_failed`, so client smoke tests do not need to parse free-form stderr.

See [MCP Setup](https://github.com/syndicalt/eventloom/blob/master/docs/mcp-setup.md) for Codex, Claude Desktop, and MCP inspector configuration examples.

Tools:

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
