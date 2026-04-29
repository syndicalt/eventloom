import { describe, expect, it } from "vitest";
import {
  agentWorkflowTemplates,
  formatAgentWorkflowTemplate,
  formatAgentWorkflowTemplates,
  getAgentWorkflowTemplate,
} from "../src/templates.js";

describe("agent workflow templates", () => {
  it("exposes the first dogfood templates", () => {
    expect(agentWorkflowTemplates.map((template) => template.id)).toEqual([
      "coding-task",
      "review-task",
      "release-task",
      "research-task",
    ]);
  });

  it("formats template lists and details", () => {
    expect(formatAgentWorkflowTemplates()).toContain("coding-task: Coding Task");

    const template = getAgentWorkflowTemplate("release-task");
    expect(template).not.toBeNull();
    expect(formatAgentWorkflowTemplate(template!)).toContain("verification.completed");
  });
});
