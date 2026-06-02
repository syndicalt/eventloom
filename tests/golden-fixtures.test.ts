import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { buildVisualizerModel } from "../src/visualizer.js";
import { buildEventLogStats, canonicalJson, createRuntime, projectionHash } from "../src/index.js";

interface GoldenManifest {
  version: number;
  fixtures: GoldenFixture[];
  corruptFixtures?: CorruptGoldenFixture[];
}

interface GoldenFixture {
  id: string;
  path: string;
  eventCount: number;
  projectionHash: string;
  visualizerHash: string;
  eventTypes?: Record<string, number>;
  telemetry?: Record<string, number>;
  tasks?: Record<string, { status: string }>;
  research?: { finalizedQuestions?: string[] };
  effects?: Record<string, { status: string }>;
}

interface CorruptGoldenFixture {
  id: string;
  path: string;
  ok: false;
  validPrefixCount: number;
  diagnosticCodes: string[];
}

describe("golden fixtures", () => {
  it("keeps every manifest fixture replayable and hash-stable", async () => {
    const manifest = JSON.parse(await readFile(join("fixtures", "golden", "manifest.json"), "utf8")) as GoldenManifest;
    expect(manifest.version).toBe(1);
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual(expect.arrayContaining([
      "rejection-path",
      "software-work",
      "research-pipeline",
      "human-ops",
      "human-ops-approved",
    ]));
    expect(manifest.fixtures.find((fixture) => fixture.id === "human-ops-approved")?.effects).toEqual({
      effect_runtime_mitigation: { status: "applied" },
    });
    expect(manifest.fixtures.find((fixture) => fixture.id === "software-work")?.telemetry).toEqual({
      "model.started": 5,
      "model.completed": 5,
      "tool.started": 5,
      "tool.completed": 5,
      "reasoning.summary": 5,
    });

    for (const fixture of manifest.fixtures) {
      const path = join("fixtures", "golden", fixture.path);
      const store = new JsonlEventStore(path);
      const events = await store.readAll();
      const replay = await createRuntime(path).replay();
      const stats = buildEventLogStats(events);
      const visualizerHash = projectionHash(buildVisualizerModel(events));

      expect(stats.integrity.ok, fixture.id).toBe(true);
      expect(stats.eventCount, fixture.id).toBe(fixture.eventCount);
      expect(replay.projectionHash, fixture.id).toBe(fixture.projectionHash);
      expect(stats.projectionHash, fixture.id).toBe(fixture.projectionHash);
      expect(visualizerHash, fixture.id).toBe(fixture.visualizerHash);
      expect(canonicalJson(replay.projection), fixture.id).toEqual(canonicalJson(replay.projection));

      for (const [type, count] of Object.entries(fixture.eventTypes ?? {})) {
        const actual = stats.eventTypes.find((entry) => entry.type === type)?.count ?? 0;
        expect(actual, `${fixture.id}:${type}`).toBe(count);
      }
      for (const [type, count] of Object.entries(fixture.telemetry ?? {})) {
        const telemetryEvents = events.filter((event) => event.type === type);
        expect(telemetryEvents, `${fixture.id}:${type}`).toHaveLength(count);
      }
      for (const [taskId, expected] of Object.entries(fixture.tasks ?? {})) {
        expect(replay.projection.tasks.tasks[taskId], `${fixture.id}:${taskId}`).toMatchObject(expected);
      }
      for (const questionId of fixture.research?.finalizedQuestions ?? []) {
        expect(replay.projection.research.questions[questionId], `${fixture.id}:${questionId}`).toMatchObject({
          status: "finalized",
        });
      }
      for (const [effectId, expected] of Object.entries(fixture.effects ?? {})) {
        expect(replay.projection.effects.effects[effectId], `${fixture.id}:${effectId}`).toMatchObject(expected);
      }
    }
  });

  it("keeps corrupt golden fixtures diagnosable without replaying invalid tails", async () => {
    const manifest = JSON.parse(await readFile(join("fixtures", "golden", "manifest.json"), "utf8")) as GoldenManifest;
    expect(manifest.corruptFixtures?.map((fixture) => fixture.id)).toEqual(expect.arrayContaining([
      "hash-mismatch-tail",
      "partial-tail",
    ]));

    for (const fixture of manifest.corruptFixtures ?? []) {
      const report = await new JsonlEventStore(join("fixtures", "golden", fixture.path)).verify();

      expect(report.ok, fixture.id).toBe(fixture.ok);
      expect(report.validPrefixCount, fixture.id).toBe(fixture.validPrefixCount);
      expect(report.diagnostics.map((diagnostic) => diagnostic.code), fixture.id).toEqual(fixture.diagnosticCodes);
    }
  });
});
