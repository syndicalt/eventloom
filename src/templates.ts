export interface AgentWorkflowTemplate {
  id: string;
  title: string;
  description: string;
  events: AgentWorkflowTemplateEvent[];
}

export interface AgentWorkflowTemplateEvent {
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
}

export const agentWorkflowTemplates: AgentWorkflowTemplate[] = [
  {
    id: "coding-task",
    title: "Coding Task",
    description: "Track one scoped implementation from goal through verification.",
    events: [
      { type: "goal.created", actorId: "user", payload: { title: "Implement scoped code change" } },
      { type: "task.proposed", actorId: "codex", payload: { taskId: "task_implementation", title: "Implement scoped code change" } },
      { type: "task.claimed", actorId: "codex", payload: { taskId: "task_implementation" } },
      { type: "verification.completed", actorId: "codex", payload: { summary: "Run focused tests and build checks" } },
      { type: "task.completed", actorId: "codex", payload: { taskId: "task_implementation" } },
    ],
  },
  {
    id: "review-task",
    title: "Review Task",
    description: "Track a code review with findings, disposition, and verification.",
    events: [
      { type: "goal.created", actorId: "user", payload: { title: "Review a change for risks" } },
      { type: "task.proposed", actorId: "codex", payload: { taskId: "task_review", title: "Review change" } },
      { type: "task.claimed", actorId: "codex", payload: { taskId: "task_review" } },
      { type: "decision.recorded", actorId: "codex", payload: { decision: "Record review findings before summary context" } },
      { type: "task.completed", actorId: "codex", payload: { taskId: "task_review" } },
    ],
  },
  {
    id: "release-task",
    title: "Release Task",
    description: "Track a package release from preflight through publish and tag.",
    events: [
      { type: "goal.created", actorId: "user", payload: { title: "Release package version" } },
      { type: "task.proposed", actorId: "codex", payload: { taskId: "task_release", title: "Run release checklist" } },
      { type: "task.claimed", actorId: "codex", payload: { taskId: "task_release" } },
      { type: "verification.completed", actorId: "codex", payload: { summary: "Prepublish tests, build, pack dry-run, publish, tag, and registry verification" } },
      { type: "task.completed", actorId: "codex", payload: { taskId: "task_release" } },
    ],
  },
  {
    id: "research-task",
    title: "Research Task",
    description: "Track a research pass with sources, decisions, and handoff.",
    events: [
      { type: "goal.created", actorId: "user", payload: { title: "Research a product or technical question" } },
      { type: "task.proposed", actorId: "codex", payload: { taskId: "task_research", title: "Research question" } },
      { type: "task.claimed", actorId: "codex", payload: { taskId: "task_research" } },
      { type: "decision.recorded", actorId: "codex", payload: { decision: "Separate sourced facts from inference" } },
      { type: "verification.completed", actorId: "codex", payload: { summary: "Sources checked and dates recorded" } },
      { type: "task.completed", actorId: "codex", payload: { taskId: "task_research" } },
    ],
  },
];

export function getAgentWorkflowTemplate(id: string): AgentWorkflowTemplate | null {
  return agentWorkflowTemplates.find((template) => template.id === id) ?? null;
}

export function formatAgentWorkflowTemplates(): string {
  return [
    "agent workflow templates",
    "",
    ...agentWorkflowTemplates.map((template) => `- ${template.id}: ${template.title} - ${template.description}`),
  ].join("\n");
}

export function formatAgentWorkflowTemplate(template: AgentWorkflowTemplate): string {
  return [
    `${template.id}: ${template.title}`,
    template.description,
    "",
    ...template.events.map((event, index) => (
      `${String(index + 1).padStart(2, "0")} ${event.type} actor=${event.actorId} payload=${JSON.stringify(event.payload)}`
    )),
  ].join("\n");
}
