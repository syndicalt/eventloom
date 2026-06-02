import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { JsonlEventStore } from "../../src/event-store.js";
import { createDeterministicEventFactory, type EventFactory } from "../../src/events.js";
import type { EventEnvelope } from "../../src/events.js";
import { createRuntime } from "../../src/runtime.js";

interface BenchmarkResult {
  version: "eventloom.benchmark.v1";
  mode: "smoke" | "full" | "export";
  eventCount: number;
  generatedAt: string;
  fileSizeBytes: number;
  environment: {
    node: string;
    platform: string;
    arch: string;
    hardware: string;
  };
  measurements: BenchmarkMeasurement[];
}

interface BenchmarkMeasurement {
  operation: string;
  eventCount: number;
  durationMs: number;
  throughputPerSecond: number;
  rssBytes: number;
  heapUsedBytes: number;
  fileSizeBytes?: number;
  spanCount?: number;
  pathlightEventCount?: number;
  pathlightRoutes?: Record<string, number>;
}

interface BenchOptions {
  mode: "smoke" | "full" | "export";
  eventCount: number;
  outPath?: string;
}

class BenchmarkOptionsError extends Error {
  readonly code = "invalid_benchmark_option";

  constructor(
    readonly option: string,
    readonly value: unknown,
    readonly suggestedAction = "Use --mode smoke|full|export and a positive integer --events value.",
    message?: string,
  ) {
    super(message ?? `${option} is invalid`);
    this.name = "BenchmarkOptionsError";
  }
}

const DEFAULT_COUNTS: Record<BenchOptions["mode"], number> = {
  smoke: 1_000,
  full: 100_000,
  export: 50_000,
};

const FIXED_NOW = process.env.EVENTLOOM_BENCH_FIXED_NOW ?? new Date().toISOString();

async function main(argv: readonly string[]): Promise<void> {
  const options = parseOptions(argv);
  const dir = await mkdtemp(join(tmpdir(), "eventloom-bench-"));
  try {
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const factory = createDeterministicEventFactory({
      idPrefix: "evt_bench",
      timestamp: "2026-04-28T22:00:00.000Z",
    });
    const measurements: BenchmarkMeasurement[] = [];

    measurements.push(await measure("appendMany", options.eventCount, async () => {
      await appendBenchmarkEvents(store, factory, options.eventCount);
      return { fileSizeBytes: await currentFileSize(path) };
    }));

    const runtime = createRuntime(path);
    measurements.push(await measure("readAll", options.eventCount, async () => {
      await runtime.readAll();
      return { fileSizeBytes: await currentFileSize(path) };
    }));
    measurements.push(await measure("verify", options.eventCount, async () => {
      await runtime.verify();
      return { fileSizeBytes: await currentFileSize(path) };
    }));
    measurements.push(await measure("replay", options.eventCount, async () => {
      await runtime.replay();
      return { fileSizeBytes: await currentFileSize(path) };
    }));
    measurements.push(await measure("visualize", options.eventCount, async () => {
      await runtime.visualize();
      return { fileSizeBytes: await currentFileSize(path) };
    }));
    measurements.push(await measure("haloExport", options.eventCount, async () => {
      const result = await runtime.exportHalo({ provenanceImpl: benchProvenance });
      return { fileSizeBytes: await currentFileSize(path), spanCount: result.spanCount };
    }));
    measurements.push(await measure("otlpExport", options.eventCount, async () => {
      const result = await runtime.exportOtlp({ provenanceImpl: benchProvenance });
      return { fileSizeBytes: await currentFileSize(path), spanCount: result.spanCount };
    }));

    const pathlightRoutes: Record<string, number> = {};
    measurements.push(await measure("pathlightExport", options.eventCount, async () => {
      const result = await runtime.exportPathlight({
        baseUrl: "http://pathlight.bench",
        fetchImpl: benchFetch(pathlightRoutes),
        provenanceImpl: benchProvenance,
      });
      return {
        fileSizeBytes: await currentFileSize(path),
        spanCount: result.spanCount,
        pathlightEventCount: result.eventCount,
      };
    }, pathlightRoutes));

    const result: BenchmarkResult = {
      version: "eventloom.benchmark.v1",
      mode: options.mode,
      eventCount: options.eventCount,
      generatedAt: FIXED_NOW,
      fileSizeBytes: (await stat(path)).size,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        hardware: process.env.EVENTLOOM_BENCH_HARDWARE ?? "unspecified",
      },
      measurements,
    };
    const output = JSON.stringify(result, null, 2);
    if (options.outPath) {
      await mkdir(dirname(options.outPath), { recursive: true });
      await writeFile(options.outPath, `${output}\n`, "utf8");
    }
    console.log(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseOptions(argv: readonly string[]): BenchOptions {
  let modeValue: string | undefined;
  let eventCountValue: string | undefined;
  let outPath: string | undefined;
  let smoke = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--smoke") {
      smoke = true;
      continue;
    }
    if (flag === "--mode") {
      const value = argv[index + 1];
      if (!isOptionValue(value)) throw missingBenchmarkValueError("--mode", value);
      modeValue = value;
      index += 1;
      continue;
    }
    if (flag === "--events") {
      const value = argv[index + 1];
      if (!isOptionValue(value)) throw missingBenchmarkValueError("--events", value);
      eventCountValue = value;
      index += 1;
      continue;
    }
    if (flag === "--out") {
      const value = argv[index + 1];
      if (!isOptionValue(value)) throw missingBenchmarkValueError("--out", value);
      outPath = value;
      index += 1;
      continue;
    }
    throw new BenchmarkOptionsError(
      flag,
      undefined,
      "Run npm run bench:smoke, npm run bench, or pass documented benchmark options.",
      `Unknown benchmark option ${flag}`,
    );
  }

  const mode = modeValue ?? (smoke ? "smoke" : "full");
  if (mode !== "smoke" && mode !== "full" && mode !== "export") {
    throw new BenchmarkOptionsError(
      "--mode",
      mode,
      "Use one of: smoke, full, export.",
      `Unknown benchmark mode ${mode}`,
    );
  }
  const eventCount = eventCountValue ? Number(eventCountValue) : DEFAULT_COUNTS[mode];
  if (!Number.isInteger(eventCount) || eventCount <= 0) {
    throw new BenchmarkOptionsError(
      "--events",
      eventCountValue,
      "Use a positive integer event count.",
      "--events must be a positive integer",
    );
  }
  return { mode, eventCount, outPath };
}

function isOptionValue(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("--");
}

function missingBenchmarkValueError(option: string, value: string | undefined): BenchmarkOptionsError {
  return new BenchmarkOptionsError(
    option,
    value,
    "Pass a value after the benchmark option.",
    `Missing value for ${option}`,
  );
}

async function appendBenchmarkEvents(
  store: JsonlEventStore,
  factory: EventFactory,
  eventCount: number,
): Promise<void> {
  const state: { appended: EventEnvelope[]; taskIndex: number } = { appended: [], taskIndex: 0 };
  while (state.appended.length < eventCount) {
    const next = nextBenchmarkBatch(factory, state);
    for (const event of next) {
      if (state.appended.length >= eventCount) break;
      state.appended.push(event);
    }
    state.taskIndex += 1;
  }
  await store.appendMany(state.appended);
}

function nextBenchmarkBatch(factory: EventFactory, state: { appended: readonly EventEnvelope[]; taskIndex: number }): EventEnvelope[] {
  if (state.appended.length === 0) {
    return [factory.create({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_bench",
      parentEventId: null,
      causedBy: [],
      payload: { title: "Benchmark local event log performance" },
    })];
  }

  const taskId = `task_bench_${String(state.taskIndex).padStart(6, "0")}`;
  const previous = state.appended.at(-1);
  const threadId = `thread_${state.taskIndex % 16}`;
  const proposed = factory.create({
    type: "task.proposed",
    actorId: "planner",
    threadId,
    parentEventId: previous?.id ?? null,
    causedBy: previous ? [previous.id] : [],
    payload: { taskId, title: `Benchmark task ${state.taskIndex}` },
  });
  const started = factory.create({
    type: "actor.started",
    actorId: "worker",
    threadId,
    parentEventId: proposed.id,
    causedBy: [proposed.id],
    payload: { turnId: `turn_${taskId}`, sourceEventId: proposed.id, mailboxEventType: "task.proposed" },
  });
  const toolStarted = factory.create({
    type: "tool.started",
    actorId: "worker",
    threadId,
    parentEventId: started.id,
    causedBy: [started.id, proposed.id],
    payload: { turnId: `turn_${taskId}`, toolCallId: `tool_${taskId}`, toolName: "eventloom.benchmark" },
  });
  const toolCompleted = factory.create({
    type: "tool.completed",
    actorId: "worker",
    threadId,
    parentEventId: started.id,
    causedBy: [started.id, toolStarted.id],
    payload: {
      turnId: `turn_${taskId}`,
      toolCallId: `tool_${taskId}`,
      toolName: "eventloom.benchmark",
      outputSummary: "Benchmark tool completed.",
      exitCode: 0,
      resultCount: 1,
      latencyMs: 1,
      decisive: true,
    },
  });
  const modelStarted = factory.create({
    type: "model.started",
    actorId: "worker",
    threadId,
    parentEventId: started.id,
    causedBy: [started.id],
    payload: {
      turnId: `turn_${taskId}`,
      modelCallId: `model_${taskId}`,
      modelProvider: "eventloom",
      modelName: "benchmark-runner",
      promptVersion: "eventloom.benchmark.v1",
      inputSummary: "Benchmark model input.",
      inputMessages: [{ role: "user", content: `Handle ${taskId}` }],
      parameters: { temperature: 0 },
    },
  });
  const reasoning = factory.create({
    type: "reasoning.summary",
    actorId: "worker",
    threadId,
    parentEventId: started.id,
    causedBy: [started.id, modelStarted.id],
    payload: { turnId: `turn_${taskId}`, summary: `Claim and complete ${taskId}.`, confidence: 1 },
  });
  const modelCompleted = factory.create({
    type: "model.completed",
    actorId: "worker",
    threadId,
    parentEventId: started.id,
    causedBy: [started.id, modelStarted.id],
    payload: {
      turnId: `turn_${taskId}`,
      modelCallId: `model_${taskId}`,
      modelProvider: "eventloom",
      modelName: "benchmark-runner",
      outputSummary: "Benchmark model completed.",
      outputText: "claim and complete",
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      latencyMs: 1,
      cost: 0,
    },
  });
  const claimed = factory.create({
    type: "task.claimed",
    actorId: "worker",
    threadId,
    parentEventId: proposed.id,
    causedBy: [proposed.id, started.id],
    payload: { taskId },
  });
  const completed = factory.create({
    type: "task.completed",
    actorId: "worker",
    threadId,
    parentEventId: claimed.id,
    causedBy: [claimed.id],
    payload: { taskId },
  });
  const actorCompleted = factory.create({
    type: "actor.completed",
    actorId: "worker",
    threadId,
    parentEventId: started.id,
    causedBy: [started.id, claimed.id, completed.id],
    payload: {
      turnId: `turn_${taskId}`,
      sourceEventId: proposed.id,
      intentions: ["task.claim", "task.complete"],
      acceptedEvents: [claimed.id, completed.id],
      rejectedEvents: [],
    },
  });
  const processed = factory.create({
    type: "actor.processed",
    actorId: "worker",
    threadId,
    parentEventId: actorCompleted.id,
    causedBy: [actorCompleted.id],
    payload: { turnId: `turn_${taskId}`, sourceEventId: proposed.id },
  });

  const events = [
    proposed,
    started,
    toolStarted,
    toolCompleted,
    modelStarted,
    reasoning,
    modelCompleted,
    claimed,
    completed,
    actorCompleted,
    processed,
  ];
  if (state.taskIndex % 25 === 0) {
    events.push(factory.create({
      type: "decision.recorded",
      actorId: "worker",
      threadId,
      parentEventId: completed.id,
      causedBy: [completed.id],
      payload: { decision: `Benchmark decision ${state.taskIndex}` },
    }));
  }
  if (state.taskIndex % 50 === 0) {
    events.push(factory.create({
      type: "verification.completed",
      actorId: "worker",
      threadId,
      parentEventId: completed.id,
      causedBy: [completed.id],
      payload: { summary: `Benchmark verification ${state.taskIndex}`, ok: true },
    }));
  }
  if (state.taskIndex % 100 === 0) {
    events.push(factory.create({
      type: "risk.detected",
      actorId: "worker",
      threadId,
      parentEventId: completed.id,
      causedBy: [completed.id],
      payload: { summary: `Benchmark risk marker ${state.taskIndex}`, severity: "low" },
    }));
  }
  return events;
}

async function measure(
  operation: string,
  eventCount: number,
  run: () => Promise<Partial<BenchmarkMeasurement> | void>,
  pathlightRoutes?: Record<string, number>,
): Promise<BenchmarkMeasurement> {
  const started = performance.now();
  const extra = await run();
  const durationMs = round(performance.now() - started);
  const memory = process.memoryUsage();
  return {
    operation,
    eventCount,
    durationMs,
    throughputPerSecond: durationMs === 0 ? eventCount : round((eventCount / durationMs) * 1_000),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    ...extra,
    ...(pathlightRoutes ? { pathlightRoutes: { ...pathlightRoutes } } : {}),
  };
}

async function currentFileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function benchProvenance() {
  return {
    packageName: "@eventloom/runtime",
    packageVersion: "0.0.0-bench",
    gitCommit: "bench",
    gitBranch: "bench",
    gitDirty: false,
  };
}

function benchFetch(routes: Record<string, number>): typeof fetch {
  let span = 0;
  return async (url, init) => {
    const route = routeKey(String(url), init?.method ?? "GET");
    routes[route] = (routes[route] ?? 0) + 1;
    if (route === "POST /v1/traces") return jsonResponse({ id: "trace_bench" });
    if (route === "POST /v1/spans") return jsonResponse({ id: `span_bench_${span += 1}` });
    return jsonResponse({ ok: true });
  };
}

function routeKey(url: string, method: string): string {
  const { pathname } = new URL(url);
  if (method === "PATCH" && /^\/v1\/traces\/[^/]+$/.test(pathname)) return "PATCH /v1/traces/:id";
  if (method === "PATCH" && /^\/v1\/spans\/[^/]+$/.test(pathname)) return "PATCH /v1/spans/:id";
  if (method === "POST" && /^\/v1\/spans\/[^/]+\/events$/.test(pathname)) return "POST /v1/spans/:id/events";
  return `${method} ${pathname}`;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(JSON.stringify(formatBenchmarkError(error), null, 2));
  process.exitCode = 1;
});

function formatBenchmarkError(error: unknown): Record<string, unknown> {
  if (error instanceof BenchmarkOptionsError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        option: error.option,
        value: error.value,
        suggestedAction: error.suggestedAction,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    error: {
      code: "benchmark_failed",
      message,
      suggestedAction: "Inspect the benchmark failure and retry after correcting the local environment.",
    },
  };
}
