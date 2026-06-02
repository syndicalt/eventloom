import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

describe("benchmark evidence check", () => {
  const nodeMajor = process.versions.node.split(".")[0];

  it("is exposed as a release evidence script", () => {
    expect(packageJson.scripts).toMatchObject({
      "bench:evidence:check": "node scripts/check-benchmark-evidence.mjs",
    });
  });

  it("prints a parseable success report for full and export benchmark evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-benchmark-evidence-"));
    const fullPath = join(dir, `benchmark-full-node-${nodeMajor}.json`);
    const exportPath = join(dir, `benchmark-export-node-${nodeMajor}.json`);
    await writeBenchmarkReport(fullPath, benchmarkReport({ mode: "full", eventCount: 100000 }));
    await writeBenchmarkReport(exportPath, benchmarkReport({ mode: "export", eventCount: 50000 }));

    const result = spawnSync(process.execPath, [
      "scripts/check-benchmark-evidence.mjs",
      "--json",
      "--full",
      fullPath,
      "--export",
      exportPath,
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.benchmark-evidence.v1",
      ok: true,
      check: "benchmark-evidence",
      failureCount: 0,
      failures: [],
      reports: [
        { label: "full", path: fullPath, mode: "full", eventCount: 100000 },
        { label: "export", path: exportPath, mode: "export", eventCount: 50000 },
      ],
    });
  });

  it("rejects missing full/export evidence details with structured failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-benchmark-evidence-"));
    const fullPath = join(dir, `benchmark-full-node-${nodeMajor}.json`);
    const exportPath = join(dir, `benchmark-export-node-${nodeMajor}.json`);
    await writeBenchmarkReport(fullPath, benchmarkReport({
      mode: "smoke",
      eventCount: 1000,
      hardware: "unspecified",
    }));
    await writeBenchmarkReport(exportPath, benchmarkReport({
      mode: "export",
      eventCount: 50000,
      operations: ["appendMany", "readAll", "verify"],
    }));

    const result = spawnSync(process.execPath, [
      "scripts/check-benchmark-evidence.mjs",
      "--json",
      "--full",
      fullPath,
      "--export",
      exportPath,
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.benchmark-evidence.v1",
      ok: false,
      check: "benchmark-evidence",
      failures: expect.arrayContaining([
        "full: expected mode full, received smoke",
        "full: environment.hardware must describe the benchmark machine",
        "export: missing required measurement operation replay",
        "export: missing required measurement operation visualize",
        "export: missing required measurement operation haloExport",
        "export: missing required measurement operation otlpExport",
        "export: missing required measurement operation pathlightExport",
      ]),
    });
  });

  it("rejects unknown benchmark evidence options as structured JSON", () => {
    const result = spawnSync(process.execPath, [
      "scripts/check-benchmark-evidence.mjs",
      "--json",
      "--unknown",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.benchmark-evidence.v1",
      ok: false,
      check: "benchmark-evidence",
      diagnostic: {
        code: "invalid_benchmark_evidence_option",
        message: "Unknown benchmark evidence option --unknown",
        option: "--unknown",
        suggestedAction: expect.stringContaining("--full"),
      },
    });
  });
});

function benchmarkReport(options: {
  mode: "smoke" | "full" | "export";
  eventCount: number;
  hardware?: string;
  operations?: string[];
}) {
  const operations = options.operations ?? [
    "appendMany",
    "readAll",
    "verify",
    "replay",
    "visualize",
    "haloExport",
    "otlpExport",
    "pathlightExport",
  ];
  return {
    version: "eventloom.benchmark.v1",
    mode: options.mode,
    eventCount: options.eventCount,
    generatedAt: "2026-04-28T22:00:00.000Z",
    fileSizeBytes: 4096,
    environment: {
      node: "v20.19.0",
      platform: "linux",
      arch: "x64",
      hardware: options.hardware ?? "CI fixture CPU, tmpfs, 16GB RAM",
    },
    measurements: operations.map((operation) => ({
      operation,
      eventCount: options.eventCount,
      durationMs: 1,
      throughputPerSecond: options.eventCount,
      rssBytes: 1024,
      heapUsedBytes: 512,
      fileSizeBytes: 4096,
      ...(operation.endsWith("Export") ? { spanCount: 1 } : {}),
      ...(operation === "pathlightExport" ? {
        pathlightEventCount: options.eventCount,
        pathlightRoutes: {
          "POST /v1/traces": 1,
          "POST /v1/spans": 1,
          "PATCH /v1/traces/:id": 1,
        },
      } : {}),
    })),
  };
}

async function writeBenchmarkReport(path: string, report: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
