import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSoftwareWorkRegistry } from "../src/actors.js";
import { JsonlEventStore } from "../src/event-store.js";
import { createDeterministicEventFactory, createEvent, type EventEnvelope, type EventFactory } from "../src/events.js";
import { sealEvent } from "../src/integrity.js";
import { Orchestrator } from "../src/orchestrator.js";
import { buildEventLogStats, createRuntime, projectionHash } from "../src/index.js";
import { projectEffects } from "../src/effect-projection.js";
import { runHumanOpsRuntime, runResearchPipelineRuntime, runSoftwareWorkRuntime } from "../src/runners.js";
import { buildVisualizerModel } from "../src/visualizer.js";

let outDir = "";

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
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const fixtures = [
    await writeWorkflowFixture("software-work", "software-work.jsonl", "evt_software_work", runSoftwareWorkRuntime),
    await writeWorkflowFixture("research-pipeline", "research-pipeline.jsonl", "evt_research_pipeline", runResearchPipelineRuntime),
    await writeWorkflowFixture("human-ops", "human-ops.jsonl", "evt_human_ops", runHumanOpsRuntime),
    await writeHumanOpsApprovedFixture(),
    await writeRejectionFixture(),
  ];
  const corruptFixtures = [
    await writeCorruptPartialTailFixture(),
    await writeCorruptHashMismatchFixture(),
  ];

  await writeJson("manifest.json", {
    version: 1,
    fixtures,
    corruptFixtures,
  });
}

async function writeWorkflowFixture(
  id: string,
  path: string,
  idPrefix: string,
  run: (path: string, options: { eventFactory: EventFactory }) => Promise<unknown>,
) {
  const fullPath = join(outDir, path);
  await run(fullPath, { eventFactory: factory(idPrefix) });
  return fixtureManifestEntry(id, path);
}

async function writeHumanOpsApprovedFixture() {
  const path = "human-ops-approved.jsonl";
  const fullPath = join(outDir, path);
  const eventFactory = factory("evt_human_ops_approved");

  await runHumanOpsRuntime(fullPath, { eventFactory });
  const store = new JsonlEventStore(fullPath);
  const events = await store.readAll();
  const approvalRequest = events.find((event) => event.type === "approval.requested");
  if (!approvalRequest) throw new Error("human-ops approved fixture did not request approval");

  await store.append(eventFactory.create({
    type: "approval.granted",
    actorId: "human",
    threadId: "thread_ops",
    parentEventId: approvalRequest.id,
    causedBy: [approvalRequest.id],
    payload: {
      effectId: "effect_runtime_mitigation",
      approvalId: "approval_runtime_mitigation",
      reason: "Approved for golden fixture coverage",
    },
  }));
  await runHumanOpsRuntime(fullPath, { resume: true, eventFactory });

  return fixtureManifestEntry("human-ops-approved", path);
}

async function writeRejectionFixture() {
  const path = "rejection-path.jsonl";
  const store = new JsonlEventStore(join(outDir, path));
  const orchestrator = new Orchestrator(store, createSoftwareWorkRegistry(), {
    eventFactory: factory("evt_rejection"),
  });

  await orchestrator.submitIntention({
    type: "task.claim",
    actorId: "worker",
    threadId: "thread_rejection",
    parentEventId: null,
    causedBy: [],
    payload: { taskId: "missing_task" },
  });
  await orchestrator.submitIntention({
    type: "not.real",
    actorId: "worker",
  });

  return fixtureManifestEntry("rejection-path", path);
}

async function writeCorruptPartialTailFixture() {
  const path = "corrupt-partial-tail.jsonl";
  const event = sealEvent(createEvent({
    id: "evt_corrupt_valid_prefix",
    type: "goal.created",
    actorId: "user",
    threadId: "thread_corrupt",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { title: "Valid prefix before partial tail" },
  }), null);
  await writeFile(join(outDir, path), `${JSON.stringify(event)}\n{"id":"evt_corrupt_partial`, "utf8");

  const report = await new JsonlEventStore(join(outDir, path)).verify();
  return {
    id: "partial-tail",
    path,
    ok: false,
    validPrefixCount: report.validPrefixCount,
    diagnosticCodes: report.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

async function writeCorruptHashMismatchFixture() {
  const path = "corrupt-hash-mismatch-tail.jsonl";
  const first = sealEvent(createEvent({
    id: "evt_hash_mismatch_valid_prefix",
    type: "goal.created",
    actorId: "user",
    threadId: "thread_corrupt",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { title: "Valid prefix before hash mismatch" },
  }), null);
  const second = sealEvent(createEvent({
    id: "evt_hash_mismatch_tampered_tail",
    type: "task.proposed",
    actorId: "planner",
    threadId: "thread_corrupt",
    parentEventId: first.id,
    causedBy: [first.id],
    timestamp: "2026-04-28T22:00:01.000Z",
    payload: { taskId: "task_hash_mismatch", title: "Original task title" },
  }), first.integrity.hash);
  const tampered = {
    ...second,
    payload: { ...second.payload, title: "Tampered task title" },
  };
  await writeFile(join(outDir, path), `${JSON.stringify(first)}\n${JSON.stringify(tampered)}\n`, "utf8");

  const report = await new JsonlEventStore(join(outDir, path)).verify();
  return {
    id: "hash-mismatch-tail",
    path,
    ok: false,
    validPrefixCount: report.validPrefixCount,
    diagnosticCodes: report.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

async function fixtureManifestEntry(id: string, path: string) {
  const fullPath = join(outDir, path);
  const events = await new JsonlEventStore(fullPath).readAll();
  const replay = await createRuntime(fullPath).replay();
  const visualizerHash = projectionHash(buildVisualizerModel(events));
  const stats = buildEventLogStats(events);
  const entry: Record<string, unknown> = {
    id,
    path,
    eventCount: events.length,
    projectionHash: replay.projectionHash,
    visualizerHash,
  };

  if (id === "software-work") {
    entry.telemetry = telemetryCounts(events);
    entry.tasks = {
      task_actor_runtime: {
        status: replay.projection.tasks.tasks.task_actor_runtime?.status,
      },
    };
  }
  if (id === "research-pipeline") {
    entry.research = {
      finalizedQuestions: Object.values(replay.projection.research.questions)
        .filter((question) => question.status === "finalized")
        .map((question) => question.id)
        .sort(),
    };
  }
  if (id === "human-ops" || id === "human-ops-approved") {
    entry.effects = Object.fromEntries(Object.entries(projectEffects(events).effects)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([effectId, effect]) => [effectId, { status: effect.status }]));
  }
  if (id === "rejection-path") {
    entry.eventTypes = Object.fromEntries(stats.eventTypes.map((stat) => [stat.type, stat.count]));
  }

  return entry;
}

function telemetryCounts(events: readonly EventEnvelope[]): Record<string, number> {
  const types = ["model.started", "model.completed", "tool.started", "tool.completed", "reasoning.summary"];
  return Object.fromEntries(types.map((type) => [type, events.filter((event) => event.type === type).length]));
}

function factory(idPrefix: string): EventFactory {
  return createDeterministicEventFactory({
    idPrefix,
    timestamp: "2026-04-28T22:00:00.000Z",
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(join(outDir, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseOutDir(argv: readonly string[]): string {
  let dir = join(process.cwd(), "fixtures", "golden");
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--out-dir") {
      if (!isOptionValue(value)) throw missingFixtureGeneratorValueError("--out-dir", value);
      dir = value;
      index += 1;
    } else {
      throw new FixtureGeneratorOptionsError(
        flag,
        undefined,
        "Run npm run fixtures:golden or pass --out-dir <directory>.",
        `Unknown option ${flag}`,
      );
    }
  }
  return dir;
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
