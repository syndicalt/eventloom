# Eventloom Documentation

Eventloom is documented in two layers:

- User documentation for running workflows, inspecting logs, and embedding the package.
- Technical documentation for understanding the runtime architecture, event model, projections, and extension points.

## User Documentation

- [User Guide](user-guide.md): install, run the built-in workflows, inspect event logs, and use human approvals.
- [CLI Reference](cli-reference.md): complete command reference with arguments and examples.
- [Package API](package-api.md): use Eventloom as a TypeScript library.
- [Agent Integration](agent-integration.md): use Eventloom as a replayable event journal for coding agents.
- [MCP Package Design](mcp-package.md): `@eventloom/mcp` package scope, tool contracts, and safety model.
- [MCP Setup](mcp-setup.md): configure Eventloom MCP in Codex, Claude Desktop, or the MCP inspector.
- [Pathlight Integration](pathlight-integration.md): export Eventloom runs into Pathlight traces.
- [Agent Work Pathlight Case Study](case-studies/agent-work-pathlight.md): export a real agent journal to Pathlight.

## Technical Documentation

- [Architecture](architecture.md): runtime components and data flow.
- [Event Model](event-model.md): event envelopes, integrity hashes, intentions, and projections.
- [Workflow Guide](workflows.md): software-work, research-pipeline, and human-ops workflows.
- [Contributor Guide](contributor-guide.md): development loop, testing strategy, and extension guidance.

## Planning and Decisions

- [Product Spec](product-spec.md)
- [Development Plan](development-plan.md)
- [Stack Review](stack-review.md)
- [Pathlight Bridge Spike](decisions/pathlight-bridge-spike.md)

## Recommended Reading Order

1. Start with the [User Guide](user-guide.md).
2. Use the [CLI Reference](cli-reference.md) while running examples.
3. Read [Architecture](architecture.md) and [Event Model](event-model.md) before changing runtime behavior.
4. Read [Agent Integration](agent-integration.md) and [MCP Setup](mcp-setup.md) before wiring Eventloom into agent workflows.
5. Use [Workflow Guide](workflows.md) before adding or modifying a workflow.
6. Read [Contributor Guide](contributor-guide.md) before opening a PR.
