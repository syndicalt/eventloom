import type { ActorRegistry } from "./actors.js";
import { JsonlEventStore } from "./event-store.js";
import { projectEffects, type EffectProjection } from "./effect-projection.js";
import { type EventEnvelope } from "./events.js";
import { exportToPathlight, type PathlightExportOptions, type PathlightExportResult } from "./export/pathlight.js";
import { appendExternalEvent, type AppendExternalEventInput } from "./ingest.js";
import { verifyEventChain, type IntegrityReport } from "./integrity.js";
import { Orchestrator, type OrchestratorResult } from "./orchestrator.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectResearch, type ResearchProjection } from "./research-projection.js";
import {
  type ActorRunner,
  type RuntimeLoopOptions,
  type RuntimeLoopResult,
  runHumanOpsRuntime,
  runResearchPipelineRuntime,
  runRuntimeLoop,
  runSoftwareWorkRuntime,
} from "./runners.js";
import { projectTasks, type TaskProjection } from "./task-projection.js";

export type BuiltInWorkflow = "software-work" | "research-pipeline" | "human-ops";

export interface RuntimeProjection {
  eventTypes: Record<string, number>;
  effects: EffectProjection;
  research: ResearchProjection;
  tasks: TaskProjection;
}

export interface RuntimeReplay {
  eventCount: number;
  integrity: IntegrityReport;
  projection: RuntimeProjection;
  projectionHash: string;
}

export interface RuntimeRunOptions extends RuntimeLoopOptions {
  resume?: boolean;
}

export class ThreadlineRuntime {
  readonly store: JsonlEventStore;

  constructor(readonly path: string) {
    this.store = new JsonlEventStore(path);
  }

  async append(input: Omit<AppendExternalEventInput, "path">): Promise<EventEnvelope> {
    return appendExternalEvent({ path: this.path, ...input });
  }

  readAll(): Promise<EventEnvelope[]> {
    return this.store.readAll();
  }

  async replay(): Promise<RuntimeReplay> {
    return replayEvents(await this.store.readAll());
  }

  verify(): Promise<IntegrityReport> {
    return this.store.verify();
  }

  submitIntention(registry: ActorRegistry, value: unknown): Promise<OrchestratorResult> {
    return new Orchestrator(this.store, registry).submitIntention(value);
  }

  run(registry: ActorRegistry, runners: Record<string, ActorRunner>, options?: RuntimeLoopOptions): Promise<RuntimeLoopResult> {
    return runRuntimeLoop(this.store, registry, runners, options);
  }

  runBuiltIn(workflow: BuiltInWorkflow, options: RuntimeRunOptions = {}): Promise<RuntimeLoopResult> {
    return runBuiltInWorkflow(workflow, this.path, options);
  }

  async exportPathlight(options: PathlightExportOptions): Promise<PathlightExportResult> {
    return exportToPathlight(await this.store.readAll(), options);
  }
}

export function createRuntime(path: string): ThreadlineRuntime {
  return new ThreadlineRuntime(path);
}

export async function runBuiltInWorkflow(
  workflow: BuiltInWorkflow,
  path: string,
  options: RuntimeRunOptions = {},
): Promise<RuntimeLoopResult> {
  if (workflow === "software-work") return runSoftwareWorkRuntime(path, options);
  if (workflow === "research-pipeline") return runResearchPipelineRuntime(path, options);
  return runHumanOpsRuntime(path, options);
}

export function replayEvents(events: readonly EventEnvelope[]): RuntimeReplay {
  const projection = projectRuntime(events);
  return {
    eventCount: events.length,
    integrity: verifyEventChain(events),
    projection,
    projectionHash: projectionHash(projection),
  };
}

export function projectRuntime(events: readonly EventEnvelope[]): RuntimeProjection {
  return {
    eventTypes: eventTypeCounts(events),
    effects: projectEffects(events),
    research: projectResearch(events),
    tasks: projectTasks(events),
  };
}
