export interface ActorDefinition {
  id: string;
  role: string;
  subscriptions: string[];
  intentions: string[];
}

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
