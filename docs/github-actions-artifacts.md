# GitHub Actions Artifact Guidance

This workflow preserves an Eventloom agent journal and its derived inspection artifacts as downloadable CI artifacts. The key command is `eventloom artifacts`; the workflow invokes it through the published `@eventloom/runtime` package.

```yaml
name: eventloom-agent-artifacts

on:
  workflow_dispatch:
  pull_request:

jobs:
  eventloom-artifacts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Record Eventloom session
        run: |
          mkdir -p .eventloom
          npm exec --package @eventloom/runtime -- eventloom append .eventloom/agent-work.jsonl goal.created \
            --actor ci \
            --payload '{"title":"Run CI artifact capture"}'
          npm exec --package @eventloom/runtime -- eventloom append .eventloom/agent-work.jsonl verification.completed \
            --actor ci \
            --payload '{"summary":"Runtime tests passed","command":"npm test","checks":["runtime tests"],"assertions":["test command completed"],"evidenceEventIds":[],"artifactIds":["github-actions:${{ github.run_id }}"],"passCount":1,"failCount":0}'

      - name: Build Eventloom artifact bundle
        run: |
          npm exec --package @eventloom/runtime -- eventloom verify .eventloom/agent-work.jsonl
          npm exec --package @eventloom/runtime -- eventloom artifacts .eventloom/agent-work.jsonl \
            --out .eventloom/artifacts \
            --title "GitHub Actions Agent Work"
          npm exec --package @eventloom/runtime -- eventloom artifacts verify .eventloom/artifacts/manifest.json \
            > .eventloom/artifacts/manifest-verify.json
          test -s .eventloom/agent-work.jsonl
          test -f .eventloom/artifacts/manifest.json
          test -f .eventloom/artifacts/manifest-verify.json

      - name: Upload Eventloom artifacts
        uses: actions/upload-artifact@v4
        with:
          name: eventloom-agent-artifacts
          if-no-files-found: error
          path: |
            .eventloom/agent-work.jsonl
            .eventloom/artifacts/
```

The uploaded artifact contains:

- `.eventloom/agent-work.jsonl`: the canonical append-only event log.
- `.eventloom/artifacts/verify.json`: versioned `eventloom.verify.v1` integrity diagnostics, summary fields, and verified prefix metadata.
- `.eventloom/artifacts/stats.json`: event counts, actors, threads, and projection hash.
- `.eventloom/artifacts/query.json`: versioned `eventloom.query.v1` event summaries from the verified prefix.
- `.eventloom/artifacts/inspect.json`: consolidated integrity, stats, timeline, and handoff model for offline review.
- `.eventloom/artifacts/visualizer.json`: Capture, Replay, and Handoff model.
- `.eventloom/artifacts/visualizer.html`: self-contained static viewer.
- `.eventloom/artifacts/handoff.md`: text handoff summary.
- `.eventloom/artifacts/halo.jsonl`: HALO-compatible OpenTelemetry JSONL.
- `.eventloom/artifacts/otlp-traces.json`: generic OpenTelemetry OTLP trace JSON.
- `.eventloom/artifacts/manifest.json`: bundle version, artifact paths, projection hash, diagnostics, `inputDigest` for `.eventloom/agent-work.jsonl`, and SHA-256 file digests for generated artifacts.
- `.eventloom/artifacts/manifest-verify.json`: parseable `eventloom.artifact-bundle-verification.v1` result proving the source log digest and generated artifact digests matched uploaded files at capture time.

Bundle files are written through same-directory temporary files, flushed, atomically renamed into place, and followed by a best-effort containing-directory sync on platforms that support directory fsync. Rerunning the command refreshes the bundle without exposing partially written target files.

Keep secrets out of payloads. Store references to external CI artifacts, run ids, and commit ids instead of embedding private logs.

The repository release workflow also uploads runtime release evidence reports from `.eventloom-ci/golden-fixtures-node-<node-version>.json`, `.eventloom-ci/export-fixtures-node-<node-version>.json`, `.eventloom-ci/benchmark-smoke-node-<node-version>.json`, `.eventloom-ci/pack-manifests-node-<node-version>.json`, and `.eventloom-ci/artifact-bundle-verify-node-<node-version>.json`, plus staged MCP v1 preflight reports from `.eventloom-ci/staged-mcp-v1-preflight-node-<node-version>.json`. The fixture freshness reports are versioned as `eventloom.fixture-check.v1`, benchmark reports are versioned as `eventloom.benchmark.v1`, the pack-manifest report is versioned as `eventloom.pack-manifests.v1`, artifact-bundle verification reports are versioned as `eventloom.artifact-bundle-verification.v1`, and release-preflight reports are versioned as `eventloom.release-preflight.v1`. Those reports are separate from agent journal artifacts: they preserve the machine-readable release evidence for each Node.js matrix entry, while `.eventloom/agent-work.jsonl` remains the canonical project-specific session log.
