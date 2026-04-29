import { describe, expect, it } from "vitest";
import { causalChain } from "../src/causal.js";
import { createEvent, type EventEnvelope } from "../src/events.js";
import { explainResearchQuestion, projectResearch } from "../src/research-projection.js";

describe("research projection", () => {
  it("advances research questions through valid provenance transitions", () => {
    const events = researchLifecycleEvents();

    const projection = projectResearch(events);

    expect(projection.errors).toEqual([]);
    expect(projection.questions.question_1).toMatchObject({
      id: "question_1",
      question: "How should agents preserve provenance?",
      status: "finalized",
      actorId: "editor",
      lastEventId: "evt_report_finalized",
      reportId: "report_1",
    });
    expect(projection.questions.question_1.sources).toHaveLength(1);
    expect(projection.questions.question_1.claims).toHaveLength(1);
    expect(projection.questions.question_1.challenges).toHaveLength(1);
    expect(projection.questions.question_1.sections).toHaveLength(1);
    expect(explainResearchQuestion(projection, "question_1")).toEqual([
      "evt_question_created",
      "evt_source_found",
      "evt_claim_extracted",
      "evt_claim_challenged",
      "evt_section_drafted",
      "evt_report_finalized",
    ]);
  });

  it("records projection errors for impossible transitions", () => {
    const events = [
      event("evt_question_created", "research.question.created", "user", null, {
        questionId: "question_1",
        question: "How should agents preserve provenance?",
      }),
      event("evt_report_finalized", "report.finalized", "editor", "evt_question_created", {
        questionId: "question_1",
        reportId: "report_1",
        summary: "Too early",
      }),
    ];

    const projection = projectResearch(events);

    expect(projection.questions.question_1.status).toBe("created");
    expect(projection.errors).toEqual([
      {
        eventId: "evt_report_finalized",
        type: "report.finalized",
        message: "Cannot apply report.finalized to research question question_1 in created state",
      },
    ]);
  });

  it("can rebuild a causal chain for a finalized report", () => {
    const events = researchLifecycleEvents();

    expect(causalChain(events, "evt_report_finalized").map((event) => event.id)).toEqual([
      "evt_question_created",
      "evt_source_found",
      "evt_claim_extracted",
      "evt_claim_challenged",
      "evt_section_drafted",
      "evt_report_finalized",
    ]);
  });
});

function researchLifecycleEvents(): EventEnvelope[] {
  return [
    event("evt_question_created", "research.question.created", "user", null, {
      questionId: "question_1",
      question: "How should agents preserve provenance?",
    }),
    event("evt_source_found", "source.found", "researcher", "evt_question_created", {
      questionId: "question_1",
      sourceId: "source_1",
      title: "Runtime notes",
      url: "threadline://runtime-notes",
    }),
    event("evt_claim_extracted", "claim.extracted", "analyst", "evt_source_found", {
      questionId: "question_1",
      sourceId: "source_1",
      claimId: "claim_1",
      text: "Event logs preserve provenance.",
    }),
    event("evt_claim_challenged", "claim.challenged", "critic", "evt_claim_extracted", {
      questionId: "question_1",
      claimId: "claim_1",
      challengeId: "challenge_1",
      verdict: "supported",
    }),
    event("evt_section_drafted", "report.section.drafted", "writer", "evt_claim_challenged", {
      questionId: "question_1",
      sectionId: "section_1",
      title: "Provenance",
      content: "Event logs make provenance inspectable.",
    }),
    event("evt_report_finalized", "report.finalized", "editor", "evt_section_drafted", {
      questionId: "question_1",
      reportId: "report_1",
      summary: "Use an event log.",
    }),
  ];
}

function event(
  id: string,
  type: string,
  actorId: string,
  parentEventId: string | null,
  payload: Record<string, unknown>,
): EventEnvelope {
  return createEvent({
    id,
    type,
    actorId,
    threadId: "thread_research",
    parentEventId,
    causedBy: parentEventId ? [parentEventId] : [],
    timestamp: "2026-04-29T12:00:00.000Z",
    payload,
  });
}
