import type { EventEnvelope } from "./events.js";
import { verifyEventChain, type IntegrityReport } from "./integrity.js";
import { eventTypeCounts } from "./projection.js";
import { projectTasks, type TaskState } from "./task-projection.js";

export interface HandoffSummary {
  eventCount: number;
  eventTypes: Record<string, number>;
  integrity: IntegrityReport;
  goals: HandoffGoal[];
  tasks: {
    active: HandoffTask[];
    completed: HandoffTask[];
  };
  projectionErrors: HandoffProjectionError[];
  decisions: HandoffFact[];
  verification: HandoffFact[];
  releases: HandoffFact[];
  risks: HandoffFact[];
  recentFacts: HandoffFact[];
  telemetry: HandoffTelemetry;
  observabilityGaps: string[];
  nextActions: string[];
}

export interface HandoffGoal {
  id: string;
  actorId: string;
  title: string;
  timestamp: string;
}

export interface HandoffTask {
  id: string;
  title?: string;
  status: TaskState["status"];
  actorId: string;
  lastEventId: string;
}

export interface HandoffFact {
  id: string;
  type: string;
  actorId: string;
  timestamp: string;
  summary: string;
  evidence: HandoffFactEvidence;
}

export interface HandoffFactEvidence {
  command?: string;
  checks: string[];
  assertions: string[];
  evidenceEventIds: string[];
  artifactIds: string[];
  passCount?: number;
  failCount?: number;
}

export interface HandoffProjectionError {
  eventId: string;
  type: string;
  message: string;
}

export interface HandoffTelemetry {
  models: HandoffModelCall[];
  tools: HandoffToolCall[];
  reasoning: HandoffReasoningSummary[];
}

export interface HandoffModelCall {
  callId: string;
  actorId: string;
  provider: string;
  modelName: string;
  status: "completed" | "failed" | "missing";
  promptVersion?: string;
  inputSummary?: string;
  outputSummary?: string;
  parameters?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  latencyMs?: number;
  error?: string;
}

export interface HandoffToolCall {
  callId: string;
  actorId: string;
  toolName: string;
  status: "completed" | "failed" | "missing";
  inputSummary?: string;
  outputSummary?: string;
  exitCode?: number;
  resultCount?: number;
  resultExcerpt?: string;
  decisive?: boolean;
  latencyMs?: number;
  error?: string;
}

export interface HandoffReasoningSummary {
  id: string;
  actorId: string;
  summary: string;
  confidence?: number;
  evidenceEventIds: string[];
}

const completedStatuses = new Set<TaskState["status"]>(["completed", "approved"]);

export function summarizeHandoff(events: readonly EventEnvelope[]): HandoffSummary {
  const taskProjection = projectTasks(events);
  const tasks = Object.values(taskProjection.tasks)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(taskSummary);
  const active = tasks.filter((task) => !completedStatuses.has(task.status));
  const completed = tasks.filter((task) => completedStatuses.has(task.status));
  const integrity = verifyEventChain(events);
  const decisions = factsFor(events, "decision.recorded");
  const verification = events
    .filter((event) => event.type.startsWith("verification."))
    .map(factSummary);
  const releases = events
    .filter((event) => event.type.startsWith("release."))
    .map(factSummary);
  const risks = events
    .filter((event) => event.type.startsWith("risk."))
    .map(factSummary);
  const telemetry = summarizeTelemetry(events);
  const observabilityGaps = findObservabilityGaps(telemetry, verification);

  return {
    eventCount: events.length,
    eventTypes: eventTypeCounts(events),
    integrity,
    goals: events
      .filter((event) => event.type === "goal.created")
      .map(goalSummary),
    tasks: { active, completed },
    projectionErrors: taskProjection.errors,
    decisions,
    verification,
    releases,
    risks,
    recentFacts: recentFacts([...decisions, ...verification, ...releases, ...risks]),
    telemetry,
    observabilityGaps,
    nextActions: nextActions(active, integrity, taskProjection.errors, observabilityGaps),
  };
}

export function formatHandoffSummary(summary: HandoffSummary): string {
  return [
    "handoff summary",
    `events: ${summary.eventCount}`,
    `integrity: ${summary.integrity.ok ? "ok" : "failed"}`,
    `event types: ${formatEventTypeCounts(summary.eventTypes)}`,
    "",
    section("goals", summary.goals.map((goal) => `- ${goal.title} (${goal.id})`)),
    "",
    section("active tasks", summary.tasks.active.map(formatTask)),
    "",
    section("completed tasks", summary.tasks.completed.map(formatTask)),
    "",
    section("projection errors", summary.projectionErrors.map(formatProjectionError)),
    "",
    section("decisions", summary.decisions.map(formatFact)),
    "",
    section("verification", summary.verification.map(formatFact)),
    "",
    section("releases", summary.releases.map(formatFact)),
    "",
    section("risks", summary.risks.map(formatFact)),
    "",
    section("recent facts", summary.recentFacts.map(formatFact)),
    "",
    section("model telemetry", summary.telemetry.models.map(formatModelCall)),
    "",
    section("tool telemetry", summary.telemetry.tools.map(formatToolCall)),
    "",
    section("reasoning summaries", summary.telemetry.reasoning.map(formatReasoningSummary)),
    "",
    section("observability gaps", summary.observabilityGaps.map((gap) => `- ${gap}`)),
    "",
    section("next actions", summary.nextActions.map((action) => `- ${action}`)),
  ].join("\n");
}

function goalSummary(event: EventEnvelope): HandoffGoal {
  return {
    id: event.id,
    actorId: event.actorId,
    title: stringPayload(event, "title") ?? "(untitled goal)",
    timestamp: event.timestamp,
  };
}

function taskSummary(task: TaskState): HandoffTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    actorId: task.actorId,
    lastEventId: task.lastEventId,
  };
}

function factsFor(events: readonly EventEnvelope[], type: string): HandoffFact[] {
  return events.filter((event) => event.type === type).map(factSummary);
}

function factSummary(event: EventEnvelope): HandoffFact {
  const baseSummary = (
    stringPayload(event, "summary") ??
    stringPayload(event, "decision") ??
    stringPayload(event, "title") ??
    JSON.stringify(event.payload)
  );
  const evidence = factEvidence(event);
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    timestamp: event.timestamp,
    summary: appendFactEvidence(baseSummary, evidence),
    evidence,
  };
}

function factEvidence(event: EventEnvelope): HandoffFactEvidence {
  return {
    command: stringPayload(event, "command") ?? undefined,
    checks: stringArrayPayload(event, "checks"),
    assertions: stringArrayPayload(event, "assertions"),
    evidenceEventIds: stringArrayPayload(event, "evidenceEventIds"),
    artifactIds: stringArrayPayload(event, "artifactIds"),
    passCount: numberPayload(event, "passCount") ?? undefined,
    failCount: numberPayload(event, "failCount") ?? undefined,
  };
}

function appendFactEvidence(summary: string, evidence: HandoffFactEvidence): string {
  const details: string[] = [];
  if (evidence.command) details.push(`command=${evidence.command}`);
  if (evidence.checks.length > 0) details.push(`checks=${evidence.checks.join(",")}`);
  if (evidence.assertions.length > 0) details.push(`assertions=${evidence.assertions.join(",")}`);
  if (evidence.evidenceEventIds.length > 0) details.push(`evidence=${evidence.evidenceEventIds.join(",")}`);
  if (evidence.artifactIds.length > 0) details.push(`artifacts=${evidence.artifactIds.join(",")}`);
  if (evidence.passCount !== undefined) details.push(`pass=${evidence.passCount}`);
  if (evidence.failCount !== undefined) details.push(`fail=${evidence.failCount}`);
  return details.length === 0 ? summary : `${summary} [${details.join("; ")}]`;
}

function recentFacts(facts: readonly HandoffFact[]): HandoffFact[] {
  return [...facts]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-5);
}

function summarizeTelemetry(events: readonly EventEnvelope[]): HandoffTelemetry {
  return {
    models: events
      .filter((event) => event.type === "model.started")
      .map((event) => summarizeModelCall(event, events)),
    tools: events
      .filter((event) => event.type === "tool.started")
      .map((event) => summarizeToolCall(event, events)),
    reasoning: events
      .filter((event) => event.type === "reasoning.summary")
      .map((event) => ({
        id: event.id,
        actorId: event.actorId,
        summary: stringPayload(event, "summary") ?? JSON.stringify(event.payload),
        confidence: numberPayload(event, "confidence") ?? undefined,
        evidenceEventIds: stringArrayPayload(event, "evidenceEventIds"),
      })),
  };
}

function summarizeModelCall(started: EventEnvelope, events: readonly EventEnvelope[]): HandoffModelCall {
  const callId = stringPayload(started, "modelCallId") ?? started.id;
  const completed = events.find((event) => (
    (event.type === "model.completed" || event.type === "model.failed") &&
    event.payload.modelCallId === callId
  ));
  return {
    callId,
    actorId: started.actorId,
    provider: stringPayload(completed ?? started, "modelProvider") ?? "unknown",
    modelName: stringPayload(completed ?? started, "modelName") ?? "unknown",
    status: completed?.type === "model.completed" ? "completed" : completed?.type === "model.failed" ? "failed" : "missing",
    promptVersion: stringPayload(started, "promptVersion") ?? undefined,
    inputSummary: stringPayload(started, "inputSummary") ?? undefined,
    outputSummary: stringPayload(completed, "outputSummary") ?? undefined,
    parameters: recordPayload(started, "parameters") ?? undefined,
    inputTokens: numberPayload(completed, "inputTokens") ?? undefined,
    outputTokens: numberPayload(completed, "outputTokens") ?? undefined,
    totalTokens: numberPayload(completed, "totalTokens") ?? undefined,
    cost: numberPayload(completed, "cost") ?? undefined,
    latencyMs: numberPayload(completed, "latencyMs") ?? undefined,
    error: stringPayload(completed, "error") ?? undefined,
  };
}

function summarizeToolCall(started: EventEnvelope, events: readonly EventEnvelope[]): HandoffToolCall {
  const callId = stringPayload(started, "toolCallId") ?? started.id;
  const completed = events.find((event) => (
    (event.type === "tool.completed" || event.type === "tool.failed") &&
    event.payload.toolCallId === callId
  ));
  return {
    callId,
    actorId: started.actorId,
    toolName: stringPayload(completed ?? started, "toolName") ?? "unknown",
    status: completed?.type === "tool.completed" ? "completed" : completed?.type === "tool.failed" ? "failed" : "missing",
    inputSummary: stringPayload(started, "inputSummary") ?? undefined,
    outputSummary: stringPayload(completed, "outputSummary") ?? undefined,
    exitCode: numberPayload(completed, "exitCode") ?? undefined,
    resultCount: numberPayload(completed, "resultCount") ?? undefined,
    resultExcerpt: stringPayload(completed, "resultExcerpt") ?? undefined,
    decisive: booleanPayload(completed, "decisive") ?? undefined,
    latencyMs: numberPayload(completed, "latencyMs") ?? undefined,
    error: stringPayload(completed, "error") ?? undefined,
  };
}

function findObservabilityGaps(telemetry: HandoffTelemetry, verification: readonly HandoffFact[]): string[] {
  const gaps: string[] = [];
  if (telemetry.models.length === 0) gaps.push("No model telemetry events recorded.");
  if (telemetry.tools.length === 0) gaps.push("No tool telemetry events recorded.");
  if (telemetry.reasoning.length === 0) gaps.push("No reasoning.summary events recorded.");
  if (telemetry.models.some((call) => call.status === "missing")) gaps.push("At least one model.started event has no terminal model event.");
  if (telemetry.tools.some((call) => call.status === "missing")) gaps.push("At least one tool.started event has no terminal tool event.");
  if (telemetry.models.some((call) => !call.inputSummary && !call.promptVersion)) {
    gaps.push("Model telemetry should include prompt version or input summary.");
  }
  if (telemetry.models.some((call) => call.status === "completed" && !call.outputSummary)) {
    gaps.push("Completed model telemetry should include output summary.");
  }
  if (telemetry.tools.some((call) => call.status === "completed" && call.exitCode === undefined && call.resultCount === undefined && !call.outputSummary && !call.resultExcerpt)) {
    gaps.push("Completed tool telemetry should include exit code, result count, output summary, or result excerpt.");
  }
  if (verification.some((fact) => fact.summary.length > 0 && !verificationHasEvidence(fact))) {
    gaps.push("Verification events should include command, checks, assertions, evidence ids, and artifacts or pass/fail counts.");
  }
  return gaps;
}

function verificationHasEvidence(fact: HandoffFact): boolean {
  const evidence = fact.evidence;
  return !!evidence.command &&
    (evidence.checks.length > 0 || evidence.assertions.length > 0) &&
    evidence.evidenceEventIds.length > 0 &&
    (evidence.artifactIds.length > 0 || evidence.passCount !== undefined || evidence.failCount !== undefined);
}

function nextActions(
  active: readonly HandoffTask[],
  integrity: IntegrityReport,
  projectionErrors: readonly HandoffProjectionError[],
  observabilityGaps: readonly string[],
): string[] {
  const actions: string[] = [];
  if (!integrity.ok) actions.push("Fix event log integrity before continuing or exporting.");
  if (projectionErrors.length > 0) actions.push("Resolve projection errors before using this log as a canonical trace.");
  if (observabilityGaps.length > 0) actions.push("Add missing observability evidence before treating this as a debugging-ready agent trace.");
  if (active.length === 0) return actions.length > 0 ? actions : ["No active tasks remain."];
  return actions.concat(active.map((task) => {
    const label = task.title ? `${task.id}: ${task.title}` : task.id;
    return `Continue ${label} (${task.status}).`;
  }));
}

function stringPayload(event: EventEnvelope | undefined, key: string): string | null {
  const value = event?.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberPayload(event: EventEnvelope | undefined, key: string): number | null {
  const value = event?.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanPayload(event: EventEnvelope | undefined, key: string): boolean | null {
  const value = event?.payload[key];
  return typeof value === "boolean" ? value : null;
}

function recordPayload(event: EventEnvelope | undefined, key: string): Record<string, unknown> | null {
  const value = event?.payload[key];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArrayPayload(event: EventEnvelope, key: string): string[] {
  const value = event.payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function section(title: string, lines: string[]): string {
  return [title + ":", ...(lines.length > 0 ? lines : ["- none"])].join("\n");
}

function formatTask(task: HandoffTask): string {
  const title = task.title ? ` ${task.title}` : "";
  return `- ${task.id}${title} status=${task.status} lastActor=${task.actorId}`;
}

function formatFact(fact: HandoffFact): string {
  return `- ${fact.summary} (${fact.type} by ${fact.actorId})`;
}

function formatProjectionError(error: HandoffProjectionError): string {
  return `- ${error.message} (${error.type} ${error.eventId})`;
}

function formatModelCall(call: HandoffModelCall): string {
  const tokens = call.totalTokens === undefined ? "" : ` tokens=${call.totalTokens}`;
  const latency = call.latencyMs === undefined ? "" : ` latencyMs=${call.latencyMs}`;
  const prompt = call.promptVersion ? ` prompt=${call.promptVersion}` : "";
  const input = call.inputSummary ? ` input="${call.inputSummary}"` : "";
  const output = call.outputSummary ? ` output="${call.outputSummary}"` : "";
  const error = call.error ? ` error=${call.error}` : "";
  return `- ${call.callId} ${call.provider}/${call.modelName} status=${call.status}${tokens}${latency}${prompt}${input}${output}${error}`;
}

function formatToolCall(call: HandoffToolCall): string {
  const latency = call.latencyMs === undefined ? "" : ` latencyMs=${call.latencyMs}`;
  const exitCode = call.exitCode === undefined ? "" : ` exitCode=${call.exitCode}`;
  const resultCount = call.resultCount === undefined ? "" : ` results=${call.resultCount}`;
  const decisive = call.decisive === undefined ? "" : ` decisive=${call.decisive}`;
  const excerpt = call.resultExcerpt ? ` excerpt="${call.resultExcerpt}"` : "";
  const output = call.outputSummary ? ` output="${call.outputSummary}"` : "";
  const error = call.error ? ` error=${call.error}` : "";
  return `- ${call.callId} ${call.toolName} status=${call.status}${latency}${exitCode}${resultCount}${decisive}${output}${excerpt}${error}`;
}

function formatReasoningSummary(summary: HandoffReasoningSummary): string {
  const confidence = summary.confidence === undefined ? "" : ` confidence=${summary.confidence}`;
  const evidence = summary.evidenceEventIds.length === 0 ? "" : ` evidence=${summary.evidenceEventIds.join(",")}`;
  return `- ${summary.summary}${confidence}${evidence}`;
}

function formatEventTypeCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries.map(([type, count]) => `${type}=${count}`).join(", ");
}
