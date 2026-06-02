import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent, type EventEnvelope } from "../src/events.js";
import { exportToHalo, formatHaloJsonl } from "../src/export/halo.js";
import { exportToOtlp, formatOtlpJson } from "../src/export/otlp.js";
import { exportToPathlight } from "../src/export/pathlight.js";
import { sealEvent } from "../src/integrity.js";

let outDir = "";
let packageVersion = "";

class FixtureGeneratorOptionsError extends Error {
  readonly code = "invalid_fixture_generator_option";

  constructor(
    readonly option: string,
    readonly value: unknown,
    readonly suggestedAction = "Use --out-dir <directory> or omit it to write the default fixture directory.",
    message?: string,
  ) {
    super(message ?? `${option} is invalid`);
    this.name = "FixtureGeneratorOptionsError";
  }
}

await main().catch((error) => {
  console.error(JSON.stringify(formatFixtureGeneratorError(error), null, 2));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  outDir = parseOutDir(process.argv.slice(2));
  await mkdir(outDir, { recursive: true });

  packageVersion = await runtimePackageVersion();
  const successEvents = await softwareWorkEvents();
  const negativeEvents = negativePathEvents();

  const successSourceLog = "fixtures/golden/software-work.jsonl";
  const negativeSourceLog = "synthetic-negative-path";
  const fixtures = [
    await writePathlightFixture("pathlight-success", "success", "pathlight-success.json", successEvents, successSourceLog),
    await writePathlightFixture("pathlight-negative", "negative", "pathlight-negative.json", negativeEvents, negativeSourceLog),
    await writeHaloFixture("halo-success", "success", "halo-success.json", successEvents, successSourceLog),
    await writeHaloFixture("halo-negative", "negative", "halo-negative.json", negativeEvents, negativeSourceLog),
    await writeOtlpFixture("otlp-success", "success", "otlp-success.json", successEvents, successSourceLog),
    await writeOtlpFixture("otlp-negative", "negative", "otlp-negative.json", negativeEvents, negativeSourceLog),
  ];

  await writeJson("manifest.json", { version: 1, fixtures });
}

async function softwareWorkEvents(): Promise<EventEnvelope[]> {
  return new JsonlEventStore(join(process.cwd(), "fixtures", "golden", "software-work.jsonl")).readAll();
}

function negativePathEvents(): EventEnvelope[] {
  const goal = sealEvent(createEvent({
    id: "evt_export_negative_goal",
    type: "goal.created",
    actorId: "user",
    threadId: "thread_negative",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-06-01T00:00:00.000Z",
    payload: { title: "Demonstrate failed export diagnostics" },
  }), null);

  const started = sealEvent(createEvent({
    id: "evt_export_negative_started",
    type: "actor.started",
    actorId: "worker",
    threadId: "thread_negative",
    parentEventId: goal.id,
    causedBy: [goal.id],
    timestamp: "2026-06-01T00:00:01.000Z",
    payload: {
      turnId: "turn_negative",
      sourceEventId: goal.id,
      mailboxEventType: "goal.created",
    },
  }), "sha256:not-the-previous-hash");

  return [goal, started];
}

async function writePathlightFixture(
  id: string,
  scenario: "success" | "negative",
  path: string,
  events: readonly EventEnvelope[],
  sourceLog: string,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let span = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/v1/traces")) return response({ id: `${id}-trace` });
    if (String(url).endsWith("/v1/spans")) return response({ id: `${id}-span-${span += 1}` });
    if (String(url).includes("/events")) return response({ id: `${id}-event` });
    return response({ ok: true });
  };

  const result = await exportToPathlight(events, {
    baseUrl: "http://pathlight.fixture",
    traceName: `eventloom-${id}`,
    fetchImpl: fetchImpl as typeof fetch,
    provenance: provenance(),
  });

  const traceCreate = parseBody(calls.find((call) => call.url === "http://pathlight.fixture/v1/traces"));
  const tracePatch = parseBody(calls.find((call) => call.url === `http://pathlight.fixture/v1/traces/${id}-trace`));
  const spanCreates = calls
    .filter((call) => call.url === "http://pathlight.fixture/v1/spans")
    .map((call) => parseBody(call));
  const spanPatches = calls
    .filter((call) => call.init.method === "PATCH" && call.url.includes("/v1/spans/"))
    .map((call) => parseBody(call));

  const fixture = {
    version: "eventloom.export-fixture.v1",
    id,
    kind: "pathlight",
    scenario,
    source: sourceMetadata(events, sourceLog),
    result,
    trace: {
      id: result.traceId,
      status: tracePatch.status,
      metadata: traceCreate.metadata,
      output: tracePatch.output,
      error: tracePatch.error ?? null,
    },
    spans: spanCreates.map((create, index) => ({
      id: `${id}-span-${index + 1}`,
      name: create.name,
      type: create.type,
      metadata: create.metadata,
      status: spanPatches[index]?.status ?? null,
      output: spanPatches[index]?.output ?? null,
      error: spanPatches[index]?.error ?? null,
    })),
  };
  await writeJson(path, fixture);

  return {
    id,
    kind: "pathlight",
    scenario,
    path,
    expected: {
      result: { traceId: result.traceId, spanCount: result.spanCount },
      trace: { status: scenario === "success" ? "completed" : "failed" },
    },
  };
}

async function writeHaloFixture(
  id: string,
  scenario: "success" | "negative",
  path: string,
  events: readonly EventEnvelope[],
  sourceLog: string,
) {
  const result = await exportToHalo(events, {
    projectId: `eventloom-${id}`,
    serviceName: "eventloom-fixtures",
    traceName: `eventloom-${id}`,
    provenance: provenance(),
  });
  const fixture = {
    version: "eventloom.export-fixture.v1",
    id,
    kind: "halo",
    scenario,
    source: sourceMetadata(events, sourceLog),
    result: {
      version: result.version,
      projectId: result.projectId,
      traceId: result.traceId,
      traceCount: result.traceCount,
      spanCount: result.spanCount,
      exportedEventCount: result.exportedEventCount,
      validPrefixCount: result.validPrefixCount,
      integrity: result.integrity,
    },
    spans: result.spans,
    jsonl: formatHaloJsonl(result),
  };
  await writeJson(path, fixture);

  return {
    id,
    kind: "halo",
    scenario,
    path,
    expected: {
      result: { projectId: result.projectId, traceCount: 1, spanCount: result.spanCount },
    },
  };
}

async function writeOtlpFixture(
  id: string,
  scenario: "success" | "negative",
  path: string,
  events: readonly EventEnvelope[],
  sourceLog: string,
) {
  const result = await exportToOtlp(events, {
    serviceName: "eventloom-fixtures",
    serviceVersion: packageVersion,
    traceName: `eventloom-${id}`,
    provenance: provenance(),
  });
  const fixture = {
    version: "eventloom.export-fixture.v1",
    id,
    kind: "otlp",
    scenario,
    source: sourceMetadata(events, sourceLog),
    result: {
      version: result.version,
      traceCount: result.traceCount,
      spanCount: result.spanCount,
      exportedEventCount: result.exportedEventCount,
      validPrefixCount: result.validPrefixCount,
      integrity: result.integrity,
    },
    resourceSpans: result.resourceSpans,
    json: formatOtlpJson(result),
  };
  await writeJson(path, fixture);

  return {
    id,
    kind: "otlp",
    scenario,
    path,
    expected: {
      result: { traceCount: 1, spanCount: result.spanCount },
    },
  };
}

function provenance() {
  return {
    packageName: "eventloom",
    packageVersion,
    gitCommit: null,
    gitBranch: null,
    gitDirty: null,
  };
}

async function runtimePackageVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json must define a string version");
  }
  return packageJson.version;
}

function sourceMetadata(events: readonly EventEnvelope[], log: string) {
  return {
    log,
    eventCount: events.length,
  };
}

function parseBody(call: { init: RequestInit } | undefined): Record<string, any> {
  if (!call) throw new Error("missing fixture call");
  return JSON.parse(String(call.init.body));
}

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(join(outDir, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseOutDir(argv: readonly string[]): string {
  let outDir = join(process.cwd(), "fixtures", "export");
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--out-dir") {
      if (!isOptionValue(value)) throw missingFixtureGeneratorValueError("--out-dir", value);
      outDir = value;
      index += 1;
    } else {
      throw new FixtureGeneratorOptionsError(
        flag,
        undefined,
        "Run npm run fixtures:export or pass --out-dir <directory>.",
        `Unknown option ${flag}`,
      );
    }
  }
  return outDir;
}

function isOptionValue(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("--");
}

function missingFixtureGeneratorValueError(option: string, value: string | undefined): FixtureGeneratorOptionsError {
  return new FixtureGeneratorOptionsError(
    option,
    value,
    "Pass a directory after --out-dir.",
    `Missing value for ${option}`,
  );
}

function formatFixtureGeneratorError(error: unknown): Record<string, unknown> {
  if (error instanceof FixtureGeneratorOptionsError) {
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
      code: "fixture_generation_failed",
      message,
      suggestedAction: "Inspect the fixture generation failure and retry after correcting the local environment.",
    },
  };
}
