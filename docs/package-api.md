# Package API

Eventloom can be used as a library through the `@eventloom/runtime` package without assembling the event store, orchestrator, runners, and projections manually.

The package API is local-first. It reads and writes JSONL event logs directly. Docker Compose is not required for Eventloom itself; it is only useful when you want to run optional infrastructure such as the Pathlight collector and dashboard.

## Install

```bash
npm install @eventloom/runtime
```

## Create a Runtime

```ts
import { createRuntime } from "@eventloom/runtime";

const runtime = createRuntime("/tmp/eventloom.jsonl");
```

`EventloomRuntime` is a small facade around the JSONL store, orchestrator, built-in workflow runners, replay helpers, and Pathlight/HALO/OTLP export.

## Append External Events

```ts
await runtime.append({
  type: "goal.created",
  actorId: "user",
  threadId: "thread_main",
  payload: { title: "Build evented agents" },
});
```

External events are sealed into the append-only hash chain before they are written. Append, read, and verify paths enforce the same strict Eventloom envelope: unknown top-level envelope fields are invalid, while domain-specific extension fields belong inside `payload`.

## Run Built-In Workflows

```ts
await runtime.runBuiltIn("software-work");
await runtime.runBuiltIn("research-pipeline");
await runtime.runBuiltIn("human-ops");
```

Use `resume: true` when continuing from an existing log:

```ts
await runtime.runBuiltIn("human-ops", { resume: true });
```

The built-in workflow names are:

- `software-work`
- `research-pipeline`
- `human-ops`

The stable TypeScript union for these identifiers is `BuiltInWorkflow`.

When a resumed built-in workflow finds invalid projection state, `runBuiltIn()` throws `RuntimeProjectionError` with code `runtime_projection_failed`, the workflow name, `projectionKind`, and structured `projectionErrors`. Invalid runtime loop options throw `RuntimeOptionsError` before mutating workflow logs. Actor runner failures throw `RuntimeRunnerError` with code `actor_runner_failed` or `actor_runner_invalid_output` plus actor, turn, source event, and cause details.

## Replay State

```ts
const replay = await runtime.replay();

console.log(replay.integrity.ok);
console.log(replay.projection.tasks);
console.log(replay.projection.research);
console.log(replay.projection.effects);
console.log(replay.projectionHash);
```

Replay returns a versioned `eventloom.replay.v1` object with the event count, integrity report, combined projections, and deterministic projection hash. If the log has a corrupted tail, `runtime.replay()` returns diagnostics and rebuilds projections from the verified prefix instead of throwing on the first bad line. Stable integrity types include `SealedEvent`, `IntegrityError`, and `IntegrityReport`.

The replay shape is:

```ts
interface RuntimeReplay {
  version: "eventloom.replay.v1";
  eventCount: number;
  integrity: IntegrityReport | EventLogVerificationReport;
  projection: {
    eventTypes: Record<string, number>;
    effects: EffectProjection;
    research: ResearchProjection;
    tasks: TaskProjection;
  };
  projectionHash: string;
}
```

## Diff Replays

Use `diffRuntimeReplays()` to compare two replay results without parsing CLI text:

```ts
import { createRuntime, diffRuntimeReplays } from "@eventloom/runtime";

const left = await createRuntime("fixtures/golden/software-work.jsonl").replay();
const right = await createRuntime("/tmp/software-work.jsonl").replay();
const diff = diffRuntimeReplays(left, right);

console.log(diff.sameProjectionHash);
console.log(diff.eventTypes.changed);
console.log(diff.tasks.changed);
```

The report is stable, versioned `eventloom.projection-diff.v1` JSON and includes per-side event counts, projection hashes, integrity status, event-type count deltas, task changes, and projection errors. Projection errors include `projectionKind` (`task`, `effect`, or `research`) so package consumers can route diagnostics without parsing event type strings.

## Stats And Query

Use `buildEventLogStats()`, `buildEventLogInspectionModel()`, and `filterEvents()` for read-only inspection helpers:

```ts
import { buildEventLogInspectionModel, buildEventLogStats, filterEvents } from "@eventloom/runtime";

const events = await createRuntime("/tmp/eventloom.jsonl").readAll();
const stats = buildEventLogStats(events);
const inspect = buildEventLogInspectionModel(events);
const filteredInspect = buildEventLogInspectionModel(events, undefined, { type: "task.proposed", limit: 10 });
const taskEvents = filterEvents(events, { type: "task.proposed", actorId: "planner" });
```

Stats return a versioned `eventloom.stats.v1` model with sorted event-type, actor, and thread counts plus integrity and projection hash. `EventLogStats`, `EventTypeStat`, `ActorStat`, and `ThreadStat` are the stable stats result types. Use `buildEventQueryResult()` when callers need the versioned `eventloom.query.v1` query model used by CLI and MCP outputs. `EventQuery`, `EventQueryResult`, and `EventSummary` describe query input filters, result envelopes, and stable event summaries suitable for tests and agent clients.

`buildEventLogInspectionModel()` returns a versioned `eventloom.inspect.v1` object that combines integrity, stats, timeline, and handoff summary data for callers that need one compact review payload. The optional third `EventQuery` argument narrows the returned timeline to the selected event window and adds `selection` with `totalEventCount`, `matchedEventCount`, the effective query, and stable event summaries. Full-log stats and handoff data remain unchanged.

## Deterministic Factories

Default runtime behavior still uses fresh ids and wall-clock timestamps. Tests, fixtures, and reproducible demos can opt into deterministic event creation:

```ts
import { createDeterministicEventFactory, runSoftwareWorkRuntime } from "@eventloom/runtime";

await runSoftwareWorkRuntime("/tmp/software-work.jsonl", {
  eventFactory: createDeterministicEventFactory({
    idPrefix: "evt_fixture",
    timestamp: "2026-04-28T22:00:00.000Z",
  }),
});
```

Deterministic factories are additive and do not change the event envelope or hash-chain model. Stable event envelope contracts include `EventEnvelope`, `NewEvent`, `EventFactory`, `DeterministicEventFactoryOptions`, `EventValidationIssue`, `EventValidationError`, `EventFactoryOptionsError`, `eventIdSchema`, `actorIdSchema`, `threadIdSchema`, `eventTypeSchema`, `sha256Schema`, `eventIntegritySchema`, and `eventEnvelopeSchema`.

## Verify And Recover Logs

Use `verify()` when you need structured corruption diagnostics without loading the whole log through strict parsing:

```ts
const report = await runtime.verify();

console.log(report.version);
console.log(report.ok);
console.log(report.validPrefixCount);
console.log(report.diagnostics);
```

`runtime.verify()` and `JsonlEventStore.verify()` return the versioned `eventloom.verify.v1` report used by CLI `eventloom verify`, CLI `eventloom validate`, MCP `eventloom_verify`, and artifact-bundle `verify.json`.

Use `recoverVerifiedPrefix()` to write the verified prefix to a separate output path:

```ts
await runtime.recoverVerifiedPrefix("/tmp/eventloom.recovered.jsonl");
await runtime.recoverVerifiedPrefix("/tmp/eventloom.recovered.jsonl", {
  quarantinePath: "/tmp/eventloom.bad-tail.jsonl",
});
```

Recovery is non-destructive, uses the same local lock as append, writes outputs through an exclusive durable path, and refuses to write to the same path as the source log or overwrite an existing output. Eventloom fsyncs appended log contents and recovery outputs; when a write creates a new log or recovery artifact, it also syncs the containing directory entry on platforms that support directory fsync. `quarantinePath` preserves the rejected physical tail lines for later inspection without mutating the canonical log. When the verified prefix covers the full source log, `quarantinePath` creates an empty durable artifact so callers can depend on stable recovery outputs. Existing recovered or quarantine paths fail with `EventStoreRecoveryError` code `recovery_output_exists` before any recovery output is written. Appends also refuse to continue a log whose existing contents fail streaming verification.

## Build Visualizer Views

```ts
const visualizer = await runtime.visualize();

console.log(visualizer.capture.events);
console.log(visualizer.replay.integrity.ok);
console.log(visualizer.handoff.nextActions);
```

`runtime.visualize()` returns the structured, versioned `eventloom.visualizer.v1` `VisualizerModel` used by visualizer UIs:

- `version`: currently `eventloom.visualizer.v1`.
- `capture`: ordered events with compact summaries and hash-chain fields.
- `replay`: integrity, projections, event count, and projection hash.
- `handoff`: the same handoff summary produced by `summarizeHandoff`.

The runtime facade reads the verified prefix for this read-only view. If the log has a corrupt tail, `replay.integrity` and `handoff.integrity` preserve the source-log diagnostics while `capture` contains only recoverable events.

For in-memory logs, use the pure helper:

```ts
import { buildVisualizerModel } from "@eventloom/runtime";

const visualizer = buildVisualizerModel(events);
```

To persist a self-contained static artifact, render that model to HTML with optional `VisualizerHtmlOptions`:

```ts
import { buildVisualizerModel, renderVisualizerHtml } from "@eventloom/runtime";

const html = renderVisualizerHtml(buildVisualizerModel(events), {
  title: "Agent session",
});
```

The renderer embeds the visualizer model as escaped inert JSON and uses only inline HTML/CSS, so the output can be saved as a repository artifact or CI artifact without a hosted service.

Stable visualizer types include `VisualizerModel`, `VisualizerCapture`, `VisualizerCaptureEvent`, `VisualizerReplay`, `VisualizerProjection`, and `VisualizerHtmlOptions`. The top-level model version lets CLI, MCP, static HTML, and artifact-bundle consumers detect the visualizer read-model contract without inferring it from nested fields.

## Write Artifact Bundles

```ts
import { verifyArtifactBundleFiles, writeArtifactBundle } from "@eventloom/runtime";

const result = await writeArtifactBundle({
  inputPath: ".eventloom/agent-work.jsonl",
  outDir: ".eventloom/artifacts",
  title: "Agent work",
});

const verification = await verifyArtifactBundleFiles(result);
```

The bundle contains `verify.json`, `stats.json`, `query.json`, `inspect.json`, `visualizer.json`, `visualizer.html`, `handoff.md`, `halo.jsonl`, `otlp-traces.json`, and `manifest.json`. It is designed for repository-local handoffs and CI artifact upload. The manifest includes `inputDigest` for the canonical source JSONL log plus `fileDigests` with byte counts and SHA-256 hashes for generated artifacts other than the manifest itself, so uploaded or committed bundles can be checked later. `verify.json` preserves the versioned `eventloom.verify.v1` source-integrity artifact with both summary fields and the full nested integrity report. `query.json` preserves the versioned `eventloom.query.v1` event-summary read model for offline filtering handoffs, and `inspect.json` preserves the consolidated `eventloom.inspect.v1` model for offline review. `buildArtifactBundleVerifyArtifact()` builds the same verification artifact shape for package consumers. `verifyArtifactBundleFiles()` checks the source log and generated files and returns the versioned `eventloom.artifact-bundle-verification.v1` result with stable `invalid_manifest`, `missing_file`, `unreadable_file`, `byte_count_mismatch`, and `sha256_mismatch` issues without verifying the self-describing manifest file. The same check is available through `eventloom artifacts verify <manifest.json>` and the MCP `eventloom_verify_artifacts` tool for automation. Each file is written through a same-directory temporary file, flushed, atomically renamed into place, and followed by a best-effort containing-directory sync on platforms that support directory fsync.

## Projection Snapshot Cache

Projection snapshots are optional derived artifacts for large local logs. They are not appended to the canonical event log and they do not replace hash-chain verification.

```ts
import {
  createProjectionSnapshot,
  createRuntime,
  replayFromProjectionSnapshot,
} from "@eventloom/runtime";

const runtime = createRuntime(".eventloom/agent-work.jsonl");
const events = await runtime.readAll();
const snapshot = createProjectionSnapshot(events.slice(0, 1_000));

const replay = replayFromProjectionSnapshot(snapshot, events.slice(1_000));
console.log(replay.projectionHash);
```

For file-backed logs, use the runtime cache path so Eventloom verifies the current log and only accepts the snapshot when its anchor hash still matches:

```ts
const replay = await runtime.replayCached({ snapshot });

if (!replay.cache.hit) {
  console.log(replay.cache.reason);
}
```

`ProjectionSnapshot` records the snapshotted prefix event ids, event count, last event id, last event hash, projection state, and projection hash. `replayFromProjectionSnapshot()` rejects tails that do not continue from the snapshot hash or that reuse an event id from the snapshot prefix.

`replayCached()` falls back to full verified replay for stale anchors, unsupported snapshot formats, snapshot hash mismatches, or log integrity diagnostics. A cache hit applies only the verified tail to the cached projection state, while full replay remains the source of truth.

Stable snapshot types include `ProjectionSnapshot`, `ProjectionSnapshotOptions`, `SnapshotReplay`, and `SnapshotReplayError`.

## Submit Intentions

For custom actor registries, submit intentions through the runtime facade:

```ts
import { ActorRegistry, createRuntime } from "@eventloom/runtime";

const actors = new ActorRegistry();
actors.register({
  id: "planner",
  role: "Plan tasks",
  subscriptions: ["goal.created"],
  intentions: ["task.propose"],
});

const result = await createRuntime("/tmp/eventloom.jsonl").submitIntention(actors, {
  type: "task.propose",
  actorId: "planner",
  threadId: "thread_main",
  parentEventId: "evt_goal",
  causedBy: ["evt_goal"],
  payload: { taskId: "task_1", title: "Write tests" },
});
```

The orchestrator validates actor permissions and projection state before accepting events. `Intention`, `IntentionType`, `intentionTypeSchema`, `intentionSchema`, `intentionEventTypeMap`, and `validateIntention` expose the built-in intention contract used before orchestration. Rejected submissions still append an explicit rejection event. `OrchestratorRejectionCode`, `OrchestratorRejectionCategory`, `ProjectionRejectionKind`, and `ProjectionRejectionDiagnostic` are the stable diagnostic types for permission, schema, and projection-state failures.

For domain-specific intentions and events, configure custom intention definitions on `Orchestrator`:

```ts
import { ActorRegistry, JsonlEventStore, Orchestrator } from "@eventloom/runtime";
import { z } from "zod";

const actors = new ActorRegistry();
actors.register({
  id: "notetaker",
  role: "Capture durable notes",
  subscriptions: ["goal.created"],
  intentions: ["note.add"],
});

const orchestrator = new Orchestrator(new JsonlEventStore("/tmp/notes.jsonl"), actors, {
  customIntentions: [
    {
      type: "note.add",
      eventType: "note.added",
      payloadSchema: z.object({
        noteId: z.string().min(1),
        body: z.string().min(1),
        version: z.literal(1),
      }),
      validateEvent(events, event) {
        return events.some((existing) => existing.type === "note.added" && existing.payload.noteId === event.payload.noteId)
          ? `Note ${event.payload.noteId} already exists`
          : null;
      },
    },
  ],
});
```

The runnable [custom workflow example](custom-workflows.md) shows this pattern end to end.

## Run Custom Actors

```ts
await runtime.run(actorRegistry, actorRunners, { maxIterations: 10 });
```

Custom runners receive actor context, a rebuilt mailbox, and the current event history. They return structured intentions; they do not mutate state directly.

```ts
const runners = {
  planner: ({ mailbox }) => mailbox.map((item) => ({
    type: "task.propose",
    actorId: "planner",
    threadId: item.event.threadId,
    parentEventId: item.event.id,
    causedBy: [item.event.id],
    payload: { taskId: "task_1", title: "Write tests" },
  })),
};
```

Built-in registries can be reused directly with `createBuiltInRegistry`, `createSoftwareWorkRegistry`, `createResearchPipelineRegistry`, and `createHumanOpsRegistry`. Registry failures use `ActorRegistryError` with `ActorRegistryErrorCode` values such as `actor_duplicate` and `actor_not_registered`.

For custom event domains, add `CustomIntentionDefinition.validateEvent()` before relying on the orchestrator as a state-machine boundary.

## Rebuild Actor Mailboxes

Use the package facade to inspect pending mailbox items for a built-in workflow actor:

```ts
const mailbox = await runtime.mailbox("software-work", "worker");
```

The mailbox is rebuilt from the verified prefix of the event log. Events already marked as processed by the actor are omitted, task events include projected task context when available, and corrupt tails do not prevent inspection of recoverable pending work.

For lower-level custom workflow tests and tools, `MailboxItem`, `buildMailbox`, `buildMailboxForActor`, and `processedSourceEvents` expose the same deterministic mailbox rebuild semantics used by the runtime loop.

## Export to Pathlight

```ts
await runtime.exportPathlight({
  baseUrl: "http://localhost:4100",
  traceName: "eventloom-run",
});
```

Pathlight export returns the versioned `eventloom.export.pathlight.v1` result. It includes integrity status, projection hash, projection kinds, thread IDs, runtime package metadata, and git provenance when available. The runtime facade reads the verified prefix, so damaged logs can still export recoverable events while the returned `integrity`, `validPrefixCount`, and `exportedEventCount` fields preserve the original scan result.

Result shape:

```ts
{
  version: "eventloom.export.pathlight.v1";
  traceId: string;
  spanCount: number;
  eventCount: number; // Pathlight span events
  exportedEventCount: number; // Eventloom events exported
  validPrefixCount: number;
  integrity: EventLogVerificationReport | IntegrityReport;
}
```

## Export to HALO

```ts
import { formatHaloJsonl } from "@eventloom/runtime";

const result = await runtime.exportHalo({
  projectId: "eventloom",
  serviceName: "eventloom-agent-work",
  traceName: "eventloom-agent-work",
});

const jsonl = formatHaloJsonl(result);
```

HALO export returns the versioned `eventloom.export.halo.v1` result. It projects the Eventloom log into OpenTelemetry-shaped JSONL spans with HALO's required `inference.*` attributes. The returned result includes the generated spans so callers can write them to disk or inspect them in tests. The runtime facade reads the verified prefix and carries corrupt-tail diagnostics into the returned `integrity` report and root span attributes.

Result shape:

```ts
{
  version: "eventloom.export.halo.v1";
  projectId: string;
  traceId: string;
  traceCount: number;
  spanCount: number;
  exportedEventCount: number;
  validPrefixCount: number;
  integrity: EventLogVerificationReport | IntegrityReport;
  spans: HaloSpanRecord[];
}
```

## Export to OTLP

```ts
import { formatOtlpJson, pushOtlpJson } from "@eventloom/runtime";

const result = await runtime.exportOtlp({
  serviceName: "eventloom-agent-work",
  traceName: "eventloom-agent-work",
});

const json = formatOtlpJson(result);

await pushOtlpJson(result, {
  endpoint: "http://localhost:4318/v1/traces",
});
```

OTLP export returns the versioned `eventloom.export.otlp.v1` result. It projects the Eventloom log into generic OpenTelemetry trace JSON with `resourceSpans`, `scopeSpans`, and spans that carry Eventloom task, telemetry, integrity, and provenance attributes. The runtime facade reads the verified prefix and carries corrupt-tail diagnostics into the returned `integrity` report and root span attributes. `pushOtlpJson()` returns a separate delivery result versioned as `eventloom.export.otlp-push.v1`; `formatOtlpJson()` keeps the OTLP wire payload as the unwrapped `resourceSpans` document.

Result shape:

```ts
{
  version: "eventloom.export.otlp.v1";
  traceCount: number;
  spanCount: number;
  exportedEventCount: number;
  validPrefixCount: number;
  integrity: EventLogVerificationReport | IntegrityReport;
  resourceSpans: OtlpResourceSpan[];
}
```

## Lower-Level Exports

The public package still exports the lower-level modules for advanced use:

- `JsonlEventStore`
- `Orchestrator`
- `ActorRegistry`
- `runRuntimeLoop`
- `projectTasks`
- `projectResearch`
- `projectEffects`
- `eventById`
- `causalChain`
- `RuntimeProvenance`
- `collectRuntimeProvenance`
- `AgentWorkflowTemplate`
- `AgentWorkflowTemplateEvent`
- `getAgentWorkflowTemplate`
- `formatAgentWorkflowTemplates`
- `formatAgentWorkflowTemplate`
- `exportToHalo`
- `formatHaloJsonl`
- `exportToOtlp`
- `formatOtlpJson`
- `exportToPathlight`
- `buildVisualizerModel`

`JsonlEventStore.append(event)` remains the compatibility path for one sealed event at a time. For high-volume local generation, `JsonlEventStore.appendMany(events)` validates the batch, takes the file lock once, verifies the existing log once, rejects duplicate ids before writing, seals the batch as one contiguous hash-chain segment, and durably appends the JSONL lines with one file sync. A process or OS failure can still leave a partial trailing line or partial batch tail; verification and recovery treat that as a damaged tail rather than silently accepting it as committed state.

`JsonlEventStore.appendValidated(event, validate)` is the lower-level compare-and-append primitive for projection-sensitive writers. It takes the same file lock used by append, scans the current verified log with events collected, runs the `AppendValidator` callback against that locked snapshot, and only then seals and appends the event. It returns `AppendValidationResult`, either the sealed event or a rejection reason plus optional diagnostic. Validators should be deterministic and must not call lock-taking store methods on the same log.

## Typed Errors

The store exposes typed errors for common operational failures:

- `EventStoreReadError` includes the log path and failing line when strict parsing fails.
- `EventStoreLockError` includes the log path when an append lock cannot be acquired before timeout.
- `EventStoreOptionsError` reports invalid `JsonlEventStoreOptions`, such as negative or fractional lock timing values.
- `EventStoreAppendError` includes the verification report when Eventloom refuses to append onto a corrupt log or duplicate event id.
- `EventStoreRecoveryError` reports unsafe recovery paths, such as writing the recovered prefix over the source log or overwriting an existing recovery artifact.

The Pathlight adapter throws `PathlightExportError` for invalid collector URLs, failed collector requests, or invalid collector responses. The error includes a stable `code`, target `url`, optional HTTP `status`, and a `suggestedAction` suitable for CLI and MCP diagnostics.

The HALO adapter throws `HaloExportError` when required export context, such as runtime provenance, cannot be collected. The error includes a stable `code` and `suggestedAction`.

Built-in workflow resumes throw `RuntimeProjectionError` when existing task, research, or effect projection state is invalid. The error includes stable code `runtime_projection_failed`, `workflow`, `projectionKind`, and projection diagnostics suitable for CLI and MCP responses. Invalid runtime loop options throw `RuntimeOptionsError` with code `invalid_runtime_option`, the invalid option name, the rejected value, and a suggested action. Actor runner failures throw `RuntimeRunnerError` with code `actor_runner_failed` or `actor_runner_invalid_output`, plus actor id, turn id, source event id, and the original cause message.

Projection errors in task, effect, and research projections include stable codes:

- `invalid_payload`
- `duplicate_entity`
- `missing_dependency`
- `invalid_transition`

`JsonlEventStore` accepts optional non-negative integer lock timing settings:

```ts
const store = new JsonlEventStore(".eventloom/agent-work.jsonl", {
  lockTimeoutMs: 1_000,
  lockRetryMs: 10,
});
```

The CLI and MCP server also read `EVENTLOOM_LOCK_TIMEOUT_MS` and `EVENTLOOM_LOCK_RETRY_MS` as non-negative integer millisecond values. The CLI applies them to external appends and built-in runtime `run` commands, and invalid CLI environment values return `invalid_cli_option` diagnostics with the rejected option and value. Leave them unset for the production defaults of `5000` and `10`.

`parseJsonPayload()` throws `JsonPayloadParseError` with code `invalid_json_payload` when a CLI-style payload string is malformed JSON or does not parse to an object. The CLI preserves that code in structured append diagnostics.

CLI option diagnostics preserve rejected values. For example, `eventloom query --limit <n>` requires a positive integer and invalid values return `invalid_cli_option` with `option`, `value`, and a targeted suggested action. Invalid top-level invocations, unknown and missing parser options, and missing command arguments include the rejected `option` when Eventloom can identify it; missing values also include the rejected following `value` when the next token is another option. Fixed-shape commands reject extra options or positional arguments with the same structured diagnostic shape. Pathlight `--base-url` diagnostics use the same shape for invalid collector URLs before the CLI reads the source log or opens a network connection.
