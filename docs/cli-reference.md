# CLI Reference

Run the published CLI without installing it into the current project:

```bash
npm exec --package @eventloom/runtime -- eventloom <command>
```

Or install the published package first:

```bash
npm install @eventloom/runtime
npx eventloom <command>
```

When developing from the repository root, run the source CLI with:

```bash
npm run eventloom -- <command>
```

The repository CLI entrypoint is `src/cli.ts`.

## `help`

Print CLI usage and exit successfully.

```bash
npx eventloom help
npx eventloom --help
```

Use this when a structured diagnostic suggests checking command arguments. Invalid commands still print usage on stderr and exit nonzero, while explicit help prints usage and exits successfully.

## `replay`

Replay an event log, verify integrity, and print projections.

```bash
npx eventloom replay <events.jsonl> [--json]
```

Example:

```bash
npx eventloom replay fixtures/sample.jsonl
```

Output is a versioned `eventloom.replay.v1` object and includes:

- `version`
- `eventCount`
- `integrity`
- `projection.eventTypes`
- `projection.effects`
- `projection.research`
- `projection.tasks`
- `projectionHash`

If the log has a malformed or corrupted tail, replay returns structured integrity diagnostics and rebuilds projections from the verified prefix instead of throwing away the whole log.

`replay` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `verify`

Stream-verify an event log and print structured diagnostics.

```bash
npx eventloom verify <events.jsonl> [--json]
```

Output is a versioned `eventloom.verify.v1` object and includes:

- `version`
- `ok`
- `eventCount`
- `validPrefixCount`
- `lastGoodLine`
- `lastGoodHash`
- `diagnostics`

The command exits nonzero when diagnostics are present. Malformed JSON, schema-invalid events, unknown top-level envelope fields, missing integrity metadata, duplicate event ids, previous-hash mismatches, and event hash mismatches are reported with line context.

`verify` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `validate`

Alias for `verify`.

```bash
npx eventloom validate <events.jsonl> [--json]
```

`validate` prints the same versioned `eventloom.verify.v1` JSON diagnostics and uses the same exit code as `verify`.

## `recover`

Write the verified prefix of a damaged log to a separate output path.

```bash
npx eventloom recover <events.jsonl> --out <recovered.jsonl> [--json]
npx eventloom recover <events.jsonl> --out <recovered.jsonl> --quarantine-tail <bad-tail.jsonl> [--json]
```

Recovery is non-destructive. It never truncates or rewrites the source log, takes the same local lock as append, writes recovery artifacts through an exclusive durable path, and refuses to overwrite existing outputs. Use `--quarantine-tail` to preserve the rejected physical tail lines for inspection while writing the verified prefix to a clean log. When the source log is already fully verified, `--quarantine-tail` still creates an empty quarantine artifact so automation can rely on a stable output set. Existing recovered or quarantine paths fail with `recovery_output_exists` before any recovery artifact is written.

`recover` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `diff`

Replay two logs and print a structured projection diff.

```bash
npx eventloom diff <left.jsonl> <right.jsonl> [--json]
```

The diff is a versioned `eventloom.projection-diff.v1` object. It includes projection hashes, event counts, integrity status for each side, event-type count changes, task additions/removals/status changes, and projection errors. Projection errors include `projectionKind` (`task`, `effect`, or `research`) so callers can route diagnostics without parsing event types. Use this when comparing a regenerated fixture, resumed workflow, or alternate agent run against a known baseline.

`diff` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `stats`

Print stable JSON counts and hashes for a log.

```bash
npx eventloom stats <events.jsonl> [--json]
```

Output is a versioned `eventloom.stats.v1` object with event count, integrity, projection hash, sorted event-type counts, sorted actor counts, and sorted thread counts.

`stats` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `query`

Filter events and print stable JSON summaries.

```bash
npx eventloom query <events.jsonl> [--type <event.type>] [--actor <actorId>] [--thread <threadId>] [--limit <n>] [--json]
```

Filters are exact-match and read-only. `--limit` returns the last matching events and must be a positive integer. Invalid limits exit with `invalid_cli_option` and include the rejected `option` and `value`.

Output is a versioned `eventloom.query.v1` object with `count`, source scan report in `integrity`, and stable `events`. `query` reads the verified prefix of the log, so callers can still inspect recoverable events when a damaged tail is present.

`query` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `inspect`

Print a consolidated JSON inspection model for a log.

```bash
npx eventloom inspect <events.jsonl> [--type <event.type>] [--actor <actorId>] [--thread <threadId>] [--limit <n>] [--json]
```

Output is a versioned `eventloom.inspect.v1` object that combines the verified-prefix `integrity` report, stable `stats`, ordered `timeline`, and agent `handoff` summary in one read-only result. Use this when scripts or agent clients need a compact health and review snapshot without making separate `stats`, `timeline`, and `handoff` calls.

The optional filters match `query`: exact `--type`, `--actor`, and `--thread` filters plus a positive-integer `--limit` for the last matching events. When filters are present, `stats` and `handoff` still describe the full verified prefix while `timeline` is narrowed to the selected event window and `selection` records `totalEventCount`, `matchedEventCount`, the effective query, and stable event summaries.

`inspect` reads the verified prefix of the log. If the file has a corrupt tail, the returned model still includes the recoverable events and preserves the source scan diagnostics in top-level `integrity`, `stats.integrity`, `timeline.integrity`, and `handoff.integrity`.

`inspect` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `append`

Append a sealed external event.

```bash
npx eventloom append <events.jsonl> <event.type> [--actor <actorId>] [--payload '<json>'] [--json]
```

Flags:

- `--id <eventId>`: explicit event id. Omit this for a generated id.
- `--actor <actorId>`: actor that emitted the event. Defaults to `external`.
- `--thread <threadId>`: thread identifier. Defaults to `thread_main`.
- `--parent <eventId>`: direct parent event id.
- `--caused-by <eventId,eventId>`: causal dependencies.
- `--payload '<json>'`: event payload. Defaults to `{}` and must be valid JSON object text when provided. Malformed JSON exits with `invalid_json_payload`.

Examples:

```bash
npx eventloom append /tmp/eventloom.jsonl goal.created --actor user --payload '{"title":"External goal"}'
```

```bash
npx eventloom append /tmp/eventloom-human-ops.jsonl approval.granted --actor human --thread thread_ops --payload '{"effectId":"effect_runtime_mitigation","approvalId":"approval_runtime_mitigation"}'
```

Output includes the new event id, hash, and previous hash.

`append` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

Append refuses to write onto an existing log when streaming verification reports corruption. Recover the verified prefix and optionally quarantine the damaged tail first.

If another writer holds the append lock for too long, append and built-in `run` commands exit with structured JSON diagnostics using `event_store_lock_timeout`. Retry after the active writer finishes or inspect the stale `<events.jsonl>.lock` file if no writer is running.

For automated tests or constrained local workflows, set `EVENTLOOM_LOCK_TIMEOUT_MS` and `EVENTLOOM_LOCK_RETRY_MS` to non-negative integer millisecond values. Defaults are `5000` and `10`, and the CLI applies them to `append`, `run software-work`, `run research-pipeline`, and `run human-ops`. Invalid lock timing environment values exit with `invalid_cli_option` and include the rejected `option` and `value`.

Append also rejects duplicate event ids before writing. This preserves the replay invariant that every event id identifies a single event in the verified prefix.

CLI failures return a structured error payload on stderr with `code`, `message`, `path` when available, and `suggestedAction`. Invalid top-level invocations, such as missing required command arguments or unknown commands, also use this JSON diagnostic shape. Option parser failures include the rejected `option` when Eventloom can identify it; missing values also include the rejected following `value` when the next token is another option. Fixed-shape commands reject extra options or positional arguments instead of silently ignoring them. Export adapter diagnostics can include additional actionable fields; for example, Pathlight failures include the collector `url` and HTTP `status` when available.

Built-in `run` commands also preserve runtime loop diagnostics. Invalid loop options exit with `invalid_runtime_option` and include the rejected option and value before mutating the target log. Invalid resume projection state exits with `runtime_projection_failed` and includes `workflow`, `projectionKind`, and `projectionErrors`. Actor runner failures exit with `actor_runner_failed` or `actor_runner_invalid_output` and include actor, turn, source event, and cause details.

## `demo software-work`

Generate a deterministic software-work demo log.

```bash
npx eventloom demo software-work [events.jsonl] [--json]
```

If no path is given, Eventloom writes `.eventloom/events.jsonl`.

`demo software-work` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `run software-work`

Run the deterministic software-work actor loop.

```bash
npx eventloom run software-work [events.jsonl] [--resume] [--max-iterations <n>] [--json]
```

Without `--resume`, the target log is replaced. With `--resume`, Eventloom continues from the existing log and skips actor mailbox items already marked as processed. Use `--max-iterations` to bound the actor loop for tests or constrained local runs.

`run software-work` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `run research-pipeline`

Run the deterministic research actor loop.

```bash
npx eventloom run research-pipeline [events.jsonl] [--resume] [--max-iterations <n>] [--json]
```

Default path: `.eventloom/research-events.jsonl`.

The final projection is available under `projection.research`.

`run research-pipeline` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `run human-ops`

Run the deterministic human approval workflow.

```bash
npx eventloom run human-ops [events.jsonl] [--resume] [--max-iterations <n>] [--json]
```

Default path: `.eventloom/human-ops-events.jsonl`.

The first run stops after `approval.requested`. Append an `approval.granted` event and resume to apply the effect.

`run human-ops` always prints JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `timeline`

Print an ordered event timeline with integrity status.

```bash
npx eventloom timeline <events.jsonl>
npx eventloom timeline <events.jsonl> --limit <n>
npx eventloom timeline <events.jsonl> --json
```

Each line includes:

- ordinal
- event id
- actor id
- event type
- parent event id when present

With `--json`, output is a versioned `eventloom.timeline.v1` object with `eventCount`, `integrity`, and ordered event entries including ids, type, actor, thread, parent, causality, timestamp, and integrity hashes.

Use `--limit <n>` to print only the last `n` events from the verified prefix. The limit must be a positive integer and works with both text and JSON output.

`timeline` reads the verified prefix of the log. If the file has a corrupt tail, JSON output still returns the recoverable events and preserves the original scan diagnostics in `integrity`.

## `explain task`

Explain task state from projection history and causal chain.

```bash
npx eventloom explain task <taskId> <events.jsonl>
npx eventloom explain task <taskId> <events.jsonl> --json
```

Example:

```bash
npx eventloom explain task task_actor_runtime /tmp/eventloom-software.jsonl
```

With `--json`, output is a versioned `eventloom.task-explanation.v1` object containing `found`, `taskId`, `task`, ordered `history`, ordered `causalChain`, projection errors, and the verified-prefix `integrity` report.

## `mailbox`

Show a rebuilt actor mailbox for the software-work registry.

```bash
npx eventloom mailbox <actorId> <events.jsonl>
npx eventloom mailbox <actorId> <events.jsonl> --json
```

Example:

```bash
npx eventloom mailbox worker /tmp/eventloom-software.jsonl
```

With `--json`, output is a versioned `eventloom.mailbox.v1` object with the workflow, actor id, count, event references, task context for each mailbox item, and verified-prefix `integrity` report.

## `handoff`

Summarize goals, tasks, projection errors, decisions, verification, releases, risks, recent facts, model/tool telemetry, reasoning summaries, observability gaps, event type counts, and next actions from an Eventloom log.

```bash
npx eventloom handoff <events.jsonl>
npx eventloom handoff <events.jsonl> --json
```

Example:

```bash
npx eventloom handoff .eventloom/agent-work.jsonl
```

With `--json`, output is a versioned `eventloom.handoff.v1` object containing the same typed summary used by the package API: event counts, integrity, goals, active/completed tasks, facts, telemetry, observability gaps, and next actions.

`handoff` reads the verified prefix of the log. If the file has a corrupt tail, JSON output keeps the original diagnostics in `integrity` while projections are derived from the recoverable prefix.

## `visualize`

Build the structured, versioned `eventloom.visualizer.v1` model used by visualizer UIs. The output contains the same three views shown on the site: captured events, replay projection, and handoff summary.

```bash
npx eventloom visualize <events.jsonl> [--json]
npx eventloom visualize <events.jsonl> --html <visualizer.html> [--title <title>] [--json]
```

Output shape:

- `version`
- `capture.eventCount`
- `capture.eventTypes`
- `capture.events`
- `replay.integrity`
- `replay.projection`
- `replay.projectionHash`
- `handoff`

`visualize` reads the verified prefix of the log and carries the original scan report through `replay.integrity` and `handoff.integrity`. Static HTML exports are therefore safe to generate from a damaged log while still showing that the source file needs recovery.

With `--html`, Eventloom writes a self-contained static visualizer artifact and prints a JSON status object:

- `out`
- `eventCount`
- `projectionHash`

If the `--html` path includes directories that do not exist yet, Eventloom creates them before writing the file.

`visualize` always prints JSON, either the full visualizer model or an HTML-write status object. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

## `artifacts`

Write a complete repo-local artifact bundle for CI uploads, handoffs, or later inspection.

```bash
npx eventloom artifacts <events.jsonl> --out <artifact-dir> [--title <title>] [--json]
npx eventloom artifacts verify <manifest.json> [--json]
```

The command writes:

- `verify.json`
- `stats.json`
- `query.json`
- `inspect.json`
- `visualizer.json`
- `visualizer.html`
- `handoff.md`
- `halo.jsonl`
- `otlp-traces.json`
- `manifest.json`

The bundle is built from the verified prefix of the log. If the log has a corrupt tail, every derived artifact remains based on the recoverable prefix while `verify.json`, `manifest.json`, `query.json`, `inspect.json`, `visualizer.json`, embedded `visualizer.html`, `handoff.md`, `halo.jsonl`, and `otlp-traces.json` preserve the source diagnostics for review. `verify.json` is a versioned `eventloom.verify.v1` artifact with summary fields and the full nested integrity report.

`manifest.json` includes `inputDigest` for the canonical source JSONL log and `fileDigests` with byte counts and SHA-256 hashes for generated artifacts other than the manifest itself. Use those digests, or the package API `verifyArtifactBundleFiles()`, to verify an uploaded or committed bundle before relying on derived evidence.

`artifacts verify` reads an artifact bundle manifest, checks the source JSONL log against `inputDigest` and generated artifact files against `fileDigests`, prints a versioned `eventloom.artifact-bundle-verification.v1` JSON result with `ok`, `checkedFiles`, and `issues`, and exits nonzero when the manifest digest metadata is invalid or any file is missing, unreadable, has a byte-count mismatch, or has a SHA-256 mismatch.

`artifacts` and `artifacts verify` always print JSON. `--json` is accepted as an explicit no-op for scripts that use a uniform machine-output flag.

Each bundle file is written through a same-directory temporary file, flushed, atomically renamed into place, and followed by a best-effort containing-directory sync on platforms that support directory fsync.

## `templates`

List or inspect starter templates for common agent workflows.

```bash
npx eventloom templates
npx eventloom templates <templateId>
```

Available templates:

- `coding-task`
- `review-task`
- `release-task`
- `research-task`

## `export pathlight`

Export an Eventloom log to a Pathlight collector.

```bash
npx eventloom export pathlight <events.jsonl> [--base-url <url>] [--trace-name <name>] [--json]
```

Defaults:

- `--base-url`: `http://localhost:4100`
- `--trace-name`: `eventloom-runtime`

`--base-url` must be an absolute `http://` or `https://` URL. Invalid values are rejected before Eventloom reads the source log or opens a network connection, and diagnostics include the rejected `option` and `value`.

The export creates:

- one Pathlight trace
- one agent span per `actor.started` / `actor.completed` turn
- for external agent journals without actor turns, one task lifecycle span per projected task
- span events for related Eventloom events

Command output is versioned as `eventloom.export.pathlight.v1`. Trace metadata includes integrity, projection hash, projection kinds, runtime package metadata, thread IDs, and git provenance when available. If the source log has a corrupt tail, export uses the verified prefix, marks `integrity.ok: false`, and includes `validPrefixCount` and `exportedEventCount` in command output.

## `export halo`

Export an Eventloom log to a HALO-compatible OpenTelemetry JSONL trace file.

```bash
npx eventloom export halo <events.jsonl> [--out <traces.jsonl>] [--project-id <id>] [--service-name <name>] [--trace-name <name>] [--json]
```

Defaults:

- `--out`: `eventloom-halo-traces.jsonl`
- `--project-id`: `eventloom`
- `--service-name`: `eventloom`
- `--trace-name`: `eventloom.log`

Command output is versioned as `eventloom.export.halo.v1`. The export creates one trace with a root log span, task lifecycle spans, and high-level fact spans for goals, decisions, verification, release, and risk events.

If the `--out` path includes directories that do not exist yet, Eventloom creates them before writing the file.

If the source log has a corrupt tail, export uses the verified prefix, marks the HALO root span as an error, and preserves scan diagnostics in root span attributes plus command output fields `integrity`, `validPrefixCount`, and `exportedEventCount`.

Validate the output with a local HALO checkout:

```bash
python /home/cheapseatsecon/Projects/GitHub-Clone/HALO/demo/openai-agents-sdk-demo/verify_traces.py <traces.jsonl>
```

## `export otlp`

Export an Eventloom log to generic OpenTelemetry OTLP trace JSON.

```bash
npx eventloom export otlp <events.jsonl> [--out <traces.json>] [--endpoint <url>] [--service-name <name>] [--service-version <version>] [--trace-name <name>] [--json]
```

Defaults:

- `--out`: `eventloom-otlp-traces.json`
- `--service-name`: `eventloom`
- `--trace-name`: `eventloom.log`

Command output is versioned as `eventloom.export.otlp.v1`. The export creates one OTLP `resourceSpans` payload with a root log span plus task, telemetry, and fact spans derived from the same Eventloom projection semantics as the HALO adapter. If the source log has a corrupt tail, export uses the verified prefix and preserves scan diagnostics in the returned `integrity`, `validPrefixCount`, and `exportedEventCount` fields.

If the `--out` path includes directories that do not exist yet, Eventloom creates them before writing the file.

Use `--endpoint <url>` to also POST the generated JSON payload to a generic OTLP HTTP traces endpoint such as `http://localhost:4318/v1/traces`. The internal delivery result is versioned as `eventloom.export.otlp-push.v1`, while CLI stdout remains the export result version. Delivery failures return structured diagnostics with `otlp_invalid_endpoint`, `otlp_request_failed`, or `otlp_response_failed`.
