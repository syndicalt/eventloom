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

## Observability Evidence

For logs that will be exported to HALO or Pathlight, add observability events around real model and tool work. Lifecycle events prove that a task moved forward; telemetry events explain how and why.

Recommended event sequence for one agent step:

```bash
npm run eventloom -- append .eventloom/agent-work.jsonl model.started \
  --actor codex \
  --payload '{"modelCallId":"model_1","modelProvider":"openai","modelName":"gpt-5.5","promptVersion":"agent.step.v1","inputSummary":"Summarize the relevant code paths","inputMessages":[{"role":"user","content":"Summarize the relevant code paths"}],"parameters":{"temperature":0}}'

npm run eventloom -- append .eventloom/agent-work.jsonl tool.started \
  --actor codex \
  --payload '{"toolCallId":"tool_1","toolName":"shell","inputSummary":"Find handoff references in source, tests, and docs","input":{"cmd":"rg -n \"handoff\" src tests docs"}}'

npm run eventloom -- append .eventloom/agent-work.jsonl tool.completed \
  --actor codex \
  --payload '{"toolCallId":"tool_1","toolName":"shell","output":{"summary":"Found runtime, test, and docs references"},"outputSummary":"Found handoff references in runtime, tests, and docs","exitCode":0,"resultCount":3,"resultExcerpt":"src/handoff.ts tests/handoff.test.ts docs/agent-integration.md","decisive":true,"latencyMs":120}'

npm run eventloom -- append .eventloom/agent-work.jsonl reasoning.summary \
  --actor codex \
  --payload '{"summary":"The handoff summary needs telemetry evidence because HALO can already validate the trace but cannot infer model or tool behavior without spans.","evidenceEventIds":["tool_1"],"confidence":0.84}'

npm run eventloom -- append .eventloom/agent-work.jsonl model.completed \
  --actor codex \
  --payload '{"modelCallId":"model_1","modelProvider":"openai","modelName":"gpt-5.5","outputText":"Add telemetry-aware handoff summaries.","outputSummary":"Recommended telemetry-aware handoff summaries","inputTokens":320,"outputTokens":80,"totalTokens":400,"latencyMs":900}'
```

Verification events should include the command or checks that support the claim:

```bash
npm run eventloom -- append .eventloom/agent-work.jsonl verification.completed \
  --actor codex \
  --payload '{"summary":"Handoff telemetry tests passed","command":"npm test -- tests/handoff.test.ts","checks":["model telemetry summarized","tool telemetry summarized","reasoning evidence summarized"],"assertions":["handoff reports no observability gaps"],"evidenceEventIds":["tool_1"],"artifactIds":["artifact_handoff_test"],"passCount":1,"failCount":0}'
```

Do not include secrets, private prompts, hidden chain-of-thought, or unredacted user data. Use summaries, redacted inputs, event ids, and command names.

## Handoff Summary

Use a handoff summary before pausing, switching agents, or asking for review:

```bash
npm run eventloom -- handoff .eventloom/agent-work.jsonl
```

The summary reports goals, active tasks, completed tasks, projection errors, recorded decisions, verification events, releases, risks, model/tool telemetry, reasoning summaries, observability gaps, and deterministic next actions.

## Dogfood Templates

Eventloom includes starter templates for common agent workflows:

```bash
npm run eventloom -- templates
npm run eventloom -- templates coding-task
```

Initial templates:

- `coding-task`
- `review-task`
- `release-task`
- `research-task`

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
- `eventloom_mailbox`
- `eventloom_summarize_handoff`
- `eventloom_run_builtin`
- `eventloom_export_pathlight`
- `eventloom_export_halo`

## Pathlight Export

If a Pathlight collector is running, export the agent log:

```bash
npm run eventloom -- export pathlight .eventloom/agent-work.jsonl \
  --base-url http://localhost:4100 \
  --trace-name eventloom-agent-work
```

Pathlight export is optional. Eventloom remains useful as a local JSONL event log without it.

## HALO Export

MCP clients can also export a local agent log to HALO-compatible OpenTelemetry JSONL:

```json
{
  "path": ".eventloom/agent-work.jsonl",
  "out": ".eventloom/agent-work-halo.jsonl",
  "projectId": "eventloom-agent-work",
  "serviceName": "eventloom",
  "traceName": "eventloom-agent-work"
}
```

The `eventloom_export_halo` tool writes the trace file inside the configured MCP root and returns the trace id, event count, and span count.
