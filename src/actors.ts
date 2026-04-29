export interface ActorDefinition {
  id: string;
  role: string;
  subscriptions: string[];
  intentions: string[];
}

export type BuiltInWorkflow = "software-work" | "research-pipeline" | "human-ops";

export class ActorRegistry {
  private readonly actors = new Map<string, ActorDefinition>();

  register(actor: ActorDefinition): void {
    if (this.actors.has(actor.id)) {
      throw new Error(`Actor ${actor.id} is already registered`);
    }
    this.actors.set(actor.id, actor);
  }

  get(actorId: string): ActorDefinition | undefined {
    return this.actors.get(actorId);
  }

  require(actorId: string): ActorDefinition {
    const actor = this.get(actorId);
    if (!actor) throw new Error(`Actor ${actorId} is not registered`);
    return actor;
  }

  all(): ActorDefinition[] {
    return [...this.actors.values()];
  }
}

export function createSoftwareWorkRegistry(): ActorRegistry {
  const actors = new ActorRegistry();
  actors.register({
    id: "planner",
    role: "Break goals into tasks",
    subscriptions: ["goal.created"],
    intentions: ["task.propose"],
  });
  actors.register({
    id: "worker",
    role: "Claim and complete tasks",
    subscriptions: ["task.proposed", "task.claimed", "task.completed", "issue.reported"],
    intentions: ["task.claim", "task.complete", "review.request"],
  });
  actors.register({
    id: "reviewer",
    role: "Approve or report issues",
    subscriptions: ["review.requested"],
    intentions: ["review.approve", "issue.report"],
  });

  return actors;
}

export function createBuiltInRegistry(workflow: BuiltInWorkflow): ActorRegistry {
  if (workflow === "software-work") return createSoftwareWorkRegistry();
  if (workflow === "research-pipeline") return createResearchPipelineRegistry();
  return createHumanOpsRegistry();
}

export function createResearchPipelineRegistry(): ActorRegistry {
  const actors = new ActorRegistry();
  actors.register({
    id: "researcher",
    role: "Find sources for research questions",
    subscriptions: ["research.question.created"],
    intentions: ["source.find"],
  });
  actors.register({
    id: "analyst",
    role: "Extract claims from sources",
    subscriptions: ["source.found"],
    intentions: ["claim.extract"],
  });
  actors.register({
    id: "critic",
    role: "Challenge extracted claims",
    subscriptions: ["claim.extracted"],
    intentions: ["claim.challenge"],
  });
  actors.register({
    id: "writer",
    role: "Draft report sections from reviewed claims",
    subscriptions: ["claim.challenged"],
    intentions: ["report.draftSection"],
  });
  actors.register({
    id: "editor",
    role: "Finalize research reports",
    subscriptions: ["report.section.drafted"],
    intentions: ["report.finalize"],
  });

  return actors;
}

export function createHumanOpsRegistry(): ActorRegistry {
  const actors = new ActorRegistry();
  actors.register({
    id: "responder",
    role: "Propose effects for external alerts",
    subscriptions: ["external.alert.received"],
    intentions: ["effect.request"],
  });
  actors.register({
    id: "safety",
    role: "Request human approval for proposed effects",
    subscriptions: ["effect.requested"],
    intentions: ["approval.request"],
  });
  actors.register({
    id: "applier",
    role: "Apply approved effects",
    subscriptions: ["approval.granted"],
    intentions: ["effect.apply"],
  });

  return actors;
}
