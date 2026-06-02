# Migrating To Eventloom v1.0.0

Eventloom v1.0.0 is a compatibility release for the existing local-first runtime model. It hardens the prototype without changing the append-only event envelope, hash-chain semantics, intention validation boundary, projection model, CLI command family, MCP contract, or Pathlight/HALO/OTLP export bridges.

## Required Changes

No log migration is required for valid Eventloom 0.x JSONL logs.

Existing logs keep the same envelope fields:

- `id`
- `type`
- `actorId`
- `threadId`
- `parentEventId`
- `causedBy`
- `timestamp`
- `payload`
- `integrity`

Existing hash-chain fields also keep the same meaning:

- `integrity.hash`
- `integrity.previousHash`

## Public API freeze

The v1 public API freeze covers the package-facing exports documented in [Public API Stability](public-api.md), the CLI command family documented in [CLI Reference](cli-reference.md), and the MCP tools documented in [MCP Package](mcp-package.md).

Eventloom may add new exports, commands, payload fields, and optional artifact formats in v1.x. Removing documented exports, changing event envelope semantics, changing accepted built-in event names, or changing the MCP tool contract requires a migration note and a semver-major release.

## Recommended Upgrade Checks

Before adopting v1.0.0 in a repo, run:

```bash
npm install @eventloom/runtime@^1.0.0
npx eventloom validate .eventloom/agent-work.jsonl --json
npx eventloom artifacts .eventloom/agent-work.jsonl --out .eventloom/artifacts
npx eventloom export otlp .eventloom/agent-work.jsonl --out .eventloom/otlp-traces.json
```

For package consumers, run your normal TypeScript build and any custom workflow tests after upgrading. Custom workflows should keep domain payload versions inside the event payload rather than changing the Eventloom envelope.

## Corrupt Or Partial Logs

v1.0.0 is stricter about damaged logs. Appends refuse to continue when streaming verification finds malformed JSON, invalid envelopes, partial trailing lines, duplicate event ids, or hash mismatches.

Use:

```bash
npx eventloom validate .eventloom/agent-work.jsonl --json
npx eventloom recover .eventloom/agent-work.jsonl --out .eventloom/agent-work.recovered.jsonl
npx eventloom recover .eventloom/agent-work.jsonl --out .eventloom/agent-work.recovered.jsonl --quarantine-tail .eventloom/agent-work.bad-tail.jsonl
```

Recovery writes the verified prefix to a separate file. It does not silently mutate the canonical log, uses the same local lock as append, refuses to overwrite existing recovery artifacts, and can preserve rejected tail lines in an explicit quarantine file. If the source log is already fully verified, the quarantine file is created as an empty artifact when requested; existing recovered or quarantine paths fail with `recovery_output_exists` before any recovery output is written.

## Extension Guidance

Custom workflows should use `CustomIntentionDefinition` for additive custom intention and event pairs. Keep payload evolution forward-compatible by adding optional fields or versioning inside `payload.version` or a domain-specific payload field. Unknown top-level event envelope fields are invalid in v1.0.0.

See [Custom Workflows](custom-workflows.md) for a complete example.
