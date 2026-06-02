import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("custom workflow example", () => {
  it("runs from the published public API surface", async () => {
    const { stdout } = await execFileAsync("npx", ["tsx", "examples/custom-workflow.ts"]);
    const result = JSON.parse(stdout);

    expect(result).toMatchObject({
      eventCount: 3,
      integrityOk: true,
      note: {
        id: "note_custom_1",
        body: "Preserve the human-to-agent conversation as a durable artifact.",
        version: 1,
      },
      eventTypes: {
        "goal.created": 1,
        "note.added": 1,
        "intention.rejected": 1,
      },
    });
  });
});
