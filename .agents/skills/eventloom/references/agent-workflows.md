# Eventloom Agent Workflow Reference

## Purpose

Eventloom records durable facts about agent work. It should complement normal git commits, tests, and final summaries. The event log is useful when a task has multiple actors, approvals, handoffs, or decisions that should remain replayable.

## Recommended Events

Use projected task events for work that maps to a task:

```text
goal.created
task.proposed
task.claimed
task.completed
review.requested
review.approved
```

Use operational events for approval flows:

```text
approval.requested
approval.granted
effect.applied
effect.rejected
```

Use custom fact events only when no projection is needed:

```text
decision.recorded
risk.identified
handoff.created
verification.completed
```

## Payload Patterns

Goal:

```json
{"title":"Ship Eventloom agent integration"}
```

Task:

```json
{"taskId":"task_agent_skill","title":"Create Codex skill for Eventloom"}
```

Decision:

```json
{"title":"Keep MCP separate from runtime","reason":"Avoid coupling server protocol to core package"}
```

Verification:

```json
{"command":"npm test","status":"passed","summary":"44 tests passed"}
```

Do not store secrets, tokens, private keys, credentials, proprietary prompts, or unredacted sensitive user data.

## Handoff Checklist

Before handing off an Eventloom-tracked task:

1. Run `replay` and confirm `integrity.ok` is true.
2. Run `timeline` for a concise event order.
3. Run `explain task <taskId>` for projected task state when using task events.
4. Mention the log path, event count, projection hash, and any failed integrity checks.
5. Export to Pathlight only if the user requested visual inspection or a collector is already running.

## Causality

Use `--parent` for the direct predecessor and `--caused-by` for dependencies:

```bash
npm run eventloom -- append .eventloom/agent-work.jsonl task.completed \
  --actor codex \
  --parent evt_previous \
  --caused-by evt_goal,evt_task \
  --payload '{"taskId":"task_agent_skill"}'
```

The command output includes the event id. Capture ids when causality matters.
