import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { collectRuntimeProvenance } from "../src/provenance.js";

describe("runtime provenance", () => {
  it("reads package metadata and tolerates missing git metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-provenance-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "threadline-test",
      version: "9.9.9",
    }), "utf8");

    const provenance = await collectRuntimeProvenance(dir);

    expect(provenance).toEqual({
      packageName: "threadline-test",
      packageVersion: "9.9.9",
      gitCommit: null,
      gitBranch: null,
      gitDirty: null,
    });
  });
});
