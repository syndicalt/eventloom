import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createServerConfig, resolveLogPath } from "../src/path-safety.js";
import { createEventloomMcpServer } from "../src/server.js";
import { appendEvent, explainTask, replayLog, runBuiltIn, timeline } from "../src/tools.js";

describe("Eventloom MCP tools", () => {
  it("appends and replays a local event log", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });

    const appended = await appendEvent(config, {
      path: "events.jsonl",
      type: "task.proposed",
      actorId: "codex",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_mcp", title: "Test MCP tools" },
    });

    expect(appended.structuredContent?.event).toMatchObject({
      type: "task.proposed",
      actorId: "codex",
    });
    expect(appended.structuredContent?.hash).toEqual(expect.stringMatching(/^sha256:/));

    const replay = await replayLog(config, { path: "events.jsonl", verbose: false });
    expect(replay.structuredContent).toMatchObject({
      eventCount: 1,
      integrity: { ok: true, errors: [] },
    });
    expect(replay.structuredContent?.projectionHash).toEqual(expect.any(String));
  });

  it("returns timeline and task explanation content", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "workflow.jsonl",
      workflow: "software-work",
      resume: false,
    });

    const line = await timeline(config, { path: "workflow.jsonl", limit: 3 });
    expect(line.structuredContent?.text).toContain("integrity: ok");
    expect(line.structuredContent?.events).toHaveLength(3);

    const explanation = await explainTask(config, {
      path: "workflow.jsonl",
      taskId: "task_actor_runtime",
    });
    expect(explanation.structuredContent?.text).toContain("task: task_actor_runtime");
    expect(explanation.structuredContent?.task).toMatchObject({
      id: "task_actor_runtime",
    });
  });

  it("rejects paths outside the configured root", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });

    expect(() => resolveLogPath(config, "../outside.jsonl")).toThrow(/outside the configured Eventloom root/);
  });

  it("serves tools over MCP stdio", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-smoke",
      version: "0.1.0",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);

      const appended = await client.callTool({
        name: "eventloom_append",
        arguments: {
          path: "stdio.jsonl",
          type: "task.proposed",
          actorId: "codex",
          threadId: "thread_main",
          payload: { taskId: "task_stdio_smoke", title: "Smoke test MCP stdio" },
        },
      });
      expect(appended.structuredContent?.hash).toEqual(expect.stringMatching(/^sha256:/));

      const replay = await client.callTool({
        name: "eventloom_replay",
        arguments: {
          path: "stdio.jsonl",
        },
      });
      expect(replay.structuredContent).toMatchObject({
        eventCount: 1,
        integrity: { ok: true, errors: [] },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "eventloom-mcp-"));
}

class StreamClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly input: PassThrough,
    private readonly output: PassThrough,
  ) {}

  async start(): Promise<void> {
    this.input.on("data", this.handleData);
    this.input.on("error", this.handleError);
    this.input.on("close", this.handleClose);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.output.write(JSON.stringify(message) + "\n")) {
        resolve();
      } else {
        this.output.once("drain", resolve);
      }
    });
  }

  async close(): Promise<void> {
    this.input.off("data", this.handleData);
    this.input.off("error", this.handleError);
    this.input.off("close", this.handleClose);
    this.output.end();
    this.input.end();
    this.onclose?.();
  }

  private readonly handleData = (chunk: Buffer): void => {
    for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
      this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
    }
  };

  private readonly handleError = (error: Error): void => {
    this.onerror?.(error);
  };

  private readonly handleClose = (): void => {
    this.onclose?.();
  };
}
