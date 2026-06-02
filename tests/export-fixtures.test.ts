import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

interface ExportFixtureManifest {
  version: 1;
  fixtures: Array<{
    id: string;
    kind: "pathlight" | "halo" | "otlp";
    scenario: "success" | "negative";
    path: string;
    expected: Record<string, unknown>;
  }>;
}

describe("export fixtures", () => {
  it("ships Pathlight, HALO, and OTLP success and negative-path fixtures", async () => {
    const manifest = await readManifest();

    expect(manifest.version).toBe(1);
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual(expect.arrayContaining([
      "pathlight-success",
      "pathlight-negative",
      "halo-success",
      "halo-negative",
      "otlp-success",
      "otlp-negative",
    ]));

    for (const fixture of manifest.fixtures) {
      const payload = JSON.parse(await readFile(join("fixtures", "export", fixture.path), "utf8"));
      expect(payload.version).toBe("eventloom.export-fixture.v1");
      expect(payload.source.eventCount).toEqual(expect.any(Number));
      expect(payload.result).toMatchObject({
        exportedEventCount: payload.source.eventCount,
        validPrefixCount: payload.source.eventCount,
        integrity: { ok: fixture.scenario === "success" },
      });
      expect(payload).toMatchObject(fixture.expected);
    }
  });

  it("keeps negative-path fixtures inspectable without live services", async () => {
    const manifest = await readManifest();
    const pathlight = manifest.fixtures.find((fixture) => fixture.id === "pathlight-negative");
    const halo = manifest.fixtures.find((fixture) => fixture.id === "halo-negative");
    const otlp = manifest.fixtures.find((fixture) => fixture.id === "otlp-negative");
    if (!pathlight || !halo || !otlp) throw new Error("missing negative fixtures");

    const pathlightPayload = JSON.parse(await readFile(join("fixtures", "export", pathlight.path), "utf8"));
    const haloPayload = JSON.parse(await readFile(join("fixtures", "export", halo.path), "utf8"));
    const otlpPayload = JSON.parse(await readFile(join("fixtures", "export", otlp.path), "utf8"));

    expect(pathlightPayload.trace.status).toBe("failed");
    expect(pathlightPayload.trace.output.visualizer.handoff.observabilityGaps.length).toBeGreaterThan(0);
    expect(pathlightPayload.spans.some((span: { status?: string; error?: string }) => (
      span.status === "failed" || typeof span.error === "string"
    ))).toBe(true);
    expect(haloPayload.spans.some((span: { status?: { code?: string } }) => (
      span.status?.code === "STATUS_CODE_ERROR"
    ))).toBe(true);
    expect(haloPayload.jsonl).toContain("\"STATUS_CODE_ERROR\"");
    expect(otlpPayload.resourceSpans[0].scopeSpans[0].spans.some((span: { status?: { code?: string } }) => (
      span.status?.code === "STATUS_CODE_ERROR"
    ))).toBe(true);
    expect(otlpPayload.json).toContain("\"STATUS_CODE_ERROR\"");
  });

  it("records fixture source logs by scenario instead of golden event count", async () => {
    const tempRoot = await makeTempWorkspace();
    const goldenPath = join(tempRoot, "fixtures", "golden", "software-work.jsonl");
    const originalGolden = await readFile(join("fixtures", "golden", "software-work.jsonl"), "utf8");
    const fewerEventsGolden = originalGolden.trimEnd().split("\n").slice(0, -1).join("\n");
    await writeFile(goldenPath, `${fewerEventsGolden}\n`, "utf8");

    const outDir = join(tempRoot, "fixtures", "export");
    const result = spawnSync(
      "npx",
      ["tsx", join(process.cwd(), "scripts", "generate-export-fixtures.ts"), "--out-dir", outDir],
      { cwd: tempRoot, encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const manifest = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")) as ExportFixtureManifest;
    for (const fixture of manifest.fixtures) {
      const payload = JSON.parse(await readFile(join(outDir, fixture.path), "utf8"));
      expect(payload.source.log).toBe(
        fixture.scenario === "success" ? "fixtures/golden/software-work.jsonl" : "synthetic-negative-path",
      );
    }
  });
});

async function readManifest(): Promise<ExportFixtureManifest> {
  return JSON.parse(await readFile(join("fixtures", "export", "manifest.json"), "utf8")) as ExportFixtureManifest;
}

async function makeTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "eventloom-export-fixtures-"));
  await mkdir(join(root, "fixtures", "golden"), { recursive: true });
  await mkdir(join(root, "fixtures", "export"), { recursive: true });
  await copyFile("package.json", join(root, "package.json"));
  return root;
}
