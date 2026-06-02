import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { verifyArtifactBundleFiles, writeArtifactBundle } from "../src/artifacts.js";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";

describe("artifact bundle", () => {
  it("writes repo-local inspection and export artifacts from one event log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-artifacts-"));
    const inputPath = join(dir, "events.jsonl");
    const outDir = join(dir, "artifacts");
    const store = new JsonlEventStore(inputPath);
    await store.append(createEvent({
      id: "evt_artifact_goal",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Preserve agent session" },
    }));

    const result = await writeArtifactBundle({ inputPath, outDir, title: "Agent Session Artifacts" });

    expect(result).toMatchObject({
      inputPath,
      outDir,
      eventCount: 1,
      integrityOk: true,
      files: {
        verify: join(outDir, "verify.json"),
        stats: join(outDir, "stats.json"),
        queryJson: join(outDir, "query.json"),
        inspectJson: join(outDir, "inspect.json"),
        visualizerJson: join(outDir, "visualizer.json"),
        visualizerHtml: join(outDir, "visualizer.html"),
        handoff: join(outDir, "handoff.md"),
        haloJsonl: join(outDir, "halo.jsonl"),
        otlpJson: join(outDir, "otlp-traces.json"),
        manifest: join(outDir, "manifest.json"),
      },
    });

    const manifest = JSON.parse(await readFile(result.files.manifest, "utf8"));
    expect(manifest).toMatchObject({
      version: "eventloom.artifact-bundle.v1",
      inputPath,
      eventCount: 1,
      integrityOk: true,
      inputDigest: result.inputDigest,
      files: result.files,
      fileDigests: result.fileDigests,
    });
    await expectDigest(result.inputDigest, inputPath);
    expect(Object.keys(result.fileDigests).sort()).toEqual([
      "haloJsonl",
      "handoff",
      "inspectJson",
      "otlpJson",
      "queryJson",
      "stats",
      "verify",
      "visualizerHtml",
      "visualizerJson",
    ]);
    await expectDigest(result.fileDigests.verify, result.files.verify);
    await expectDigest(result.fileDigests.visualizerHtml, result.files.visualizerHtml);
    expect(result.fileDigests).not.toHaveProperty("manifest");
    await expect(verifyArtifactBundleFiles(result)).resolves.toEqual({
      version: "eventloom.artifact-bundle-verification.v1",
      ok: true,
      checkedFiles: 10,
      issues: [],
    });
    expect(await readFile(result.files.handoff, "utf8")).toContain("handoff summary");
    expect(await readFile(result.files.visualizerHtml, "utf8")).toContain("eventloom-visualizer-data");
    const otlp = JSON.parse(await readFile(result.files.otlpJson, "utf8"));
    const rootSpan = otlp.resourceSpans[0].scopeSpans[0].spans.find((span: { name?: string }) => span.name === "eventloom.log");
    expect(rootSpan).toMatchObject({
      attributes: expect.arrayContaining([
        {
          key: "eventloom.integrity.ok",
          value: { boolValue: true },
        },
        {
          key: "eventloom.valid_prefix_count",
          value: { intValue: "1" },
        },
      ]),
    });
    expect(JSON.parse(await readFile(result.files.visualizerJson, "utf8"))).toMatchObject({
      capture: { eventCount: 1 },
    });
    expect(JSON.parse(await readFile(result.files.stats, "utf8"))).toMatchObject({
      version: "eventloom.stats.v1",
      eventCount: 1,
      integrity: { ok: true },
    });
    expect(JSON.parse(await readFile(result.files.verify, "utf8"))).toMatchObject({
      version: "eventloom.verify.v1",
      eventCount: 1,
      ok: true,
      validPrefixCount: 1,
      diagnosticCount: 0,
      integrity: { ok: true, diagnostics: [] },
    });
    expect(JSON.parse(await readFile(result.files.queryJson, "utf8"))).toMatchObject({
      version: "eventloom.query.v1",
      count: 1,
      integrity: { ok: true },
      events: [{ id: "evt_artifact_goal", type: "goal.created" }],
    });
    expect(JSON.parse(await readFile(result.files.inspectJson, "utf8"))).toMatchObject({
      version: "eventloom.inspect.v1",
      integrity: { ok: true },
      stats: { eventCount: 1 },
      timeline: { eventCount: 1 },
      handoff: { eventCount: 1 },
    });
    expect(await readFile(result.files.haloJsonl, "utf8")).toContain("\"eventloom.event_count\":1");
  });

  it("refreshes bundle files through atomic temp writes without leaving temp artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-artifacts-atomic-"));
    const inputPath = join(dir, "events.jsonl");
    const outDir = join(dir, "artifacts");
    const store = new JsonlEventStore(inputPath);
    await store.append(createEvent({
      id: "evt_artifact_atomic_goal",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Atomic artifact refresh" },
    }));

    const first = await writeArtifactBundle({ inputPath, outDir, title: "Original Bundle" });
    await writeFile(first.files.manifest, "stale manifest\n", "utf8");
    await writeFile(first.files.visualizerHtml, "stale visualizer\n", "utf8");

    const refreshed = await writeArtifactBundle({ inputPath, outDir, title: "Refreshed Bundle" });

    expect(JSON.parse(await readFile(refreshed.files.manifest, "utf8"))).toMatchObject({
      version: "eventloom.artifact-bundle.v1",
      projectionHash: refreshed.projectionHash,
      fileDigests: refreshed.fileDigests,
    });
    await expectDigest(refreshed.fileDigests.visualizerHtml, refreshed.files.visualizerHtml);
    const html = await readFile(refreshed.files.visualizerHtml, "utf8");
    expect(html).toContain("Refreshed Bundle");
    expect(html).not.toContain("stale visualizer");
    expect((await readdir(outDir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("reports tampered and missing generated artifact files from manifest digests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-artifacts-verify-"));
    const inputPath = join(dir, "events.jsonl");
    const outDir = join(dir, "artifacts");
    const store = new JsonlEventStore(inputPath);
    await store.append(createEvent({
      id: "evt_artifact_verify_goal",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Verify artifact bundle" },
    }));
    const result = await writeArtifactBundle({ inputPath, outDir });
    await writeFile(inputPath, "tampered input log\n", "utf8");
    await writeFile(result.files.handoff, "tampered handoff\n", "utf8");
    await rm(result.files.otlpJson);

    await expect(verifyArtifactBundleFiles(result)).resolves.toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      ok: false,
      checkedFiles: 10,
      issues: expect.arrayContaining([
        expect.objectContaining({
          file: "input",
          path: inputPath,
          code: "byte_count_mismatch",
          expectedBytes: result.inputDigest.bytes,
          actualBytes: "tampered input log\n".length,
        }),
        expect.objectContaining({
          file: "input",
          path: inputPath,
          code: "sha256_mismatch",
          expectedSha256: result.inputDigest.sha256,
          actualSha256: `sha256:${createHash("sha256").update("tampered input log\n").digest("hex")}`,
        }),
        expect.objectContaining({
          file: "handoff",
          path: result.files.handoff,
          code: "byte_count_mismatch",
          expectedBytes: result.fileDigests.handoff.bytes,
          actualBytes: "tampered handoff\n".length,
        }),
        expect.objectContaining({
          file: "handoff",
          path: result.files.handoff,
          code: "sha256_mismatch",
          expectedSha256: result.fileDigests.handoff.sha256,
          actualSha256: `sha256:${createHash("sha256").update("tampered handoff\n").digest("hex")}`,
        }),
        expect.objectContaining({
          file: "otlpJson",
          path: result.files.otlpJson,
          code: "missing_file",
        }),
      ]),
    });
  });

  it("reports invalid artifact bundle manifest digest metadata without throwing", async () => {
    await expect(verifyArtifactBundleFiles({})).resolves.toEqual({
      version: "eventloom.artifact-bundle-verification.v1",
      ok: false,
      checkedFiles: 0,
      issues: [{
        file: "manifest",
        path: "",
        code: "invalid_manifest",
        message: "Artifact bundle manifest must include a fileDigests object",
      }],
    });

    await expect(verifyArtifactBundleFiles({
      fileDigests: {
        handoff: {
          path: "/tmp/handoff.md",
          bytes: -1,
          sha256: "not-a-digest",
        },
      },
    })).resolves.toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      ok: false,
      checkedFiles: 0,
      issues: expect.arrayContaining([
        {
          file: "verify",
          path: "",
          code: "invalid_manifest",
          message: "Artifact bundle manifest fileDigests.verify must include path, bytes, and sha256",
        },
        {
          file: "handoff",
          path: "",
          code: "invalid_manifest",
          message: "Artifact bundle manifest fileDigests.handoff must include path, bytes, and sha256",
        },
      ]),
    });
  });

  it("preserves corrupt-tail diagnostics in verify and manifest artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-artifacts-corrupt-"));
    const inputPath = join(dir, "events.jsonl");
    const outDir = join(dir, "artifacts");
    const store = new JsonlEventStore(inputPath);
    const first = await store.append(createEvent({
      id: "evt_artifact_corrupt_goal",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Recoverable artifact prefix" },
    }));
    await writeFile(inputPath, `${JSON.stringify(first)}\n{bad-json\n`, "utf8");

    const result = await writeArtifactBundle({ inputPath, outDir });
    const verify = JSON.parse(await readFile(result.files.verify, "utf8"));
    const manifest = JSON.parse(await readFile(result.files.manifest, "utf8"));

    expect(result).toMatchObject({
      eventCount: 1,
      integrityOk: false,
      diagnosticCount: 1,
      validPrefixCount: 1,
      lastGoodLine: 1,
      lastGoodHash: first.integrity.hash,
    });
    expect(verify).toMatchObject({
      version: "eventloom.verify.v1",
      eventCount: 1,
      ok: false,
      validPrefixCount: 1,
      diagnosticCount: 1,
      diagnostics: [{ code: "malformed_json", line: 2 }],
      integrity: {
        ok: false,
        validPrefixCount: 1,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
    });
    expect(manifest).toMatchObject({
      integrityOk: false,
      diagnosticCount: 1,
      validPrefixCount: 1,
      lastGoodLine: 1,
      lastGoodHash: first.integrity.hash,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });
    expect(JSON.parse(await readFile(result.files.visualizerJson, "utf8"))).toMatchObject({
      capture: { eventCount: 1 },
    });
    const otlp = JSON.parse(await readFile(result.files.otlpJson, "utf8"));
    const rootSpan = otlp.resourceSpans[0].scopeSpans[0].spans.find((span: { name?: string }) => span.name === "eventloom.log");
    expect(rootSpan).toMatchObject({
      attributes: expect.arrayContaining([
        {
          key: "eventloom.integrity.ok",
          value: { boolValue: false },
        },
        {
          key: "eventloom.valid_prefix_count",
          value: { intValue: "1" },
        },
        {
          key: "eventloom.integrity.diagnostics",
          value: { stringValue: expect.stringContaining("malformed_json") },
        },
      ]),
    });
  });
});

async function expectDigest(digest: { path: string; bytes: number; sha256: string } | undefined, path: string): Promise<void> {
  expect(digest).toBeDefined();
  const contents = await readFile(path);
  expect(digest).toEqual({
    path,
    bytes: contents.byteLength,
    sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
  });
}
