import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("pack manifest check reports", () => {
  it("prints a parseable success report in JSON mode", () => {
    const result = spawnSync(process.execPath, [
      "scripts/check-pack-manifests.mjs",
      "--json",
    ], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.pack-manifests.v1",
      ok: true,
      check: "pack-manifests",
      failureCount: 0,
      failures: [],
      packages: [
        {
          label: "runtime",
          name: "@eventloom/runtime",
          version: "1.0.0",
          filename: "eventloom-runtime-1.0.0.tgz",
          fileCount: expect.any(Number),
        },
        {
          label: "mcp",
          name: "@eventloom/mcp",
          filename: expect.stringMatching(/^eventloom-mcp-/),
          fileCount: expect.any(Number),
        },
      ],
    });
  });

  it("rejects unknown pack check options as structured JSON when requested", () => {
    const result = spawnSync(process.execPath, [
      "scripts/check-pack-manifests.mjs",
      "--json",
      "--unknown",
    ], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.pack-manifests.v1",
      ok: false,
      check: "pack-manifests",
      diagnostic: {
        code: "invalid_pack_manifest_check_option",
        message: "Unknown pack manifest check option --unknown",
        option: "--unknown",
        suggestedAction: "Use only --json for pack manifest check options.",
      },
    });
  });
});
