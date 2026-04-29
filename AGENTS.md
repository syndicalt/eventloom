# Repository Guidelines

## Project Structure & Module Organization

Threadline is a TypeScript runtime prototype. Core code lives in `src/`, tests live in `tests/`, sample event logs live in `fixtures/`, and planning docs live in `docs/`. Keep repository-level configuration files in the root.

Recommended layout:

```text
src/        Application or library code
tests/      Unit and integration tests
fixtures/   Sample Threadline event data used by tests
docs/       Design notes and contributor documentation
```

## Build, Test, and Development Commands

Run commands from the repository root:

```bash
npm install                              # Install dependencies
npm test                                 # Run the Vitest suite
npm run build                           # Compile TypeScript to dist/
npm run threadline -- replay fixtures/sample.jsonl  # Replay a sample event log
npm run threadline -- append /tmp/threadline-demo.jsonl goal.created --actor user --payload '{"title":"External goal"}'  # Append a sealed external event
npm run threadline -- demo software-work /tmp/threadline-demo.jsonl  # Generate a deterministic demo log
npm run threadline -- run software-work /tmp/threadline-run.jsonl --resume  # Resume deterministic actor loop from an existing log
npm run threadline -- timeline /tmp/threadline-demo.jsonl  # Show ordered event history
npm run threadline -- explain task task_actor_intentions /tmp/threadline-demo.jsonl  # Explain task state
npm run threadline -- mailbox worker /tmp/threadline-demo.jsonl  # Show rebuilt actor mailbox
npm run threadline -- export pathlight /tmp/threadline-demo.jsonl --base-url http://localhost:4100  # Export to Pathlight collector
```

## Coding Style & Naming Conventions

Use strict TypeScript with ES modules. Use descriptive file and function names that reflect Threadline concepts, such as `event_store`, `event_parser`, or `append_event`.

Prefer small modules with narrow responsibilities. Avoid committing generated files unless they are required for runtime or distribution. Use ASCII text unless a file already requires Unicode content.

## Testing Guidelines

Place tests in `tests/` and name files after the module or behavior, for example `event-store.test.ts` or `projection.test.ts`.

Tests should cover event creation, ordering, persistence, parsing, and error handling once those features exist. Add regression tests with bug fixes.

## Commit & Pull Request Guidelines

Use concise, imperative commit subjects such as `Add event store` or `Document stack decisions`.

Pull requests should include a short summary, the reason for the change, test results, and linked issues when applicable. Include screenshots or sample output for user-facing behavior or CLI changes.

## Agent-Specific Instructions

Before editing, inspect the current tree and preserve user changes. Keep changes focused on the requested task, avoid unrelated refactors, and update this guide when project tooling or structure changes.
