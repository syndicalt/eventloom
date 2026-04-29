# Agent Integration

Eventloom can be used by coding agents as a lightweight, local event journal. The goal is to make agent work replayable without requiring a hosted service, database, or MCP server.

## Recommended Integration Order

1. Use the CLI from the published package or repository checkout.
2. Record meaningful workflow facts into a JSONL log.
3. Replay the log before handoff or export.
4. Use `@eventloom/mcp` when an editor or agent client should call Eventloom through MCP instead of shelling out.

## Install

```bash
npm install @eventloom/runtime
```

Run the installed CLI:

```bash
npx eventloom replay <events.jsonl>
```

From this repository, use:

```bash
npm run eventloom -- replay <events.jsonl>
```

## Agent Work Log

Use a project-local log path:

```text
.eventloom/agent-work.jsonl
```

Do not log secrets, credentials, private keys, auth tokens, or unredacted sensitive user data. Use short summaries and redacted payloads.

## Minimal Agent Workflow

```bash
mkdir -p .eventloom

npm run eventloom -- append .eventloom/agent-work.jsonl goal.created \
  --actor user \
  --payload '{"title":"Ship Eventloom agent integration"}'

npm run eventloom -- append .eventloom/agent-work.jsonl task.proposed \
  --actor codex \
  --payload '{"taskId":"task_agent_skill","title":"Create Eventloom Codex skill"}'

npm run eventloom -- append .eventloom/agent-work.jsonl task.claimed \
  --actor codex \
  --payload '{"taskId":"task_agent_skill"}'

npm run eventloom -- append .eventloom/agent-work.jsonl task.completed \
  --actor codex \
  --payload '{"taskId":"task_agent_skill"}'

npm run eventloom -- replay .eventloom/agent-work.jsonl
npm run eventloom -- timeline .eventloom/agent-work.jsonl
npm run eventloom -- explain task task_agent_skill .eventloom/agent-work.jsonl
```

The replay output includes integrity status, event counts, projections, and projection hash.

## Codex Skill

This repository includes a Codex skill at:

```text
.agents/skills/eventloom
```

The skill teaches Codex when and how to create Eventloom logs, append projected task events, replay before handoff, and optionally export to Pathlight.

## MCP Package

MCP remains a separate package from the runtime:

```text
@eventloom/mcp
```

The package is implemented in `packages/mcp`, and the tool contract is documented in [MCP Package Design](mcp-package.md).

Local checkout usage:

```bash
npm run build:mcp
node packages/mcp/dist/cli.js --root .
```

From npm, use:

```bash
npx @eventloom/mcp --root .
```

MVP tools:

- `eventloom_append`
- `eventloom_replay`
- `eventloom_timeline`
- `eventloom_explain_task`
- `eventloom_run_builtin`
- `eventloom_export_pathlight`

`eventloom_mailbox` should wait until mailbox rebuilding is exposed as a stable runtime capability rather than being tied to one built-in workflow registry.

## Pathlight Export

If a Pathlight collector is running, export the agent log:

```bash
npm run eventloom -- export pathlight .eventloom/agent-work.jsonl \
  --base-url http://localhost:4100 \
  --trace-name eventloom-agent-work
```

Pathlight export is optional. Eventloom remains useful as a local JSONL event log without it.
