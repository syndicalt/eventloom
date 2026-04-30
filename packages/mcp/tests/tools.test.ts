import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createServerConfig, resolveLogPath } from "../src/path-safety.js";
import { createEventloomMcpServer } from "../src/server.js";
import { appendEvent, explainTask, exportHalo, exportPathlight, handoff, mailbox, replayLog, runBuiltIn, timeline } from "../src/tools.js";

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

  it("returns a rebuilt actor mailbox", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "mailbox.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Test mailbox" },
    });

    const result = await mailbox(config, {
      path: "mailbox.jsonl",
      workflow: "software-work",
      actorId: "planner",
    });

    expect(result.structuredContent?.text).toContain("mailbox: planner");
    expect(result.structuredContent?.items).toMatchObject([
      { event: { type: "goal.created", actorId: "user" }, task: null },
    ]);
  });

  it("summarizes handoff state", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "handoff.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Summarize work" },
    });
    await appendEvent(config, {
      path: "handoff.jsonl",
      type: "task.proposed",
      actorId: "codex",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_handoff", title: "Write handoff" },
    });

    const result = await handoff(config, { path: "handoff.jsonl" });

    expect(result.structuredContent?.text).toContain("handoff summary");
    expect(result.structuredContent?.goals).toMatchObject([{ title: "Summarize work" }]);
    expect(result.structuredContent?.tasks).toMatchObject({
      active: [{ id: "task_handoff", status: "proposed" }],
    });
  });

  it("exports a workflow log to a Pathlight collector", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "workflow.jsonl",
      workflow: "software-work",
      resume: false,
    });
    const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    let span = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
      });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_mcp" });
      if (String(url).endsWith("/v1/spans")) return json({ id: `span_mcp_${span += 1}` });
      return json({ ok: true });
    });

    try {
      const exported = await exportPathlight(config, {
        path: "workflow.jsonl",
        baseUrl: "http://pathlight.test",
        traceName: "eventloom-mcp-test",
      });

      expect(exported.structuredContent).toMatchObject({
        traceId: "trace_mcp",
        spanCount: 21,
      });
      expect(requests.filter((request) => request.method === "POST" && request.url === "http://pathlight.test/v1/traces")).toHaveLength(1);
      expect(requests.filter((request) => request.method === "POST" && request.url === "http://pathlight.test/v1/spans")).toHaveLength(21);
      expect(requests.some((request) => request.method === "PATCH" && request.url === "http://pathlight.test/v1/traces/trace_mcp")).toBe(true);

      const traceCreate = requests.find((request) => request.url === "http://pathlight.test/v1/traces");
      expect(traceCreate?.body.name).toBe("eventloom-mcp-test");
      expect((traceCreate?.body.metadata as Record<string, unknown>).source).toBe("eventloom");
      expect(((traceCreate?.body.metadata as Record<string, unknown>).integrity as Record<string, unknown>).ok).toBe(true);
    } finally {
      fetch.mockRestore();
    }
  });

  it("exports a workflow log to HALO JSONL", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "workflow.jsonl",
      workflow: "software-work",
      resume: false,
    });

    const exported = await exportHalo(config, {
      path: "workflow.jsonl",
      out: "halo-trace.jsonl",
      projectId: "eventloom-mcp-test",
      serviceName: "eventloom-mcp",
      traceName: "eventloom-mcp-test",
    });

    expect(exported.structuredContent).toMatchObject({
      traceId: expect.any(String),
      eventCount: expect.any(Number),
      spanCount: expect.any(Number),
    });
    expect(exported.structuredContent?.outputPath).toBe(join(root, "halo-trace.jsonl"));

    const lines = (await readFile(join(root, "halo-trace.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(exported.structuredContent?.spanCount as number);
    const firstSpan = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const attributes = firstSpan.attributes as Record<string, unknown>;
    const resourceAttributes = (firstSpan.resource as Record<string, Record<string, unknown>>).attributes;
    expect(firstSpan.name).toBe("eventloom-mcp-test");
    expect(attributes["inference.project_id"]).toBe("eventloom-mcp-test");
    expect(resourceAttributes["service.name"]).toBe("eventloom-mcp");
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
      version: "0.1.1",
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

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
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
