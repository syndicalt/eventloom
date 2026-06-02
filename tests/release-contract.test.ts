import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;
}

describe("release contract", () => {
  it("documents the v1 roadmap and changelog", () => {
    expect(existsSync(join(root, "docs/roadmap-v1.md"))).toBe(true);
    expect(existsSync(join(root, "CHANGELOG.md"))).toBe(true);
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");

    expect(roadmap).toContain("npm run bench:smoke");
    expect(roadmap).toContain(".eventloom-ci/benchmark-smoke-node-<node-version>.json");
    expect(roadmap).toContain("npm run pack:check");
    expect(roadmap).toContain("npm run smoke:custom-workflow-package");
    expect(roadmap).toContain("npm run smoke:runtime-installed-cli");
    expect(roadmap).toContain("Verified local/staged baseline for this roadmap slice");
    expect(roadmap).toContain("Post-runtime-publication MCP baseline");
    expect(roadmap).toContain("npm run smoke:mcp-installed-bin");
    expect(roadmap).toContain("Those MCP-phase commands require npm to resolve `@eventloom/runtime@1.0.0`");
    expect(roadmap).toContain("MCP package dry-run succeeds");
    expect(roadmap).toContain("Unknown top-level event envelope fields are invalid");
    expect(roadmap).toContain("non-executable");
    expect(roadmap).toContain("executable in the packed tarball");
    expect(roadmap).toContain("JSON-default CLI commands accept an explicit no-op `--json` flag for uniform scripting on `append`, `demo`, `run`, `replay`, `verify`, `validate`, `recover`, `diff`, `stats`, `query`, `inspect`, `visualize`, artifact commands, and export commands.");
  });

  it("publishes v1 migration notes and current release gates", () => {
    const packageJson = readJson("package.json");
    const files = packageJson.files as string[];
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");
    const migration = readFileSync(join(root, "docs", "migration-v1.md"), "utf8");
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

    expect(files).not.toContain("docs/release.md");
    expect(files).toContain("docs/migration-v1.md");
    expect(release).toContain("npm run bench:smoke");
    expect(release).toContain("invalid_release_preflight_option");
    expect(release).toContain("invalid_staged_mcp_preflight_option");
    expect(release).toContain("distinguish release argument mistakes from failed release checks");
    expect(release).toContain("invalid_fixture_generator_option");
    expect(release).toContain("distinguish argument mistakes from fixture drift");
    expect(release).toContain("Fixture drift checks accept `--json`");
    expect(release).toContain("invalid_fixture_check_option");
    expect(release).toContain("eventloom.release-preflight.v1");
    expect(release).toContain("npm run smoke:custom-workflow-package");
    expect(release).toContain("eventloom-runtime-1.0.0.tgz");
    expect(migration).toContain("# Migrating To Eventloom v1.0.0");
    expect(migration).toContain("No log migration is required");
    expect(migration).toContain("Public API freeze");
    expect(migration).toContain("Unknown top-level event envelope fields are invalid");
    expect(migration).toContain("npx eventloom recover .eventloom/agent-work.jsonl --out .eventloom/agent-work.recovered.jsonl");
    expect(migration).toContain("quarantine file is created as an empty artifact");
    expect(migration).toContain("recovery_output_exists");
    expect(migration).toContain("Pathlight/HALO/OTLP export bridges");
    expect(migration).toContain("npx eventloom export otlp .eventloom/agent-work.jsonl --out .eventloom/otlp-traces.json");
    expect(changelog).toContain("v1.0 migration notes");
    expect(changelog).toContain("## 1.0.0");
    expect(changelog).toContain("runtime package is now staged as `@eventloom/runtime@1.0.0`");
    expect(changelog).toContain("MCP package remains `0.1.6`");
    expect(changelog).toContain("MCP v1 local-runtime staging smoke");
    expect(changelog).toContain("verified-prefix recovery");
    expect(changelog).toContain("projection snapshots");
    expect(changelog).toContain("static HTML visualizer");
    expect(changelog).toContain("generic OTLP trace JSON export");
    expect(changelog).toContain("Pathlight/HALO/OTLP artifacts");
    expect(changelog).toContain("Pathlight/HALO/OTLP export fixtures");
    expect(changelog).toContain("release preflight");
    expect(changelog).toContain("eventloom.release-preflight.v1");
    expect(changelog).toContain("archived benchmark smoke JSON reports");
    expect(changelog).toContain("archived artifact-bundle verification JSON reports");
    expect(changelog).toContain("parseable manifest digest proof");
    expect(changelog).toContain("`inputDigest` to artifact bundle manifests");
    expect(changelog).toContain("public API JSDoc");
    expect(changelog).toContain("stable recovery output semantics");
    expect(changelog).toContain("installed runtime CLI, installed MCP bin, and staged MCP v1 smoke tests");
    expect(changelog).toContain("verify generated artifact bundle manifests");
    expect(changelog).toContain("source-log `inputDigest`");
    expect(changelog).toContain("all ten source-log plus generated artifact digests");
    expect(changelog).toContain("Added `inspect.json` to artifact bundles");
  });

  it("documents stable recovery quarantine output semantics", () => {
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const userGuide = readFileSync(join(root, "docs", "user-guide.md"), "utf8");

    expect(cliReference).toContain("creates an empty quarantine artifact");
    expect(cliReference).toContain("Existing recovered or quarantine paths fail with `recovery_output_exists`");
    expect(packageApi).toContain("creates an empty durable artifact");
    expect(packageApi).toContain("EventStoreRecoveryError` code `recovery_output_exists`");
    expect(mcpPackage).toContain("creates an empty quarantine artifact");
    expect(mcpPackage).toContain("structured `recovery_output_exists` error");
    expect(userGuide).toContain("writes an empty quarantine file");
  });

  it("documents local append lock timeout configuration", () => {
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");

    for (const text of [cliReference, packageApi, mcpPackage]) {
      expect(text).toContain("EVENTLOOM_LOCK_TIMEOUT_MS");
      expect(text).toContain("EVENTLOOM_LOCK_RETRY_MS");
    }
    expect(cliReference).toContain("Invalid lock timing environment values");
    expect(cliReference).toContain("rejected `option` and `value`");
    expect(cliReference).toContain("Invalid top-level invocations");
    expect(cliReference).toContain("Option parser failures include the rejected `option`");
    expect(cliReference).toContain("missing values also include the rejected following `value`");
    expect(cliReference).toContain("Fixed-shape commands reject extra options or positional arguments");
    expect(cliReference).toContain("Invalid limits exit with `invalid_cli_option`");
    expect(cliReference).toContain("diagnostics include the rejected `option` and `value`");
    expect(packageApi).toContain("invalid CLI environment values return `invalid_cli_option` diagnostics");
    expect(packageApi).toContain("CLI option diagnostics preserve rejected values");
    expect(packageApi).toContain("Invalid top-level invocations, unknown and missing parser options, and missing command arguments include the rejected `option`");
    expect(packageApi).toContain("missing values also include the rejected following `value`");
    expect(packageApi).toContain("Fixed-shape commands reject extra options or positional arguments");
    expect(packageApi).toContain("Pathlight `--base-url` diagnostics use the same shape");
    expect(mcpPackage).toContain("append and built-in workflow runs");
    expect(mcpPackage).toContain("invalid_mcp_server_option");
    expect(mcpPackage).toContain("Schema validation failures use `invalid_tool_input`");
    expect(mcpPackage).toContain("first rejected input `option` plus its rejected `value`");
    expect(mcpPackage).toContain("Tool-level numeric validation also uses `invalid_tool_input`");
    expect(mcpPackage).toContain("Invalid limits return `invalid_tool_input` with the rejected `option` and `value`");
    expect(mcpPackage).toContain("Invalid startup lock timing");
    expect(mcpPackage).toContain("Unknown or missing stdio startup options use the same structured code");
    expect(mcpPackage).toContain("Unexpected stdio startup failures use JSON stderr diagnostics");
  });

  it("keeps semantic JSDoc on stable public API exports", () => {
    const requiredDocs = [
      { path: "src/runtime.ts", exportName: "RuntimeProjection" },
      { path: "src/runtime.ts", exportName: "RuntimeReplay" },
      { path: "src/runtime.ts", exportName: "RuntimeCachedReplay" },
      { path: "src/runtime.ts", exportName: "RuntimeReplayCacheOptions" },
      { path: "src/runtime.ts", exportName: "RuntimeRunOptions" },
      { path: "src/runtime.ts", exportName: "EventloomRuntime" },
      { path: "src/runtime.ts", exportName: "createRuntime" },
      { path: "src/runtime.ts", exportName: "runBuiltInWorkflow" },
      { path: "src/runtime.ts", exportName: "replayEvents" },
      { path: "src/runtime.ts", exportName: "projectRuntime" },
      { path: "src/runtime.ts", exportName: "applyRuntimeEvent" },
      { path: "src/events.ts", exportName: "eventIdSchema" },
      { path: "src/events.ts", exportName: "actorIdSchema" },
      { path: "src/events.ts", exportName: "threadIdSchema" },
      { path: "src/events.ts", exportName: "eventTypeSchema" },
      { path: "src/events.ts", exportName: "sha256Schema" },
      { path: "src/events.ts", exportName: "eventIntegritySchema" },
      { path: "src/events.ts", exportName: "eventEnvelopeSchema" },
      { path: "src/events.ts", exportName: "EventEnvelope" },
      { path: "src/events.ts", exportName: "EventValidationIssue" },
      { path: "src/events.ts", exportName: "EventValidationError" },
      { path: "src/events.ts", exportName: "EventFactoryOptionsError" },
      { path: "src/events.ts", exportName: "NewEvent" },
      { path: "src/events.ts", exportName: "EventFactory" },
      { path: "src/events.ts", exportName: "DeterministicEventFactoryOptions" },
      { path: "src/events.ts", exportName: "createEvent" },
      { path: "src/events.ts", exportName: "defaultEventFactory" },
      { path: "src/events.ts", exportName: "createDeterministicEventFactory" },
      { path: "src/events.ts", exportName: "validateEvent" },
      { path: "src/ingest.ts", exportName: "AppendExternalEventInput" },
      { path: "src/ingest.ts", exportName: "JsonPayloadParseError" },
      { path: "src/ingest.ts", exportName: "appendExternalEvent" },
      { path: "src/ingest.ts", exportName: "parseJsonPayload" },
      { path: "src/intentions.ts", exportName: "intentionTypeSchema" },
      { path: "src/intentions.ts", exportName: "intentionSchema" },
      { path: "src/intentions.ts", exportName: "Intention" },
      { path: "src/intentions.ts", exportName: "IntentionType" },
      { path: "src/intentions.ts", exportName: "intentionEventTypeMap" },
      { path: "src/intentions.ts", exportName: "validateIntention" },
      { path: "src/integrity.ts", exportName: "SealedEvent" },
      { path: "src/integrity.ts", exportName: "IntegrityError" },
      { path: "src/integrity.ts", exportName: "IntegrityReport" },
      { path: "src/integrity.ts", exportName: "sealEvent" },
      { path: "src/integrity.ts", exportName: "verifyEventChain" },
      { path: "src/integrity.ts", exportName: "hashEvent" },
      { path: "src/integrity.ts", exportName: "stripIntegrity" },
      { path: "src/projection.ts", exportName: "replay" },
      { path: "src/projection.ts", exportName: "projectionHash" },
      { path: "src/projection.ts", exportName: "canonicalJson" },
      { path: "src/projection.ts", exportName: "eventTypeCounts" },
      { path: "src/causal.ts", exportName: "eventById" },
      { path: "src/causal.ts", exportName: "causalChain" },
      { path: "src/task-projection.ts", exportName: "projectTasks" },
      { path: "src/research-projection.ts", exportName: "projectResearch" },
      { path: "src/effect-projection.ts", exportName: "projectEffects" },
      { path: "src/query.ts", exportName: "EventLogStats" },
      { path: "src/query.ts", exportName: "EventTypeStat" },
      { path: "src/query.ts", exportName: "ActorStat" },
      { path: "src/query.ts", exportName: "ThreadStat" },
      { path: "src/query.ts", exportName: "EventQuery" },
      { path: "src/query.ts", exportName: "EventQueryResult" },
      { path: "src/query.ts", exportName: "EventSummary" },
      { path: "src/query.ts", exportName: "buildEventLogStats" },
      { path: "src/query.ts", exportName: "buildEventQueryResult" },
      { path: "src/query.ts", exportName: "filterEvents" },
      { path: "src/inspect.ts", exportName: "EventLogInspectionModel" },
      { path: "src/inspect.ts", exportName: "EventLogInspectionSelection" },
      { path: "src/inspect.ts", exportName: "buildEventLogInspectionModel" },
      { path: "src/inspect.ts", exportName: "buildTimelineModel" },
      { path: "src/inspect.ts", exportName: "formatTimeline" },
      { path: "src/inspect.ts", exportName: "buildTaskExplanationModel" },
      { path: "src/inspect.ts", exportName: "formatTaskExplanation" },
      { path: "src/inspect.ts", exportName: "buildMailboxModel" },
      { path: "src/inspect.ts", exportName: "formatMailbox" },
      { path: "src/handoff.ts", exportName: "summarizeHandoff" },
      { path: "src/handoff.ts", exportName: "formatHandoffSummary" },
      { path: "src/projection-diff.ts", exportName: "diffRuntimeReplays" },
      { path: "src/snapshots.ts", exportName: "ProjectionSnapshot" },
      { path: "src/snapshots.ts", exportName: "ProjectionSnapshotOptions" },
      { path: "src/snapshots.ts", exportName: "SnapshotReplay" },
      { path: "src/snapshots.ts", exportName: "SnapshotReplayError" },
      { path: "src/snapshots.ts", exportName: "createProjectionSnapshot" },
      { path: "src/snapshots.ts", exportName: "replayFromProjectionSnapshot" },
      { path: "src/visualizer.ts", exportName: "VisualizerModel" },
      { path: "src/visualizer.ts", exportName: "VisualizerCapture" },
      { path: "src/visualizer.ts", exportName: "VisualizerCaptureEvent" },
      { path: "src/visualizer.ts", exportName: "VisualizerReplay" },
      { path: "src/visualizer.ts", exportName: "VisualizerProjection" },
      { path: "src/visualizer.ts", exportName: "VisualizerHtmlOptions" },
      { path: "src/visualizer.ts", exportName: "buildVisualizerModel" },
      { path: "src/visualizer.ts", exportName: "renderVisualizerHtml" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleOptions" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleResult" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleFiles" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleFileDigest" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleFileDigests" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleVerifyArtifact" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleVerificationIssue" },
      { path: "src/artifacts.ts", exportName: "ArtifactBundleVerificationResult" },
      { path: "src/artifacts.ts", exportName: "buildArtifactBundleVerifyArtifact" },
      { path: "src/artifacts.ts", exportName: "writeArtifactBundle" },
      { path: "src/artifacts.ts", exportName: "verifyArtifactBundleFiles" },
      { path: "src/event-store.ts", exportName: "EventLogDiagnostic" },
      { path: "src/event-store.ts", exportName: "EventLogVerificationReport" },
      { path: "src/event-store.ts", exportName: "EventLogRecoveryResult" },
      { path: "src/event-store.ts", exportName: "JsonlEventStoreOptions" },
      { path: "src/event-store.ts", exportName: "EventLogRecoveryOptions" },
      { path: "src/event-store.ts", exportName: "EventLogTailAnchor" },
      { path: "src/event-store.ts", exportName: "EventLogTailSnapshot" },
      { path: "src/event-store.ts", exportName: "AppendValidationResult" },
      { path: "src/event-store.ts", exportName: "AppendValidator" },
      { path: "src/event-store.ts", exportName: "EventLogScan" },
      { path: "src/event-store.ts", exportName: "EventStoreReadError" },
      { path: "src/event-store.ts", exportName: "EventStoreLockError" },
      { path: "src/event-store.ts", exportName: "EventStoreOptionsError" },
      { path: "src/event-store.ts", exportName: "EventStoreAppendError" },
      { path: "src/event-store.ts", exportName: "EventStoreRecoveryError" },
      { path: "src/event-store.ts", exportName: "JsonlEventStore" },
      { path: "src/orchestrator.ts", exportName: "OrchestratorResult" },
      { path: "src/orchestrator.ts", exportName: "OrchestratorRejectionCode" },
      { path: "src/orchestrator.ts", exportName: "OrchestratorRejectionCategory" },
      { path: "src/orchestrator.ts", exportName: "ProjectionRejectionKind" },
      { path: "src/orchestrator.ts", exportName: "ProjectionRejectionDiagnostic" },
      { path: "src/orchestrator.ts", exportName: "CustomIntentionDefinition" },
      { path: "src/orchestrator.ts", exportName: "OrchestratorOptions" },
      { path: "src/orchestrator.ts", exportName: "Orchestrator" },
      { path: "src/actors.ts", exportName: "BuiltInWorkflow" },
      { path: "src/actors.ts", exportName: "ActorRegistryErrorCode" },
      { path: "src/actors.ts", exportName: "ActorRegistryError" },
      { path: "src/actors.ts", exportName: "ActorDefinition" },
      { path: "src/actors.ts", exportName: "ActorRegistry" },
      { path: "src/actors.ts", exportName: "createSoftwareWorkRegistry" },
      { path: "src/actors.ts", exportName: "createBuiltInRegistry" },
      { path: "src/actors.ts", exportName: "createResearchPipelineRegistry" },
      { path: "src/actors.ts", exportName: "createHumanOpsRegistry" },
      { path: "src/mailbox.ts", exportName: "MailboxItem" },
      { path: "src/mailbox.ts", exportName: "buildMailbox" },
      { path: "src/mailbox.ts", exportName: "buildMailboxForActor" },
      { path: "src/mailbox.ts", exportName: "processedSourceEvents" },
      { path: "src/runners.ts", exportName: "ActorRunnerContext" },
      { path: "src/runners.ts", exportName: "RuntimeLoopResult" },
      { path: "src/runners.ts", exportName: "RuntimeLoopOptions" },
      { path: "src/runners.ts", exportName: "BuiltInRuntimeOptions" },
      { path: "src/runners.ts", exportName: "RuntimeProjectionDiagnostic" },
      { path: "src/runners.ts", exportName: "ActorRunner" },
      { path: "src/runners.ts", exportName: "RuntimeOptionsError" },
      { path: "src/runners.ts", exportName: "RuntimeRunnerError" },
      { path: "src/runners.ts", exportName: "RuntimeProjectionError" },
      { path: "src/runners.ts", exportName: "runRuntimeLoop" },
      { path: "src/export/pathlight.ts", exportName: "PathlightExportOptions" },
      { path: "src/export/pathlight.ts", exportName: "PathlightExportResult" },
      { path: "src/export/pathlight.ts", exportName: "PathlightExportError" },
      { path: "src/export/pathlight.ts", exportName: "exportToPathlight" },
      { path: "src/export/halo.ts", exportName: "HaloExportOptions" },
      { path: "src/export/halo.ts", exportName: "HaloExportResult" },
      { path: "src/export/halo.ts", exportName: "HaloExportError" },
      { path: "src/export/halo.ts", exportName: "exportToHalo" },
      { path: "src/export/halo.ts", exportName: "formatHaloJsonl" },
      { path: "src/export/otlp.ts", exportName: "OtlpExportOptions" },
      { path: "src/export/otlp.ts", exportName: "OtlpExportResult" },
      { path: "src/export/otlp.ts", exportName: "OtlpPushOptions" },
      { path: "src/export/otlp.ts", exportName: "OtlpPushResult" },
      { path: "src/export/otlp.ts", exportName: "OtlpExportError" },
      { path: "src/export/otlp.ts", exportName: "exportToOtlp" },
      { path: "src/export/otlp.ts", exportName: "formatOtlpJson" },
      { path: "src/export/otlp.ts", exportName: "pushOtlpJson" },
      { path: "src/provenance.ts", exportName: "RuntimeProvenance" },
      { path: "src/provenance.ts", exportName: "collectRuntimeProvenance" },
      { path: "src/templates.ts", exportName: "AgentWorkflowTemplate" },
      { path: "src/templates.ts", exportName: "AgentWorkflowTemplateEvent" },
      { path: "src/templates.ts", exportName: "getAgentWorkflowTemplate" },
      { path: "src/templates.ts", exportName: "formatAgentWorkflowTemplates" },
      { path: "src/templates.ts", exportName: "formatAgentWorkflowTemplate" },
    ];

    for (const required of requiredDocs) {
      const source = readFileSync(join(root, required.path), "utf8");
      expect(hasLeadingJsDoc(source, required.exportName), `${required.path} ${required.exportName}`).toBe(true);
    }
  });

  it("keeps semantic JSDoc on stable EventloomRuntime facade methods", () => {
    const source = readFileSync(join(root, "src", "runtime.ts"), "utf8");

    for (const methodName of [
      "append",
      "readAll",
      "replay",
      "replayCached",
      "verify",
      "recoverVerifiedPrefix",
      "submitIntention",
      "run",
      "runBuiltIn",
      "exportPathlight",
      "exportHalo",
      "mailbox",
      "visualize",
    ]) {
      expect(hasLeadingMethodJsDoc(source, methodName), `EventloomRuntime.${methodName}`).toBe(true);
    }
  });

  it("keeps semantic JSDoc on stable ActorRegistry methods", () => {
    const source = readFileSync(join(root, "src", "actors.ts"), "utf8");

    for (const methodName of ["register", "get", "require", "all"]) {
      expect(hasLeadingMethodJsDoc(source, methodName), `ActorRegistry.${methodName}`).toBe(true);
    }
  });

  it("documents stable orchestrator rejection diagnostics", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of [
      "OrchestratorRejectionCode",
      "OrchestratorRejectionCategory",
      "ProjectionRejectionKind",
      "ProjectionRejectionDiagnostic",
    ]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable root ingest helpers", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");

    for (const symbol of ["AppendExternalEventInput", "JsonPayloadParseError", "appendExternalEvent", "parseJsonPayload"]) {
      expect(publicApi).toContain(symbol);
    }
  });

  it("documents stable mailbox rebuild helpers", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of ["MailboxItem", "buildMailbox", "buildMailboxForActor", "processedSourceEvents"]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable actor registry helpers", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of [
      "ActorRegistryErrorCode",
      "ActorRegistryError",
      "createSoftwareWorkRegistry",
      "createBuiltInRegistry",
      "createResearchPipelineRegistry",
      "createHumanOpsRegistry",
    ]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable built-in intention helpers", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of [
      "intentionTypeSchema",
      "intentionSchema",
      "Intention",
      "IntentionType",
      "intentionEventTypeMap",
      "validateIntention",
    ]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable query and stats types", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of ["EventLogStats", "EventTypeStat", "ActorStat", "ThreadStat", "EventQuery", "EventQueryResult", "EventSummary", "buildEventQueryResult"]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable event envelope schemas and types", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of [
      "eventIdSchema",
      "actorIdSchema",
      "threadIdSchema",
      "eventTypeSchema",
      "sha256Schema",
      "eventIntegritySchema",
      "eventEnvelopeSchema",
      "EventEnvelope",
      "EventValidationIssue",
      "EventValidationError",
      "EventFactoryOptionsError",
      "NewEvent",
      "EventFactory",
      "DeterministicEventFactoryOptions",
    ]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable appendValidated contract types", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of ["AppendValidationResult", "AppendValidator"]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable integrity report types", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of ["SealedEvent", "IntegrityError", "IntegrityReport"]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("ships docs linked from the packaged README files", () => {
    const packageJson = readJson("package.json");
    const files = packageJson.files as string[];
    const mcpPackageJson = readJson("packages/mcp/package.json");
    const mcpFiles = mcpPackageJson.files as string[];
    const mcpReadme = readFileSync(join(root, "packages", "mcp", "README.md"), "utf8");

    expect(files).toEqual([
      "dist",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
      "docs/README.md",
      "docs/benchmarks.md",
      "docs/package-api.md",
      "docs/public-api.md",
      "docs/custom-workflows.md",
      "docs/agent-journal-cookbook.md",
      "docs/github-actions-artifacts.md",
      "docs/migration-v1.md",
      "docs/cli-reference.md",
      "docs/user-guide.md",
      "docs/agent-integration.md",
      "docs/case-studies",
      "docs/architecture.md",
      "docs/event-model.md",
      "docs/workflows.md",
      "docs/pathlight-integration.md",
      "docs/halo-integration.md",
      "docs/otlp-integration.md",
      "fixtures/sample.jsonl",
      "fixtures/export",
      "examples/custom-workflow.ts",
      "fixtures/golden",
    ]);
    expect(mcpFiles).toEqual(["dist", "README.md", "LICENSE"]);
    expect(mcpReadme).not.toContain("../../docs/");
    expect(mcpReadme).toContain("https://github.com/syndicalt/eventloom/blob/master/docs/mcp-setup.md");
  });

  it("keeps the packaged docs index current with v1 release docs", () => {
    const docsIndex = readFileSync(join(root, "docs", "README.md"), "utf8");

    expect(docsIndex).toContain("[Migration Notes](migration-v1.md)");
    expect(docsIndex).toContain("[Release Checklist](https://github.com/syndicalt/eventloom/blob/master/docs/release.md)");
    expect(docsIndex).toContain("[OTLP Integration](otlp-integration.md)");
    expect(docsIndex).toContain("[Product Spec](https://github.com/syndicalt/eventloom/blob/master/docs/product-spec.md): historical MVP target");
    expect(docsIndex).toContain("[Stack Review](https://github.com/syndicalt/eventloom/blob/master/docs/stack-review.md): historical stack decision note");
  });

  it("marks early planning docs as historical next to current v1 docs", () => {
    const productSpec = readFileSync(join(root, "docs", "product-spec.md"), "utf8");
    const stackReview = readFileSync(join(root, "docs", "stack-review.md"), "utf8");

    expect(productSpec).toContain("Status: historical product specification.");
    expect(productSpec).toContain("[Eventloom v1.0.0 Roadmap](roadmap-v1.md)");
    expect(productSpec).toContain("[Public API](public-api.md)");
    expect(productSpec).toContain("[Migration Notes](migration-v1.md)");

    expect(stackReview).toContain("Status: historical stack decision note.");
    expect(stackReview).toContain("[Eventloom v1.0.0 Roadmap](roadmap-v1.md)");
    expect(stackReview).toContain("[Public API](public-api.md)");
    expect(stackReview).toContain("[Release Checklist](release.md)");
  });

  it("ships usable source maps without requiring unpackaged source files", () => {
    const packageJson = readJson("package.json");
    const files = packageJson.files as string[];
    const tsconfig = readJson("tsconfig.json");
    const mcpTsconfig = readJson("packages/mcp/tsconfig.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>;
    const mcpCompilerOptions = mcpTsconfig.compilerOptions as Record<string, unknown>;

    expect(files).not.toContain("src");
    expect(scripts["build:runtime"]).toBe("node scripts/clean-dist.mjs dist && tsc && node scripts/chmod-cli-bins.mjs dist/cli.js");
    expect(scripts["build:mcp"]).toBe("npm run build:runtime && npm --prefix packages/mcp run build");
    expect(compilerOptions.sourceMap).toBe(true);
    expect(compilerOptions.declarationMap).toBe(false);
    expect(compilerOptions.inlineSources).toBe(true);
    expect(mcpCompilerOptions.sourceMap).toBe(true);
    expect(mcpCompilerOptions.declarationMap).toBe(false);
    expect(mcpCompilerOptions.inlineSources).toBe(true);
  });

  it("keeps packaged README files current with the v1 runtime surface", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const mcpReadme = readFileSync(join(root, "packages", "mcp", "README.md"), "utf8");

    expect(readme).toContain("stable foundation for local agent workflows");
    expect(readme).toContain("verified-prefix recovery");
    expect(readme).toContain("static HTML visualizer");
    expect(readme).toContain("artifact bundle");
    expect(readme).toContain("eventloom artifacts verify .eventloom/artifacts/manifest.json");
    expect(readme).toContain("HALO");
    expect(readme).toContain("OTLP");
    expect(readme).toContain("MCP");
    expect(readme).toContain("npm run release:preflight:runtime-v1");
    expect(readme).toContain("npm run ci:runtime-v1");
    expect(readme).toContain("npm run smoke:mcp-v1-local-runtime-bin");
    expect(readme).toContain("npm run ci:full-v1");
    expect(readme).toContain("Before the runtime package is published, use the runtime-first gate plus the staged MCP local preflight");
    expect(readme).toContain("npm run release:preflight:mcp-v1-staged:local");
    expect(readme).toContain("After `@eventloom/runtime@1.0.0` is published");
    expect(readme).toContain("docs/migration-v1.md");
    expect(readme).toContain("docs/public-api.md");
    expect(readme).toContain("docs/custom-workflows.md");
    expect(readme).toContain("npm exec --package @eventloom/runtime -- eventloom append");
    expect(readme).toContain("eventloom recover");
    expect(readme).toContain("eventloom inspect");
    expect(readme).toContain("eventloom query");
    expect(readme).toContain("eventloom export otlp");
    expect(readme).toContain("inspect.json");
    expect(readme).toContain("eventloom.inspect.v1");
    expect(readme).toContain("docs/otlp-integration.md");
    expect(readme).toContain("validPrefixCount");
    expect(readme).not.toContain("npx eventloom append");
    expect(readme).not.toContain("currently a runtime prototype");
    expect(readme).not.toContain("MVP Quickstart");
    expect(readme).not.toContain("being hardened into");

    expect(mcpReadme).toContain("verified-prefix diagnostics");
    expect(mcpReadme).toContain("structuredContent");
    expect(mcpReadme).toContain("@eventloom/runtime");
    expect(mcpReadme).toContain("The checked-in MCP package remains `0.1.6`");
    expect(mcpReadme).toContain("publish the runtime package first");
    expect(mcpReadme).toContain("move MCP metadata and its runtime dependency to `1.0.0`/`^1.0.0`");
    expect(mcpReadme).toContain("EVENTLOOM_MCP_ROOT");
    expect(mcpReadme).toContain("EVENTLOOM_LOCK_TIMEOUT_MS");
    expect(mcpReadme).toContain("--lock-timeout-ms");
    expect(mcpReadme).toContain("--lock-retry-ms");
    expect(mcpReadme).toContain("invalid_mcp_server_option");
    expect(mcpReadme).toContain("Invalid, unknown, or incomplete startup options");
    expect(mcpReadme).toContain("mcp_server_start_failed");
    expect(mcpReadme).toContain("eventloom_recover");
    expect(mcpReadme).toContain("eventloom_inspect");
    expect(mcpReadme).toContain("eventloom_query");
    expect(mcpReadme).toContain("eventloom_export_halo");
    expect(mcpReadme).toContain("integrity");
    expect(mcpReadme).toContain("exportedEventCount");
    expect(mcpReadme).toContain("validPrefixCount");

    const server = readFileSync(join(root, "packages", "mcp", "src", "server.ts"), "utf8");
    const registeredTools = Array.from(server.matchAll(/server\.registerTool\(\s*"(eventloom_[^"]+)"/g), (match) => match[1]);
    expect(registeredTools.length).toBeGreaterThan(0);
    for (const toolName of registeredTools) {
      expect(mcpReadme).toContain(toolName);
    }
  });

  it("keeps MCP current coverage docs aligned with registered tools", () => {
    const server = readFileSync(join(root, "packages", "mcp", "src", "server.ts"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const registeredTools = Array.from(
      server.matchAll(/server\.registerTool\(\s*"(eventloom_[^"]+)"/g),
      (match) => match[1],
    );
    const start = mcpPackage.indexOf("Current coverage:");
    const end = mcpPackage.indexOf("Avoid real network", start);
    const coverage = start >= 0 && end > start ? mcpPackage.slice(start, end) : "";

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(registeredTools.length).toBeGreaterThan(0);
    for (const toolName of registeredTools) {
      expect(coverage, toolName).toContain(`\`${toolName}\``);
    }
    expect(coverage).toContain("MCP stdio smoke coverage verifies append, replay, built-in workflow runs, artifact bundle writes, artifact bundle verification, and OTLP export through the protocol.");
  });

  it("keeps agent-facing docs current with verified-prefix export behavior", () => {
    const agentIntegration = readFileSync(join(root, "docs", "agent-integration.md"), "utf8");
    const userGuide = readFileSync(join(root, "docs", "user-guide.md"), "utf8");
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const server = readFileSync(join(root, "packages", "mcp", "src", "server.ts"), "utf8");

    expect(agentIntegration).toContain("eventloom_write_artifacts");
    expect(agentIntegration).toContain("exportedEventCount");
    expect(agentIntegration).toContain("validPrefixCount");
    expect(agentIntegration).toContain("integrity");
    expect(agentIntegration).toContain("verified prefix");
    expect(agentIntegration).toContain("Pathlight, HALO, or generic OTLP");
    expect(agentIntegration).toContain("`exportedEventCount` and `validPrefixCount` are the runtime and CLI source-log counters");
    expect(agentIntegration).toContain("MCP HALO `eventCount` is a compatibility alias for `exportedEventCount`");
    expect(agentIntegration).toContain("Pathlight `eventCount` is the Pathlight span-event count");
    expect(agentIntegration).toContain("## OTLP Export");
    expect(agentIntegration).toContain("resourceSpans");
    const registeredTools = Array.from(server.matchAll(/server\.registerTool\(\s*"(eventloom_[^"]+)"/g), (match) => match[1]);
    for (const toolName of registeredTools) {
      expect(agentIntegration).toContain(toolName);
    }

    expect(userGuide).toContain("visualize <events.jsonl> --html <visualizer.html>");
    expect(userGuide).toContain("artifacts <events.jsonl> --out <artifact-dir>");
    expect(userGuide).toContain("mailbox --json");
    expect(userGuide).toContain("handoff --json");
    expect(userGuide).toContain("exportedEventCount");
    expect(userGuide).toContain("validPrefixCount");
    expect(userGuide).toContain("verified-prefix exports");

    expect(cliReference).toContain("npm exec --package @eventloom/runtime -- eventloom <command>");
    expect(cliReference).toContain("npx eventloom inspect <events.jsonl> [--type <event.type>] [--actor <actorId>] [--thread <threadId>] [--limit <n>] [--json]");
    expect(cliReference).toContain("versioned `eventloom.replay.v1` object");
    expect(cliReference).toContain("versioned `eventloom.projection-diff.v1` object");
    expect(cliReference).toContain("versioned `eventloom.stats.v1` object");
    expect(cliReference).toContain("versioned `eventloom.query.v1` object");
    expect(cliReference).toContain("versioned `eventloom.inspect.v1` object");
    expect(cliReference).toContain("`selection` records `totalEventCount`, `matchedEventCount`, the effective query, and stable event summaries");
    expect(cliReference).toContain("npx eventloom timeline <events.jsonl> --limit <n>");
    expect(cliReference).toContain("Use `--limit <n>` to print only the last `n` events from the verified prefix.");

    expect(mcpPackage).toContain("Runtime and CLI export results use `exportedEventCount` and `validPrefixCount` for Eventloom source-log counters.");
    expect(mcpPackage).toContain("MCP HALO adds `eventCount` only as a compatibility alias for `exportedEventCount`.");
    expect(mcpPackage).toContain("Pathlight `eventCount` remains the Pathlight span-event count, not the Eventloom source-log count.");
  });

  it("keeps MCP setup, design docs, and CLI usage aligned with implemented tools", () => {
    const mcpSetup = readFileSync(join(root, "docs", "mcp-setup.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");

    expect(mcpSetup).toContain("eventloom_write_artifacts");
    expect(mcpSetup).toContain("otlp-traces.json");
    expect(mcpSetup).toContain("EVENTLOOM_LOCK_TIMEOUT_MS");
    expect(mcpSetup).toContain("--lock-timeout-ms");

    expect(mcpPackage).toContain("src/tools.ts");
    expect(mcpPackage).toContain("### `eventloom_recover`");
    expect(mcpPackage).toContain("### `eventloom_inspect`");
    expect(mcpPackage).toContain("same versioned `eventloom.replay.v1` model as the runtime package and CLI JSON output");
    expect(mcpPackage).toContain("same versioned `eventloom.projection-diff.v1` model as the runtime package and CLI JSON output");
    expect(mcpPackage).toContain("same versioned `eventloom.stats.v1` model as the runtime package and CLI JSON output");
    expect(mcpPackage).toContain("same versioned `eventloom.query.v1` model as the CLI JSON output");
    expect(mcpPackage).toContain("`type`, `actorId`, `threadId`, and `limit` are optional and match `eventloom_query` semantics");
    expect(mcpPackage).toContain("optional filtered `selection` inspection model");
    expect(mcpPackage).toContain("### `eventloom_timeline`");
    expect(mcpPackage).toContain("same versioned `eventloom.timeline.v1` model as the runtime package and CLI JSON output");
    expect(mcpPackage).toContain("`eventloom_timeline` returns the versioned `eventloom.timeline.v1` model plus human-readable text.");
    expect(mcpPackage).toContain("### `eventloom_explain_task`");
    expect(mcpPackage).toContain("same versioned `eventloom.task-explanation.v1` model as the runtime package and CLI JSON output");
    expect(mcpPackage).toContain("`eventloom_explain_task` returns the versioned `eventloom.task-explanation.v1` model plus human-readable text.");
    expect(mcpPackage).toContain("### `eventloom_mailbox`");
    expect(mcpPackage).toContain("same versioned `eventloom.mailbox.v1` model as the runtime package and CLI JSON output");
    expect(mcpPackage).toContain("`eventloom_mailbox` returns the versioned `eventloom.mailbox.v1` model plus human-readable text.");
    expect(mcpPackage).toContain("### `eventloom_summarize_handoff`");
    expect(mcpPackage).toContain("same versioned `eventloom.handoff.v1` model as the CLI JSON output");
    expect(mcpPackage).toContain("same typed summary produced by the runtime `summarizeHandoff()` helper");
    expect(mcpPackage).toContain("`eventloom_summarize_handoff` returns the versioned `eventloom.handoff.v1` model plus human-readable text.");
    expect(mcpPackage).toContain("quarantineTail");
    expect(mcpPackage).toContain("`verbose`: include the full projection");
    expect(mcpPackage).toContain("## v1 Release Readiness");
    expect(mcpPackage).toContain("npm run ci:mcp-v1");
    expect(mcpPackage).toContain("npm run release:preflight:mcp-v1");
    expect(mcpPackage).toContain("npm run smoke:mcp-installed-bin");
    expect(mcpPackage).toContain("@eventloom/runtime@1.0.0");
    expect(mcpPackage).not.toContain("Document setup after the package is implemented and published");
    expect(mcpPackage).not.toContain("- `eventloom_verify`\n- `eventloom_read_events`\n- `eventloom_summarize_handoff`");
    expect(mcpPackage).not.toContain("ready for local use when");
    expect(mcpPackage).not.toContain("MVP tools");
    const mcpTools = readFileSync(join(root, "packages", "mcp", "src", "tools.ts"), "utf8");
    expect(mcpTools).toContain("buildTimelineModel(selectedEvents, report)");
    expect(mcpTools).toContain("buildTaskExplanationModel(events, input.taskId)");
    expect(mcpTools).toContain("buildMailboxModel(input.actorId, items)");
    expect(mcpTools).toContain("summarizeHandoff(events, report)");
    expect(mcpTools).toContain("formatHandoffSummary(summary)");

    expect(cli).toContain("eventloom append <events.jsonl> <event.type> [--actor <actorId>] [--payload '<json>'] [--json]");
    expect(cli).toContain("eventloom replay <events.jsonl> [--json]");
    expect(cli).toContain("eventloom demo software-work [events.jsonl] [--json]");
    expect(cli).toContain("eventloom run software-work [events.jsonl] [--resume] [--max-iterations <n>] [--json]");
    expect(cli).toContain("eventloom run research-pipeline [events.jsonl] [--resume] [--max-iterations <n>] [--json]");
    expect(cli).toContain("eventloom run human-ops [events.jsonl] [--resume] [--max-iterations <n>] [--json]");
    expect(cli).toContain("eventloom verify <events.jsonl> [--json]");
    expect(cli).toContain("eventloom validate <events.jsonl> [--json]");
    expect(cli).toContain("eventloom recover <events.jsonl> --out <recovered.jsonl> [--quarantine-tail <bad-tail.jsonl>] [--json]");
    expect(cli).toContain("eventloom diff <left.jsonl> <right.jsonl> [--json]");
    expect(cli).toContain("eventloom stats <events.jsonl> [--json]");
    expect(cli).toContain("eventloom query <events.jsonl> [--type <event.type>] [--actor <actorId>] [--thread <threadId>] [--limit <n>] [--json]");
    expect(cli).toContain("eventloom export pathlight <events.jsonl> [--base-url <url>] [--trace-name <name>] [--json]");
    expect(cli).toContain("eventloom export halo <events.jsonl> [--out <traces.jsonl>] [--project-id <id>] [--service-name <name>] [--trace-name <name>] [--json]");
    expect(cli).toContain("eventloom export otlp <events.jsonl> [--out <traces.json>] [--endpoint <url>] [--service-name <name>] [--service-version <version>] [--trace-name <name>] [--json]");
    expect(cli).toContain("eventloom inspect <events.jsonl> [--type <event.type>] [--actor <actorId>] [--thread <threadId>] [--limit <n>] [--json]");
    expect(cli).toContain("eventloom timeline <events.jsonl> [--limit <n>] [--json]");
    expect(cli).toContain("eventloom explain task <taskId> <events.jsonl> [--json]");
    expect(cli).toContain("eventloom mailbox <actorId> <events.jsonl> [--json]");
    expect(cli).toContain("eventloom handoff <events.jsonl> [--json]");
    expect(cli).toContain("eventloom visualize <events.jsonl> [--html <visualizer.html>] [--title <title>] [--json]");
    expect(cli).toContain("eventloom artifacts <events.jsonl> --out <artifact-dir> [--title <title>] [--json]");
    expect(cli).toContain("eventloom artifacts verify <manifest.json> [--json]");
  });

  it("keeps raw verify diagnostics versioned across package, CLI, and MCP docs", () => {
    const eventStore = readFileSync(join(root, "src", "event-store.ts"), "utf8");
    const runtime = readFileSync(join(root, "src", "runtime.ts"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
    const mcpTools = readFileSync(join(root, "packages", "mcp", "src", "tools.ts"), "utf8");
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const readme = readFileSync(join(root, "README.md"), "utf8");

    expect(eventStore).toContain('version: "eventloom.verify.v1";');
    expect(eventStore).toContain('version: "eventloom.verify.v1" as const');
    expect(runtime).toContain("verify(): Promise<EventLogVerificationReport>");
    expect(cli).toContain("const report = await new JsonlEventStore(path).verify()");
    expect(mcpTools).toContain("const report = await createRuntime(resolveLogPath(config, input.path)).verify()");
    expect(cliReference).toContain("Output is a versioned `eventloom.verify.v1` object");
    expect(cliReference).toContain("`validate` prints the same versioned `eventloom.verify.v1` JSON diagnostics");
    expect(packageApi).toContain("`runtime.verify()` and `JsonlEventStore.verify()` return the versioned `eventloom.verify.v1` report");
    expect(publicApi).toContain("`EventloomRuntime.verify()` returns the versioned `eventloom.verify.v1` streaming integrity diagnostics");
    expect(publicApi).toContain("`JsonlEventStore.verify()` returns the same versioned `eventloom.verify.v1` report");
    expect(mcpPackage).toContain('"version": "eventloom.verify.v1"');
    expect(mcpPackage).toContain("same versioned `eventloom.verify.v1` report as the runtime package");
    expect(roadmap).toContain("MCP `eventloom_verify` return the explicitly versioned `eventloom.verify.v1` diagnostics model");
    expect(roadmap).toContain("Raw verify results and artifact-bundle `verify.json` are explicitly versioned as `eventloom.verify.v1`");
    expect(changelog).toContain("Added explicit `eventloom.verify.v1` versioning to raw store/runtime verify reports");
    expect(readme).toContain("Returns versioned `eventloom.verify.v1` diagnostics");
  });

  it("documents optional Pathlight base URL consistently", () => {
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
    const usage = "eventloom export pathlight <events.jsonl> [--base-url <url>] [--trace-name <name>]";

    expect(cliReference).toContain(usage);
    expect(cli).toContain(usage);
    expect(cliReference).toContain("`--base-url`: `http://localhost:4100`");
    expect(cliReference).toContain("`--base-url` must be an absolute `http://` or `https://` URL");
    expect(cliReference).toContain("eventloom.export.pathlight.v1");
    expect(readFileSync(join(root, "docs", "pathlight-integration.md"), "utf8"))
      .toContain("`--base-url` must be an absolute `http://` or `https://` URL");
    expect(readFileSync(join(root, "docs", "pathlight-integration.md"), "utf8"))
      .toContain("eventloom.export.pathlight.v1");
    expect(readFileSync(join(root, "docs", "mcp-package.md"), "utf8"))
      .toContain("`baseUrl` is optional; when it is omitted, the tool uses `EVENTLOOM_PATHLIGHT_BASE_URL` and then `http://localhost:4100`");
    expect(readFileSync(join(root, "docs", "mcp-package.md"), "utf8"))
      .toContain("diagnostics include the rejected `option` and `value`");
    expect(readFileSync(join(root, "docs", "mcp-package.md"), "utf8"))
      .toContain('"version": "eventloom.export.pathlight.v1"');
    expect(cli).toContain('baseUrl: "http://localhost:4100"');
    expect(cli).toContain("must be an absolute HTTP(S) URL");
    expect(readFileSync(join(root, "packages", "mcp", "src", "tools.ts"), "utf8"))
      .toContain("baseUrl must be an absolute HTTP(S) URL");
    expect(readFileSync(join(root, "packages", "mcp", "src", "tools.ts"), "utf8"))
      .toContain('process.env.EVENTLOOM_PATHLIGHT_BASE_URL ?? "http://localhost:4100"');
    expect(cliReference).toContain("Pathlight failures include the collector `url` and HTTP `status` when available");
    expect(cli).toContain("url: error.url");
    expect(cli).toContain("status: error.status");
    expect(cliReference).not.toContain("eventloom export pathlight <events.jsonl> --base-url <url> [--trace-name <name>]");
    expect(cli).not.toContain("eventloom export pathlight <events.jsonl> --base-url <url> [--trace-name <name>]");
  });

  it("documents optional HALO output path consistently", () => {
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const haloIntegration = readFileSync(join(root, "docs", "halo-integration.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
    const mcpTools = readFileSync(join(root, "packages", "mcp", "src", "tools.ts"), "utf8");
    const usage = "eventloom export halo <events.jsonl> [--out <traces.jsonl>] [--project-id <id>] [--service-name <name>] [--trace-name <name>]";

    expect(cliReference).toContain(usage);
    expect(cli).toContain(usage);
    expect(haloIntegration).toContain("npx eventloom export halo <events.jsonl> [--out <halo-traces.jsonl>]");
    expect(cliReference).toContain("`--out`: `eventloom-halo-traces.jsonl`");
    expect(cliReference).toContain("eventloom.export.halo.v1");
    expect(cliReference).toContain("If the `--out` path includes directories that do not exist yet, Eventloom creates them before writing the file.");
    expect(haloIntegration).toContain("`--out`: `eventloom-halo-traces.jsonl`");
    expect(haloIntegration).toContain("eventloom.export.halo.v1");
    expect(mcpPackage).toContain('"version": "eventloom.export.halo.v1"');
    expect(cli).toContain('out: "eventloom-halo-traces.jsonl"');
    expect(cli).toContain("writeTextFileCreatingParents(options.out, formatHaloJsonl(result))");
    expect(mcpPackage).toContain("The output file is written through a same-directory temporary file");
    expect(mcpTools).toContain("writeTextFileAtomically(outputPath, formatHaloJsonl(result) + \"\\n\")");
    expect(cliReference).not.toContain("eventloom export halo <events.jsonl> --out <traces.jsonl>");
    expect(cli).not.toContain("eventloom export halo <events.jsonl> --out <traces.jsonl>");
  });

  it("documents OTLP export consistently", () => {
    const packageJson = readJson("package.json");
    const mcpPackageJson = readJson("packages/mcp/package.json");
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const userGuide = readFileSync(join(root, "docs", "user-guide.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const otlpIntegration = readFileSync(join(root, "docs", "otlp-integration.md"), "utf8");
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");
    const developmentPlan = readFileSync(join(root, "docs", "development-plan.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
    const mcpTools = readFileSync(join(root, "packages", "mcp", "src", "tools.ts"), "utf8");
    const usage = "eventloom export otlp <events.jsonl> [--out <traces.json>] [--endpoint <url>] [--service-name <name>] [--service-version <version>] [--trace-name <name>] [--json]";

    expect(packageJson.exports["./export/otlp"]).toMatchObject({
      types: "./dist/export/otlp.d.ts",
      import: "./dist/export/otlp.js",
    });
    expect(packageJson.keywords).toEqual(expect.arrayContaining(["otlp", "opentelemetry"]));
    expect(mcpPackageJson.keywords).toEqual(expect.arrayContaining(["otlp", "opentelemetry"]));
    expect(cliReference).toContain(usage);
    expect(cli).toContain(usage);
    expect(cliReference).toContain("`--out`: `eventloom-otlp-traces.json`");
    expect(cliReference).toContain("`--endpoint <url>`");
    expect(cliReference).toContain("eventloom.export.otlp.v1");
    expect(cliReference).toContain("eventloom.export.otlp-push.v1");
    expect(cliReference).toContain("otlp_invalid_endpoint");
    expect(cliReference).toContain("If the `--out` path includes directories that do not exist yet, Eventloom creates them before writing the file.");
    expect(cli).toContain('out: "eventloom-otlp-traces.json"');
    expect(cli).toContain("writeTextFileCreatingParents(options.out, formatOtlpJson(result))");
    expect(cli).toContain("pushOtlpJson(result, { endpoint: options.endpoint })");
    expect(mcpPackage).toContain("The output file is written through a same-directory temporary file");
    expect(mcpTools).toContain("writeTextFileAtomically(outputPath, formatOtlpJson(result))");
    expect(mcpTools).toContain("pushOtlpJson(result, { endpoint: input.endpoint })");
    expect(mcpPackage).toContain('"endpoint": "http://localhost:4318/v1/traces"');
    expect(mcpPackage).toContain('"version": "eventloom.export.otlp.v1"');
    expect(mcpPackage).toContain("can POST it to an OTLP HTTP endpoint");
    expect(mcpPackage).toContain("otlp_response_failed");
    expect(userGuide).toContain("npx eventloom export otlp");
    expect(userGuide).toContain("eventloom.export.otlp.v1");
    expect(userGuide).toContain("resourceSpans");
    expect(otlpIntegration).toContain("npx eventloom export otlp <events.jsonl>");
    expect(otlpIntegration).toContain("eventloom_export_otlp");
    expect(otlpIntegration).toContain("eventloom.export.otlp.v1");
    expect(otlpIntegration).toContain("eventloom.export.otlp-push.v1");
    expect(otlpIntegration).toContain("otlp-success.json");
    expect(otlpIntegration).toContain("otlp-negative.json");
    expect(otlpIntegration).toContain("pushOtlpJson");
    expect(otlpIntegration).toContain("http://localhost:4318/v1/traces");
    expect(otlpIntegration).toContain("When `endpoint` is provided, the tool POSTs the same JSON payload");
    expect(otlpIntegration).toContain("verified prefix");
    expect(packageApi).toContain("runtime.exportOtlp");
    expect(packageApi).toContain("formatOtlpJson");
    expect(packageApi).toContain("pushOtlpJson");
    expect(packageApi).toContain('version: "eventloom.export.pathlight.v1"');
    expect(packageApi).toContain('version: "eventloom.export.halo.v1"');
    expect(packageApi).toContain('version: "eventloom.export.otlp.v1"');
    expect(packageApi).toContain("eventloom.export.otlp-push.v1");
    expect(publicApi).toContain("EventloomRuntime.exportPathlight()`, `exportHalo()`, `exportOtlp()");
    expect(publicApi).toContain("OtlpExportError");
    expect(publicApi).toContain("eventloom.export.pathlight.v1");
    expect(publicApi).toContain("eventloom.export.halo.v1");
    expect(publicApi).toContain("eventloom.export.otlp.v1");
    expect(publicApi).toContain("eventloom.export.otlp-push.v1");
    expect(publicApi).toContain("@eventloom/runtime/export/otlp");
    expect(roadmap).toContain("eventloom export otlp <events.jsonl>");
    expect(roadmap).toContain("pushOtlpJson()");
    expect(roadmap).toContain("eventloom.export.pathlight.v1");
    expect(roadmap).toContain("eventloom.export.halo.v1");
    expect(roadmap).toContain("eventloom.export.otlp.v1");
    expect(roadmap).toContain("eventloom.export.otlp-push.v1");
    expect(roadmap).toContain("docs/otlp-integration.md");
    expect(roadmap).toContain("Pathlight/HALO/OTLP export bridges");
    expect(roadmap).toContain("Runtime, CLI, and MCP OTLP export paths");
    expect(developmentPlan).toContain("### Phase 7: Portable Observability Export");
    expect(developmentPlan).toContain("Status: implemented for generic OTLP HTTP delivery.");
    expect(developmentPlan).toContain("exportToOtlp()");
    expect(developmentPlan).toContain("pushOtlpJson()");
    expect(developmentPlan).toContain("eventloom.export.otlp.v1");
    expect(developmentPlan).toContain("eventloom.export.otlp-push.v1");
    expect(developmentPlan).toContain("docs/otlp-integration.md");
  });

  it("keeps event store durability hardening documented and implemented", () => {
    const eventStore = readFileSync(join(root, "src", "event-store.ts"), "utf8");
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    expect(eventStore).toContain("await handle.sync()");
    expect(eventStore).toContain("syncContainingDirectory");
    expect(eventStore).toContain("isUnsupportedDirectorySyncError");
    expect(roadmap).toContain("sync newly created log directory entries where supported");
    expect(roadmap).toContain("syncs recovery directory entries where supported");
    expect(packageApi).toContain("fsyncs appended log contents and recovery outputs");
    expect(packageApi).toContain("syncs the containing directory entry on platforms that support directory fsync");
  });

  it("keeps the public site aligned with the v1 OTLP release surface", () => {
    const site = readFileSync(join(root, "site", "index.html"), "utf8");

    expect(site).toContain("Eventloom v1.0.0");
    expect(site).toContain("generic OpenTelemetry OTLP JSON");
    expect(site).toContain("Pathlight / HALO / OTLP");
    expect(site).toContain("artifact bundles");
    expect(site).toContain("docs/otlp-integration.md");
    expect(site).toContain("eventloom -- export otlp");
    expect(site).toContain("Ship runtime 1.0.0");
    expect(site).not.toContain("Eventloom v0.1.7");
    expect(site).not.toContain("Ship runtime 0.1.7");
  });

  it("documents the successful CLI help path used by diagnostics", () => {
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");

    expect(cliReference).toContain("## `help`");
    expect(cliReference).toContain("npx eventloom help");
    expect(cliReference).toContain("npx eventloom --help");
    expect(cliReference).toContain("prints usage and exits successfully");
    expect(cli).toContain("command === \"help\"");
    expect(cli).toContain("command === \"--help\"");
    expect(cli).toContain("Check the command arguments and run eventloom help for usage.");
  });

  it("documents append actor and payload defaults consistently", () => {
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
    const usage = "eventloom append <events.jsonl> <event.type> [--actor <actorId>] [--payload '<json>'] [--json]";

    expect(cliReference).toContain(usage);
    expect(cli).toContain(usage);
    expect(cliReference).toContain("`--actor <actorId>`: actor that emitted the event. Defaults to `external`.");
    expect(cliReference).toContain("`--payload '<json>'`: event payload. Defaults to `{}` and must be valid JSON object text when provided. Malformed JSON exits with `invalid_json_payload`.");
    expect(cli).toContain('actorId: "external"');
    expect(cli).toContain('payload: "{}"');
    expect(cliReference).not.toContain("eventloom append <events.jsonl> <event.type> --actor <actorId> --payload '<json>'");
    expect(cli).not.toContain("eventloom append <events.jsonl> <event.type> --actor <actorId> --payload '<json>'");
  });

  it("documents strict v1 event envelope extensibility boundaries", () => {
    const eventModel = readFileSync(join(root, "docs", "event-model.md"), "utf8");
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const customWorkflows = readFileSync(join(root, "docs", "custom-workflows.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");

    expect(eventModel).toContain("The envelope is strict");
    expect(eventModel).toContain("Unknown top-level fields");
    expect(eventModel).toContain("Domain evolution belongs inside `payload`");
    expect(publicApi).toContain("unknown top-level envelope fields are invalid");
    expect(publicApi).toContain("payload.version");
    expect(customWorkflows).toContain("Unknown top-level envelope fields are rejected");
    expect(packageApi).toContain("Append, read, and verify paths enforce the same strict Eventloom envelope");
    expect(cliReference).toContain("unknown top-level envelope fields");
    expect(roadmap).toContain("Unknown top-level event envelope fields are invalid");
  });

  it("documents stable runtime loop typed errors across API, CLI, and MCP", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");

    for (const text of [publicApi, packageApi]) {
      expect(text).toContain("RuntimeProjectionError");
      expect(text).toContain("RuntimeOptionsError");
      expect(text).toContain("RuntimeRunnerError");
      expect(text).toContain("runtime_projection_failed");
      expect(text).toContain("invalid_runtime_option");
      expect(text).toContain("actor_runner_failed");
      expect(text).toContain("actor_runner_invalid_output");
    }

    expect(cliReference).toContain("runtime_projection_failed");
    expect(cliReference).toContain("invalid_runtime_option");
    expect(cliReference).toContain("projectionErrors");
    expect(cliReference).toContain("Projection errors include `projectionKind` (`task`, `effect`, or `research`)");
    expect(packageApi).toContain("Projection errors include `projectionKind` (`task`, `effect`, or `research`)");
    expect(mcpPackage).toContain("runtime_projection_failed");
    expect(mcpPackage).toContain("invalid_event_store_option");
    expect(mcpPackage).toContain("invalid_runtime_option");
    expect(mcpPackage).toContain("projectionErrors");
    expect(mcpPackage).toContain("Projection errors include `projectionKind` (`task`, `effect`, or `research`)");
  });

  it("documents the stable artifact bundle package API", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const userGuide = readFileSync(join(root, "docs", "user-guide.md"), "utf8");
    const githubActions = readFileSync(join(root, "docs", "github-actions-artifacts.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const mcpServer = readFileSync(join(root, "packages", "mcp", "src", "server.ts"), "utf8");

    expect(publicApi).toContain("writeArtifactBundle");
    expect(publicApi).toContain("ArtifactBundleOptions");
    expect(publicApi).toContain("ArtifactBundleResult");
    expect(publicApi).toContain("ArtifactBundleFiles");
    expect(publicApi).toContain("ArtifactBundleFileDigest");
    expect(publicApi).toContain("ArtifactBundleFileDigests");
    expect(publicApi).toContain("ArtifactBundleVerifyArtifact");
    expect(publicApi).toContain("ArtifactBundleVerificationIssue");
    expect(publicApi).toContain("ArtifactBundleVerificationResult");
    expect(publicApi).toContain("buildArtifactBundleVerifyArtifact");
    expect(publicApi).toContain("verifyArtifactBundleFiles");
    expect(publicApi).toContain("eventloom.artifact-bundle.v1");
    expect(publicApi).toContain("eventloom.verify.v1");
    expect(publicApi).toContain("eventloom.artifact-bundle-verification.v1");
    expect(publicApi).toContain("inputDigest` for the canonical source JSONL log");
    const publicApiTest = readFileSync(join(root, "tests", "public-api.test.ts"), "utf8");
    expect(publicApiTest).toContain("inspectJson: join(dir, \"artifacts\", \"inspect.json\")");
    expect(publicApiTest).toContain("queryJson: join(dir, \"artifacts\", \"query.json\")");
    expect(publicApiTest).toContain("otlpJson: join(dir, \"artifacts\", \"otlp-traces.json\")");
    expect(publicApiTest).toContain("result.files.inspectJson");
    expect(publicApiTest).toContain("result.files.queryJson");
    expect(publicApiTest).toContain("result.files.otlpJson");
    expect(publicApiTest).toContain("eventloom.verify.v1");
    expect(publicApiTest).toContain("result.inputDigest");
    expect(publicApiTest).toContain("result.fileDigests.otlpJson");
    expect(publicApiTest).toContain("verifyArtifactBundleFiles(result)");
    expect(packageApi).toContain("invalid_manifest");
    expect(packageApi).toContain("missing_file");
    expect(packageApi).toContain("sha256_mismatch");
    expect(packageApi).toContain("eventloom artifacts verify <manifest.json>");
    expect(packageApi).toContain("eventloom_verify_artifacts");
    expect(packageApi).toContain("eventloom.artifact-bundle-verification.v1");
    expect(cliReference).toContain("eventloom artifacts verify <manifest.json>");
    expect(cliReference).toContain("eventloom.artifact-bundle-verification.v1");
    expect(cliReference).toContain("exits nonzero when the manifest digest metadata is invalid");
    expect(githubActions).toContain("eventloom artifacts verify .eventloom/artifacts/manifest.json");
    expect(mcpPackage).toContain("### `eventloom_verify_artifacts`");
    expect(mcpPackage).toContain("same versioned `eventloom.artifact-bundle-verification.v1` model as the runtime package and CLI JSON output");
    expect(mcpPackage).toContain("restricts the manifest, the `inputDigest` path, and every valid manifest digest path to the configured MCP root");
    for (const doc of [publicApi, packageApi, cliReference, userGuide, githubActions, mcpPackage]) {
      expect(doc).toContain("inspect.json");
      expect(doc).toContain("query.json");
      expect(doc).toContain("otlp-traces.json");
    }
    for (const doc of [publicApi, packageApi, cliReference, userGuide, githubActions, mcpPackage]) {
      expect(doc).toContain("SHA-256");
    }
    for (const doc of [packageApi, cliReference, mcpPackage]) {
      expect(doc).toContain("fileDigests");
    }
    for (const doc of [publicApi, packageApi, cliReference, userGuide, githubActions, mcpPackage]) {
      expect(doc).toContain("inputDigest");
    }
    for (const doc of [packageApi, cliReference, githubActions]) {
      expect(doc).toContain("same-directory temporary file");
      expect(doc).toContain("atomically renamed into place");
    }
    const artifacts = readFileSync(join(root, "src", "artifacts.ts"), "utf8");
    expect(artifacts).toContain("writeTextFileAtomically");
    expect(artifacts).toContain("buildEventLogInspectionModel");
    expect(artifacts).toContain("await handle.sync()");
    expect(artifacts).toContain("await syncContainingDirectory(path)");
    expect(mcpPackage).toContain('"otlpJson"');
    expect(mcpPackage).toContain('"queryJson"');
    expect(mcpServer).toContain("stats, inspect, visualizer, HALO, OTLP, handoff, and manifest artifacts");
    expect(mcpServer).toContain("eventloom_verify_artifacts");
  });

  it("documents the stable visualizer package API", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");
    const cliReference = readFileSync(join(root, "docs", "cli-reference.md"), "utf8");
    const mcpPackage = readFileSync(join(root, "docs", "mcp-package.md"), "utf8");
    const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
    const visualizer = readFileSync(join(root, "src", "visualizer.ts"), "utf8");

    for (const symbol of [
      "VisualizerModel",
      "VisualizerCapture",
      "VisualizerCaptureEvent",
      "VisualizerReplay",
      "VisualizerProjection",
      "VisualizerHtmlOptions",
      "buildVisualizerModel",
      "renderVisualizerHtml",
    ]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
    expect(visualizer).toContain('version: "eventloom.visualizer.v1"');
    expect(packageApi).toContain("versioned `eventloom.visualizer.v1`");
    expect(cliReference).toContain("versioned `eventloom.visualizer.v1`");
    expect(mcpPackage).toContain("versioned `eventloom.visualizer.v1`");
    expect(cliReference).toContain("If the `--html` path includes directories that do not exist yet, Eventloom creates them before writing the file.");
    expect(cli).toContain("writeTextFileCreatingParents(options.html, renderVisualizerHtml(model, { title: options.title }))");
  });

  it("documents the stable projection snapshot package API", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of [
      "ProjectionSnapshot",
      "ProjectionSnapshotOptions",
      "SnapshotReplay",
      "SnapshotReplayError",
      "createProjectionSnapshot",
      "replayFromProjectionSnapshot",
    ]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
    expect(publicApi).toContain("prefix `eventIds`");
    expect(packageApi).toContain("records the snapshotted prefix event ids");
    expect(packageApi).toContain("reuse an event id from the snapshot prefix");
  });

  it("documents stable domain projection helpers across public API docs", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of ["projectTasks", "projectResearch", "projectEffects"]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable causal helpers across public API docs", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of ["eventById", "causalChain"]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable runtime provenance helpers across public API docs", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of ["RuntimeProvenance", "collectRuntimeProvenance"]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents stable agent workflow template helpers across public API docs", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    for (const symbol of [
      "AgentWorkflowTemplate",
      "AgentWorkflowTemplateEvent",
      "getAgentWorkflowTemplate",
      "formatAgentWorkflowTemplates",
      "formatAgentWorkflowTemplate",
    ]) {
      expect(publicApi).toContain(symbol);
      expect(packageApi).toContain(symbol);
    }
  });

  it("documents the stable built-in workflow type across public API docs", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    expect(publicApi).toContain("BuiltInWorkflow");
    expect(packageApi).toContain("BuiltInWorkflow");
  });

  it("documents runtime facade methods used by package API examples", () => {
    const publicApi = readFileSync(join(root, "docs", "public-api.md"), "utf8");
    const packageApi = readFileSync(join(root, "docs", "package-api.md"), "utf8");

    expect(packageApi).toContain("runtime.readAll()");
    expect(publicApi).toContain("EventloomRuntime.readAll()");
  });

  it("documents extension stability and ships the custom workflow example", () => {
    const packageJson = readJson("package.json");
    const files = packageJson.files as string[];

    expect(existsSync(join(root, "docs/public-api.md"))).toBe(true);
    expect(existsSync(join(root, "docs/custom-workflows.md"))).toBe(true);
    expect(existsSync(join(root, "examples/custom-workflow.ts"))).toBe(true);
    expect(files).toContain("docs/public-api.md");
    expect(files).toContain("docs/custom-workflows.md");
    expect(files).toContain("examples/custom-workflow.ts");
  });

  it("documents agent journal cookbooks and CI artifact preservation", () => {
    const packageJson = readJson("package.json");
    const files = packageJson.files as string[];
    const cookbook = readFileSync(join(root, "docs", "agent-journal-cookbook.md"), "utf8");
    const actions = readFileSync(join(root, "docs", "github-actions-artifacts.md"), "utf8");
    const developmentPlan = readFileSync(join(root, "docs", "development-plan.md"), "utf8");

    expect(files).toContain("fixtures/export");
    expect(files).toContain("docs/agent-journal-cookbook.md");
    expect(files).toContain("docs/github-actions-artifacts.md");
    expect(cookbook).toContain("## Coding Agent Task");
    expect(cookbook).toContain("## Review Loop");
    expect(cookbook).toContain("## Research Workflow");
    expect(cookbook).toContain("## Human Approval");
    expect(cookbook).toContain("## Git Commit And Session Linkage");
    expect(actions).toContain("actions/upload-artifact");
    expect(actions).toContain("npm exec --package @eventloom/runtime -- eventloom artifacts");
    expect(actions).toContain("> .eventloom/artifacts/manifest-verify.json");
    expect(actions).toContain("test -s .eventloom/agent-work.jsonl");
    expect(actions).toContain("test -f .eventloom/artifacts/manifest.json");
    expect(actions).toContain("test -f .eventloom/artifacts/manifest-verify.json");
    expect(actions).toContain(".eventloom/agent-work.jsonl");
    expect(actions).toContain(".eventloom/artifacts/");
    expect(actions).toContain(".eventloom/artifacts/manifest-verify.json");
    expect(actions).toContain("inputDigest` for `.eventloom/agent-work.jsonl`");
    expect(actions).toContain("source log digest and generated artifact digests");
    expect(actions).toContain("eventloom artifacts");
    expect(actions).toContain(".eventloom-ci/golden-fixtures-node-<node-version>.json");
    expect(actions).toContain(".eventloom-ci/export-fixtures-node-<node-version>.json");
    expect(actions).toContain("eventloom.fixture-check.v1");
    expect(actions).toContain(".eventloom-ci/benchmark-smoke-node-<node-version>.json");
    expect(actions).toContain("eventloom.benchmark.v1");
    expect(actions).toContain(".eventloom-ci/pack-manifests-node-<node-version>.json");
    expect(actions).toContain(".eventloom-ci/artifact-bundle-verify-node-<node-version>.json");
    expect(actions).toContain("eventloom.artifact-bundle-verification.v1");
    expect(actions).toContain(".eventloom-ci/staged-mcp-v1-preflight-node-<node-version>.json");
    expect(actions).toContain("eventloom.release-preflight.v1");
    expect(actions).toContain("separate from agent journal artifacts");
    expect(developmentPlan).toContain("### Phase 8: GitHub Workflow Artifacts");
    expect(developmentPlan).toContain("Status: implemented.");
    expect(developmentPlan).toContain("docs/github-actions-artifacts.md");
    expect(developmentPlan).toContain("eventloom artifacts");
    expect(developmentPlan).not.toContain("Status: queued.\n\nGoal: make Eventloom useful in CI for agentic coding, review, and release workflows.");
  });

  it("keeps fixture freshness release evidence versioned", () => {
    const fixtureCheck = readFileSync(join(root, "scripts", "fixture-check.mjs"), "utf8");
    const goldenCheck = readFileSync(join(root, "scripts", "check-golden-fixtures.mjs"), "utf8");
    const exportCheck = readFileSync(join(root, "scripts", "check-export-fixtures.mjs"), "utf8");
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

    expect(fixtureCheck).toContain('version: "eventloom.fixture-check.v1"');
    expect(goldenCheck).toContain('version: "eventloom.fixture-check.v1"');
    expect(exportCheck).toContain('version: "eventloom.fixture-check.v1"');
    expect(release).toContain("eventloom.fixture-check.v1");
    expect(roadmap).toContain("eventloom.fixture-check.v1");
    expect(changelog).toContain("eventloom.fixture-check.v1");
  });

  it("keeps the development plan aligned with Eventloom-side visualizer completion", () => {
    const developmentPlan = readFileSync(join(root, "docs", "development-plan.md"), "utf8");

    expect(developmentPlan).toContain("### Phase 6: Pathlight Visualizer Affordance");
    expect(developmentPlan).toContain("Status: implemented for Eventloom.");
    expect(developmentPlan).toContain("External follow-up:");
    expect(developmentPlan).toContain("Pathlight dashboard affordance");
    expect(developmentPlan).not.toContain("High-value integrations to evaluate after the active Pathlight visualizer sprint");
    expect(developmentPlan).not.toContain("Status: active.\n\nGoal: turn the visualizer model into a Pathlight-facing product surface");
    expect(developmentPlan).not.toContain("Remaining:\n\n- Implement the corresponding Pathlight dashboard affordance");
  });

  it("keeps development plan package adoption status aligned with current staged package versions", () => {
    const developmentPlan = readFileSync(join(root, "docs", "development-plan.md"), "utf8");

    expect(developmentPlan).toContain("MCP package in `packages/mcp` with append, replay, timeline, task explanation, built-in workflow, artifact bundle, Pathlight export, HALO export, and OTLP export tools.");
    expect(developmentPlan).toContain("OTLP JSON export behavior");
    expect(developmentPlan).toContain("External collector smoke tests for the implemented generic OTLP export");
    expect(developmentPlan).not.toContain("OpenTelemetry/OTLP export so one Eventloom adapter can feed");
    expect(developmentPlan).toContain("Published `@eventloom/mcp@0.1.6` with Pathlight and HALO export tools.");
    expect(developmentPlan).toContain("Published `@eventloom/runtime@0.1.7` and `@eventloom/mcp@0.1.6`");
    expect(developmentPlan).not.toContain("@eventloom/mcp@0.1.4");
  });

  it("keeps the agent work export case study aligned with current export surfaces", () => {
    const docsIndex = readFileSync(join(root, "docs", "README.md"), "utf8");
    const caseStudy = readFileSync(join(root, "docs", "case-studies", "agent-work-pathlight.md"), "utf8");
    const developmentPlan = readFileSync(join(root, "docs", "development-plan.md"), "utf8");

    expect(docsIndex).toContain("Pathlight, HALO, and generic OTLP artifacts");
    expect(caseStudy).toContain("## Pathlight Export");
    expect(caseStudy).toContain("## HALO Export");
    expect(caseStudy).toContain("## OTLP Export");
    expect(caseStudy).toContain("node dist/cli.js export otlp .eventloom/agent-work.jsonl");
    expect(caseStudy).toContain("resourceSpans");
    expect(caseStudy).toContain("otlp-traces.json");
    expect(caseStudy).toContain("vendor-neutral artifact");
    expect(developmentPlan).toContain("HALO JSONL, generic OTLP JSON, and Pathlight export examples");
    expect(developmentPlan).toContain("exported to OTLP");
  });

  it("exposes root release gate scripts", () => {
    const packageJson = readJson("package.json");
    const mcpPackageJson = readJson("packages/mcp/package.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const mcpScripts = mcpPackageJson.scripts as Record<string, string>;

    expect(scripts["test:runtime"]).toBe("npm run build:mcp && vitest run");
    expect(scripts["build:runtime"]).toBe("node scripts/clean-dist.mjs dist && tsc && node scripts/chmod-cli-bins.mjs dist/cli.js");
    expect(mcpScripts["build"]).toBe("node -e \"import('node:fs/promises').then(({ rm }) => rm('dist', { recursive: true, force: true }))\" && tsc && node ../../scripts/chmod-cli-bins.mjs dist/cli.js");
    expect(scripts.prepack).toBe("npm run test:runtime");
    expect(mcpScripts.prepack).toBe("npm test && npm run build");
    expect(scripts["audit:runtime"]).toBe("npm audit --omit=dev");
    expect(scripts["audit:mcp"]).toBe("npm --prefix packages/mcp audit --omit=dev");
    expect(scripts["smoke:mcp-local-runtime"]).toBe("node scripts/smoke-mcp-local-runtime.mjs");
    expect(scripts["smoke:custom-workflow-package"]).toBe("node scripts/smoke-custom-workflow-package.mjs");
    expect(scripts["smoke:runtime-installed-cli"]).toBe("node scripts/smoke-runtime-installed-cli.mjs");
    expect(scripts["smoke:mcp-installed-bin"]).toBe("npm --prefix packages/mcp run smoke:installed-bin");
    expect(scripts["smoke:mcp-v1-local-runtime-bin"]).toBe("npm --prefix packages/mcp run smoke:v1-local-runtime-bin");
    expect(mcpScripts["smoke:installed-bin"]).toBe("node scripts/smoke-installed-bin.mjs");
    expect(mcpScripts["smoke:v1-local-runtime-bin"]).toBe("node scripts/smoke-v1-local-runtime-bin.mjs");
    expect(scripts["fixtures:golden"]).toBe("tsx scripts/generate-golden-fixtures.ts");
    expect(scripts["fixtures:golden:check"]).toBe("node scripts/check-golden-fixtures.mjs");
    expect(scripts["fixtures:check"]).toBe("node scripts/check-export-fixtures.mjs");
    expect(scripts["pack:check"]).toBe("node scripts/check-pack-manifests.mjs");
    expect(readFileSync(join(root, "scripts", "check-pack-manifests.mjs"), "utf8"))
      .toContain('version: "eventloom.pack-manifests.v1"');
    expect(scripts["ci:runtime-v1"]).toBe(
      "npm run test:runtime && npm run fixtures:golden:check && npm run fixtures:check && npm run bench:smoke && npm run audit:runtime && npm run smoke:mcp-local-runtime && npm run smoke:mcp-v1-local-runtime-bin && npm run smoke:custom-workflow-package && npm run smoke:runtime-installed-cli && npm run pack:check && npm pack --dry-run",
    );
    expect(scripts["ci:mcp-v1"]).toBe(
      "npm run test:mcp && npm run build:mcp && npm run audit:mcp && npm run smoke:mcp-installed-bin && npm run pack:check && npm pack --dry-run ./packages/mcp",
    );
    expect(scripts["ci:full-v1"]).toBe("npm run ci:runtime-v1 && npm run ci:mcp-v1");
    expect(scripts["release:preflight:runtime-v1"]).toBe("node scripts/release-preflight.mjs --target 1.0.0 --phase runtime");
    expect(scripts["release:preflight:mcp-v1"]).toBe("node scripts/release-preflight.mjs --target 1.0.0 --phase mcp --check-published-runtime");
    expect(scripts["release:preflight:v1"]).toBe("node scripts/release-preflight.mjs --target 1.0.0");
    expect(scripts["release:preflight:v1:local"]).toBe("node scripts/release-preflight.mjs --target 1.0.0 --no-git");
    expect(scripts["release:preflight:runtime-v1:local"]).toBe("node scripts/release-preflight.mjs --target 1.0.0 --phase runtime --no-git");
    expect(scripts["release:preflight:mcp-v1:local"]).toBe("node scripts/release-preflight.mjs --target 1.0.0 --phase mcp --no-git");
    expect(scripts["release:preflight:mcp-v1-staged:local"]).toBe("node scripts/release-preflight-mcp-v1-local-staged.mjs");
    expect(scripts["publish:runtime-v1"]).toBe("npm run ci:runtime-v1 && npm run release:preflight:mcp-v1-staged:local && npm run release:preflight:runtime-v1 && npm publish --access public");
    expect(scripts["publish:mcp-v1"]).toBe("npm run ci:full-v1 && npm run release:preflight:mcp-v1 && npm --prefix packages/mcp publish --access public");
    expect(scripts["ci"]).toBe(
      "npm run ci:runtime-v1",
    );
  });

  it("keeps documented release gate command blocks aligned with package scripts", () => {
    const packageJson = readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");

    expect(commandBlockAfter(release, "The runtime-first release gate runs:")).toEqual(
      splitScriptCommands(scripts["ci:runtime-v1"]),
    );
    expect(commandBlockAfter(release, "The MCP release gate, after npm resolves the runtime v1 package, runs:")).toEqual(
      splitScriptCommands(scripts["ci:mcp-v1"]),
    );
  });

  it("documents local no-git release readiness audits", () => {
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");

    expect(release).toContain("## Local Readiness Audit");
    expect(release).toContain("npm run release:preflight:runtime-v1:local");
    expect(release).toContain("npm run release:preflight:mcp-v1-staged:local");
    expect(release).toContain("The current staged checkout is expected to pass");
    expect(release).toContain("Both commands accept `--json`");
    expect(release).toContain("npm run --silent <script> -- --json");
    expect(release).toContain("stdout remains a single parseable report");
    expect(release).toContain("Do not treat `npm run release:preflight:v1:local` or `npm run release:preflight:mcp-v1:local` as current-checkout gates");
    expect(release).toContain("after `@eventloom/runtime@1.0.0` is published");
    expect(release).toContain("do not validate Git branch, tags, or worktree cleanliness");
    expect(release).toContain("do not publish packages");
  });

  it("reports staged MCP preflight argument errors as parseable JSON", () => {
    const result = spawnSync(process.execPath, [
      "scripts/release-preflight-mcp-v1-local-staged.mjs",
      "--json",
      "--unknown-option",
    ], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      targetVersion: "1.0.0",
      phase: "mcp",
      checks: [{
        name: "staged MCP v1 local preflight",
        ok: false,
        expected: "ok",
        actual: "Unknown option: --unknown-option",
        diagnostic: {
          code: "invalid_staged_mcp_preflight_option",
          message: "Unknown option: --unknown-option",
          option: "--unknown-option",
          suggestedAction: "Use only --json for staged MCP v1 local preflight options.",
        },
      }],
    });
  });

  it("reports staged MCP build and pack dry-run checks in local staged preflight JSON", () => {
    const result = spawnSync(process.execPath, [
      "scripts/release-preflight-mcp-v1-local-staged.mjs",
      "--json",
    ], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_dry_run: "true",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      checks: expect.arrayContaining([
        {
          name: "staged MCP package builds",
          ok: true,
          expected: "npm run build",
          actual: "npm run build",
        },
        {
          name: "staged MCP package pack dry-run",
          ok: true,
          expected: "npm pack --dry-run --ignore-scripts",
          actual: "npm pack --dry-run --ignore-scripts",
        },
        {
          name: "staged MCP pack name",
          ok: true,
          expected: "@eventloom/mcp",
          actual: "@eventloom/mcp",
        },
        {
          name: "staged MCP pack version",
          ok: true,
          expected: "1.0.0",
          actual: "1.0.0",
        },
        {
          name: "staged MCP pack filename",
          ok: true,
          expected: "eventloom-mcp-1.0.0.tgz",
          actual: "eventloom-mcp-1.0.0.tgz",
        },
        {
          name: "staged MCP pack includes dist/server.js",
          ok: true,
          expected: "dist/server.js",
          actual: "dist/server.js",
        },
        {
          name: "staged MCP pack excludes src/",
          ok: true,
          expected: "absent",
          actual: "absent",
        },
      ]),
    });
  }, 45_000);

  it("rejects option-like missing values in release support scripts", () => {
    const cases = [
      {
        command: "npx",
        args: ["tsx", "scripts/generate-golden-fixtures.ts", "--out-dir", "--unknown"],
        message: "Missing value for --out-dir",
        code: "invalid_fixture_generator_option",
        option: "--out-dir",
        value: "--unknown",
      },
      {
        command: "npx",
        args: ["tsx", "scripts/generate-export-fixtures.ts", "--out-dir", "--unknown"],
        message: "Missing value for --out-dir",
        code: "invalid_fixture_generator_option",
        option: "--out-dir",
        value: "--unknown",
      },
      {
        command: "npx",
        args: ["tsx", "scripts/benchmarks/large-log.ts", "--events", "--mode", "smoke"],
        message: "Missing value for --events",
        code: "invalid_benchmark_option",
        option: "--events",
        value: "--mode",
      },
      {
        command: "npx",
        args: ["tsx", "scripts/benchmarks/large-log.ts", "--mode", "--events", "10"],
        message: "Missing value for --mode",
        code: "invalid_benchmark_option",
        option: "--mode",
        value: "--events",
      },
      {
        command: "npx",
        args: ["tsx", "scripts/benchmarks/large-log.ts", "--unknown"],
        message: "Unknown benchmark option --unknown",
        code: "invalid_benchmark_option",
        option: "--unknown",
        value: undefined,
      },
      {
        command: "npx",
        args: ["tsx", "scripts/benchmarks/large-log.ts", "--out", "--mode", "smoke"],
        message: "Missing value for --out",
        code: "invalid_benchmark_option",
        option: "--out",
        value: "--mode",
      },
    ];

    for (const testCase of cases) {
      const result = spawnSync(testCase.command, testCase.args, {
        cwd: root,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(testCase.message);
      const expectedError: Record<string, unknown> = {
        code: testCase.code,
        message: testCase.message,
        option: testCase.option,
      };
      if (testCase.value !== undefined) expectedError.value = testCase.value;
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          ...expectedError,
        },
      });
    }
  });

  it("documents full benchmark evidence for v1 release candidates", () => {
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");
    const benchmarks = readFileSync(join(root, "docs", "benchmarks.md"), "utf8");
    const benchmarkScript = readFileSync(join(root, "scripts", "benchmarks", "large-log.ts"), "utf8");

    expect(benchmarkScript).toContain('measure("otlpExport"');
    expect(benchmarkScript).toContain("runtime.exportOtlp");
    expect(benchmarkScript).toContain('version: "eventloom.benchmark.v1"');
    expect(benchmarks).toContain("maintainers should run the full benchmark before v1.0 release candidates");
    expect(benchmarks).toContain("eventloom.benchmark.v1");
    expect(benchmarks).toContain("OTLP export");
    expect(benchmarks).toContain("HALO, OTLP, and Pathlight export measurements");
    expect(benchmarks).toContain("Invalid benchmark options exit nonzero and print a JSON diagnostic");
    expect(benchmarks).toContain("invalid_benchmark_option");
    expect(benchmarks).toContain("Pass `--out <path>`");
    expect(benchmarks).toContain(".eventloom-ci/benchmark-*.json");
    expect(release).toContain("## Benchmark Evidence");
    expect(release).toContain("npm run bench");
    expect(release).toContain("npm run bench:export");
    expect(release).toContain("--out .eventloom-ci/benchmark-full-node-<node-major>.json");
    expect(release).toContain("--out .eventloom-ci/benchmark-export-node-<node-major>.json");
    expect(release).toContain("defaults to the current Node.js major version");
    expect(release).toContain("Upload the `.eventloom-ci/benchmark-*.json` reports");
    expect(release).toContain("EVENTLOOM_BENCH_HARDWARE");
    expect(release).toContain("docs/benchmarks.md");
    expect(release).toContain("eventloom.benchmark.v1");
    expect(release).toContain("release candidate");
  });

  it("checks actual packed docs and source maps before release", () => {
    const checker = readFileSync(join(root, "scripts", "check-pack-manifests.mjs"), "utf8");

    expect(checker).toContain("checkInlineSourceMaps(\"runtime\"");
    expect(checker).toContain("checkInlineSourceMaps(\"mcp\"");
    expect(checker).toContain("checkPackedMarkdownLinks(\"runtime\"");
    expect(checker).toContain("checkPackedMarkdownLinks(\"mcp\"");
    expect(checker).toContain("checkBin(\"runtime\"");
    expect(checker).toContain("checkBin(\"mcp\"");
    expect(checker).toContain("checkPackageEntrypoints(\"runtime\"");
    expect(checker).toContain("checkPackageEntrypoints(\"mcp\"");
    expect(checker).toContain("package export");
    expect(checker).toContain("hasPositivePackedSize");
    expect(checker).toContain("hasExecutablePackedMode");
    expect(checker).toContain("required packed file");
    expect(checker).toContain("must be executable in the packed tarball");
    expect(checker).toContain("extractMarkdownLinks");
  });

  it("generates export fixtures from the runtime package version", () => {
    const generator = readFileSync(join(root, "scripts", "generate-export-fixtures.ts"), "utf8");
    const exportFixtureTest = readFileSync(join(root, "tests", "export-fixtures.test.ts"), "utf8");
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");

    expect(generator).toContain("await runtimePackageVersion()");
    expect(generator).toContain("packageJson.version");
    expect(generator).toContain("writeOtlpFixture");
    expect(generator).toContain("formatOtlpJson");
    expect(exportFixtureTest).toContain('"otlp-success"');
    expect(exportFixtureTest).toContain('"otlp-negative"');
    expect(roadmap).toContain("Pathlight, HALO, and OTLP success and negative-path fixtures");
    expect(generator).not.toContain('packageVersion: "0.1.7"');
  });

  it("documents the executable v1 release preflight", () => {
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");
    const script = readFileSync(join(root, "scripts", "release-preflight.mjs"), "utf8");

    expect(release).toContain("npm run release:preflight:v1");
    expect(release).toContain("npm run release:preflight:runtime-v1");
    expect(release).toContain("npm run release:preflight:mcp-v1");
    expect(release).toContain("npm run release:preflight:mcp-v1-staged:local");
    expect(release).toContain("npm run publish:runtime-v1");
    expect(release).toContain("npm run publish:mcp-v1");
    expect(release).toContain("npm run ci:runtime-v1");
    expect(release).toContain("npm run ci:mcp-v1");
    expect(release).toContain("npm run ci:full-v1");
    expect(release).toContain("The runtime-first publish gate intentionally does not run");
    expect(release).toContain("runtime and MCP `prepack` scripts run tests and builds before pack or publish");
    expect(release).toContain("npm run pack:check");
    expect(release).toContain("eventloom.pack-manifests.v1");
    expect(readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8")).toContain("eventloom.pack-manifests.v1");
    expect(readFileSync(join(root, "docs", "github-actions-artifacts.md"), "utf8")).toContain("eventloom.pack-manifests.v1");
    expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toContain("eventloom.pack-manifests.v1");
    expect(release).toContain("`@eventloom/runtime` is ESM-only");
    expect(release).toContain("`@eventloom/mcp` is ESM-only");
    expect(release).toContain("Node.js `>=20` is required");
    expect(release).toContain("Do not publish from a dirty worktree");
    expect(release).toContain("CLI bin targets that are absent, empty, non-executable in the packed tarball");
    expect(release).toContain("#!/usr/bin/env node");
    expect(release).toContain("node scripts/check-pack-manifests.mjs --json");
    expect(release).toContain("invalid_pack_manifest_check_option");
    expect(release).toContain("npm run smoke:runtime-installed-cli");
    expect(release).toContain("npm run smoke:mcp-installed-bin");
    expect(release).toContain("npm run smoke:mcp-v1-local-runtime-bin");
    expect(release).toContain("temporary MCP v1 package");
    expect(release).toContain("# If the runtime package is already staged as `1.0.0`, skip `npm version 1.0.0 --no-git-tag-version`");
    expect(release).not.toMatch(/\nIf the runtime package is already staged as `1\.0\.0`/);
    expect(release).toContain("The runtime package should include only");
    expect(release).toContain("The MCP package currently ships only");
    expect(release).toContain("release branch is `main` or `master`");
    expect(release).toContain("runtime preflight requires `runtime-v1.0.0`");
    expect(release).toContain("MCP preflight requires `mcp-v1.0.0`");
    expect(release).toContain("full coordinated preflight requires `v1.0.0`");
    expect(release).toContain("@eventloom/runtime` package version is `1.0.0");
    expect(release).toContain("runtime package metadata, repository links, keywords, entrypoints, and lockfile package name match `@eventloom/runtime`");
    expect(release).toContain("root lockfile uses npm lockfile format version 3 and package version `1.0.0`");
    expect(release).toContain("@eventloom/mcp` dependency on `@eventloom/runtime` is `^1.0.0");
    expect(release).toContain("MCP package metadata, repository links, keywords, entrypoints, and lockfile package name match `@eventloom/mcp`");
    expect(release).toContain("MCP lockfile uses npm lockfile format version 3 and package version `1.0.0`");
    expect(release).toContain("the MCP server metadata constant is `1.0.0");
    expect(release).toContain("MCP v1 publication uses `--check-published-runtime` after the runtime package has been published");
    expect(release).toContain("The runtime package must be published before the MCP package version that depends on it");
    expect(release).toContain("Do not hand-edit the MCP lockfile to pretend a runtime tarball exists");
    expect(script).toContain("--phase");
    expect(script).toContain('"status", "--porcelain"');
    expect(script).toContain('"branch", "--show-current"');
    expect(script).toContain('"tag", "--points-at", "HEAD"');
    expect(script).toContain("runtime-v");
    expect(script).toContain("mcp-v");
    expect(script).toContain("mcp runtime dependency");
    expect(script).toContain("mcp version constant");
    expect(script).toContain("release doc references published runtime preflight");
    expect(script).toContain("release doc documents runtime-before-MCP publish order");
    expect(script).toContain("release doc warns against hand-edited MCP lockfile");
    const stagedScript = readFileSync(join(root, "scripts", "release-preflight-mcp-v1-local-staged.mjs"), "utf8");
    expect(stagedScript).toContain("localRuntimeTarball");
    expect(stagedScript).toContain("npm");
    expect(stagedScript).toContain("install");
    expect(stagedScript).toContain("--package-lock-only");
    expect(stagedScript).toContain("await main(process.argv.slice(2))");
    expect(stagedScript).toContain("const wantsJson = argv.includes(\"--json\")");
    expect(stagedScript).toContain("failureReport(stagedRoot, error)");
    expect(stagedScript).toContain("invalid_staged_mcp_preflight_option");
    expect(stagedScript).toContain("diagnostic: stagedMcpPreflightDiagnostic(error)");
    expect(stagedScript).toContain("args.json ? JSON.stringify");
    expect(stagedScript).toContain("stagedRuntimeTarball");
    expect(stagedScript).toContain('stdio: args.json ? ["ignore", "ignore", "pipe"] : "inherit"');
    expect(release).toContain("git tag runtime-v1.0.0");
    expect(release).toContain("git add packages/mcp/package.json packages/mcp/package-lock.json packages/mcp/src/version.ts");
    expect(release).toContain("git commit -m \"Release MCP v1.0.0\"");
    expect(release).toContain("git tag mcp-v1.0.0");
  });

  it("packs smoke-test tarballs into script-owned temp directories", () => {
    const mcpSmoke = readFileSync(join(root, "scripts", "smoke-mcp-local-runtime.mjs"), "utf8");
    const customWorkflowSmoke = readFileSync(join(root, "scripts", "smoke-custom-workflow-package.mjs"), "utf8");
    const runtimeCliSmoke = readFileSync(join(root, "scripts", "smoke-runtime-installed-cli.mjs"), "utf8");
    const mcpInstalledSmoke = readFileSync(join(root, "packages", "mcp", "scripts", "smoke-installed-bin.mjs"), "utf8");

    expect(mcpSmoke).toContain('"--pack-destination"');
    expect(customWorkflowSmoke).toContain('"--pack-destination"');
    expect(runtimeCliSmoke).toContain('"--pack-destination"');
    expect(runtimeCliSmoke).toContain("--no-install");
    expect(runtimeCliSmoke).toContain("eventloom");
    expect(runtimeCliSmoke).toContain("artifacts");
    expect(runtimeCliSmoke).toContain('"verify"');
    expect(runtimeCliSmoke).toContain("artifacts.inputDigest?.path !== logPath");
    expect(runtimeCliSmoke).toContain("artifacts.files?.inspectJson");
    expect(runtimeCliSmoke).toContain("artifacts.files?.queryJson");
    expect(runtimeCliSmoke).toContain("artifactVerification.version !== \"eventloom.artifact-bundle-verification.v1\"");
    expect(runtimeCliSmoke).toContain("artifactVerification.checkedFiles !== 10");
    expect(runtimeCliSmoke).toContain("export");
    expect(runtimeCliSmoke).toContain("otlp");
    expect(runtimeCliSmoke).toContain("resourceSpans");
    expect(runtimeCliSmoke).toContain("human-ops");
    expect(runtimeCliSmoke).toContain("approval.granted");
    expect(runtimeCliSmoke).toContain("--resume");
    expect(mcpInstalledSmoke).toContain('"--pack-destination"');
    expect(mcpInstalledSmoke).toContain("StdioClientTransport");
    expect(mcpInstalledSmoke).toContain("eventloom-mcp");
	    expect(mcpInstalledSmoke).toContain("eventloom_run_builtin");
    expect(mcpInstalledSmoke).toContain("eventloom_inspect");
    expect(mcpInstalledSmoke).toContain("eventloom_write_artifacts");
    expect(mcpInstalledSmoke).toContain("eventloom_verify_artifacts");
    expect(mcpInstalledSmoke).toContain("artifactContent?.inputDigest?.path");
    expect(mcpInstalledSmoke).toContain("artifactContent?.files?.inspectJson");
    expect(mcpInstalledSmoke).toContain("artifactContent?.files?.queryJson");
    expect(mcpInstalledSmoke).toContain("artifactVerification.structuredContent?.version !== \"eventloom.artifact-bundle-verification.v1\"");
    expect(mcpInstalledSmoke).toContain("checkedFiles !== 10");
    expect(mcpInstalledSmoke).toContain("eventloom_export_otlp");
    expect(mcpInstalledSmoke).toContain("resourceSpans");
    expect(mcpInstalledSmoke).toContain("stoppedReason");
    expect(mcpSmoke).toContain("copySmokeSupportFiles");
    expect(mcpSmoke).toContain("stdio-diagnostics.mjs");
    expect(mcpSmoke).toContain("scripts/chmod-cli-bins.mjs");
    expect(mcpSmoke).toContain("patchMcpPackageForTempBuild");
    const mcpV1StagingSmoke = readFileSync(join(root, "packages", "mcp", "scripts", "smoke-v1-local-runtime-bin.mjs"), "utf8");
    expect(mcpV1StagingSmoke).toContain('"@eventloom/runtime"');
    expect(mcpV1StagingSmoke).toContain("file:");
    expect(mcpV1StagingSmoke).toContain("EVENTLOOM_MCP_VERSION");
    expect(mcpV1StagingSmoke).toContain("stdio-diagnostics.mjs");
    expect(mcpV1StagingSmoke).toContain("scripts/chmod-cli-bins.mjs");
    expect(mcpV1StagingSmoke).toContain("packageJson.scripts.build");
    expect(mcpV1StagingSmoke).toContain("StdioClientTransport");
    expect(mcpV1StagingSmoke).toContain("eventloom_query");
    expect(mcpV1StagingSmoke).toContain("eventloom_inspect");
	    expect(mcpV1StagingSmoke).toContain("eventloom_run_builtin");
    expect(mcpV1StagingSmoke).toContain("eventloom_write_artifacts");
    expect(mcpV1StagingSmoke).toContain("eventloom_verify_artifacts");
    expect(mcpV1StagingSmoke).toContain("artifactContent?.inputDigest?.path");
    expect(mcpV1StagingSmoke).toContain("artifactContent?.files?.inspectJson");
    expect(mcpV1StagingSmoke).toContain("artifactContent?.files?.queryJson");
    expect(mcpV1StagingSmoke).toContain("artifactVerification.structuredContent?.version !== \"eventloom.artifact-bundle-verification.v1\"");
    expect(mcpV1StagingSmoke).toContain("checkedFiles !== 10");
    expect(mcpV1StagingSmoke).toContain("eventloom_export_otlp");
    expect(mcpV1StagingSmoke).toContain("createOtlpCollector");
    expect(mcpV1StagingSmoke).toContain("status !== 202");
    expect(mcpV1StagingSmoke).toContain("resourceSpans");
    expect(mcpV1StagingSmoke).toContain("stoppedReason");
    expect(mcpSmoke).not.toContain("runtimeTarball = join(root, packed[0].filename)");
    expect(customWorkflowSmoke).not.toContain("runtimeTarball = join(root, packed[0].filename)");
  });

  it("documents installed tarball smoke coverage for artifacts and OTLP export", () => {
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");
    const runtimeCliSmoke = readFileSync(join(root, "scripts", "smoke-runtime-installed-cli.mjs"), "utf8");

	    expect(release).toContain("npx eventloom artifacts /path/to/eventloom/fixtures/sample.jsonl --out /tmp/eventloom-artifacts");
	    expect(release).toContain("npx eventloom artifacts verify /tmp/eventloom-artifacts/manifest.json");
	    expect(release).toContain("npx eventloom export otlp /path/to/eventloom/fixtures/sample.jsonl --out /tmp/eventloom-otlp-traces.json");
    expect(release).toContain("--endpoint http://127.0.0.1:4318/v1/traces");
	    expect(runtimeCliSmoke).toContain('runEventloom(["artifacts"');
	    expect(runtimeCliSmoke).toContain('runEventloom(["artifacts", "verify"');
	    expect(runtimeCliSmoke).toContain('const otlp = await runEventloomAsync([');
    expect(runtimeCliSmoke).toContain("createOtlpCollector");
    expect(runtimeCliSmoke).toContain("otlp.status !== 202");
    expect(runtimeCliSmoke).toContain("otlp-traces.json");
    expect(runtimeCliSmoke).toContain("resourceSpans");
  });

  it("documents installed MCP bin smoke coverage for artifacts and OTLP export", () => {
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");
    const mcpInstalledSmoke = readFileSync(join(root, "packages", "mcp", "scripts", "smoke-installed-bin.mjs"), "utf8");
    const mcpV1StagingSmoke = readFileSync(join(root, "packages", "mcp", "scripts", "smoke-v1-local-runtime-bin.mjs"), "utf8");

    expect(release).toContain("Both installed MCP bin smokes exercise the artifact bundle and OTLP MCP tools through stdio");
    expect(release).toContain("records an `inputDigest` for the source JSONL log");
    expect(release).toContain("verifies all ten source-log and generated artifact digests");
    expect(release).toContain("delivers that same payload to a local OTLP HTTP collector endpoint with a `202` response");
	    expect(release).toContain("eventloom_write_artifacts");
	    expect(release).toContain("eventloom_verify_artifacts");
	    expect(release).toContain("eventloom_export_otlp");
	    for (const smoke of [mcpInstalledSmoke, mcpV1StagingSmoke]) {
      expect(smoke).toContain("eventloom_write_artifacts");
      expect(smoke).toContain("eventloom_verify_artifacts");
      expect(smoke).toContain("Unexpected verify_artifacts response");
      expect(smoke).toContain("inspect.json");
      expect(smoke).toContain("eventloom_export_otlp");
      expect(smoke).toContain("createOtlpCollector");
      expect(smoke).toContain("status !== 202");
      expect(smoke).toContain("assertCollectorReceivedPayload");
      expect(smoke).toContain("otlp-traces.json");
      expect(smoke).toContain("resourceSpans");
    }
  });

  it("requires the MCP package tarball to include the MIT license", () => {
    const checker = readFileSync(join(root, "scripts", "check-pack-manifests.mjs"), "utf8");
    const packageJson = readJson("packages/mcp/package.json");
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");

    expect(packageJson.files as string[]).toContain("LICENSE");
    expect(checker).toContain('"LICENSE"');
    expect(release).toContain("- `LICENSE`");
  });

  it("preflights MCP package files before publishing", () => {
    const preflight = readFileSync(join(root, "scripts", "release-preflight.mjs"), "utf8");
    const tests = readFileSync(join(root, "tests", "release-preflight.test.ts"), "utf8");

    expect(preflight).toContain("mcpPackageFileChecks");
    expect(preflight).toContain("runtime package ships dist");
    expect(preflight).toContain("runtime package ships license");
    expect(preflight).toContain("runtime package ships sample fixture");
    expect(preflight).toContain("runtime package ships golden fixtures");
    expect(preflight).toContain("runtime package ships export fixtures");
    expect(preflight).toContain("runtime package ships custom workflow example");
    expect(preflight).toContain("mcp package ships README");
    expect(preflight).toContain("mcp package ships license");
    expect(preflight).toContain("runtime prepack script");
    expect(preflight).toContain("mcp prepack script");
    expect(tests).toContain("requires the MCP package to ship runtime adapter files and user-facing metadata");
  });

  it("declares public publish access for scoped runtime and MCP packages", () => {
    expect(readJson("package.json").publishConfig).toEqual({ access: "public" });
    expect(readJson("packages/mcp/package.json").publishConfig).toEqual({ access: "public" });
    const preflight = readFileSync(join(root, "scripts", "release-preflight.mjs"), "utf8");
    const tests = readFileSync(join(root, "tests", "release-preflight.test.ts"), "utf8");
    expect(preflight).toContain("runtime publish access");
    expect(preflight).toContain("mcp publish access");
    expect(preflight).toContain("runtime package license");
    expect(preflight).toContain("mcp package license");
    expect(tests).toContain("requires runtime and MCP publish metadata to match public MIT packages");
  });

  it("preflights published package entrypoints before release", () => {
    const preflight = readFileSync(join(root, "scripts", "release-preflight.mjs"), "utf8");
    const tests = readFileSync(join(root, "tests", "release-preflight.test.ts"), "utf8");

    expect(preflight).toContain("runtimePackageEntrypointChecks");
    expect(preflight).toContain("runtimePackageMetadataChecks");
    expect(preflight).toContain("runtime repository url");
    expect(preflight).toContain("observability");
    expect(preflight).toContain("runtime main entry");
    expect(preflight).toContain("runtime bin eventloom");
    expect(preflight).toContain("runtime pathlight export import");
    expect(preflight).toContain("mcpPackageEntrypointChecks");
    expect(preflight).toContain("mcpPackageMetadataChecks");
    expect(preflight).toContain("mcp repository directory");
    expect(preflight).toContain("opentelemetry");
    expect(preflight).toContain("mcp main entry");
    expect(preflight).toContain("mcp bin eventloom-mcp");
    expect(preflight).toContain("runtime lockfile package name");
    expect(preflight).toContain("runtime lockfile format version");
    expect(preflight).toContain("mcp lockfile package name");
    expect(preflight).toContain("mcp lockfile format version");
    expect(preflight).toContain("release:preflight:v1:local");
    expect(preflight).toContain("release:preflight:runtime-v1:local");
    expect(preflight).toContain("release:preflight:mcp-v1:local");
    expect(tests).toContain("requires runtime and MCP package entrypoints to match the published ESM and CLI contracts");
    expect(tests).toContain("requires runtime and MCP npm metadata to point at the public Eventloom project");
    expect(tests).toContain("requires runtime and MCP lockfile package names to match the publish targets");
    expect(tests).toContain("requires runtime and MCP lockfiles to use the npm v3 lockfile format");
  });

  it("runs release gates in GitHub Actions", () => {
    const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    const release = readFileSync(join(root, "docs", "release.md"), "utf8");

    expect(workflow).toContain("strategy:");
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("node-version: [20.x, 22.x, 24.x]");
    expect(workflow).toContain("node-version: ${{ matrix.node-version }}");
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("package-lock.json");
    expect(workflow).toContain("packages/mcp/package-lock.json");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm --prefix packages/mcp ci");
    expect(workflow).toContain("npm run ci:runtime-v1");
    expect(workflow).toContain("Write runtime release evidence reports");
    expect(workflow).toContain("node scripts/check-golden-fixtures.mjs --json > \".eventloom-ci/golden-fixtures-node-${{ matrix.node-version }}.json\"");
    expect(workflow).toContain("node scripts/check-export-fixtures.mjs --json > \".eventloom-ci/export-fixtures-node-${{ matrix.node-version }}.json\"");
    expect(workflow).toContain("npm run --silent bench:smoke -- --out \".eventloom-ci/benchmark-smoke-node-${{ matrix.node-version }}.json\" > /dev/null");
    expect(workflow).toContain("node scripts/check-pack-manifests.mjs --json > \".eventloom-ci/pack-manifests-node-${{ matrix.node-version }}.json\"");
    expect(workflow).toContain("npm run --silent eventloom -- append .eventloom/agent-work.jsonl goal.created");
    expect(workflow).toContain("npm run --silent eventloom -- append .eventloom/agent-work.jsonl verification.completed");
    expect(workflow).toContain("npm run --silent eventloom -- artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts");
    expect(workflow).toContain("npm run --silent eventloom -- artifacts verify .eventloom/artifacts/manifest.json");
    expect(workflow).toContain(".eventloom-ci/artifact-bundle-verify-node-${{ matrix.node-version }}.json");
    expect(workflow).toContain("Upload runtime release evidence reports");
    expect(workflow).toContain("runtime-release-evidence-node-${{ matrix.node-version }}");
    expect(workflow).toContain(".eventloom/agent-work.jsonl");
    expect(workflow).toContain(".eventloom/artifacts/");
    expect(workflow).toContain("npm run --silent release:preflight:mcp-v1-staged:local -- --json");
    expect(workflow).toContain("tee \".eventloom-ci/staged-mcp-v1-preflight-node-${{ matrix.node-version }}.json\"");
    expect(workflow).toContain("Upload staged MCP v1 preflight report");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("staged-mcp-v1-preflight-node-${{ matrix.node-version }}");
    expect(workflow).toContain("if-no-files-found: error");
    expect(release).toContain(".github/workflows/ci.yml");
    expect(release).toContain("Node.js 20, 22, and 24");
    expect(release).toContain("runtime-first release gate and the staged MCP v1 local preflight");
    expect(release).toContain(".eventloom-ci/golden-fixtures-node-<node-version>.json");
    expect(release).toContain(".eventloom-ci/export-fixtures-node-<node-version>.json");
    expect(release).toContain(".eventloom-ci/benchmark-smoke-node-<node-version>.json");
    expect(release).toContain(".eventloom-ci/pack-manifests-node-<node-version>.json");
    expect(release).toContain(".eventloom-ci/artifact-bundle-verify-node-<node-version>.json");
    expect(release).toContain("eventloom artifacts verify .eventloom/artifacts/manifest.json");
    expect(release).toContain("runtime-release-evidence-node-<node-version>");
    expect(release).toContain(".eventloom-ci/staged-mcp-v1-preflight-node-<node-version>.json");
    expect(release).toContain("eventloom.release-preflight.v1");
    expect(release).toContain("parseable reports per matrix entry");
    expect(release).toContain("artifact-bundle verification");
    expect(release).not.toContain("runs the same release gate on Node.js 20, 22, and 24");

    const preflight = readFileSync(join(root, "scripts", "release-preflight.mjs"), "utf8");
    expect(preflight).toContain("workflow uses setup-node v4");
    expect(preflight).toContain("workflow caches runtime lockfile");
    expect(preflight).toContain("workflow caches MCP lockfile");
    expect(preflight).toContain("workflow installs runtime dependencies from lockfile");
    expect(preflight).toContain("workflow installs MCP dependencies from lockfile");
  });

  it("keeps the roadmap aligned with phase-specific v1 release gates", () => {
    const roadmap = readFileSync(join(root, "docs", "roadmap-v1.md"), "utf8");

    expect(roadmap).toContain("`npm run ci:runtime-v1`");
    expect(roadmap).toContain("`npm run ci:mcp-v1`");
    expect(roadmap).toContain("`npm run ci:full-v1`");
    expect(roadmap).toContain("`npm run smoke:mcp-v1-local-runtime-bin`");
    expect(roadmap).toContain("The default `npm run ci` currently aliases the runtime-first v1 gate");
    expect(roadmap).toContain("CI-uploaded runtime release evidence that includes a tamper-evident Eventloom agent work log plus a verified artifact bundle manifest");
    expect(roadmap).toContain("runs `eventloom artifacts verify .eventloom/artifacts/manifest.json`");
    expect(roadmap).toContain("bound to the source log by `inputDigest`");
    expect(roadmap).toContain("`verifyArtifactBundleFiles()`, `eventloom artifacts verify <manifest.json>`, and `eventloom_verify_artifacts`");
    expect(roadmap).not.toContain("Root `npm run ci` release gate covering runtime, MCP");
  });
});

function hasLeadingJsDoc(source: string, exportName: string): boolean {
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(String.raw`\/\*\*[\s\S]*?\*\/\s*export\s+(?:async\s+)?(?:class|interface|function|type|const)\s+${escaped}\b`);
  return pattern.test(source);
}

function hasLeadingMethodJsDoc(source: string, methodName: string): boolean {
  const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(String.raw`\/\*\*[\s\S]*?\*\/\s*(?:async\s+)?${escaped}\s*\(`);
  return pattern.test(source);
}

function commandBlockAfter(source: string, heading: string): string[] {
  const start = source.indexOf(heading);
  expect(start, `missing heading ${heading}`).toBeGreaterThanOrEqual(0);
  const afterHeading = source.slice(start + heading.length);
  const match = afterHeading.match(/```bash\n([\s\S]*?)\n```/);
  expect(match, `missing bash command block after ${heading}`).not.toBeNull();
  return match![1].split("\n").filter((line) => line.trim().length > 0);
}

function splitScriptCommands(script: string): string[] {
  return script.split(" && ");
}
