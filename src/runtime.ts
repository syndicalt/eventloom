import { createBuiltInRegistry, type ActorRegistry, type BuiltInWorkflow } from "./actors.js";
import {
  JsonlEventStore,
  type EventLogRecoveryOptions,
  type EventLogRecoveryResult,
  type EventLogVerificationReport,
  type JsonlEventStoreOptions,
} from "./event-store.js";
import { applyEffectEvent, projectEffects, type EffectProjection } from "./effect-projection.js";
import { type EventEnvelope } from "./events.js";
import { exportToHalo, type HaloExportOptions, type HaloExportResult } from "./export/halo.js";
import { exportToOtlp, type OtlpExportOptions, type OtlpExportResult } from "./export/otlp.js";
import { exportToPathlight, type PathlightExportOptions, type PathlightExportResult } from "./export/pathlight.js";
import { appendExternalEvent, type AppendExternalEventInput } from "./ingest.js";
import { verifyEventChain, type IntegrityReport } from "./integrity.js";
import { buildMailbox, type MailboxItem } from "./mailbox.js";
import { Orchestrator, type OrchestratorResult } from "./orchestrator.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { applyResearchEvent, projectResearch, type ResearchProjection } from "./research-projection.js";
import {
  type ActorRunner,
  type RuntimeLoopOptions,
  type RuntimeLoopResult,
  runHumanOpsRuntime,
  runResearchPipelineRuntime,
  runRuntimeLoop,
  runSoftwareWorkRuntime,
} from "./runners.js";
import { applyTaskEvent, projectTasks, type TaskProjection } from "./task-projection.js";
import { buildVisualizerModel, type VisualizerModel } from "./visualizer.js";
import type { ProjectionSnapshot } from "./snapshots.js";

/**
 * Combined deterministic projection state produced by Eventloom replay.
 */
export interface RuntimeProjection {
  eventTypes: Record<string, number>;
  effects: EffectProjection;
  research: ResearchProjection;
  tasks: TaskProjection;
}

/**
 * Replay result for a local log or in-memory event sequence.
 *
 * `eventCount` is the number of events used for projection, which may be the
 * verified prefix when integrity diagnostics are present.
 */
export interface RuntimeReplay {
  version: "eventloom.replay.v1";
  eventCount: number;
  integrity: IntegrityReport | EventLogVerificationReport;
  projection: RuntimeProjection;
  projectionHash: string;
}

/**
 * Replay result that records whether a projection snapshot cache was used.
 */
export interface RuntimeCachedReplay extends RuntimeReplay {
  cache: {
    hit: boolean;
    reason: "snapshot_anchor_mismatch" | "snapshot_integrity_failed" | "snapshot_projection_hash_mismatch" | "unsupported_snapshot_format" | null;
  };
  tailEventCount: number | null;
}

/**
 * Input for cache-assisted replay from a projection snapshot.
 */
export interface RuntimeReplayCacheOptions {
  snapshot: ProjectionSnapshot;
}

/**
 * Options for running a built-in workflow through the runtime facade.
 *
 * `eventStore` only tunes local store behavior such as lock retry timing; it
 * does not change event semantics, replay, or projection behavior.
 */
export interface RuntimeRunOptions extends RuntimeLoopOptions {
  resume?: boolean;
  eventStore?: JsonlEventStoreOptions;
}

/**
 * High-level facade over one local Eventloom JSONL log.
 *
 * The facade keeps the v1 API centered on append-only storage, verified replay,
 * orchestrated intention submission, built-in workflow runners, and read-only
 * export/view helpers.
 */
export class EventloomRuntime {
  readonly store: JsonlEventStore;

  constructor(readonly path: string) {
    this.store = new JsonlEventStore(path);
  }

  /**
   * Append one externally supplied event to this runtime log.
   *
   * The event is validated, sealed into the hash chain, and persisted through
   * the same JSONL store path used by the facade.
   */
  async append(input: Omit<AppendExternalEventInput, "path">): Promise<EventEnvelope> {
    return appendExternalEvent({ path: this.path, ...input });
  }

  /**
   * Read every event currently present in the local log.
   *
   * Use `replay()` or `verify()` when callers need integrity diagnostics before
   * trusting corrupt-tail logs.
   */
  readAll(): Promise<EventEnvelope[]> {
    return this.store.readAll();
  }

  /**
   * Verify the log and rebuild all runtime projections from the valid prefix.
   */
  async replay(): Promise<RuntimeReplay> {
    const snapshot = await this.store.readVerifiedSnapshot();
    return replayEvents(snapshot.validEvents, snapshot.report);
  }

  /**
   * Replay using a projection snapshot when its anchor and projection hash match.
   *
   * Falls back to full verified replay when the snapshot is unsupported, stale,
   * or fails integrity checks.
   */
  async replayCached(options: RuntimeReplayCacheOptions): Promise<RuntimeCachedReplay> {
    const snapshot = options.snapshot;
    const fallback = async (reason: RuntimeCachedReplay["cache"]["reason"]): Promise<RuntimeCachedReplay> => ({
      ...(await this.replay()),
      cache: { hit: false, reason },
      tailEventCount: null,
    });

    if (snapshot.format !== "eventloom.projection-snapshot.v1") return fallback("unsupported_snapshot_format");
    if (!hasValidSnapshotEventIds(snapshot)) return fallback("unsupported_snapshot_format");
    if (projectionHash(snapshot.projection) !== snapshot.projectionHash) return fallback("snapshot_projection_hash_mismatch");

    const tail = await this.store.readVerifiedTail({
      eventCount: snapshot.eventCount,
      lastGoodHash: snapshot.lastEventHash,
    });
    if (!tail.report.ok) return fallback("snapshot_integrity_failed");
    if (!tail.anchorMatched) return fallback("snapshot_anchor_mismatch");

    const projection = tail.tailEvents.reduce(applyRuntimeEvent, snapshot.projection);
    return {
      version: "eventloom.replay.v1",
      eventCount: snapshot.eventCount + tail.tailEvents.length,
      integrity: tail.report,
      projection,
      projectionHash: projectionHash(projection),
      cache: { hit: true, reason: null },
      tailEventCount: tail.tailEvents.length,
    };
  }

  /**
   * Verify the append-only hash chain and return detailed log diagnostics.
   */
  verify(): Promise<EventLogVerificationReport> {
    return this.store.verify();
  }

  /**
   * Write the verified event prefix to a new JSONL file for corrupt-tail recovery.
   */
  recoverVerifiedPrefix(outputPath: string, options: EventLogRecoveryOptions = {}): Promise<EventLogRecoveryResult> {
    return this.store.recoverVerifiedPrefix(outputPath, options);
  }

  /**
   * Submit one actor intention through orchestrator validation.
   *
   * Accepted intentions append concrete events; invalid or rejected intentions
   * append explicit rejection events.
   */
  submitIntention(registry: ActorRegistry, value: unknown): Promise<OrchestratorResult> {
    return new Orchestrator(this.store, registry).submitIntention(value);
  }

  /**
   * Run a custom actor registry and runner set against this runtime log.
   */
  run(registry: ActorRegistry, runners: Record<string, ActorRunner>, options?: RuntimeLoopOptions): Promise<RuntimeLoopResult> {
    return runRuntimeLoop(this.store, registry, runners, options);
  }

  /**
   * Run one built-in deterministic workflow against this runtime log path.
   */
  runBuiltIn(workflow: BuiltInWorkflow, options: RuntimeRunOptions = {}): Promise<RuntimeLoopResult> {
    return runBuiltInWorkflow(workflow, this.path, options);
  }

  /**
   * Export the log's verified prefix to Pathlight-compatible trace payloads.
   */
  async exportPathlight(options: PathlightExportOptions): Promise<PathlightExportResult> {
    const snapshot = await this.store.readVerifiedSnapshot();
    return exportToPathlight(snapshot.validEvents, { ...options, integrityReport: snapshot.report });
  }

  /**
   * Export the log's verified prefix to HALO-compatible trace payloads.
   */
  async exportHalo(options: HaloExportOptions = {}): Promise<HaloExportResult> {
    const snapshot = await this.store.readVerifiedSnapshot();
    return exportToHalo(snapshot.validEvents, { ...options, integrityReport: snapshot.report });
  }

  /**
   * Export the log's verified prefix to generic OpenTelemetry OTLP trace JSON.
   */
  async exportOtlp(options: OtlpExportOptions = {}): Promise<OtlpExportResult> {
    const snapshot = await this.store.readVerifiedSnapshot();
    return exportToOtlp(snapshot.validEvents, { ...options, integrityReport: snapshot.report });
  }

  /**
   * Rebuild one built-in actor mailbox from the log's verified prefix.
   */
  async mailbox(workflow: BuiltInWorkflow, actorId: string): Promise<MailboxItem[]> {
    const snapshot = await this.store.readVerifiedSnapshot();
    return buildMailbox(createBuiltInRegistry(workflow), actorId, snapshot.validEvents);
  }

  /**
   * Build the visualizer model from the log's verified prefix.
   *
   * Corrupt-tail diagnostics are preserved in the replay and handoff sections.
   */
  async visualize(): Promise<VisualizerModel> {
    const snapshot = await this.store.readVerifiedSnapshot();
    const model = buildVisualizerModel(snapshot.validEvents);
    return {
      ...model,
      replay: { ...model.replay, integrity: snapshot.report },
      handoff: { ...model.handoff, integrity: snapshot.report },
    };
  }
}

/**
 * Create the package facade for a local JSONL event log path.
 */
export function createRuntime(path: string): EventloomRuntime {
  return new EventloomRuntime(path);
}

function hasValidSnapshotEventIds(snapshot: ProjectionSnapshot): boolean {
  return Array.isArray(snapshot.eventIds) &&
    snapshot.eventIds.length === snapshot.eventCount &&
    snapshot.eventIds.every((eventId) => typeof eventId === "string");
}

/**
 * Run one of Eventloom's built-in deterministic workflows against a local log.
 */
export async function runBuiltInWorkflow(
  workflow: BuiltInWorkflow,
  path: string,
  options: RuntimeRunOptions = {},
): Promise<RuntimeLoopResult> {
  if (workflow === "software-work") return runSoftwareWorkRuntime(path, options);
  if (workflow === "research-pipeline") return runResearchPipelineRuntime(path, options);
  return runHumanOpsRuntime(path, options);
}

/**
 * Rebuild runtime projections from an already-loaded event sequence.
 *
 * This helper is pure with respect to the input events and is useful for tests,
 * fixture generation, and comparing in-memory replay with JSONL replay.
 */
export function replayEvents(events: readonly EventEnvelope[], integrity?: IntegrityReport | EventLogVerificationReport): RuntimeReplay {
  const projection = projectRuntime(events);
  return {
    version: "eventloom.replay.v1",
    eventCount: events.length,
    integrity: integrity ?? verifyEventChain(events),
    projection,
    projectionHash: projectionHash(projection),
  };
}

/**
 * Project all runtime domains from a complete event sequence.
 */
export function projectRuntime(events: readonly EventEnvelope[]): RuntimeProjection {
  return {
    eventTypes: eventTypeCounts(events),
    effects: projectEffects(events),
    research: projectResearch(events),
    tasks: projectTasks(events),
  };
}

/**
 * Apply one event to an existing runtime projection for cache-tail replay.
 */
export function applyRuntimeEvent(projection: RuntimeProjection, event: EventEnvelope): RuntimeProjection {
  return {
    eventTypes: {
      ...projection.eventTypes,
      [event.type]: (projection.eventTypes[event.type] ?? 0) + 1,
    },
    effects: applyEffectEvent(projection.effects, event),
    research: applyResearchEvent(projection.research, event),
    tasks: applyTaskEvent(projection.tasks, event),
  };
}
