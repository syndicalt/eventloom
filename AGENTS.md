# Repository Guidelines

## Project Structure & Module Organization

This repository is currently a minimal workspace. Add source code under a clear top-level directory such as `src/`, tests under `tests/`, and reusable assets or fixtures under `assets/` or `fixtures/` as the project grows. Keep repository-level documentation and configuration files in the root.

Recommended layout:

```text
src/        Application or library code
tests/      Unit and integration tests
fixtures/   Sample Threadline event data used by tests
docs/       Design notes and contributor documentation
```

## Build, Test, and Development Commands

No build system or package manager configuration is present yet. When adding one, document commands here and keep them runnable from the repository root.

Suggested command names:

```bash
make test      # Run the full test suite
make lint      # Run formatting and lint checks
make build     # Produce any generated or distributable output
```

If this becomes a Node, Python, Go, or Rust project, prefer the standard project commands for that ecosystem and add a short explanation for each.

## Coding Style & Naming Conventions

Keep code style consistent with the language and tooling introduced in the repository. Use descriptive file and function names that reflect Threadline concepts, such as `event_store`, `event_parser`, or `append_event`.

Prefer small modules with narrow responsibilities. Avoid committing generated files unless they are required for runtime or distribution. Use ASCII text unless a file already requires Unicode content.

## Testing Guidelines

Place tests in `tests/` or beside source files if that is the convention of the chosen language. Name tests after the behavior being verified, for example `test_appends_event_to_log` or `event-parser.test.ts`.

Tests should cover event creation, ordering, persistence, parsing, and error handling once those features exist. Add regression tests with bug fixes.

## Commit & Pull Request Guidelines

This directory is not currently initialized as a Git repository, so no local commit history is available. Use concise, imperative commit subjects such as `Add event parser` or `Document test workflow`.

Pull requests should include a short summary, the reason for the change, test results, and linked issues when applicable. Include screenshots or sample output for user-facing behavior or CLI changes.

## Agent-Specific Instructions

Before editing, inspect the current tree and preserve user changes. Keep changes focused on the requested task, avoid unrelated refactors, and update this guide when project tooling or structure changes.
