import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createRuntime,
  canonicalJson,
  createEvent,
  createDeterministicEventFactory,
  defaultEventFactory,
  eventTypeCounts,
  filterEvents,
  formatHaloJsonl,
  formatOtlpJson,
  hashEvent,
  projectionHash,
  replay,
  replayEvents,
  runBuiltInWorkflow,
  sealEvent,
  stripIntegrity,
  validateEvent,
  verifyArtifactBundleFiles,
  writeArtifactBundle,
  type ArtifactBundleResult,
  type BuiltInWorkflow,
} from "../src/index.js";

describe("public package API", () => {
  it("exports documented pure helpers from the root package API", () => {
    const event = createEvent({
      id: "evt_public_helper",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      payload: { title: "Public helper contract" },
      timestamp: "2026-04-28T22:00:00.000Z",
    });
    const sealed = sealEvent(event, null);

    expect(validateEvent(event).id).toBe("evt_public_helper");
    expect(defaultEventFactory().create({ ...event, id: "evt_default_factory" }).id).toBe("evt_default_factory");
    expect(createDeterministicEventFactory({ idPrefix: "evt_api" }).create({ ...event, id: undefined }).id).toBe("evt_api_000001");
    expect(hashEvent(event, null)).toBe(sealed.integrity.hash);
    expect(stripIntegrity(sealed)).not.toHaveProperty("integrity");
    expect(eventTypeCounts([sealed])).toEqual({ "goal.created": 1 });
    expect(replay([sealed], 0, (count) => count + 1)).toBe(1);
    expect(projectionHash({ b: 2, a: 1 })).toBe(projectionHash({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe("{\"a\":1,\"b\":2}");
    expect(filterEvents([sealed], { actorId: "user" })).toHaveLength(1);
  });

  it("runs a built-in workflow and replays projections through the facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);

    const result = await runtime.runBuiltIn("research-pipeline");
    const replay = await runtime.replay();
    const verification = await runtime.verify();

    expect(result.stoppedReason).toBe("idle");
    expect(replay.version).toBe("eventloom.replay.v1");
    expect(verification.version).toBe("eventloom.verify.v1");
    expect(replay.integrity.ok).toBe(true);
    expect(replay.projection.research.questions.question_evented_runtime.status).toBe("finalized");
    expect(replayEvents(await runtime.readAll())).toMatchObject({
      version: "eventloom.replay.v1",
      projectionHash: replay.projectionHash,
    });
  });

  it("runs built-in workflows without manually constructing stores or registries", async () => {
    const path = await tempLog();
    const workflow: BuiltInWorkflow = "software-work";

    const result = await runBuiltInWorkflow(workflow, path);
    const runtime = createRuntime(path);

    expect(result.appended).toBe(5);
    expect((await runtime.replay()).projection.tasks.tasks.task_actor_runtime.status).toBe("approved");
  });

  it("builds visualizer views through the runtime facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);

    await runtime.runBuiltIn("software-work");
    const visualizer = await runtime.visualize();

    expect(visualizer.capture.eventCount).toBeGreaterThan(0);
    expect(visualizer.capture.events.some((event) => event.type === "goal.created")).toBe(true);
    expect(visualizer.replay.integrity.ok).toBe(true);
    expect(visualizer.replay.projection.tasks.tasks.task_actor_runtime.status).toBe("approved");
    expect(visualizer.handoff.tasks.completed).toMatchObject([
      { id: "task_actor_runtime", status: "approved" },
    ]);
  });

  it("rebuilds built-in actor mailboxes through the facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Package API mailbox" },
    });

    const mailbox = await runtime.mailbox("software-work", "planner");

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].event.type).toBe("goal.created");
  });

  it("builds read-only facade views from the verified prefix of damaged logs", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Verified prefix facade" },
    });
    await writeFile(path, `${await readFile(path, "utf8")}{bad-json\n`, "utf8");

    const visualizer = await runtime.visualize();
    const mailbox = await runtime.mailbox("software-work", "planner");

    expect(visualizer.capture.eventCount).toBe(1);
    expect(visualizer.replay.integrity).toMatchObject({
      ok: false,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });
    expect(visualizer.handoff.integrity).toMatchObject({
      ok: false,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].event.type).toBe("goal.created");
  });

  it("appends external events and exports through injected fetch", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Package API goal" },
    });

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_api" });
      if (String(url).endsWith("/v1/spans")) return json({ id: "span_api" });
      return json({ ok: true });
    };

    const exported = await runtime.exportPathlight({
      baseUrl: "http://pathlight.test",
      fetchImpl: fetchImpl as typeof fetch,
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.0",
        gitCommit: null,
        gitBranch: null,
        gitDirty: null,
      },
    });

    expect(exported).toMatchObject({
      version: "eventloom.export.pathlight.v1",
      traceId: "trace_api",
      spanCount: 1,
      eventCount: 1,
      exportedEventCount: 1,
      validPrefixCount: 1,
      integrity: { ok: true, diagnostics: [] },
    });
    expect(calls.some((call) => call.url === "http://pathlight.test/v1/traces")).toBe(true);
  });

  it("exports HALO traces through the facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "task.proposed",
      actorId: "codex",
      threadId: "thread_main",
      payload: { taskId: "task_halo", title: "Export HALO traces" },
    });

    const exported = await runtime.exportHalo({
      projectId: "eventloom-api",
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.3",
        gitCommit: null,
        gitBranch: null,
        gitDirty: null,
      },
    });

    expect(exported.projectId).toBe("eventloom-api");
    expect(exported.version).toBe("eventloom.export.halo.v1");
    expect(exported.spanCount).toBe(2);
    expect(formatHaloJsonl(exported)).toContain("\"inference.project_id\":\"eventloom-api\"");
  });

  it("exports OTLP traces through the facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "task.proposed",
      actorId: "codex",
      threadId: "thread_main",
      payload: { taskId: "task_otlp_api", title: "Export OTLP traces" },
    });

    const exported = await runtime.exportOtlp({
      serviceName: "eventloom-api",
      provenance: {
        packageName: "eventloom",
        packageVersion: "1.0.0",
        gitCommit: null,
        gitBranch: null,
        gitDirty: null,
      },
    });

    expect(exported).toMatchObject({
      version: "eventloom.export.otlp.v1",
      traceCount: 1,
      spanCount: 2,
      exportedEventCount: 1,
      validPrefixCount: 1,
      integrity: { ok: true, diagnostics: [] },
    });
    expect(formatOtlpJson(exported)).toContain("\"service.name\"");
  });

  it("recovers and quarantines damaged logs through the runtime facade", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    const first = await runtime.append({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Facade recovery" },
    });
    const dir = await mkdtemp(join(tmpdir(), "eventloom-api-recovery-"));
    const out = join(dir, "events.recovered.jsonl");
    const quarantinePath = join(dir, "events.bad-tail.jsonl");
    await writeFile(path, `${JSON.stringify(first)}\n{bad-json\n`, "utf8");

    const result = await runtime.recoverVerifiedPrefix(out, { quarantinePath });

    expect(result).toMatchObject({
      outputPath: out,
      recoveredEventCount: 1,
      quarantinedTailPath: quarantinePath,
      quarantinedLineCount: 1,
    });
    expect((await readFile(out, "utf8")).trim()).toBe(JSON.stringify(first));
    expect(await readFile(quarantinePath, "utf8")).toBe("{bad-json\n");
  });

  it("writes artifact bundles through the root package API", async () => {
    const path = await tempLog();
    const runtime = createRuntime(path);
    await runtime.append({
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      payload: { title: "Root artifact API" },
    });
    const dir = await mkdtemp(join(tmpdir(), "eventloom-api-artifacts-"));

    const result: ArtifactBundleResult = await writeArtifactBundle({
      inputPath: path,
      outDir: join(dir, "artifacts"),
      title: "Root Package Artifact API",
    });

    expect(result).toMatchObject({
      version: "eventloom.artifact-bundle.v1",
      inputPath: path,
      eventCount: 1,
      integrityOk: true,
      files: {
        verify: join(dir, "artifacts", "verify.json"),
        stats: join(dir, "artifacts", "stats.json"),
        queryJson: join(dir, "artifacts", "query.json"),
        inspectJson: join(dir, "artifacts", "inspect.json"),
        visualizerJson: join(dir, "artifacts", "visualizer.json"),
        visualizerHtml: join(dir, "artifacts", "visualizer.html"),
        handoff: join(dir, "artifacts", "handoff.md"),
        haloJsonl: join(dir, "artifacts", "halo.jsonl"),
        otlpJson: join(dir, "artifacts", "otlp-traces.json"),
        manifest: join(dir, "artifacts", "manifest.json"),
      },
    });
    expect(await readFile(result.files.manifest, "utf8")).toContain("eventloom.artifact-bundle.v1");
    expect(result.fileDigests.otlpJson).toMatchObject({
      path: result.files.otlpJson,
      sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(result.fileDigests.queryJson).toMatchObject({
      path: result.files.queryJson,
      sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(result.inputDigest).toMatchObject({
      path,
      sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    await expect(verifyArtifactBundleFiles(result)).resolves.toMatchObject({
      ok: true,
      checkedFiles: 10,
      issues: [],
    });
    expect(JSON.parse(await readFile(result.files.queryJson, "utf8"))).toMatchObject({
      version: "eventloom.query.v1",
      count: 1,
    });
    expect(JSON.parse(await readFile(result.files.verify, "utf8"))).toMatchObject({
      version: "eventloom.verify.v1",
      eventCount: 1,
      ok: true,
      integrity: { ok: true },
    });
    expect(JSON.parse(await readFile(result.files.inspectJson, "utf8"))).toMatchObject({
      version: "eventloom.inspect.v1",
      stats: { eventCount: 1 },
    });
    const otlp = JSON.parse(await readFile(result.files.otlpJson, "utf8"));
    expect(otlp.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
      name: "eventloom.log",
    });
  });
});

async function tempLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-api-"));
  return join(dir, "events.jsonl");
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
