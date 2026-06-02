# Benchmarks

Eventloom benchmarks are reproducible local release artifacts for the v1.0 roadmap. They measure batched append, `readAll`, verify, replay, visualize, HALO export, OTLP export, and Pathlight export over deterministic JSONL logs.

## Commands

Run the CI-friendly smoke benchmark:

```bash
npm run bench:smoke
```

Archive a parseable benchmark report for release or CI evidence:

```bash
npm run bench:smoke -- --out .eventloom-ci/benchmark-smoke-node-20.json
```

Run the full local benchmark:

```bash
npm run bench
```

Run the export-focused local benchmark:

```bash
npm run bench:export
```

The smoke benchmark uses 1,000 events and is wired into CI. The full benchmark uses 100,000 events by default, and the export benchmark uses 50,000 events by default. Override with `-- --events <n>` when collecting release evidence for a specific scale.

Validate full and export release-candidate reports before attaching them to a release packet:

```bash
npm run bench:evidence:check -- --full .eventloom-ci/benchmark-full-node-20.json --export .eventloom-ci/benchmark-export-node-20.json
```

The checker prints a versioned `eventloom.benchmark-evidence.v1` report in `--json` mode. It validates the benchmark report schema, `full` and `export` modes, positive event counts, environment metadata, a non-`unspecified` hardware note, required operation coverage, and export span fields. It deliberately does not enforce throughput thresholds because benchmark numbers are hardware-sensitive release evidence, not a portable correctness gate.

## Output

Both commands print versioned `eventloom.benchmark.v1` JSON with:

- `version`
- `mode`
- `eventCount`
- `generatedAt`
- `fileSizeBytes`
- `environment.node`
- `environment.platform`
- `environment.arch`
- `environment.hardware`
- `measurements[].operation`
- `measurements[].eventCount`
- `measurements[].durationMs`
- `measurements[].throughputPerSecond`
- `measurements[].rssBytes`
- `measurements[].heapUsedBytes`
- `measurements[].fileSizeBytes`
- `measurements[].spanCount` for HALO, OTLP, and Pathlight export measurements
- `measurements[].pathlightEventCount` for the Pathlight export measurement
- `measurements[].pathlightRoutes` for the Pathlight export measurement

Set `EVENTLOOM_BENCH_HARDWARE` to describe the machine used for full benchmark runs. Example:

```bash
EVENTLOOM_BENCH_HARDWARE="Ryzen 7950X, NVMe SSD, 64GB RAM" npm run bench
```

Set `EVENTLOOM_BENCH_FIXED_NOW` when a stable `generatedAt` value is useful in tests or archived release notes.

Pass `--out <path>` to write the same JSON report printed on stdout to a durable file. Parent directories are created automatically, which makes `.eventloom-ci/benchmark-*.json` suitable for GitHub Actions artifacts and release-candidate review packets.

Invalid benchmark options exit nonzero and print a JSON diagnostic on stderr with `error.code`, `error.message`, `error.option`, `error.value`, and `error.suggestedAction`. Option diagnostics use `invalid_benchmark_option` so release automation can distinguish argument problems from benchmark runtime failures.

## Baseline Policy

Benchmark numbers are not a correctness gate by themselves. Release notes should record the command, Node version, hardware note, event counts, `durationMs`, and `throughputPerSecond` values. The CI smoke benchmark proves the benchmark harness still runs; maintainers should run the full benchmark before v1.0 release candidates.

The `appendMany` measurement uses the production batched append path so large fixture generation exercises the same single-lock, single-scan, sequential-sealing behavior available to runtime callers.
