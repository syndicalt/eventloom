---
name: eventloom
description: Use when Codex should record, replay, inspect, or export agent work with Eventloom append-only JSONL event logs. Trigger for tasks involving Eventloom, agent workflow journaling, event-sourced agent state, replayable coding-agent work, Pathlight export of Eventloom logs, or dogfooding Eventloom while planning or implementing roadmap work.
---

# Eventloom

Use Eventloom to make agent work replayable. Prefer the CLI for journaling and inspection unless the user specifically asks for code-level integration.

## Command Selection

From the Eventloom repository, use:

```bash
npm run eventloom -- <command>
```

From another project with the package installed, use:

```bash
npx eventloom <command>
```

Do not create a new runtime or server for routine journaling. Eventloom uses local JSONL files.

## Agent Work Log

Use a project-local log path unless the user gives one:

```text
.eventloom/agent-work.jsonl
```

Create the directory before appending:

```bash
mkdir -p .eventloom
```

Never log secrets, credentials, private keys, auth tokens, or full sensitive outputs. Summarize sensitive work with redacted payloads.

## Basic Workflow

1. Start with a goal:

```bash
npm run eventloom -- append .eventloom/agent-work.jsonl goal.created --actor user --payload '{"title":"Add Eventloom agent integration"}'
```

2. Append task lifecycle events as work progresses:

```bash
npm run eventloom -- append .eventloom/agent-work.jsonl task.proposed --actor codex --payload '{"taskId":"task_agent_integration","title":"Document Eventloom agent workflow"}'
npm run eventloom -- append .eventloom/agent-work.jsonl task.claimed --actor codex --payload '{"taskId":"task_agent_integration"}'
npm run eventloom -- append .eventloom/agent-work.jsonl task.completed --actor codex --payload '{"taskId":"task_agent_integration"}'
```

3. Inspect before reporting completion:

```bash
npm run eventloom -- replay .eventloom/agent-work.jsonl
npm run eventloom -- timeline .eventloom/agent-work.jsonl
npm run eventloom -- explain task task_agent_integration .eventloom/agent-work.jsonl
```

4. Append review events only when there is a real review or acceptance signal:

```bash
npm run eventloom -- append .eventloom/agent-work.jsonl review.requested --actor codex --payload '{"taskId":"task_agent_integration"}'
npm run eventloom -- append .eventloom/agent-work.jsonl review.approved --actor user --payload '{"taskId":"task_agent_integration"}'
```

Use `--thread`, `--parent`, and `--caused-by` when a task needs explicit causality. The append command prints the new event id.

## Event Naming

Use lowercase dot-delimited event types. Prefer existing projected events when possible:

- `goal.created`
- `task.proposed`
- `task.claimed`
- `task.completed`
- `review.requested`
- `review.approved`
- `approval.requested`
- `approval.granted`
- `effect.applied`

Use custom event types only for facts that do not need current projections, such as `decision.recorded` or `risk.identified`.

## When to Replay

Replay after meaningful batches, before final summaries, and before exporting to Pathlight:

```bash
npm run eventloom -- replay <events.jsonl>
```

If `integrity.ok` is false, stop and report the integrity error. Do not edit sealed JSONL lines manually to "fix" them; append corrective events instead unless the user explicitly asks for fixture resealing.

## Pathlight Export

If the user wants visual inspection and a Pathlight collector is running:

```bash
npm run eventloom -- export pathlight .eventloom/agent-work.jsonl --base-url http://localhost:4100 --trace-name eventloom-agent-work
```

Pathlight export is optional. Do not start Docker or services unless the user asks.

## References

Read `references/agent-workflows.md` for event patterns, payload examples, and handoff conventions when creating a new agent workflow or documenting Eventloom usage for other agents.
