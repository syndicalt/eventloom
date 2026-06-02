import type { EffectProjectionError, EffectState } from "./effect-projection.js";
import { canonicalJson } from "./projection.js";
import type { ResearchProjectionError, ResearchQuestionState } from "./research-projection.js";
import type { RuntimeReplay } from "./runtime.js";
import type { ProjectionError, TaskState } from "./task-projection.js";

export interface ProjectionDiffReport {
  version: "eventloom.projection-diff.v1";
  sameProjectionHash: boolean;
  left: ProjectionDiffSide;
  right: ProjectionDiffSide;
  eventTypes: {
    added: EventTypeAdded[];
    removed: EventTypeRemoved[];
    changed: EventTypeChanged[];
  };
  tasks: {
    added: TaskDiffEntry[];
    removed: TaskDiffEntry[];
    changed: TaskDiffChanged[];
  };
  effects: {
    added: EffectDiffEntry[];
    removed: EffectDiffEntry[];
    changed: EffectDiffChanged[];
  };
  researchQuestions: {
    added: ResearchQuestionDiffEntry[];
    removed: ResearchQuestionDiffEntry[];
    changed: ResearchQuestionDiffChanged[];
  };
  projectionErrors: {
    left: ProjectionDiffError[];
    right: ProjectionDiffError[];
  };
}

export interface ProjectionDiffSide {
  eventCount: number;
  projectionHash: string;
  integrityOk: boolean;
}

export interface EventTypeAdded {
  type: string;
  right: number;
}

export interface EventTypeRemoved {
  type: string;
  left: number;
}

export interface EventTypeChanged {
  type: string;
  left: number;
  right: number;
  delta: number;
}

export interface TaskDiffEntry {
  taskId: string;
  task: TaskDiffTask;
}

export interface TaskDiffChanged {
  taskId: string;
  left: TaskDiffTask;
  right: TaskDiffTask;
}

export interface TaskDiffTask {
  id: string;
  title?: string;
  status: TaskState["status"];
  actorId: string;
  lastEventId: string;
  history: string[];
}

export interface EffectDiffEntry {
  effectId: string;
  effect: EffectDiffEffect;
}

export interface EffectDiffChanged {
  effectId: string;
  left: EffectDiffEffect;
  right: EffectDiffEffect;
}

export interface EffectDiffEffect {
  id: string;
  action?: string;
  target?: string;
  description?: string;
  approvalId?: string;
  status: EffectState["status"];
  actorId: string;
  lastEventId: string;
  history: string[];
}

export interface ResearchQuestionDiffEntry {
  questionId: string;
  question: ResearchQuestionDiffQuestion;
}

export interface ResearchQuestionDiffChanged {
  questionId: string;
  left: ResearchQuestionDiffQuestion;
  right: ResearchQuestionDiffQuestion;
}

export interface ResearchQuestionDiffQuestion {
  id: string;
  question: string;
  status: ResearchQuestionState["status"];
  actorId: string;
  lastEventId: string;
  sourceCount: number;
  claimCount: number;
  challengeCount: number;
  sectionCount: number;
  reportId?: string;
  summary?: string;
  history: string[];
}

export type ProjectionDiffError =
  | ({ projectionKind: "task" } & ProjectionError)
  | ({ projectionKind: "effect" } & EffectProjectionError)
  | ({ projectionKind: "research" } & ResearchProjectionError);

/**
 * Compares two runtime replay results and returns a structured projection diff
 * for event counts, task/effect/research state, and projection errors.
 */
export function diffRuntimeReplays(left: RuntimeReplay, right: RuntimeReplay): ProjectionDiffReport {
  return {
    version: "eventloom.projection-diff.v1",
    sameProjectionHash: left.projectionHash === right.projectionHash,
    left: summarizeSide(left),
    right: summarizeSide(right),
    eventTypes: diffEventTypes(left.projection.eventTypes, right.projection.eventTypes),
    tasks: diffTasks(left.projection.tasks.tasks, right.projection.tasks.tasks),
    effects: diffEffects(left.projection.effects.effects, right.projection.effects.effects),
    researchQuestions: diffResearchQuestions(left.projection.research.questions, right.projection.research.questions),
    projectionErrors: {
      left: projectionErrors(left),
      right: projectionErrors(right),
    },
  };
}

function projectionErrors(replay: RuntimeReplay): ProjectionDiffError[] {
  return [
    ...replay.projection.tasks.errors.map((error) => ({ projectionKind: "task" as const, ...error })),
    ...replay.projection.effects.errors.map((error) => ({ projectionKind: "effect" as const, ...error })),
    ...replay.projection.research.errors.map((error) => ({ projectionKind: "research" as const, ...error })),
  ];
}

function diffEffects(
  left: Record<string, EffectState>,
  right: Record<string, EffectState>,
): ProjectionDiffReport["effects"] {
  const added: EffectDiffEntry[] = [];
  const removed: EffectDiffEntry[] = [];
  const changed: EffectDiffChanged[] = [];

  for (const effectId of sortedUnion(Object.keys(left), Object.keys(right))) {
    const leftEffect = left[effectId];
    const rightEffect = right[effectId];
    if (!leftEffect && rightEffect) added.push({ effectId, effect: summarizeEffect(rightEffect) });
    else if (leftEffect && !rightEffect) removed.push({ effectId, effect: summarizeEffect(leftEffect) });
    else if (leftEffect && rightEffect && canonicalJson(leftEffect) !== canonicalJson(rightEffect)) {
      changed.push({ effectId, left: summarizeEffect(leftEffect), right: summarizeEffect(rightEffect) });
    }
  }

  return { added, removed, changed };
}

function diffResearchQuestions(
  left: Record<string, ResearchQuestionState>,
  right: Record<string, ResearchQuestionState>,
): ProjectionDiffReport["researchQuestions"] {
  const added: ResearchQuestionDiffEntry[] = [];
  const removed: ResearchQuestionDiffEntry[] = [];
  const changed: ResearchQuestionDiffChanged[] = [];

  for (const questionId of sortedUnion(Object.keys(left), Object.keys(right))) {
    const leftQuestion = left[questionId];
    const rightQuestion = right[questionId];
    if (!leftQuestion && rightQuestion) added.push({ questionId, question: summarizeResearchQuestion(rightQuestion) });
    else if (leftQuestion && !rightQuestion) removed.push({ questionId, question: summarizeResearchQuestion(leftQuestion) });
    else if (leftQuestion && rightQuestion && canonicalJson(leftQuestion) !== canonicalJson(rightQuestion)) {
      changed.push({ questionId, left: summarizeResearchQuestion(leftQuestion), right: summarizeResearchQuestion(rightQuestion) });
    }
  }

  return { added, removed, changed };
}

function summarizeSide(replay: RuntimeReplay): ProjectionDiffSide {
  return {
    eventCount: replay.eventCount,
    projectionHash: replay.projectionHash,
    integrityOk: replay.integrity.ok,
  };
}

function diffEventTypes(
  left: Record<string, number>,
  right: Record<string, number>,
): ProjectionDiffReport["eventTypes"] {
  const added: EventTypeAdded[] = [];
  const removed: EventTypeRemoved[] = [];
  const changed: EventTypeChanged[] = [];

  for (const type of sortedUnion(Object.keys(left), Object.keys(right))) {
    const leftCount = left[type] ?? 0;
    const rightCount = right[type] ?? 0;
    if (leftCount === rightCount) continue;
    if (leftCount === 0) added.push({ type, right: rightCount });
    else if (rightCount === 0) removed.push({ type, left: leftCount });
    else changed.push({ type, left: leftCount, right: rightCount, delta: rightCount - leftCount });
  }

  return { added, removed, changed };
}

function diffTasks(
  left: Record<string, TaskState>,
  right: Record<string, TaskState>,
): ProjectionDiffReport["tasks"] {
  const added: TaskDiffEntry[] = [];
  const removed: TaskDiffEntry[] = [];
  const changed: TaskDiffChanged[] = [];

  for (const taskId of sortedUnion(Object.keys(left), Object.keys(right))) {
    const leftTask = left[taskId];
    const rightTask = right[taskId];
    if (!leftTask && rightTask) {
      added.push({ taskId, task: summarizeTask(rightTask) });
      continue;
    }
    if (leftTask && !rightTask) {
      removed.push({ taskId, task: summarizeTask(leftTask) });
      continue;
    }
    if (!leftTask || !rightTask) continue;
    if (canonicalJson(leftTask) !== canonicalJson(rightTask)) {
      changed.push({
        taskId,
        left: summarizeTask(leftTask),
        right: summarizeTask(rightTask),
      });
    }
  }

  return { added, removed, changed };
}

function summarizeTask(task: TaskState): TaskDiffTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    actorId: task.actorId,
    lastEventId: task.lastEventId,
    history: [...task.history],
  };
}

function summarizeEffect(effect: EffectState): EffectDiffEffect {
  return {
    id: effect.id,
    action: effect.action,
    target: effect.target,
    description: effect.description,
    approvalId: effect.approvalId,
    status: effect.status,
    actorId: effect.actorId,
    lastEventId: effect.lastEventId,
    history: [...effect.history],
  };
}

function summarizeResearchQuestion(question: ResearchQuestionState): ResearchQuestionDiffQuestion {
  return {
    id: question.id,
    question: question.question,
    status: question.status,
    actorId: question.actorId,
    lastEventId: question.lastEventId,
    sourceCount: question.sources.length,
    claimCount: question.claims.length,
    challengeCount: question.challenges.length,
    sectionCount: question.sections.length,
    reportId: question.reportId,
    summary: question.summary,
    history: [...question.history],
  };
}

function sortedUnion(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}
