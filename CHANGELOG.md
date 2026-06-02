# Changelog

All notable changes to Eventloom are tracked here.

Eventloom follows semantic versioning. Runtime package compatibility is governed by the event envelope, hash-chain, public API, CLI command family, MCP bridge contract, and export format notes documented for v1.

## Unreleased

- MCP package remains `0.1.6` until `@eventloom/runtime@1.0.0` is published and resolvable from npm.

## 1.0.0

### Added

- Added a canonical v1.0 roadmap in `docs/roadmap-v1.md`.
- Added v1.0 migration notes documenting the public API freeze and no-migration path for valid 0.x logs.
- The runtime package is now staged as `@eventloom/runtime@1.0.0`; MCP package remains `0.1.6` until the runtime v1 package is published and the MCP dependency can move to `^1.0.0`.
- Added phase-specific release gate scripts for runtime-first, MCP-after-runtime, and full coordinated v1 checks.
- Added GitHub Actions CI for the runtime-first v1 gate.
- Added archived benchmark smoke JSON reports to the runtime release evidence uploaded by GitHub Actions.
- Added explicit `eventloom.benchmark.v1` versioning to benchmark smoke/full/export release evidence.
- Added explicit `eventloom.fixture-check.v1` versioning to golden/export fixture freshness release evidence.
- Added archived artifact-bundle verification JSON reports to runtime release evidence so CI-uploaded Eventloom session artifacts include parseable manifest digest proof.
- Added executable v1 release preflight checks for coordinated runtime/MCP package versions, lockfile versions, MCP server metadata, package docs, and optional published-runtime availability.
- Added explicit `eventloom.release-preflight.v1` versioning to runtime, MCP, full, and staged MCP release-preflight JSON reports.
- Added explicit `eventloom.pack-manifests.v1` versioning to parseable runtime/MCP package dry-run manifest evidence.
- Added verified-prefix recovery with optional bad-tail quarantine, exclusive durable recovery artifact writes, and lock-coordinated recovery.
- Added projection snapshots and verified-tail replay helpers so cache-assisted replay can prove equivalence with full replay.
- Added static HTML visualizer and agent artifact bundle generation for repository-local session preservation.
- Added generic OTLP trace JSON export across runtime, CLI, MCP, artifact bundles, offline fixtures, and packaged integration docs.
- Added explicit `eventloom.verify.v1` versioning to raw store/runtime verify reports, CLI `verify`/`validate`, MCP `eventloom_verify`, and artifact-bundle `verify.json`.
- Added public API JSDoc for stable TypeScript declarations and a release contract that keeps those declarations documented.
- Added MCP stdio lock timing flags and propagated configured lock timing to built-in workflow runs.
- Added MCP v1 local-runtime staging smoke to prove a temporary MCP v1 package can run against the packed runtime v1 tarball without mutating checked-in MCP metadata.
- Added a staged MCP v1 local preflight that validates temporary MCP v1 package metadata and lockfile state against the packed runtime v1 tarball without weakening the real registry-backed MCP publish preflight.

### Changed

- Upgraded the runtime and MCP Vitest development dependency to clear known Vite/esbuild audit findings in the local release toolchain.
- Tightened malformed-log diagnostics so partial trailing lines, malformed JSON, duplicate event ids, and append lock timeouts have stable structured reports.
- Expanded CLI, MCP, Pathlight, and HALO diagnostics so automation can use stable error codes instead of parsing prose.
- Updated CLI and MCP read-model tools to inspect verified log prefixes while preserving corrupt-tail diagnostics in structured output.
- Updated Pathlight and HALO export callers to export verified prefixes while preserving source-log integrity diagnostics in results and trace metadata.
- Documented stable recovery output semantics: quarantine paths are created as empty artifacts for fully verified logs, and existing recovered or quarantine paths fail with `recovery_output_exists` before any artifact is written.
- Added a CI fixture freshness check for exported Pathlight/HALO/OTLP artifacts.
- Strengthened v1 release preflight checks for MCP runtime lockfile tarball and integrity metadata.
- Added runtime-only and MCP-only v1 preflight modes for the two-phase first v1 publish.
- Updated Pathlight/HALO/OTLP export fixtures to use runtime package version `1.0.0` provenance.
- Added SHA-256 file digests to artifact bundle manifests so repo-local and CI-uploaded session artifacts can be verified after preservation.
- Added `inputDigest` to artifact bundle manifests so preserved bundles are bound to the canonical source JSONL session log.
- Added `verifyArtifactBundleFiles()` so package callers can check preserved artifact bundles against manifest byte counts and SHA-256 digests.
- Added CLI and MCP artifact-bundle verification commands for checking preserved session artifacts in local automation and agent clients.
- Hardened artifact bundle verification so malformed or hand-edited manifest digest metadata returns stable `invalid_manifest` issues instead of generic runtime errors.
- Extended installed runtime CLI, installed MCP bin, and staged MCP v1 smoke tests to verify generated artifact bundle manifests, source-log `inputDigest`, and all ten source-log plus generated artifact digests before accepting packaged release artifacts.
- Updated the v1 release workflow to use Node 24-native GitHub JavaScript actions for checkout, setup-node, and artifact upload while preserving the supported Node.js package test matrix.
- Added `inspect.json` to artifact bundles so preserved agent-session artifacts include the consolidated `eventloom.inspect.v1` integrity, stats, timeline, and handoff model.

### Security

- Refreshed the MCP package lockfile so production dependency audit reports no vulnerabilities.

## 0.1.7

- Current published runtime prototype package.

## 0.1.6

- Current published MCP package version.
