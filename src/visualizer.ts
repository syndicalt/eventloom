import { projectEffects, type EffectProjection } from "./effect-projection.js";
import type { EventEnvelope } from "./events.js";
import { summarizeHandoff, type HandoffSummary } from "./handoff.js";
import { verifyEventChain, type IntegrityReport } from "./integrity.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectResearch, type ResearchProjection } from "./research-projection.js";
import { projectTasks, type TaskProjection } from "./task-projection.js";

export interface VisualizerModel {
  capture: VisualizerCapture;
  replay: VisualizerReplay;
  handoff: HandoffSummary;
}

export interface VisualizerCapture {
  eventCount: number;
  eventTypes: Record<string, number>;
  events: VisualizerCaptureEvent[];
}

export interface VisualizerCaptureEvent {
  id: string;
  type: string;
  actorId: string;
  threadId: string;
  timestamp: string;
  parentEventId: string | null;
  causedBy: string[];
  summary: string;
  hash?: string;
  previousHash?: string | null;
}

export interface VisualizerReplay {
  eventCount: number;
  integrity: IntegrityReport;
  projection: VisualizerProjection;
  projectionHash: string;
}

export interface VisualizerProjection {
  eventTypes: Record<string, number>;
  effects: EffectProjection;
  research: ResearchProjection;
  tasks: TaskProjection;
}

export function buildVisualizerModel(events: readonly EventEnvelope[]): VisualizerModel {
  const eventTypes = eventTypeCounts(events);
  const projection = {
    eventTypes,
    effects: projectEffects(events),
    research: projectResearch(events),
    tasks: projectTasks(events),
  };

  return {
    capture: {
      eventCount: events.length,
      eventTypes,
      events: events.map(captureEvent),
    },
    replay: {
      eventCount: events.length,
      integrity: verifyEventChain(events),
      projection,
      projectionHash: projectionHash(projection),
    },
    handoff: summarizeHandoff(events),
  };
}

function captureEvent(event: EventEnvelope): VisualizerCaptureEvent {
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    threadId: event.threadId,
    timestamp: event.timestamp,
    parentEventId: event.parentEventId,
    causedBy: event.causedBy,
    summary: summarizeEvent(event),
    hash: event.integrity?.hash,
    previousHash: event.integrity?.previousHash,
  };
}

function summarizeEvent(event: EventEnvelope): string {
  const payload = event.payload;
  return (
    stringPayload(payload, "title") ??
    stringPayload(payload, "summary") ??
    stringPayload(payload, "decision") ??
    stringPayload(payload, "outputSummary") ??
    stringPayload(payload, "inputSummary") ??
    stringPayload(payload, "taskId") ??
    stringPayload(payload, "effectId") ??
    stringPayload(payload, "questionId") ??
    stringPayload(payload, "modelName") ??
    stringPayload(payload, "toolName") ??
    `actor=${event.actorId}`
  );
}

function stringPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
