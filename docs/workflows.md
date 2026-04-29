# Workflow Guide

Threadline includes three deterministic built-in workflows. They are intentionally small, concrete examples that exercise the runtime model.

## Software Work

Command:

```bash
npm run threadline -- run software-work /tmp/threadline-software.jsonl
```

Actors:

| Actor | Subscriptions | Intentions |
|---|---|---|
| `planner` | `goal.created` | `task.propose` |
| `worker` | `task.proposed`, `task.claimed`, `task.completed`, `issue.reported` | `task.claim`, `task.complete`, `review.request` |
| `reviewer` | `review.requested` | `review.approve`, `issue.report` |

Lifecycle:

```text
goal.created
  -> task.proposed
  -> task.claimed
  -> task.completed
  -> review.requested
  -> review.approved
```

Projection:

`projectTasks` stores task status, last actor, last event, title, and history.

Expected final status:

```text
task_actor_runtime -> approved
```

## Research Pipeline

Command:

```bash
npm run threadline -- run research-pipeline /tmp/threadline-research.jsonl
```

Actors:

| Actor | Subscriptions | Intentions |
|---|---|---|
| `researcher` | `research.question.created` | `source.find` |
| `analyst` | `source.found` | `claim.extract` |
| `critic` | `claim.extracted` | `claim.challenge` |
| `writer` | `claim.challenged` | `report.draftSection` |
| `editor` | `report.section.drafted` | `report.finalize` |

Lifecycle:

```text
research.question.created
  -> source.found
  -> claim.extracted
  -> claim.challenged
  -> report.section.drafted
  -> report.finalized
```

Projection:

`projectResearch` stores:

- question text
- sources
- claims
- challenges
- report sections
- final report id and summary
- history

Expected final status:

```text
question_evented_runtime -> finalized
```

## Human Ops

Command:

```bash
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl
```

Actors:

| Actor | Subscriptions | Intentions |
|---|---|---|
| `responder` | `external.alert.received` | `effect.request` |
| `safety` | `effect.requested` | `approval.request` |
| `applier` | `approval.granted` | `effect.apply` |

Lifecycle:

```text
external.alert.received
  -> effect.requested
  -> approval.requested
  -> approval.granted
  -> effect.applied
```

The first run stops after `approval.requested`. A human approval must be appended externally:

```bash
npm run threadline -- append /tmp/threadline-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
```

Then resume:

```bash
npm run threadline -- run human-ops /tmp/threadline-human-ops.jsonl --resume
```

Projection:

`projectEffects` stores effect status, action, target, approval id, last actor, last event, and history.

Expected final status:

```text
effect_runtime_mitigation -> applied
```

## Runtime Loop Behavior

All built-in workflows use the same runtime loop:

1. Rebuild actor mailboxes from the log.
2. Run one actor on one mailbox item.
3. Submit intentions to the orchestrator.
4. Append actor turn markers.
5. Mark the mailbox item processed.
6. Continue until idle.

The loop returns:

- `iterations`
- `appended`
- `processed`
- `turns`
- `skipped`
- `rejected`
- `stoppedReason`

## Resume Behavior

`--resume` keeps the existing log and continues from it.

Resume works because `actor.processed` events record source event ids. If a source event was already processed by an actor, it is excluded from that actor's rebuilt mailbox.

## Adding a Built-In Workflow

Use the existing workflows as templates:

1. Add actor registry factory in `src/actors.ts`.
2. Add intention names and event mappings in `src/intentions.ts`.
3. Add projection and validation if the workflow has new state.
4. Wire validation in `src/orchestrator.ts`.
5. Add runners in `src/runners.ts`.
6. Add CLI routing in `src/cli.ts`.
7. Add package API support in `src/runtime.ts` if it should be public.
8. Add tests for projection, orchestrator, and runtime behavior.
