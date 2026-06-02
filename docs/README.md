# Eventloom Documentation

Eventloom is documented in two layers:

- User documentation for running workflows, inspecting logs, and embedding the package.
- Technical documentation for understanding the runtime architecture, event model, projections, and extension points.

## User Documentation

- [User Guide](user-guide.md): install, run the built-in workflows, inspect event logs, and use human approvals.
- [CLI Reference](cli-reference.md): complete command reference with arguments and examples.
- [Package API](package-api.md): use Eventloom as a TypeScript library.
- [Public API Stability](public-api.md): stable exports and compatibility boundaries.
- [Migration Notes](migration-v1.md): v1.0 compatibility notes and no-log-migration guidance.
- [Release Checklist](https://github.com/syndicalt/eventloom/blob/master/docs/release.md): v1 release gates, local audits, package boundaries, and publish sequence.
- [Custom Workflows](custom-workflows.md): add actors, custom intentions, payload versions, and projections.
- [Agent Journal Cookbook](agent-journal-cookbook.md): recipes for coding agents, reviews, research, approvals, CI capture, and git linkage.
- [GitHub Actions Artifacts](github-actions-artifacts.md): upload `.eventloom` logs and derived artifact bundles from CI.
- [Agent Integration](agent-integration.md): use Eventloom as a replayable event journal for coding agents.
- [MCP Package Design](https://github.com/syndicalt/eventloom/blob/master/docs/mcp-package.md): `@eventloom/mcp` package scope, tool contracts, and safety model.
- [MCP Setup](https://github.com/syndicalt/eventloom/blob/master/docs/mcp-setup.md): configure Eventloom MCP in Codex, Claude Desktop, or the MCP inspector.
- [Pathlight Integration](pathlight-integration.md): export Eventloom runs into Pathlight traces and view Capture, Replay, and Handoff panels in the Pathlight dashboard.
- [HALO Integration](halo-integration.md): export Eventloom logs to HALO-compatible OpenTelemetry JSONL traces and compare HALO/OTLP offline fixtures.
- [OTLP Integration](otlp-integration.md): export Eventloom logs to generic OpenTelemetry trace JSON for CI artifacts or later collector upload.
- [Agent Work Export Case Study](case-studies/agent-work-pathlight.md): export a real agent journal to Pathlight, HALO, and generic OTLP artifacts.

## Technical Documentation

- [Architecture](architecture.md): runtime components and data flow.
- [Event Model](event-model.md): event envelopes, integrity hashes, intentions, and projections.
- [Workflow Guide](workflows.md): software-work, research-pipeline, and human-ops workflows.
- [Contributor Guide](https://github.com/syndicalt/eventloom/blob/master/docs/contributor-guide.md): development loop, testing strategy, and extension guidance.

## Planning and Decisions

- [Product Spec](https://github.com/syndicalt/eventloom/blob/master/docs/product-spec.md): historical MVP target and product thesis; use the v1 roadmap for current release scope.
- [Development Plan](https://github.com/syndicalt/eventloom/blob/master/docs/development-plan.md)
- [v1.0 Roadmap](https://github.com/syndicalt/eventloom/blob/master/docs/roadmap-v1.md)
- [Stack Review](https://github.com/syndicalt/eventloom/blob/master/docs/stack-review.md): historical stack decision note; use release docs and public API docs for current package boundaries.
- [Pathlight Bridge Spike](https://github.com/syndicalt/eventloom/blob/master/docs/decisions/pathlight-bridge-spike.md)

## Recommended Reading Order

1. Start with the [User Guide](user-guide.md).
2. Use the [CLI Reference](cli-reference.md) while running examples.
3. Read [Architecture](architecture.md) and [Event Model](event-model.md) before changing runtime behavior.
4. Read [Agent Integration](agent-integration.md) and [MCP Setup](https://github.com/syndicalt/eventloom/blob/master/docs/mcp-setup.md) before wiring Eventloom into agent workflows.
5. Use [Workflow Guide](workflows.md) before adding or modifying a workflow.
6. Read [Contributor Guide](https://github.com/syndicalt/eventloom/blob/master/docs/contributor-guide.md) before opening a PR.
