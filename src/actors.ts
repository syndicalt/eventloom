/**
 * Declares one actor's stable workflow permissions.
 *
 * Subscriptions describe the event types the actor should receive in its
 * mailbox; intentions describe the intention types it is allowed to propose.
 */
export interface ActorDefinition {
  id: string;
  role: string;
  subscriptions: string[];
  intentions: string[];
}

/**
 * Stable identifiers for the deterministic workflows shipped with Eventloom.
 */
export type BuiltInWorkflow = "software-work" | "research-pipeline" | "human-ops";

/**
 * Stable machine-readable actor registry error codes.
 */
export type ActorRegistryErrorCode = "actor_duplicate" | "actor_not_registered";

/**
 * Stable actor registry diagnostic used by mailboxes, runtimes, and MCP tools.
 */
export class ActorRegistryError extends Error {
  constructor(readonly code: ActorRegistryErrorCode, readonly actorId: string, message: string) {
    super(message);
    this.name = "ActorRegistryError";
  }
}

/**
 * In-memory registry of actors used by mailboxes, runtime loops, and the orchestrator.
 */
export class ActorRegistry {
  private readonly actors = new Map<string, ActorDefinition>();

  /**
   * Register one actor definition and reject duplicate actor ids.
   */
  register(actor: ActorDefinition): void {
    if (this.actors.has(actor.id)) {
      throw new ActorRegistryError("actor_duplicate", actor.id, `Actor ${actor.id} is already registered`);
    }
    this.actors.set(actor.id, actor);
  }

  /**
   * Return an actor definition by id, or undefined when it is absent.
   */
  get(actorId: string): ActorDefinition | undefined {
    return this.actors.get(actorId);
  }

  /**
   * Return an actor definition by id or throw ActorRegistryError when absent.
   */
  require(actorId: string): ActorDefinition {
    const actor = this.get(actorId);
    if (!actor) throw new ActorRegistryError("actor_not_registered", actorId, `Actor ${actorId} is not registered`);
    return actor;
  }

  /**
   * Return all registered actor definitions in registration order.
   */
  all(): ActorDefinition[] {
    return [...this.actors.values()];
  }
}

/**
 * Build the actor registry for the built-in software-work workflow.
 */
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

/**
 * Build the actor registry for one built-in deterministic workflow.
 */
export function createBuiltInRegistry(workflow: BuiltInWorkflow): ActorRegistry {
  if (workflow === "software-work") return createSoftwareWorkRegistry();
  if (workflow === "research-pipeline") return createResearchPipelineRegistry();
  return createHumanOpsRegistry();
}

/**
 * Build the actor registry for the built-in research-pipeline workflow.
 */
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

/**
 * Build the actor registry for the built-in human-ops workflow.
 */
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
