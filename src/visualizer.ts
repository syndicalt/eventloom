import { projectEffects, type EffectProjection } from "./effect-projection.js";
import type { EventEnvelope } from "./events.js";
import type { EventLogVerificationReport } from "./event-store.js";
import { summarizeHandoff, type HandoffSummary } from "./handoff.js";
import { verifyEventChain, type IntegrityReport } from "./integrity.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectResearch, type ResearchProjection } from "./research-projection.js";
import { projectTasks, type TaskProjection } from "./task-projection.js";

/**
 * Version-stable model for Capture, Replay, and Handoff visualizer views.
 */
export interface VisualizerModel {
  version: "eventloom.visualizer.v1";
  capture: VisualizerCapture;
  replay: VisualizerReplay;
  handoff: HandoffSummary;
}

/**
 * Capture view of ordered events, event type counts, and compact event
 * summaries.
 */
export interface VisualizerCapture {
  eventCount: number;
  eventTypes: Record<string, number>;
  events: VisualizerCaptureEvent[];
}

/**
 * Event summary shape used by the visualizer capture view.
 */
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

/**
 * Replay view containing integrity status, deterministic projections, and
 * projection hash data.
 */
export interface VisualizerReplay {
  eventCount: number;
  integrity: IntegrityReport | EventLogVerificationReport;
  projection: VisualizerProjection;
  projectionHash: string;
}

/**
 * Projection bundle rendered by the visualizer replay view.
 */
export interface VisualizerProjection {
  eventTypes: Record<string, number>;
  effects: EffectProjection;
  research: ResearchProjection;
  tasks: TaskProjection;
}

/**
 * Options for rendering a self-contained static Eventloom visualizer document.
 */
export interface VisualizerHtmlOptions {
  title?: string;
}

/**
 * Builds the structured Capture, Replay, and Handoff visualizer model from an
 * append-ordered Eventloom event history.
 */
export function buildVisualizerModel(events: readonly EventEnvelope[]): VisualizerModel {
  const eventTypes = eventTypeCounts(events);
  const projection = {
    eventTypes,
    effects: projectEffects(events),
    research: projectResearch(events),
    tasks: projectTasks(events),
  };

  return {
    version: "eventloom.visualizer.v1",
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

/**
 * Renders a visualizer model as self-contained static HTML with escaped inert
 * embedded JSON for repository-local or CI artifact review.
 */
export function renderVisualizerHtml(model: VisualizerModel, options: VisualizerHtmlOptions = {}): string {
  const title = options.title ?? "Eventloom Visualizer";
  const eventTypes = Object.entries(model.capture.eventTypes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `<li><code>${escapeHtml(type)}</code><span>${count}</span></li>`)
    .join("");
  const events = model.capture.events
    .map((event) => `<li><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(event.summary)}</span><small>${escapeHtml(event.actorId)} - ${escapeHtml(event.threadId)}</small></li>`)
    .join("");
  const activeTasks = model.handoff.tasks.active
    .map((task) => `<li><strong>${escapeHtml(task.id)}</strong><span>${escapeHtml(task.status)}</span></li>`)
    .join("");
  const completedTasks = model.handoff.tasks.completed
    .map((task) => `<li><strong>${escapeHtml(task.id)}</strong><span>${escapeHtml(task.status)}</span></li>`)
    .join("");
  const taskList = `${activeTasks}${completedTasks}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f8fb; color: #16181d; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    header { border-bottom: 1px solid #d8dde8; margin-bottom: 24px; padding-bottom: 16px; }
    h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    .meta { color: #596174; margin: 0; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    section { background: #ffffff; border: 1px solid #d8dde8; border-radius: 8px; padding: 16px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    li { display: grid; gap: 3px; border-top: 1px solid #edf0f5; padding-top: 8px; }
    li:first-child { border-top: 0; padding-top: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .metric { font-size: 24px; font-weight: 700; margin: 0; }
    small, .muted { color: #697386; }
    @media (prefers-color-scheme: dark) {
      body { background: #101318; color: #f0f3f8; }
      header, section, li { border-color: #303746; }
      section { background: #171b22; }
      .meta, small, .muted { color: #a8b1c2; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">Static Eventloom visualizer export. Projection hash <code>${escapeHtml(model.replay.projectionHash)}</code>.</p>
    </header>
    <div class="grid">
      <section>
        <h2>Capture</h2>
        <p class="metric">${model.capture.eventCount}</p>
        <p class="muted">captured events</p>
        <ul>${eventTypes}</ul>
      </section>
      <section>
        <h2>Replay</h2>
        <p class="metric">${model.replay.integrity.ok ? "Valid" : "Invalid"}</p>
        <p class="muted">hash-chain integrity</p>
        <p><code>${escapeHtml(model.replay.projectionHash)}</code></p>
      </section>
      <section>
        <h2>Handoff</h2>
        <p class="metric">${model.handoff.nextActions.length}</p>
        <p class="muted">next actions</p>
        <ul>${taskList.length > 0 ? taskList : "<li><span>No projected tasks.</span></li>"}</ul>
      </section>
    </div>
    <section style="margin-top: 16px;">
      <h2>Events</h2>
      <ul>${events}</ul>
    </section>
  </main>
  <script id="eventloom-visualizer-data" type="application/json">${escapeJsonForHtml(model)}</script>
</body>
</html>
`;
}

function stringPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
