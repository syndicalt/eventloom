import { z } from "zod";

/**
 * Stable built-in intention type names accepted by the default orchestrator.
 */
export const intentionTypeSchema = z.enum([
  "task.propose",
  "task.claim",
  "task.complete",
  "review.request",
  "review.approve",
  "issue.report",
  "source.find",
  "claim.extract",
  "claim.challenge",
  "report.draftSection",
  "report.finalize",
  "effect.request",
  "approval.request",
  "effect.apply",
]);

/**
 * Schema for built-in actor intentions before orchestrator validation.
 */
export const intentionSchema = z.object({
  type: intentionTypeSchema,
  actorId: z.string().min(1),
  threadId: z.string().min(1),
  parentEventId: z.string().regex(/^evt_[A-Za-z0-9_-]+$/).nullable(),
  causedBy: z.array(z.string().regex(/^evt_[A-Za-z0-9_-]+$/)).default([]),
  payload: z.record(z.unknown()),
});

/**
 * Built-in actor proposal shape consumed by the orchestrator.
 */
export type Intention = z.infer<typeof intentionSchema>;

/**
 * Stable union of built-in intention type names.
 */
export type IntentionType = z.infer<typeof intentionTypeSchema>;

/**
 * Built-in intention-to-event mapping used for accepted orchestration.
 */
export const intentionEventTypeMap: Record<IntentionType, string> = {
  "task.propose": "task.proposed",
  "task.claim": "task.claimed",
  "task.complete": "task.completed",
  "review.request": "review.requested",
  "review.approve": "review.approved",
  "issue.report": "issue.reported",
  "source.find": "source.found",
  "claim.extract": "claim.extracted",
  "claim.challenge": "claim.challenged",
  "report.draftSection": "report.section.drafted",
  "report.finalize": "report.finalized",
  "effect.request": "effect.requested",
  "approval.request": "approval.requested",
  "effect.apply": "effect.applied",
};

/**
 * Parse and validate a built-in actor intention.
 */
export function validateIntention(value: unknown): Intention {
  return intentionSchema.parse(value);
}
