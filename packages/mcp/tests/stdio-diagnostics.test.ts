import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createStderrCollector, createStdioSmokeFailure, readAvailableStderr } from "../scripts/stdio-diagnostics.mjs";

describe("MCP stdio smoke diagnostics", () => {
  it("appends child stderr to connection failures", async () => {
    const stderr = new PassThrough();
    stderr.end("SyntaxError: missing export from @eventloom/runtime\n");

    const enriched = await createStdioSmokeFailure(new Error("MCP error -32000: Connection closed"), stderr);

    expect(enriched.message).toContain("MCP error -32000: Connection closed");
    expect(enriched.message).toContain("MCP server stderr:");
    expect(enriched.message).toContain("missing export from @eventloom/runtime");
    expect(enriched.cause).toBeInstanceOf(Error);
  });

  it("returns an empty string when no child stderr is available", async () => {
    expect(await readAvailableStderr(undefined)).toBe("");
  });

  it("collects stderr without waiting for the stream to close", async () => {
    const stderr = new PassThrough();
    const collector = createStderrCollector(stderr);
    stderr.write("startup failed\n");

    const enriched = await createStdioSmokeFailure(new Error("Connection closed"), collector);

    expect(enriched.message).toContain("startup failed");
    collector.destroy();
  });
});
