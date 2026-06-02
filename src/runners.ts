import { rm } from "node:fs/promises";
import type { ActorDefinition, ActorRegistry } from "./actors.js";
import { createHumanOpsRegistry, createResearchPipelineRegistry, createSoftwareWorkRegistry } from "./actors.js";
import { JsonlEventStore, type JsonlEventStoreOptions } from "./event-store.js";
import { defaultEventFactory, type EventEnvelope, type EventFactory } from "./events.js";
import { projectEffects } from "./effect-projection.js";
import type { Intention } from "./intentions.js";
import { buildMailboxForActor, type MailboxItem } from "./mailbox.js";
import { Orchestrator } from "./orchestrator.js";
import { canonicalJson } from "./projection.js";
import { projectResearch } from "./research-projection.js";
import { projectTasks } from "./task-projection.js";

/**
 * Snapshot passed to an actor runner for one runtime turn.
 */
export interface ActorRunnerContext {
  actor: ActorDefinition;
  mailbox: MailboxItem[];
  events: EventEnvelope[];
}

/**
 * Callback contract for custom actor implementations invoked by the runtime loop.
 */
export type ActorRunner = (context: ActorRunnerContext) => Intention[];

export type RuntimeRunnerErrorCode = "actor_runner_failed" | "actor_runner_invalid_output";

/**
 * Stable runtime diagnostic for actor runner failures during a turn.
 */
export class RuntimeRunnerError extends Error {
  constructor(
    readonly code: RuntimeRunnerErrorCode,
    readonly actorId: string,
    readonly turnId: string,
    readonly sourceEventId: string,
    readonly causeMessage: string,
    cause?: unknown,
  ) {
    super(causeMessage);
    this.name = "RuntimeRunnerError";
    this.cause = cause;
  }
}

export type BuiltInProjectionKind = "tasks" | "research" | "effects";

/**
 * Projection failure detail emitted when a built-in workflow cannot safely resume.
 */
export interface RuntimeProjectionDiagnostic {
  code: string;
  eventId: string;
  type: string;
  message: string;
}

/**
 * Stable runtime diagnostic for built-in workflow projection failures.
 */
export class RuntimeProjectionError extends Error {
  readonly code = "runtime_projection_failed";

  constructor(
    readonly workflow: "software-work" | "research-pipeline" | "human-ops",
    readonly projectionKind: BuiltInProjectionKind,
    readonly errors: RuntimeProjectionDiagnostic[],
  ) {
    super(`${projectionKind} projection has errors: ${errors.map((error) => error.message).join("; ")}`);
    this.name = "RuntimeProjectionError";
  }
}

/**
 * Stable runtime diagnostic for invalid runtime loop options.
 */
export class RuntimeOptionsError extends Error {
  readonly code = "invalid_runtime_option";

  constructor(
    readonly option: keyof RuntimeLoopOptions,
    readonly value: unknown,
    readonly suggestedAction = "Use positive integer values for Eventloom runtime loop limits.",
  ) {
    super(`${option} must be a positive integer`);
    this.name = "RuntimeOptionsError";
  }
}

/**
 * Counters and stop reason produced by `runRuntimeLoop()`.
 */
export interface RuntimeLoopResult {
  iterations: number;
  appended: number;
  processed: number;
  turns: number;
  skipped: number;
  rejected: number;
  stoppedReason: "idle" | "max_iterations";
}

/**
 * Options shared by custom and built-in runtime loops.
 */
export interface RuntimeLoopOptions {
  maxIterations?: number;
  eventFactory?: EventFactory;
}

/**
 * Options for built-in workflows that own their local event store.
 */
export interface BuiltInRuntimeOptions extends RuntimeLoopOptions {
  resume?: boolean;
  eventStore?: JsonlEventStoreOptions;
}

/**
 * Run actor mailboxes until the workflow is idle or reaches the iteration cap.
 *
 * Actor intentions are deduplicated per loop and submitted through the
 * orchestrator; accepted, rejected, and processed marker events are appended to
 * the provided store.
 */
export async function runRuntimeLoop(
  store: JsonlEventStore,
  registry: ActorRegistry,
  runners: Record<string, ActorRunner>,
  options: RuntimeLoopOptions = {},
): Promise<RuntimeLoopResult> {
  validateRuntimeLoopOptions(options);
  const maxIterations = options.maxIterations ?? 20;
  const eventFactory = options.eventFactory ?? defaultEventFactory();
  const submitted = new Set<string>();
  let appended = 0;
  let processed = 0;
  let turns = 0;
  let skipped = 0;
  let rejected = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const events = await store.readAll();
    const orchestrator = new Orchestrator(store, registry, { eventFactory });
    let appendedThisIteration = 0;

    for (const actor of registry.all()) {
      const runner = runners[actor.id];
      if (!runner) continue;

      const mailbox = buildMailboxForActor(actor, events);
      for (const item of mailbox) {
        const turnId = `turn_${String(turns + 1).padStart(6, "0")}`;
        const started = await store.append(eventFactory.create({
          type: "actor.started",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: item.event.id,
          causedBy: [item.event.id],
          payload: {
            turnId,
            sourceEventId: item.event.id,
            mailboxEventType: item.event.type,
          },
        }));
        turns += 1;
        appendedThisIteration += 1;

        const toolCallId = `tool_${turnId}`;
        const modelCallId = `model_${turnId}`;
        await store.append(eventFactory.create({
          type: "tool.started",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: started.id,
          causedBy: [started.id, item.event.id],
          payload: {
            turnId,
            toolCallId,
            toolName: "eventloom.mailbox.read",
            inputSummary: `Read one mailbox item for ${actor.id}.`,
            input: {
              actorId: actor.id,
              sourceEventId: item.event.id,
              mailboxEventType: item.event.type,
            },
          },
        }));
        appendedThisIteration += 1;

        await store.append(eventFactory.create({
          type: "tool.completed",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: started.id,
          causedBy: [started.id, item.event.id],
          payload: {
            turnId,
            toolCallId,
            toolName: "eventloom.mailbox.read",
            output: {
              itemCount: 1,
              taskId: item.task?.id ?? null,
              taskStatus: item.task?.status ?? null,
            },
            outputSummary: `Read 1 mailbox item (${item.event.type}).`,
            exitCode: 0,
            resultCount: 1,
            resultExcerpt: item.event.id,
            decisive: true,
            latencyMs: 1,
          },
        }));
        appendedThisIteration += 1;

        await store.append(eventFactory.create({
          type: "model.started",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: started.id,
          causedBy: [started.id, item.event.id],
          payload: {
            turnId,
            modelCallId,
            modelProvider: "eventloom",
            modelName: "deterministic-runner",
            promptVersion: "eventloom.deterministic-runner.v1",
            inputSummary: `Actor ${actor.id} handling ${item.event.type}.`,
            inputMessages: [
              { role: "system", content: actor.role },
              { role: "user", content: `Handle ${item.event.type} from ${item.event.actorId}.` },
            ],
            parameters: {
              temperature: 0,
              toolChoice: "none",
            },
          },
        }));
        appendedThisIteration += 1;

        const intentions = await runActorTurn({
          store,
          eventFactory,
          runner,
          actor,
          item,
          events,
          startedEventId: started.id,
          turnId,
          modelCallId,
        });
        await store.append(eventFactory.create({
          type: "reasoning.summary",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: started.id,
          causedBy: [started.id, item.event.id],
          payload: {
            turnId,
            summary: reasoningSummary(actor, item, intentions),
            alternativesConsidered: intentions.length === 0 ? ["No valid transition for mailbox item."] : [],
            evidenceEventIds: [item.event.id],
            confidence: 1,
          },
        }));
        appendedThisIteration += 1;

        await store.append(eventFactory.create({
          type: "model.completed",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: started.id,
          causedBy: [started.id, item.event.id],
          payload: {
            turnId,
            modelCallId,
            modelProvider: "eventloom",
            modelName: "deterministic-runner",
            outputText: `Emitted ${intentions.length} intention(s): ${intentions.map((intention) => intention.type).join(", ") || "none"}.`,
            outputSummary: intentions.length === 0
              ? "No intentions emitted."
              : `Emitted intentions: ${intentions.map((intention) => intention.type).join(", ")}.`,
            inputTokens: estimateTokens(`${actor.role} ${item.event.type}`),
            outputTokens: estimateTokens(intentions.map((intention) => intention.type).join(" ")),
            totalTokens: estimateTokens(`${actor.role} ${item.event.type}`) + estimateTokens(intentions.map((intention) => intention.type).join(" ")),
            cost: 0,
            latencyMs: 1,
          },
        }));
        appendedThisIteration += 1;

        const acceptedEvents: string[] = [];
        const rejectedEvents: string[] = [];

        for (const intention of intentions) {
          const key = canonicalJson(intention);
          if (submitted.has(key)) {
            skipped += 1;
            continue;
          }
          submitted.add(key);

          const result = await orchestrator.submitIntention(intention);
          if (result.accepted) {
            appended += 1;
            appendedThisIteration += 1;
            acceptedEvents.push(result.event.id);
          } else {
            rejected += 1;
            rejectedEvents.push(result.event.id);
          }
        }

        const completed = await store.append(eventFactory.create({
          type: "actor.completed",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: started.id,
          causedBy: [started.id, ...acceptedEvents, ...rejectedEvents],
          payload: {
            turnId,
            sourceEventId: item.event.id,
            intentions: intentions.map((intention) => intention.type),
            acceptedEvents,
            rejectedEvents,
          },
        }));
        appendedThisIteration += 1;

        await store.append(eventFactory.create({
          type: "actor.processed",
          actorId: actor.id,
          threadId: item.event.threadId,
          parentEventId: completed.id,
          causedBy: [completed.id],
          payload: {
            turnId,
            sourceEventId: item.event.id,
            intentions: intentions.map((intention) => intention.type),
          },
        }));
        processed += 1;
        appendedThisIteration += 1;
      }
    }

    if (appendedThisIteration === 0) {
      return { iterations: iteration, appended, processed, turns, skipped, rejected, stoppedReason: "idle" };
    }
  }

  return { iterations: maxIterations, appended, processed, turns, skipped, rejected, stoppedReason: "max_iterations" };
}

interface RunActorTurnInput {
  store: JsonlEventStore;
  eventFactory: EventFactory;
  runner: ActorRunner;
  actor: ActorDefinition;
  item: MailboxItem;
  events: EventEnvelope[];
  startedEventId: string;
  turnId: string;
  modelCallId: string;
}

async function runActorTurn(input: RunActorTurnInput): Promise<Intention[]> {
  try {
    const output = input.runner({ actor: input.actor, mailbox: [input.item], events: input.events });
    if (!Array.isArray(output)) {
      throw new RuntimeRunnerError(
        "actor_runner_invalid_output",
        input.actor.id,
        input.turnId,
        input.item.event.id,
        "Actor runner must return an array of intentions.",
      );
    }
    return output;
  } catch (error) {
    const runnerError = error instanceof RuntimeRunnerError
      ? error
      : new RuntimeRunnerError(
        "actor_runner_failed",
        input.actor.id,
        input.turnId,
        input.item.event.id,
        error instanceof Error ? error.message : String(error),
        error,
      );
    await appendRunnerFailureEvents(input, runnerError);
    throw runnerError;
  }
}

async function appendRunnerFailureEvents(input: RunActorTurnInput, error: RuntimeRunnerError): Promise<void> {
  const payload = {
    code: error.code,
    actorId: error.actorId,
    turnId: error.turnId,
    sourceEventId: error.sourceEventId,
    message: error.causeMessage,
  };
  await input.store.append(input.eventFactory.create({
    type: "model.failed",
    actorId: input.actor.id,
    threadId: input.item.event.threadId,
    parentEventId: input.startedEventId,
    causedBy: [input.startedEventId, input.item.event.id],
    payload: {
      ...payload,
      modelCallId: input.modelCallId,
      modelProvider: "eventloom",
      modelName: "deterministic-runner",
    },
  }));
  await input.store.append(input.eventFactory.create({
    type: "actor.failed",
    actorId: input.actor.id,
    threadId: input.item.event.threadId,
    parentEventId: input.startedEventId,
    causedBy: [input.startedEventId],
    payload,
  }));
}

function reasoningSummary(actor: ActorDefinition, item: MailboxItem, intentions: readonly Intention[]): string {
  const emitted = intentions.map((intention) => intention.type).join(", ") || "no intentions";
  return `${actor.id} handled ${item.event.type} as ${actor.role} and emitted ${emitted}.`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3));
}

export function createSoftwareWorkRunners(): Record<string, ActorRunner> {
  return {
    planner: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "goal.created")
      .map((item) => ({
        type: "task.propose",
        actorId: "planner",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          taskId: "task_actor_runtime",
          title: "Run actors from rebuilt mailboxes",
        },
      })),
    worker: ({ mailbox }) => mailbox.flatMap((item): Intention[] => {
      if (item.event.type === "task.proposed" && item.task?.status === "proposed") {
        return [{
          type: "task.claim",
          actorId: "worker",
          threadId: item.event.threadId,
          parentEventId: item.event.id,
          causedBy: [item.event.id],
          payload: { taskId: item.task.id },
        }];
      }
      if (item.event.type === "task.claimed" && item.task?.status === "claimed") {
        return [{
          type: "task.complete",
          actorId: "worker",
          threadId: item.event.threadId,
          parentEventId: item.event.id,
          causedBy: [item.event.id],
          payload: { taskId: item.task.id },
        }];
      }
      if (item.event.type === "task.completed" && item.task?.status === "completed") {
        return [{
          type: "review.request",
          actorId: "worker",
          threadId: item.event.threadId,
          parentEventId: item.event.id,
          causedBy: [item.event.id],
          payload: { taskId: item.task.id },
        }];
      }
      return [];
    }),
    reviewer: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "review.requested" && item.task?.status === "review_requested")
      .map((item) => ({
        type: "review.approve",
        actorId: "reviewer",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: { taskId: item.task?.id },
      })),
  };
}

export function createResearchPipelineRunners(): Record<string, ActorRunner> {
  return {
    researcher: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "research.question.created")
      .map((item) => ({
        type: "source.find",
        actorId: "researcher",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          questionId: String(item.event.payload.questionId),
          sourceId: "source_runtime_notes",
          title: "Runtime design notes",
          url: "eventloom://fixtures/runtime-design-notes",
        },
      })),
    analyst: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "source.found")
      .map((item) => ({
        type: "claim.extract",
        actorId: "analyst",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          questionId: String(item.event.payload.questionId),
          sourceId: String(item.event.payload.sourceId),
          claimId: "claim_evented_runtime",
          text: "Evented runtimes preserve causality better than transcript-only workflows.",
        },
      })),
    critic: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "claim.extracted")
      .map((item) => ({
        type: "claim.challenge",
        actorId: "critic",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          questionId: String(item.event.payload.questionId),
          claimId: String(item.event.payload.claimId),
          challengeId: "challenge_causality",
          verdict: "supported_for_local_replay",
        },
      })),
    writer: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "claim.challenged")
      .map((item) => ({
        type: "report.draftSection",
        actorId: "writer",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          questionId: String(item.event.payload.questionId),
          sectionId: "section_runtime_model",
          title: "Runtime model",
          content: "Eventloom coordinates research as validated actor turns over an append-only log.",
        },
      })),
    editor: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "report.section.drafted")
      .map((item) => ({
        type: "report.finalize",
        actorId: "editor",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          questionId: String(item.event.payload.questionId),
          reportId: "report_runtime_model",
          summary: "Eventloom's evented runtime gives research actors replayable state and provenance.",
        },
      })),
  };
}

export function createHumanOpsRunners(): Record<string, ActorRunner> {
  return {
    responder: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "external.alert.received")
      .map((item) => ({
        type: "effect.request",
        actorId: "responder",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          effectId: "effect_runtime_mitigation",
          action: "notify",
          target: "ops-on-call",
          description: `Investigate ${String(item.event.payload.title ?? "external alert")}`,
        },
      })),
    safety: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "effect.requested")
      .map((item) => ({
        type: "approval.request",
        actorId: "safety",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          effectId: String(item.event.payload.effectId),
          approvalId: "approval_runtime_mitigation",
          reason: "Human approval required before applying operational effects.",
        },
      })),
    applier: ({ mailbox }) => mailbox
      .filter((item) => item.event.type === "approval.granted")
      .map((item) => ({
        type: "effect.apply",
        actorId: "applier",
        threadId: item.event.threadId,
        parentEventId: item.event.id,
        causedBy: [item.event.id],
        payload: {
          effectId: String(item.event.payload.effectId),
          action: "notify",
          target: "ops-on-call",
          description: "Human-approved mitigation notification recorded.",
        },
      })),
  };
}

export async function runSoftwareWorkRuntime(path: string, options: BuiltInRuntimeOptions = {}): Promise<RuntimeLoopResult> {
  validateRuntimeLoopOptions(options);
  if (!options.resume) {
    await rm(path, { force: true });
  }

  const eventFactory = options.eventFactory ?? defaultEventFactory();
  const store = new JsonlEventStore(path, options.eventStore);
  const existing = await store.readAll();
  if (existing.length === 0) {
    await store.append(eventFactory.create({
      id: "evt_runtime_goal",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      payload: { title: "Build deterministic actor runners" },
    }));
  }

  const result = await runRuntimeLoop(
    store,
    createSoftwareWorkRegistry(),
    createSoftwareWorkRunners(),
    options,
  );
  assertNoProjectionErrors("software-work", "tasks", projectTasks(await store.readAll()).errors);
  return result;
}

export async function runResearchPipelineRuntime(path: string, options: BuiltInRuntimeOptions = {}): Promise<RuntimeLoopResult> {
  validateRuntimeLoopOptions(options);
  if (!options.resume) {
    await rm(path, { force: true });
  }

  const eventFactory = options.eventFactory ?? defaultEventFactory();
  const store = new JsonlEventStore(path, options.eventStore);
  const existing = await store.readAll();
  if (existing.length === 0) {
    await store.append(eventFactory.create({
      id: "evt_research_question",
      type: "research.question.created",
      actorId: "user",
      threadId: "thread_research",
      parentEventId: null,
      payload: {
        questionId: "question_evented_runtime",
        question: "How should multi-agent research preserve provenance?",
      },
    }));
  }

  const result = await runRuntimeLoop(
    store,
    createResearchPipelineRegistry(),
    createResearchPipelineRunners(),
    options,
  );

  const projection = projectResearch(await store.readAll());
  assertNoProjectionErrors("research-pipeline", "research", projection.errors);

  return result;
}

export async function runHumanOpsRuntime(path: string, options: BuiltInRuntimeOptions = {}): Promise<RuntimeLoopResult> {
  validateRuntimeLoopOptions(options);
  if (!options.resume) {
    await rm(path, { force: true });
  }

  const eventFactory = options.eventFactory ?? defaultEventFactory();
  const store = new JsonlEventStore(path, options.eventStore);
  const existing = await store.readAll();
  if (existing.length === 0) {
    await store.append(eventFactory.create({
      id: "evt_ops_alert",
      type: "external.alert.received",
      actorId: "external",
      threadId: "thread_ops",
      parentEventId: null,
      payload: {
        alertId: "alert_runtime_latency",
        title: "Latency regression on checkout API",
        severity: "high",
      },
    }));
  }

  const result = await runRuntimeLoop(
    store,
    createHumanOpsRegistry(),
    createHumanOpsRunners(),
    options,
  );

  const projection = projectEffects(await store.readAll());
  assertNoProjectionErrors("human-ops", "effects", projection.errors);

  return result;
}

function assertNoProjectionErrors(
  workflow: "software-work" | "research-pipeline" | "human-ops",
  projectionKind: BuiltInProjectionKind,
  errors: readonly RuntimeProjectionDiagnostic[],
): void {
  if (errors.length > 0) throw new RuntimeProjectionError(workflow, projectionKind, [...errors]);
}

function validateRuntimeLoopOptions(options: RuntimeLoopOptions): void {
  if (options.maxIterations === undefined) return;
  if (!Number.isInteger(options.maxIterations) || options.maxIterations <= 0) {
    throw new RuntimeOptionsError("maxIterations", options.maxIterations);
  }
}
