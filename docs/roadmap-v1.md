# Eventloom v1.0.0 Roadmap

Eventloom v1.0 turns the current local-first runtime prototype into a stable foundation for agent work journals, deterministic replay, human-in-the-loop workflows, and observability exports.

The v1 release is a hardening release, not a rewrite. The core architecture remains append-only JSONL, SHA-256 hash-chain integrity, validated intentions, deterministic projections, local file storage, CLI inspection, MCP access, and Pathlight/HALO/OTLP export bridges.

## Current Baseline

The original prototype roadmap is implemented:

- Local JSONL event storage, validation, replay, and projection hashing.
- Task, research, effect, mailbox, causal, and handoff projections.
- Actor registry, intention validation, orchestrated workflows, and processed markers.
- Software-work, research-pipeline, and human-ops demo workflows.
- External event ingestion and tamper-evident event-chain verification.
- Runtime telemetry events for model calls, tool calls, reasoning summaries, and verification facts.
- Pathlight, HALO, and OTLP export adapters.
- MCP package for local agent clients.
- Browser visualizer models for Capture, Replay, and Handoff views.
- Cross-process append locking for local JSONL logs.

Verified local/staged baseline for this roadmap slice:

- `npm test`
- `npm run build`
- `npm run ci:runtime-v1`
- `npm run release:preflight:mcp-v1-staged:local`
- `npm run bench:smoke`
- `npm --prefix packages/mcp test`
- `npm --prefix packages/mcp run build`
- `npm audit --omit=dev`
- `npm --prefix packages/mcp audit --omit=dev`
- `npm run smoke:mcp-local-runtime`
- `npm run smoke:mcp-v1-local-runtime-bin`
- `npm run smoke:custom-workflow-package`
- `npm run smoke:runtime-installed-cli`
- `npm run pack:check`
- `npm pack --dry-run`
- `npm pack --dry-run ./packages/mcp`

Post-runtime-publication MCP baseline:

- `npm run ci:mcp-v1`
- `npm run ci:full-v1`
- `npm run smoke:mcp-installed-bin`

Those MCP-phase commands require npm to resolve `@eventloom/runtime@1.0.0`. Until runtime v1 is published, the current checkout proves MCP v1 readiness through `npm run smoke:mcp-v1-local-runtime-bin` and `npm run release:preflight:mcp-v1-staged:local`.

## Non-Negotiable Invariants

These are stable compatibility boundaries for v1.0:

- The event log remains append-only JSONL.
- Event integrity remains a SHA-256 hash chain using `integrity.hash` and `integrity.previousHash`.
- The event envelope keeps `id`, `type`, `actorId`, `threadId`, `parentEventId`, `causedBy`, `timestamp`, `payload`, and optional `integrity`.
- Unknown top-level event envelope fields are invalid; custom metadata and versioning live inside `payload`.
- Actors emit intentions, not trusted state mutations.
- The orchestrator validates actor permissions, schemas, and projection state before appending accepted events.
- Invalid or rejected intentions append explicit `intention.invalid` or `intention.rejected` events.
- Projections remain pure deterministic reducers over event history.
- Runtime resume continues to rebuild mailboxes from `actor.processed` markers.
- The current public runtime API, CLI command family, MCP tool contract, and Pathlight/HALO/OTLP export bridges remain backward compatible unless a pre-1.0 migration note explicitly says otherwise.

## Phase 0: Release Discipline

Goal: make release readiness executable.

Deliverables:

- Canonical v1.0 roadmap.
- Changelog and semver policy.
- Phase-specific `npm run ci:runtime-v1`, `npm run ci:mcp-v1`, and `npm run ci:full-v1` release gates for the runtime-first and MCP-after-runtime publish sequence.
- The default `npm run ci` currently aliases the runtime-first v1 gate until `@eventloom/runtime@1.0.0` is published and MCP metadata can move to v1.
- Local-runtime-to-MCP smoke test so MCP tests a freshly packed runtime tarball before coordinated release.
- MCP v1 local-runtime staging smoke so a temporary MCP v1 package can run against the packed runtime v1 tarball before npm publication.
- Staged MCP v1 local preflight so temporary MCP metadata and lockfiles can be validated against the packed runtime v1 tarball without weakening the real published-runtime preflight.
- GitHub Actions workflow for the same gate.
- CI-uploaded runtime release evidence that includes a tamper-evident Eventloom agent work log plus a verified artifact bundle manifest bound to the source log by `inputDigest`.
- Production dependency audits passing for runtime and MCP.
- Phase-specific v1 preflight commands for runtime-first and MCP-after-runtime publication.
- Package manifest checks that reject missing, empty, non-executable, or shebang-less CLI bins before publication.

Exit criteria:

- CI proves runtime tests, runtime build, runtime audit, installed runtime CLI smoke, MCP local-runtime compatibility, MCP v1 local-runtime staging, and runtime pack dry-run.
- CI writes `.eventloom/agent-work.jsonl`, exports `.eventloom/artifacts/`, runs `eventloom artifacts verify .eventloom/artifacts/manifest.json`, and uploads the verified bundle with runtime release evidence.
- MCP-phase CI proves MCP tests, MCP build, MCP audit, installed MCP bin smoke, package manifest checks, and MCP package dry-run after runtime v1 is published.
- CI proves MCP package dry-run, package manifest checks, and local runtime tarball compatibility with MCP.
- Release preflight rejects stale or hand-edited MCP runtime lockfile entries before MCP publication.
- Release package checks prove the installed `eventloom` and `eventloom-mcp` bins are present, non-empty, executable in the packed tarball, and start with the Node shebang.
- No high or critical production dependency vulnerabilities.
- Release docs identify package boundaries and release checks.

## Phase 1: Event Store And Integrity Hardening

Goal: make local event logs trustworthy under failure.

Deliverables:

- Explicit append durability using open, write, sync, and close semantics.
- Streaming event parsing and integrity verification for large logs.
- Typed diagnostics for malformed JSON, invalid envelopes, partial trailing lines, hash mismatches, and lock timeouts.
- Safe recovery workflow that can quarantine a bad tail without silently mutating the canonical log.
- CLI `validate` behavior suitable for human and JSON output.
- Tests for partial writes, corrupted lines, hash breaks, concurrent appends, and recovery boundaries.

Implemented baseline:

- Appends fsync event-log file contents and sync newly created log directory entries where supported; verified-prefix recovery writes through exclusive temp files, fsyncs output contents, and syncs recovery directory entries where supported.
- `JsonlEventStore.recoverVerifiedPrefix()` takes the same local lock as append, writes recovery artifacts through exclusive durable temp files, refuses same-path/symlink/existing-output recovery targets, and can preserve rejected physical tail lines with `quarantinePath`.
- `eventloom recover <events.jsonl> --out <recovered.jsonl> --quarantine-tail <bad-tail.jsonl>` exposes the same non-mutating verified-prefix and quarantine workflow for CLI users.
- Streaming diagnostics classify only the final unterminated malformed line as `partial_trailing_line`, report earlier malformed JSON as `malformed_json`, and keep append diagnostics on the physical line that would be written after an unterminated valid log.

Exit criteria:

- Users can diagnose and recover from a damaged local log without guessing.
- Full-log replay remains the source of truth.

## Phase 2: Determinism And Scale

Goal: prove replay stability beyond happy-path demos.

Deliverables:

- Golden fixtures for software work, research, human approval, rejection paths, telemetry-rich logs, and corrupted logs.
- Property-based tests for projection determinism and replay equivalence.
- Large-log benchmarks for append, read, validate, replay, visualize, and export.
- Optional projection snapshots as cache-only acceleration.
- Projection diff tooling for investigating replay changes.

Implemented baseline:

- Deterministic event factories can produce byte-identical built-in workflow logs without changing default runtime behavior.
- Golden fixtures and manifest now cover software-work, research-pipeline, paused human-ops approval, approved-and-applied human-ops resume, orchestrator rejection paths, and corrupt partial-tail diagnostics.
- `npm run fixtures:golden` regenerates deterministic golden logs and `npm run fixtures:golden:check` fails CI when committed golden fixtures drift from generated output.
- Golden and export fixture freshness checks produce versioned `eventloom.fixture-check.v1` release evidence for CI-uploaded fixture reports.
- Property-based replay tests generate task lifecycles and verify sealed JSONL replay matches in-memory replay and visualizer replay hashes.
- `scripts/benchmarks/large-log.ts` and `docs/benchmarks.md` provide reproducible append/read/verify/replay/visualize/export benchmarks, with `bench:smoke` wired into CI, versioned `eventloom.benchmark.v1` `.eventloom-ci/benchmark-smoke-node-<node-version>.json` reports uploaded as release evidence, and larger full/export runs available locally.
- Runtime projection snapshots are available as cache-only sidecar artifacts. `createProjectionSnapshot()`, `replayFromProjectionSnapshot()`, `JsonlEventStore.readVerifiedTail()`, and `runtime.replayCached()` verify anchors and prove snapshot-plus-tail replay matches full replay without changing canonical replay semantics.
- Runtime, CLI, and MCP expose structured projection diff tooling.
- Runtime, CLI, and MCP expose stable stats/query/inspect filtering helpers.
- Append-lock timeout behavior is covered by store, CLI, and MCP regressions using configurable lock retry timing so the typed `EventStoreLockError` path is executable without slowing the suite.
- MCP stdio startup accepts explicit lock timing flags and propagates configured lock timing to built-in workflow runs as well as external appends.

Exit criteria:

- Full replay and snapshot-plus-tail replay produce identical projection hashes.
- Benchmarks are documented and reproducible.

## Phase 3: Typed Errors And Daily DX

Goal: make Eventloom scriptable and predictable.

Deliverables:

- Stable typed error hierarchy across store, parser, integrity, orchestrator, projections, CLI, MCP, and exporters.
- `--json` output for replay, validate, timeline, explain, handoff, mailbox, stats, and export results.
- Consistent error payloads with code, message, path, event id when available, and suggested next action.
- CLI `stats` and stronger query/inspect filtering.
- MCP tool errors that agents can act on without parsing prose.

Implemented baseline:

- `eventloom inspect` and MCP `eventloom_inspect` accept exact type, actor, thread, and limit filters. Filtered inspect responses preserve full-log integrity, stats, and handoff data while narrowing the timeline and adding an explicit `selection` summary.

- `eventloom stats` returns structured counts, integrity, and projection hash.
- JSON-default CLI commands accept an explicit no-op `--json` flag for uniform scripting on `append`, `demo`, `run`, `replay`, `verify`, `validate`, `recover`, `diff`, `stats`, `query`, `inspect`, `visualize`, artifact commands, and export commands.
- `eventloom query` returns filtered event summaries by type, actor, thread, and limit.
- Stats and query read models are explicitly versioned as `eventloom.stats.v1` and `eventloom.query.v1` across package helpers, CLI JSON, MCP structured output, and artifact bundles.
- Replay and projection diff read models are explicitly versioned as `eventloom.replay.v1` and `eventloom.projection-diff.v1` across package helpers, CLI JSON, and MCP structured output.
- `eventloom verify`, `eventloom validate`, `EventloomRuntime.verify()`, `JsonlEventStore.verify()`, and MCP `eventloom_verify` return the explicitly versioned `eventloom.verify.v1` diagnostics model with identical JSON diagnostics and exit codes for the CLI aliases.
- JSON-oriented CLI failures return structured diagnostic payloads with code, message, path, and suggested action.
- `eventloom timeline --limit <n>` bounds large timeline output, and `eventloom timeline --json`, `eventloom explain task --json`, `eventloom mailbox --json`, and `eventloom handoff --json` expose versioned structured output while preserving default text output.
- `eventloom_stats` exposes the stats shape through MCP.
- CLI read-model commands for timeline, task explanation, mailbox, handoff, visualize, and query read the verified prefix of damaged logs and preserve scan diagnostics in structured output.
- MCP read-model tools for timeline, task explanation, mailbox, handoff, and visualize read the verified prefix of damaged logs and preserve scan diagnostics in structured output.
- Task, effect, and research projection errors include stable error codes for invalid payloads, duplicate entities, missing dependencies, and invalid transitions.
- Pathlight export failures now use `PathlightExportError`, HALO provenance failures use `HaloExportError`, and CLI Pathlight export failures map typed errors into actionable JSON diagnostics.
- Runtime, CLI, and MCP Pathlight/HALO export paths export verified prefixes from damaged logs while preserving source-log scan diagnostics in result payloads and trace metadata.
- Runtime, CLI, and MCP OTLP export paths write generic OpenTelemetry trace JSON from the verified prefix while preserving source-log scan diagnostics in result payloads and span attributes.

Exit criteria:

- CLI and MCP users can automate Eventloom without depending on unstable text output.

## Phase 4: Extension Stability

Goal: let developers build custom workflows without reading internals.

Deliverables:

- Public API audit and stable export list.
- JSDoc on stable exported types and functions.
- Guide for custom event types, intentions, actors, projections, workflows, and exporters.
- Minimal custom workflow example.
- Payload versioning guidance that preserves existing logs and the event envelope.

Implemented baseline:

- `CustomIntentionDefinition` lets orchestrator users add custom intention/event pairs, payload schemas, and projection-state validation without changing built-in intention schemas.
- `examples/custom-workflow.ts` is a runnable minimal workflow showing a custom actor, custom intention, custom event, duplicate rejection, verification, and local projection.
- `npm run smoke:custom-workflow-package` packs the runtime and proves an external package consumer can run a custom workflow through `@eventloom/runtime`.
- `docs/public-api.md` inventories the stable package-facing exports and compatibility boundaries.
- Stable package-facing classes, interfaces, and facade functions have semantic JSDoc that is emitted into declaration files and guarded by the release contract test.
- `docs/custom-workflows.md` documents custom event types, intentions, actors, projections, workflow validation, and payload versioning.
- `docs/migration-v1.md` publishes the no-log-migration v1 path and public API freeze notes.

Exit criteria:

- A developer can add a custom workflow from docs alone.
- Public surfaces are clear enough to support semver.

## Phase 5: Observability And Agent Journal Polish

Goal: make Eventloom useful as the repo-local artifact for agent sessions.

Deliverables:

- Pathlight, HALO, and OTLP fixtures for success and negative paths.
- Static HTML export from the visualizer model.
- Cookbook recipes for coding agents, review loops, research workflows, human approvals, CI artifact capture, and Git commit/session linkage.
- GitHub Actions artifact guidance for `.eventloom/*.jsonl`, visualizer JSON, HALO JSONL, and handoff summaries.

Implemented baseline:

- `renderVisualizerHtml()` renders the Capture, Replay, and Handoff visualizer model as a self-contained static HTML document with escaped embedded JSON.
- The visualizer read model is explicitly versioned as `eventloom.visualizer.v1` across runtime, CLI JSON, MCP structured output, static HTML embedded JSON, and artifact bundles.
- `eventloom visualize <events.jsonl> --html <visualizer.html> [--title <title>]` writes a repo-local artifact that can be opened without Pathlight, HALO, or a hosted service.
- `writeArtifactBundle()` and `eventloom artifacts <events.jsonl> --out <artifact-dir>` produce verification JSON, stats JSON, query JSON, inspect JSON, visualizer JSON/HTML, HALO JSONL, OTLP trace JSON, handoff summary, and a manifest with an `inputDigest` for the canonical JSONL log plus generated artifact SHA-256 digests for CI artifact upload or repo-local handoff.
- `node scripts/check-pack-manifests.mjs --json` produces versioned `eventloom.pack-manifests.v1` release evidence for runtime and MCP dry-run package manifests.
- Raw verify results and artifact-bundle `verify.json` are explicitly versioned as `eventloom.verify.v1` and preserve summary fields plus the full source integrity report for offline consumers.
- Artifact-bundle verification results are explicitly versioned as `eventloom.artifact-bundle-verification.v1` across package API, CLI JSON, and MCP structured output.
- Runtime, MCP, full, and staged MCP release-preflight JSON reports are explicitly versioned as `eventloom.release-preflight.v1` for CI and release-candidate evidence.
- Pathlight, HALO, and OTLP export results are explicitly versioned as `eventloom.export.pathlight.v1`, `eventloom.export.halo.v1`, and `eventloom.export.otlp.v1` across package API, CLI JSON, and MCP structured output; OTLP HTTP delivery results are versioned as `eventloom.export.otlp-push.v1`.
- `verifyArtifactBundleFiles()`, `eventloom artifacts verify <manifest.json>`, and `eventloom_verify_artifacts` verify the preserved source log, artifact bundle byte counts, and SHA-256 digests before handoff.
- `docs/agent-journal-cookbook.md` provides recipes for coding agents, review loops, research workflows, human approvals, CI artifact capture, and git commit/session linkage.
- `docs/github-actions-artifacts.md` provides a copyable GitHub Actions workflow that uploads `.eventloom/agent-work.jsonl` and `.eventloom/artifacts/`.
- `fixtures/export/` contains generated Pathlight, HALO, and OTLP success and negative-path fixtures that can be inspected offline without a running collector.
- `eventloom export otlp <events.jsonl> [--out <traces.json>]` and `exportToOtlp()` provide a vendor-neutral OpenTelemetry trace JSON artifact for local upload or inspection.
- `eventloom export otlp <events.jsonl> --endpoint <url>` and `pushOtlpJson()` can deliver the same generated payload to a generic OTLP HTTP traces endpoint without changing the canonical log.
- `docs/otlp-integration.md` documents the CLI, package API, MCP tool, artifact bundle output, verified-prefix behavior, and offline fixtures for the generic OTLP adapter.

Exit criteria:

- A project can preserve agent session history locally, inspect it without a hosted service, and export it when observability tooling is available.

## v1.0.0 Release Gate

Eventloom reaches `1.0.0` when:

- Runtime and MCP tests pass.
- Runtime and MCP builds pass.
- Golden and export fixtures regenerate byte-for-byte with committed fixture artifacts.
- Runtime and MCP production audits pass with no high or critical findings.
- Runtime package dry-run succeeds with the intended files only.
- MCP package dry-run succeeds with the intended files only.
- Public API freeze and migration notes are published.
- Event store corruption and recovery behavior is documented and tested.
- Replay, projection, and export determinism are covered by fixtures and benchmarks.
- README, package docs, MCP docs, and cookbook docs are current.

## Non-Goals For v1.0

- New storage backends.
- Distributed runtime or remote actor scheduling.
- Browser runtime support.
- Heavy plugin framework.
- Breaking the event envelope, hash chain, orchestrator trust boundary, projection semantics, current CLI family, or MCP tool contract.
