import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDeterministicEventFactory, createRuntime, runHumanOpsRuntime, runResearchPipelineRuntime, runSoftwareWorkRuntime } from "../src/index.js";

describe("deterministic runtime execution", () => {
  it("can produce byte-identical software-work logs when given equivalent deterministic factories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-determinism-"));
    const left = join(dir, "left.jsonl");
    const right = join(dir, "right.jsonl");

    await runSoftwareWorkRuntime(left, { eventFactory: factory() });
    await runSoftwareWorkRuntime(right, { eventFactory: factory() });

    expect(await readFile(left, "utf8")).toBe(await readFile(right, "utf8"));
    expect((await createRuntime(left).replay()).projectionHash).toBe((await createRuntime(right).replay()).projectionHash);
  });

  it("can produce byte-identical research-pipeline logs when given equivalent deterministic factories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-determinism-"));
    const left = join(dir, "left.jsonl");
    const right = join(dir, "right.jsonl");

    await runResearchPipelineRuntime(left, { eventFactory: factory() });
    await runResearchPipelineRuntime(right, { eventFactory: factory() });

    expect(await readFile(left, "utf8")).toBe(await readFile(right, "utf8"));
    expect((await createRuntime(left).replay()).projectionHash).toBe((await createRuntime(right).replay()).projectionHash);
  });

  it("can produce byte-identical human-ops logs when given equivalent deterministic factories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-determinism-"));
    const left = join(dir, "left.jsonl");
    const right = join(dir, "right.jsonl");

    await runHumanOpsRuntime(left, { eventFactory: factory() });
    await runHumanOpsRuntime(right, { eventFactory: factory() });

    expect(await readFile(left, "utf8")).toBe(await readFile(right, "utf8"));
    expect((await createRuntime(left).replay()).projectionHash).toBe((await createRuntime(right).replay()).projectionHash);
  });
});

function factory() {
  return createDeterministicEventFactory({
    idPrefix: "evt_test",
    timestamp: "2026-04-28T22:00:00.000Z",
  });
}
