#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  AppendInputSchema,
  ExplainTaskInputSchema,
  ExportPathlightInputSchema,
  ReplayInputSchema,
  RunBuiltInInputSchema,
  TimelineInputSchema,
  appendEvent,
  explainTask,
  exportPathlight,
  replayLog,
  runBuiltIn,
  timeline,
} from "./tools.js";
import { createServerConfig } from "./path-safety.js";

export function createEventloomMcpServer(options: { root?: string | null } = {}): McpServer {
  const config = createServerConfig(options);
  const server = new McpServer({
    name: "eventloom",
    version: "0.1.1",
  });

  server.registerTool(
    "eventloom_append",
    {
      title: "Append Eventloom Event",
      description: "Append one sealed external event to a local Eventloom JSONL log.",
      inputSchema: AppendInputSchema.shape,
    },
    (input) => appendEvent(config, AppendInputSchema.parse(input)),
  );

  server.registerTool(
    "eventloom_replay",
    {
      title: "Replay Eventloom Log",
      description: "Replay a local Eventloom JSONL log and return integrity and projection status.",
      inputSchema: ReplayInputSchema.shape,
    },
    (input) => replayLog(config, ReplayInputSchema.parse(input)),
  );

  server.registerTool(
    "eventloom_timeline",
    {
      title: "Eventloom Timeline",
      description: "Return ordered Eventloom event history for a local JSONL log.",
      inputSchema: TimelineInputSchema.shape,
    },
    (input) => timeline(config, TimelineInputSchema.parse(input)),
  );

  server.registerTool(
    "eventloom_explain_task",
    {
      title: "Explain Eventloom Task",
      description: "Explain one projected task lifecycle from a local Eventloom JSONL log.",
      inputSchema: ExplainTaskInputSchema.shape,
    },
    (input) => explainTask(config, ExplainTaskInputSchema.parse(input)),
  );

  server.registerTool(
    "eventloom_run_builtin",
    {
      title: "Run Built-In Eventloom Workflow",
      description: "Run or resume a built-in deterministic Eventloom workflow.",
      inputSchema: RunBuiltInInputSchema.shape,
    },
    (input) => runBuiltIn(config, RunBuiltInInputSchema.parse(input)),
  );

  server.registerTool(
    "eventloom_export_pathlight",
    {
      title: "Export Eventloom Log To Pathlight",
      description: "Export a local Eventloom JSONL log to a Pathlight collector.",
      inputSchema: ExportPathlightInputSchema.shape,
    },
    (input) => exportPathlight(config, ExportPathlightInputSchema.parse(input)),
  );

  return server;
}

export async function runStdioServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  const server = createEventloomMcpServer({ root: parseRoot(argv) });
  await server.connect(new StdioServerTransport());
  setInterval(() => undefined, 2_147_483_647);
  process.stdin.resume();
}

function parseRoot(argv: readonly string[]): string | null {
  const rootIndex = argv.indexOf("--root");
  if (rootIndex === -1) return null;
  const root = argv[rootIndex + 1];
  if (!root) throw new Error("Missing value for --root");
  return root;
}
