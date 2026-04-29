import { z } from "zod";

export const intentionTypeSchema = z.enum([
  "task.propose",
  "task.claim",
  "task.complete",
  "review.request",
  "review.approve",
  "issue.report",
]);

export const intentionSchema = z.object({
  type: intentionTypeSchema,
  actorId: z.string().min(1),
  threadId: z.string().min(1),
  parentEventId: z.string().regex(/^evt_[A-Za-z0-9_-]+$/).nullable(),
  causedBy: z.array(z.string().regex(/^evt_[A-Za-z0-9_-]+$/)).default([]),
  payload: z.record(z.unknown()),
});

export type Intention = z.infer<typeof intentionSchema>;
export type IntentionType = z.infer<typeof intentionTypeSchema>;

export const intentionEventTypeMap: Record<IntentionType, string> = {
  "task.propose": "task.proposed",
  "task.claim": "task.claimed",
  "task.complete": "task.completed",
  "review.request": "review.requested",
  "review.approve": "review.approved",
  "issue.report": "issue.reported",
};

export function validateIntention(value: unknown): Intention {
  return intentionSchema.parse(value);
}
