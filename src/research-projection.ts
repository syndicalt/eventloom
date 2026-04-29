import { z } from "zod";
import type { EventEnvelope } from "./events.js";
import { replay } from "./projection.js";

const questionPayloadSchema = z.object({
  questionId: z.string().min(1),
  question: z.string().min(1),
});

const sourcePayloadSchema = z.object({
  questionId: z.string().min(1),
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
});

const claimPayloadSchema = z.object({
  questionId: z.string().min(1),
  sourceId: z.string().min(1),
  claimId: z.string().min(1),
  text: z.string().min(1),
});

const challengePayloadSchema = z.object({
  questionId: z.string().min(1),
  claimId: z.string().min(1),
  challengeId: z.string().min(1),
  verdict: z.string().min(1),
});

const sectionPayloadSchema = z.object({
  questionId: z.string().min(1),
  sectionId: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
});

const reportPayloadSchema = z.object({
  questionId: z.string().min(1),
  reportId: z.string().min(1),
  summary: z.string().min(1),
});

export type ResearchStatus =
  | "created"
  | "source_found"
  | "claim_extracted"
  | "claim_challenged"
  | "section_drafted"
  | "finalized";

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
}

export interface ResearchClaim {
  id: string;
  sourceId: string;
  text: string;
}

export interface ResearchChallenge {
  id: string;
  claimId: string;
  verdict: string;
}

export interface ResearchSection {
  id: string;
  title: string;
  content: string;
}

export interface ResearchQuestionState {
  id: string;
  question: string;
  status: ResearchStatus;
  actorId: string;
  lastEventId: string;
  sources: ResearchSource[];
  claims: ResearchClaim[];
  challenges: ResearchChallenge[];
  sections: ResearchSection[];
  reportId?: string;
  summary?: string;
  history: string[];
}

export interface ResearchProjection {
  questions: Record<string, ResearchQuestionState>;
  errors: ResearchProjectionError[];
}

export interface ResearchProjectionError {
  eventId: string;
  type: string;
  message: string;
}

export function projectResearch(events: readonly EventEnvelope[]): ResearchProjection {
  return replay(events, emptyResearchProjection(), applyResearchEvent);
}

export function validateResearchEvent(
  events: readonly EventEnvelope[],
  event: EventEnvelope,
): ResearchProjectionError | null {
  const before = projectResearch(events);
  const after = applyResearchEvent(before, event);
  return after.errors.at(-1) ?? null;
}

export function emptyResearchProjection(): ResearchProjection {
  return { questions: {}, errors: [] };
}

export function applyResearchEvent(projection: ResearchProjection, event: EventEnvelope): ResearchProjection {
  if (event.type === "research.question.created") {
    return applyQuestionCreated(projection, event);
  }
  if (event.type === "source.found") {
    return applySourceFound(projection, event);
  }
  if (event.type === "claim.extracted") {
    return applyClaimExtracted(projection, event);
  }
  if (event.type === "claim.challenged") {
    return applyClaimChallenged(projection, event);
  }
  if (event.type === "report.section.drafted") {
    return applySectionDrafted(projection, event);
  }
  if (event.type === "report.finalized") {
    return applyReportFinalized(projection, event);
  }
  return projection;
}

export function explainResearchQuestion(projection: ResearchProjection, questionId: string): string[] {
  return projection.questions[questionId]?.history ?? [];
}

function applyQuestionCreated(projection: ResearchProjection, event: EventEnvelope): ResearchProjection {
  const payload = parsePayload(projection, event, questionPayloadSchema, "research question");
  if (!payload) return projection;

  if (projection.questions[payload.questionId]) {
    return appendError(projection, event, `Research question ${payload.questionId} already exists`);
  }

  return {
    ...projection,
    questions: {
      ...projection.questions,
      [payload.questionId]: {
        id: payload.questionId,
        question: payload.question,
        status: "created",
        actorId: event.actorId,
        lastEventId: event.id,
        sources: [],
        claims: [],
        challenges: [],
        sections: [],
        history: [event.id],
      },
    },
  };
}

function applySourceFound(projection: ResearchProjection, event: EventEnvelope): ResearchProjection {
  const payload = parsePayload(projection, event, sourcePayloadSchema, "source");
  if (!payload) return projection;

  const question = requireQuestion(projection, event, payload.questionId);
  if (!question) return projection;
  if (question.status !== "created") {
    return appendError(projection, event, `Cannot apply ${event.type} to research question ${question.id} in ${question.status} state`);
  }
  if (question.sources.some((source) => source.id === payload.sourceId)) {
    return appendError(projection, event, `Source ${payload.sourceId} already exists`);
  }

  return updateQuestion(projection, question, event, {
    status: "source_found",
    sources: [...question.sources, { id: payload.sourceId, title: payload.title, url: payload.url }],
  });
}

function applyClaimExtracted(projection: ResearchProjection, event: EventEnvelope): ResearchProjection {
  const payload = parsePayload(projection, event, claimPayloadSchema, "claim");
  if (!payload) return projection;

  const question = requireQuestion(projection, event, payload.questionId);
  if (!question) return projection;
  if (question.status !== "source_found") {
    return appendError(projection, event, `Cannot apply ${event.type} to research question ${question.id} in ${question.status} state`);
  }
  if (!question.sources.some((source) => source.id === payload.sourceId)) {
    return appendError(projection, event, `Source ${payload.sourceId} does not exist`);
  }
  if (question.claims.some((claim) => claim.id === payload.claimId)) {
    return appendError(projection, event, `Claim ${payload.claimId} already exists`);
  }

  return updateQuestion(projection, question, event, {
    status: "claim_extracted",
    claims: [...question.claims, { id: payload.claimId, sourceId: payload.sourceId, text: payload.text }],
  });
}

function applyClaimChallenged(projection: ResearchProjection, event: EventEnvelope): ResearchProjection {
  const payload = parsePayload(projection, event, challengePayloadSchema, "challenge");
  if (!payload) return projection;

  const question = requireQuestion(projection, event, payload.questionId);
  if (!question) return projection;
  if (question.status !== "claim_extracted") {
    return appendError(projection, event, `Cannot apply ${event.type} to research question ${question.id} in ${question.status} state`);
  }
  if (!question.claims.some((claim) => claim.id === payload.claimId)) {
    return appendError(projection, event, `Claim ${payload.claimId} does not exist`);
  }

  return updateQuestion(projection, question, event, {
    status: "claim_challenged",
    challenges: [
      ...question.challenges,
      { id: payload.challengeId, claimId: payload.claimId, verdict: payload.verdict },
    ],
  });
}

function applySectionDrafted(projection: ResearchProjection, event: EventEnvelope): ResearchProjection {
  const payload = parsePayload(projection, event, sectionPayloadSchema, "report section");
  if (!payload) return projection;

  const question = requireQuestion(projection, event, payload.questionId);
  if (!question) return projection;
  if (question.status !== "claim_challenged") {
    return appendError(projection, event, `Cannot apply ${event.type} to research question ${question.id} in ${question.status} state`);
  }

  return updateQuestion(projection, question, event, {
    status: "section_drafted",
    sections: [...question.sections, { id: payload.sectionId, title: payload.title, content: payload.content }],
  });
}

function applyReportFinalized(projection: ResearchProjection, event: EventEnvelope): ResearchProjection {
  const payload = parsePayload(projection, event, reportPayloadSchema, "report");
  if (!payload) return projection;

  const question = requireQuestion(projection, event, payload.questionId);
  if (!question) return projection;
  if (question.status !== "section_drafted") {
    return appendError(projection, event, `Cannot apply ${event.type} to research question ${question.id} in ${question.status} state`);
  }

  return updateQuestion(projection, question, event, {
    status: "finalized",
    reportId: payload.reportId,
    summary: payload.summary,
  });
}

function requireQuestion(
  projection: ResearchProjection,
  event: EventEnvelope,
  questionId: string,
): ResearchQuestionState | null {
  const question = projection.questions[questionId];
  if (!question) {
    projection.errors.push({
      eventId: event.id,
      type: event.type,
      message: `Research question ${questionId} does not exist`,
    });
    return null;
  }
  return question;
}

function updateQuestion(
  projection: ResearchProjection,
  question: ResearchQuestionState,
  event: EventEnvelope,
  updates: Partial<ResearchQuestionState>,
): ResearchProjection {
  return {
    ...projection,
    questions: {
      ...projection.questions,
      [question.id]: {
        ...question,
        ...updates,
        actorId: event.actorId,
        lastEventId: event.id,
        history: [...question.history, event.id],
      },
    },
  };
}

function parsePayload<T extends z.ZodTypeAny>(
  projection: ResearchProjection,
  event: EventEnvelope,
  schema: T,
  label: string,
): z.infer<T> | null {
  const result = schema.safeParse(event.payload);
  if (result.success) return result.data;

  projection.errors.push({
    eventId: event.id,
    type: event.type,
    message: `Invalid ${label} payload: ${result.error.issues.map((issue) => issue.message).join(", ")}`,
  });
  return null;
}

function appendError(
  projection: ResearchProjection,
  event: EventEnvelope,
  message: string,
): ResearchProjection {
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
