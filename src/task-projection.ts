import { z } from "zod";
import type { EventEnvelope } from "./events.js";
import { replay } from "./projection.js";

const taskPayloadSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1).optional(),
});

export type TaskStatus =
  | "proposed"
  | "claimed"
  | "completed"
  | "review_requested"
  | "issue_reported"
  | "approved";

export interface TaskState {
  id: string;
  title?: string;
  status: TaskStatus;
  actorId: string;
  lastEventId: string;
  history: string[];
}

export interface TaskProjection {
  tasks: Record<string, TaskState>;
  errors: ProjectionError[];
}

export interface ProjectionError {
  eventId: string;
  type: string;
  message: string;
}

type TransitionRule = {
  from: TaskStatus[];
  to: TaskStatus;
};

const taskTransitions: Record<string, TransitionRule> = {
  "task.claimed": { from: ["proposed", "issue_reported"], to: "claimed" },
  "task.completed": { from: ["claimed"], to: "completed" },
  "review.requested": { from: ["completed"], to: "review_requested" },
  "issue.reported": { from: ["review_requested"], to: "issue_reported" },
  "review.approved": { from: ["review_requested"], to: "approved" },
};

export function projectTasks(events: readonly EventEnvelope[]): TaskProjection {
  return replay(events, emptyTaskProjection(), applyTaskEvent);
}

export function emptyTaskProjection(): TaskProjection {
  return { tasks: {}, errors: [] };
}

export function applyTaskEvent(projection: TaskProjection, event: EventEnvelope): TaskProjection {
  if (event.type === "task.proposed") {
    return applyTaskProposed(projection, event);
  }

  const rule = taskTransitions[event.type];
  if (!rule) return projection;

  const payload = parseTaskPayload(projection, event);
  if (!payload) return projection;

  const existing = projection.tasks[payload.taskId];
  if (!existing) {
    return appendProjectionError(projection, event, `Task ${payload.taskId} does not exist`);
  }
  if (!rule.from.includes(existing.status)) {
    return appendProjectionError(
      projection,
      event,
      `Cannot apply ${event.type} to task ${payload.taskId} in ${existing.status} state`,
    );
  }

  return {
    ...projection,
    tasks: {
      ...projection.tasks,
      [payload.taskId]: {
        ...existing,
        status: rule.to,
        actorId: event.actorId,
        lastEventId: event.id,
        history: [...existing.history, event.id],
      },
    },
  };
}

export function explainTask(projection: TaskProjection, taskId: string): string[] {
  return projection.tasks[taskId]?.history ?? [];
}

function applyTaskProposed(projection: TaskProjection, event: EventEnvelope): TaskProjection {
  const payload = parseTaskPayload(projection, event);
  if (!payload) return projection;

  if (projection.tasks[payload.taskId]) {
    return appendProjectionError(projection, event, `Task ${payload.taskId} already exists`);
  }

  return {
    ...projection,
    tasks: {
      ...projection.tasks,
      [payload.taskId]: {
        id: payload.taskId,
        title: payload.title,
        status: "proposed",
        actorId: event.actorId,
        lastEventId: event.id,
        history: [event.id],
      },
    },
  };
}

function parseTaskPayload(projection: TaskProjection, event: EventEnvelope): z.infer<typeof taskPayloadSchema> | null {
  const result = taskPayloadSchema.safeParse(event.payload);
  if (result.success) return result.data;

  projection.errors.push({
    eventId: event.id,
    type: event.type,
    message: `Invalid task payload: ${result.error.issues.map((issue) => issue.message).join(", ")}`,
  });
  return null;
}

function appendProjectionError(
  projection: TaskProjection,
  event: EventEnvelope,
  message: string,
): TaskProjection {
  return {
    ...projection,
    errors: [
      ...projection.errors,
      {
        eventId: event.id,
        type: event.type,
        message,
      },
    ],
  };
}
