# Agent Journal Cookbook

These recipes use Eventloom as a repo-local, append-only agent journal. Keep logs under `.eventloom/`, avoid secrets, and prefer short summaries plus artifact ids over raw private data.

## Coding Agent Task

Use this when an agent implements a concrete code change:

```bash
mkdir -p .eventloom

npx eventloom append .eventloom/agent-work.jsonl goal.created \
  --actor user \
  --payload '{"title":"Implement the requested code change"}'

npx eventloom append .eventloom/agent-work.jsonl task.proposed \
  --actor codex \
  --payload '{"taskId":"task_code_change","title":"Make the code change with tests"}'

npx eventloom append .eventloom/agent-work.jsonl task.claimed \
  --actor codex \
  --payload '{"taskId":"task_code_change"}'

npx eventloom append .eventloom/agent-work.jsonl verification.completed \
  --actor codex \
  --payload '{"summary":"Targeted tests passed","command":"npm test -- tests/example.test.ts","checks":["targeted test"],"assertions":["behavior matches request"],"evidenceEventIds":[],"artifactIds":["artifact_test_output"],"passCount":1,"failCount":0}'

npx eventloom append .eventloom/agent-work.jsonl task.completed \
  --actor codex \
  --payload '{"taskId":"task_code_change"}'
```

Before handoff:

```bash
npx eventloom replay .eventloom/agent-work.jsonl
npx eventloom handoff .eventloom/agent-work.jsonl --json
npx eventloom artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts --title "Agent Work"
```

## Review Loop

Use review facts to preserve why a change was accepted or sent back:

```bash
npx eventloom append .eventloom/agent-work.jsonl review.requested \
  --actor codex \
  --payload '{"taskId":"task_code_change"}'

npx eventloom append .eventloom/agent-work.jsonl issue.reported \
  --actor reviewer \
  --payload '{"taskId":"task_code_change","summary":"Missing regression coverage for corrupted tails"}'

npx eventloom append .eventloom/agent-work.jsonl task.claimed \
  --actor codex \
  --payload '{"taskId":"task_code_change"}'
```

After remediation, append `task.completed`, `review.requested`, and either `review.approved` or another `issue.reported`.

## Research Workflow

For source-backed research, record claims and challenges as structured facts:

```bash
npx eventloom append .eventloom/agent-work.jsonl research.question.created \
  --actor user \
  --payload '{"questionId":"question_runtime","question":"How should agent sessions be preserved?"}'

npx eventloom append .eventloom/agent-work.jsonl source.found \
  --actor researcher \
  --payload '{"questionId":"question_runtime","sourceId":"source_repo_docs","title":"Repository docs","url":"eventloom://docs"}'

npx eventloom append .eventloom/agent-work.jsonl claim.extracted \
  --actor analyst \
  --payload '{"questionId":"question_runtime","sourceId":"source_repo_docs","claimId":"claim_artifacts","text":"Agent sessions should be preserved as JSONL logs plus derived artifacts."}'

npx eventloom append .eventloom/agent-work.jsonl claim.challenged \
  --actor critic \
  --payload '{"questionId":"question_runtime","claimId":"claim_artifacts","challengeId":"challenge_scope","verdict":"Supported for local-first workflows; hosted observability remains optional."}'
```

## Human Approval

Use approval events when a proposed action needs explicit human consent:

```bash
npx eventloom append .eventloom/agent-work.jsonl effect.requested \
  --actor codex \
  --payload '{"effectId":"effect_release","action":"publish","target":"npm","description":"Publish the runtime package"}'

npx eventloom append .eventloom/agent-work.jsonl approval.requested \
  --actor safety \
  --payload '{"effectId":"effect_release","approvalId":"approval_release"}'

npx eventloom append .eventloom/agent-work.jsonl approval.granted \
  --actor human \
  --payload '{"effectId":"effect_release","approvalId":"approval_release","reason":"Release gate passed"}'
```

## CI Artifact Capture

For any CI or automation run, write an artifact bundle after verification:

```bash
npx eventloom verify .eventloom/agent-work.jsonl
npx eventloom artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts --title "CI Agent Work"
npx eventloom artifacts verify .eventloom/artifacts/manifest.json
```

Upload both the raw log and the artifact directory. The raw JSONL remains canonical; the bundle is derived for inspection.
The bundle includes verification diagnostics, stats, `query.json`, `inspect.json`, visualizer JSON/HTML, `handoff.md`, `halo.jsonl`, `otlp-traces.json`, and `manifest.json`. The manifest records `inputDigest` for the canonical source JSONL log and SHA-256 file digests for generated artifacts so uploaded or committed bundles can be checked later with `verifyArtifactBundleFiles()`.

## Git Commit And Session Linkage

Use facts to link a journal to source control without relying on commit messages alone:

```bash
GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

npx eventloom append .eventloom/agent-work.jsonl decision.recorded \
  --actor codex \
  --payload "{\"summary\":\"Linked agent journal to git state\",\"evidenceEventIds\":[],\"artifactIds\":[\"git:${GIT_COMMIT}\"],\"gitCommit\":\"${GIT_COMMIT}\",\"gitBranch\":\"${GIT_BRANCH}\"}"
```

If you include an Eventloom artifact path in a commit body or pull request, prefer stable paths such as `.eventloom/agent-work.jsonl` and `.eventloom/artifacts/manifest.json`. The artifact manifest binds those paths together through `inputDigest`, so reviewers can verify that the committed or uploaded bundle still matches the raw append-only session log.
