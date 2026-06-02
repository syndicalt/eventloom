import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

describe("benchmark contract", () => {
  it("exposes smoke and full benchmark scripts", () => {
    expect(packageJson.scripts).toMatchObject({
      bench: "tsx scripts/benchmarks/large-log.ts --mode full",
      "bench:smoke": "tsx scripts/benchmarks/large-log.ts --mode smoke",
      "bench:export": "tsx scripts/benchmarks/large-log.ts --mode export",
    });
  });

  it("runs a CI-friendly smoke benchmark with machine-readable measurements", async () => {
    const { stdout } = await execFileAsync("npm", ["run", "bench:smoke"], {
      env: { ...process.env, EVENTLOOM_BENCH_FIXED_NOW: "2026-04-28T22:00:00.000Z" },
    });
    const result = JSON.parse(stdout.slice(stdout.indexOf("{"))) as {
      mode: string;
      eventCount: number;
      fileSizeBytes: number;
      measurements: Array<{
        operation: string;
        eventCount: number;
        durationMs: number;
        throughputPerSecond: number;
        rssBytes: number;
        heapUsedBytes: number;
        spanCount?: number;
        pathlightRoutes?: Record<string, number>;
      }>;
      environment: { node: string; platform: string; arch: string };
      version: string;
    };

    expect(result.version).toBe("eventloom.benchmark.v1");
    expect(result.mode).toBe("smoke");
    expect(result.eventCount).toBe(1000);
    expect(result.fileSizeBytes).toBeGreaterThan(0);
    expect(result.environment.node).toEqual(expect.stringMatching(/^v?\d+\./));
    expect(result.measurements.map((measurement) => measurement.operation)).toEqual(expect.arrayContaining([
      "appendMany",
      "readAll",
      "verify",
      "replay",
      "visualize",
      "haloExport",
      "otlpExport",
      "pathlightExport",
    ]));
    const halo = result.measurements.find((measurement) => measurement.operation === "haloExport");
    const otlp = result.measurements.find((measurement) => measurement.operation === "otlpExport");
    const pathlight = result.measurements.find((measurement) => measurement.operation === "pathlightExport");
    expect(halo?.spanCount).toBeGreaterThan(0);
    expect(otlp?.spanCount).toBeGreaterThan(0);
    expect(pathlight?.spanCount).toBeGreaterThan(0);
    expect(pathlight?.pathlightRoutes).toMatchObject({
      "POST /v1/traces": 1,
      "POST /v1/spans": expect.any(Number),
      "PATCH /v1/traces/:id": 1,
    });
    for (const measurement of result.measurements) {
      expect(measurement.eventCount).toBe(1000);
      expect(measurement.durationMs).toBeGreaterThanOrEqual(0);
      expect(measurement.throughputPerSecond).toBeGreaterThanOrEqual(0);
      expect(measurement.rssBytes).toBeGreaterThan(0);
      expect(measurement.heapUsedBytes).toBeGreaterThan(0);
    }
  });

  it("can archive the benchmark JSON report to an explicit output file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-bench-contract-"));
    try {
      const outPath = join(dir, "benchmark-report.json");
      const { stdout } = await execFileAsync("npx", [
        "tsx",
        "scripts/benchmarks/large-log.ts",
        "--mode",
        "smoke",
        "--events",
        "25",
        "--out",
        outPath,
      ], {
        env: { ...process.env, EVENTLOOM_BENCH_FIXED_NOW: "2026-04-28T22:00:00.000Z" },
      });

      const stdoutResult = JSON.parse(stdout.slice(stdout.indexOf("{")));
      const fileResult = JSON.parse(await readFile(outPath, "utf8"));

      expect(fileResult).toEqual(stdoutResult);
      expect(fileResult).toMatchObject({
        version: "eventloom.benchmark.v1",
        mode: "smoke",
        eventCount: 25,
        generatedAt: "2026-04-28T22:00:00.000Z",
      });
      expect(fileResult.measurements).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: "appendMany", eventCount: 25 }),
        expect.objectContaining({ operation: "otlpExport", eventCount: 25 }),
      ]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("documents reproducible benchmark usage and baseline fields", async () => {
    await access("docs/benchmarks.md");
    const text = await readFile("docs/benchmarks.md", "utf8");

    expect(text).toContain("npm run bench:smoke");
    expect(text).toContain("eventloom.benchmark.v1");
    expect(text).toContain("npm run bench");
    expect(text).toContain("durationMs");
    expect(text).toContain("throughputPerSecond");
    expect(text).toContain("--out .eventloom-ci/benchmark-smoke-node-20.json");
    expect(text).toContain("npm run bench:evidence:check");
    expect(text).toContain("eventloom.benchmark-evidence.v1");
    expect(text).toContain("OTLP export");
    expect(text).toContain("measurements[].spanCount` for HALO, OTLP, and Pathlight export measurements");
    expect(text).toContain("Node");
    expect(text).toContain("hardware");
  });

  it("returns structured diagnostics for invalid benchmark options", async () => {
    await expect(execFileAsync("npx", [
      "tsx",
      "scripts/benchmarks/large-log.ts",
      "--events",
      "--mode",
      "smoke",
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('"code": "invalid_benchmark_option"'),
    });

    try {
      await execFileAsync("npx", [
        "tsx",
        "scripts/benchmarks/large-log.ts",
        "--mode",
        "unknown",
      ]);
      throw new Error("expected benchmark option parsing to fail");
    } catch (error) {
      const stderr = (error as { stderr: string }).stderr;
      expect(JSON.parse(stderr)).toMatchObject({
        error: {
          code: "invalid_benchmark_option",
          message: "Unknown benchmark mode unknown",
          option: "--mode",
          value: "unknown",
          suggestedAction: "Use one of: smoke, full, export.",
        },
      });
    }
  });
});
