# Public API Stability

This page defines the package-facing API surface intended to remain stable through the v1.0 line. Eventloom may add exports, but changes to the semantics below require a migration note.

Stable classes, interfaces, and facade functions listed here should carry semantic JSDoc in source so package declaration files preserve the API contract for TypeScript consumers.

## Primary Facade

- `createRuntime(path)` creates an `EventloomRuntime` over a local JSONL log.
- `EventloomRuntime.append()` appends sealed external events.
- `EventloomRuntime.readAll()` reads all parsed events from the local store through the strict event envelope validator.
- `EventloomRuntime.replay()` verifies the log and rebuilds the versioned `eventloom.replay.v1` runtime projection result from the verified prefix.
- `EventloomRuntime.replayCached()` uses an optional projection snapshot cache, falling back to full replay when the cache is stale or invalid.
- `EventloomRuntime.verify()` returns the versioned `eventloom.verify.v1` streaming integrity diagnostics.
- `EventloomRuntime.recoverVerifiedPrefix()` writes a damaged log's verified prefix to a separate path.
- `EventloomRuntime.submitIntention()` submits built-in or configured custom intentions through the orchestrator.
- `EventloomRuntime.run()` runs a custom actor registry and runner map.
- `EventloomRuntime.runBuiltIn()` runs a built-in workflow.
- `EventloomRuntime.exportPathlight()`, `exportHalo()`, `exportOtlp()`, `mailbox()`, and `visualize()` expose read-only integrations and views from the verified prefix of damaged logs. Visualizer and export results preserve source-log integrity diagnostics.

## Core Runtime Primitives

- `JsonlEventStore` is the local append-only JSONL store.
- `JsonlEventStore.append()`, `appendMany()`, and `appendValidated()` are the write paths. `AppendValidator` and `AppendValidationResult` describe the locked compare-and-append validation contract.
- `JsonlEventStore.verify()`, `readVerifiedPrefix()`, `readVerifiedSnapshot()`, and `readVerifiedTail()` are the integrity-aware read paths. `JsonlEventStore.verify()` returns the same versioned `eventloom.verify.v1` report as the runtime facade, CLI, MCP, and artifact-bundle `verify.json`.
- `JsonlEventStore.recoverVerifiedPrefix(outputPath, { quarantinePath })` writes a lock-coordinated verified-prefix artifact and can preserve rejected tail lines in a separate quarantine artifact.
- `EventLogScan` is the structured verified snapshot returned by `readVerifiedSnapshot()` for callers that need both diagnostics and collected verified events.
- `EventStoreReadError`, `EventStoreLockError`, `EventStoreOptionsError`, `EventStoreAppendError`, and `EventStoreRecoveryError` are the stable store error classes for parse failures, append-lock timeouts, invalid store options, corrupt-log append refusal, and unsafe recovery requests.
- `Orchestrator` validates intentions against actor permissions, payload schemas, and projection state before appending accepted events.
- `intentionTypeSchema`, `intentionSchema`, `Intention`, `IntentionType`, `intentionEventTypeMap`, and `validateIntention` describe and validate built-in actor intentions before orchestration.
- `CustomIntentionDefinition` configures additive custom intention types without changing built-in schemas.
- `OrchestratorRejectionCode`, `OrchestratorRejectionCategory`, `ProjectionRejectionKind`, and `ProjectionRejectionDiagnostic` describe stable rejection payload diagnostics for permission, schema, and projection-state failures.
- `ActorRegistry`, `ActorDefinition`, `ActorRegistryError`, `ActorRegistryErrorCode`, `ActorRunner`, `BuiltInWorkflow`, and `runRuntimeLoop()` support custom and built-in actor loops.
- `createBuiltInRegistry`, `createSoftwareWorkRegistry`, `createResearchPipelineRegistry`, and `createHumanOpsRegistry` construct deterministic actor registries for built-in workflows.
- `MailboxItem`, `buildMailbox`, `buildMailboxForActor`, and `processedSourceEvents` expose deterministic mailbox rebuilds from actor subscriptions and `actor.processed` markers.
- `RuntimeProjectionError` reports built-in workflow resume logs whose task, research, or effect projections cannot be trusted. It carries `runtime_projection_failed`, `workflow`, `projectionKind`, and `RuntimeProjectionDiagnostic[]` details.
- `RuntimeOptionsError` reports invalid runtime loop options before workflow logs are mutated. It carries `invalid_runtime_option`, the invalid option name, rejected value, and suggested action.
- `RuntimeRunnerError` reports actor runner failures during runtime turns. It carries `actor_runner_failed` or `actor_runner_invalid_output`, actor and turn identifiers, the source event id, and the underlying cause message.

## Pure Helpers

- Event helpers: `createEvent`, `defaultEventFactory`, `createDeterministicEventFactory`, `validateEvent`, `eventIdSchema`, `actorIdSchema`, `threadIdSchema`, `eventTypeSchema`, `sha256Schema`, `eventIntegritySchema`, `eventEnvelopeSchema`, `EventEnvelope`, `EventValidationIssue`, `EventValidationError`, `EventFactoryOptionsError`, `NewEvent`, `EventFactory`, and `DeterministicEventFactoryOptions`.
- Ingest helpers: `AppendExternalEventInput`, `JsonPayloadParseError`, `appendExternalEvent`, and `parseJsonPayload`.
- Integrity helpers: `sealEvent`, `verifyEventChain`, `hashEvent`, `stripIntegrity`, `SealedEvent`, `IntegrityError`, and `IntegrityReport`.
- Projection helpers: `replay`, `projectionHash`, `canonicalJson`, `eventTypeCounts`, `projectTasks`, `projectResearch`, and `projectEffects`.
- Causal helpers: `eventById` and `causalChain`.
- Runtime projection helpers: `replayEvents`, `projectRuntime`, `applyRuntimeEvent`. `RuntimeReplay` is a stable `eventloom.replay.v1` read model.
- Snapshot helpers: `createProjectionSnapshot`, `replayFromProjectionSnapshot`, `ProjectionSnapshot`, `ProjectionSnapshotOptions`, `SnapshotReplay`, and `SnapshotReplayError`. `ProjectionSnapshot` records prefix `eventIds` so snapshot-tail replay can reject duplicate event ids across the cached prefix and replayed tail.
- Inspection helpers: `buildEventLogInspectionModel`, `EventLogInspectionModel`, `EventLogInspectionSelection`, `buildTimelineModel`, `buildTaskExplanationModel`, `buildMailboxModel`, `formatTimeline`, `formatTaskExplanation`, `formatMailbox`.
- Handoff helpers: `summarizeHandoff`, `formatHandoffSummary`.
- Query and stats helpers: `filterEvents`, `buildEventLogStats`, `buildEventQueryResult`, `EventLogStats`, `EventTypeStat`, `ActorStat`, `ThreadStat`, `EventQuery`, `EventQueryResult`, and `EventSummary`.
- Diff helpers: `diffRuntimeReplays`. `ProjectionDiffReport` is a stable `eventloom.projection-diff.v1` read model.
- Agent workflow template helpers: `AgentWorkflowTemplate`, `AgentWorkflowTemplateEvent`, `getAgentWorkflowTemplate`, `formatAgentWorkflowTemplates`, and `formatAgentWorkflowTemplate`.
- Visualizer helpers: `buildVisualizerModel`, `renderVisualizerHtml`, `VisualizerModel`, `VisualizerCapture`, `VisualizerCaptureEvent`, `VisualizerReplay`, `VisualizerProjection`, and `VisualizerHtmlOptions`.
- Artifact bundle helpers: `writeArtifactBundle`, `buildArtifactBundleVerifyArtifact`, `verifyArtifactBundleFiles`, `ArtifactBundleOptions`, `ArtifactBundleResult`, `ArtifactBundleFiles`, `ArtifactBundleFileDigest`, `ArtifactBundleFileDigests`, `ArtifactBundleVerifyArtifact`, `ArtifactBundleVerificationIssue`, and `ArtifactBundleVerificationResult`. The stable manifest version is `eventloom.artifact-bundle.v1`, `verify.json` uses `eventloom.verify.v1`, verification results use `eventloom.artifact-bundle-verification.v1`, and the bundle includes verification, stats, `query.json`, `inspect.json`, visualizer JSON/HTML, handoff Markdown, HALO JSONL, `otlp-traces.json`, manifest files, an `inputDigest` for the canonical source JSONL log, and SHA-256 file digests for generated artifacts.

## Export Adapters

- Root exports include HALO, OTLP, and Pathlight helpers for common package usage.
- Stable Pathlight symbols: `PathlightExportOptions`, `PathlightExportResult`, `exportToPathlight`, and `PathlightExportError`.
- Stable HALO symbols: `HaloExportOptions`, `HaloExportResult`, `exportToHalo`, `formatHaloJsonl`, and `HaloExportError`.
- Stable OTLP symbols: `OtlpExportOptions`, `OtlpExportResult`, `OtlpPushOptions`, `OtlpPushResult`, `OtlpExportError`, `OtlpResourceSpan`, `OtlpScopeSpan`, `OtlpSpan`, `OtlpKeyValue`, `OtlpAnyValue`, `exportToOtlp`, `formatOtlpJson`, and `pushOtlpJson`.
- Stable export result versions are `eventloom.export.pathlight.v1`, `eventloom.export.halo.v1`, `eventloom.export.otlp.v1`, and `eventloom.export.otlp-push.v1`.
- Export results distinguish source and adapter counts:
  - `exportedEventCount`: Eventloom events represented by the export.
  - `validPrefixCount`: replay-safe source prefix count from the verification report.
  - Pathlight `eventCount`: Pathlight span-event count, not Eventloom source events.
  - `integrity`: the source verification report, including corrupt-tail diagnostics when exporting a verified prefix.
- Low-level `integrityReport` options let callers preserve full source-log diagnostics while exporting an already-loaded verified prefix.
- `RuntimeProvenance` and `collectRuntimeProvenance` expose the package and best-effort Git metadata used by export adapters.
- `PathlightExportError` reports actionable Pathlight adapter failures, including invalid collector URLs, with `code`, `url`, optional `status`, and `suggestedAction`.
- `HaloExportError` reports actionable HALO adapter failures with a stable `code`, message, and `suggestedAction`.
- `OtlpExportError` reports actionable OTLP HTTP delivery failures with `code`, `endpoint`, optional `status`, and `suggestedAction`.
- Subpath exports remain available for adapter-specific imports:
  - `@eventloom/runtime/export/halo`
  - `@eventloom/runtime/export/otlp`
  - `@eventloom/runtime/export/pathlight`

## Stability Notes

The append-only event envelope, hash-chain fields, built-in intention names, built-in event names, CLI command family, MCP contract, and local JSONL storage model are compatibility boundaries for v1.0. The event envelope is strict: unknown top-level envelope fields are invalid instead of being silently stripped.

Custom extension code should keep payloads versioned inside `payload.version` or a domain-specific version field. Do not change the Eventloom envelope to version a domain payload. Add new optional payload fields or new event types when the meaning changes.
