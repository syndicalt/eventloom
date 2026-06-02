import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createServerConfig, resolveLogPath, ServerConfigOptionsError } from "../src/path-safety.js";
import { createEventloomMcpServer, parseServerCliOptions, ServerCliOptionsError } from "../src/server.js";
import { appendEvent, diffLogs, explainTask, exportHalo, exportOtlp, exportPathlight, handoff, inspectLog, mailbox, queryLog, recoverLog, replayLog, runBuiltIn, stats, timeline, verifyLog, visualize, verifyArtifacts, writeArtifacts } from "../src/tools.js";
import { EVENTLOOM_MCP_VERSION } from "../src/version.js";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const tsxBinName = process.platform === "win32" ? "tsx.cmd" : "tsx";
const packageTsxBin = join(packageRoot, "node_modules", ".bin", tsxBinName);
const repoTsxBin = join(repoRoot, "node_modules", ".bin", tsxBinName);
const tsxBin = existsSync(packageTsxBin) ? packageTsxBin : repoTsxBin;

describe("Eventloom MCP tools", () => {
  it("keeps server metadata version in sync with the package", () => {
    expect(EVENTLOOM_MCP_VERSION).toBe(packageJson.version);
  });

  it("parses MCP CLI root and lock timing options", () => {
    expect(parseServerCliOptions([
      "--root",
      "/tmp/eventloom",
      "--lock-timeout-ms",
      "25",
      "--lock-retry-ms",
      "2",
    ])).toEqual({
      root: "/tmp/eventloom",
      eventStore: {
        lockTimeoutMs: 25,
        lockRetryMs: 2,
      },
    });
  });

  it("rejects invalid MCP CLI options before starting stdio", () => {
    expect(() => parseServerCliOptions(["--lock-timeout-ms", "-1"])).toThrow("--lock-timeout-ms must be a non-negative integer");
    try {
      parseServerCliOptions(["--lock-retry-ms", "1.5"]);
      throw new Error("expected MCP CLI option parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerConfigOptionsError);
      expect(error).toMatchObject({
        name: "ServerConfigOptionsError",
        code: "invalid_mcp_server_option",
        option: "--lock-retry-ms",
        value: "1.5",
        suggestedAction: "Use non-negative integer millisecond values for MCP lock timing options.",
      });
    }
    try {
      parseServerCliOptions(["--unknown"]);
      throw new Error("expected unknown MCP option parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerCliOptionsError);
      expect(error).toMatchObject({
        name: "ServerCliOptionsError",
        code: "invalid_mcp_server_option",
        option: "--unknown",
        suggestedAction: "Use --root, --lock-timeout-ms, or --lock-retry-ms with valid option values.",
      });
    }
  });

  it("prints structured MCP CLI startup diagnostics before stdio starts", () => {
    const result = spawnSync(tsxBin, ["src/cli.ts", "--unknown"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_mcp_server_option",
        message: "Unknown MCP option --unknown",
        option: "--unknown",
        suggestedAction: "Use --root, --lock-timeout-ms, or --lock-retry-ms with valid option values.",
      },
    });
  });

  it("does not treat the next MCP option as a missing option value", () => {
    expect(() => parseServerCliOptions(["--root", "--lock-timeout-ms", "25"])).toThrow(ServerCliOptionsError);
    expect(() => parseServerCliOptions(["--lock-timeout-ms", "--lock-retry-ms", "2"])).toThrow("Missing value for --lock-timeout-ms");
    expect(() => parseServerCliOptions(["--lock-retry-ms", "--root", "/tmp/eventloom"])).toThrow("Missing value for --lock-retry-ms");
    try {
      parseServerCliOptions(["--root", "--lock-timeout-ms", "25"]);
      throw new Error("expected missing MCP option value parsing to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: "ServerCliOptionsError",
        code: "invalid_mcp_server_option",
        option: "--root",
        value: "--lock-timeout-ms",
        suggestedAction: "Use --root, --lock-timeout-ms, or --lock-retry-ms with valid option values.",
      });
    }
  });

  it("reads MCP root and lock timing defaults from the environment", async () => {
    const root = await tempRoot();

    withEnv({
      EVENTLOOM_MCP_ROOT: root,
      EVENTLOOM_LOCK_TIMEOUT_MS: "0",
      EVENTLOOM_LOCK_RETRY_MS: "0",
    }, () => {
      expect(createServerConfig()).toEqual({
        root,
        eventStore: {
          lockTimeoutMs: 0,
          lockRetryMs: 0,
        },
      });
    });
  });

  it("lets MCP CLI flags override environment root and lock timing", async () => {
    const envRoot = await tempRoot();
    const cliRoot = await tempRoot();

    withEnv({
      EVENTLOOM_MCP_ROOT: envRoot,
      EVENTLOOM_LOCK_TIMEOUT_MS: "99",
      EVENTLOOM_LOCK_RETRY_MS: "88",
    }, () => {
      expect(createServerConfig(parseServerCliOptions([
        "--root",
        cliRoot,
        "--lock-timeout-ms",
        "5",
        "--lock-retry-ms",
        "1",
      ]))).toEqual({
        root: cliRoot,
        eventStore: {
          lockTimeoutMs: 5,
          lockRetryMs: 1,
        },
      });
    });
  });

  it("rejects invalid MCP lock timing environment settings", () => {
    withEnv({ EVENTLOOM_LOCK_TIMEOUT_MS: "-1" }, () => {
      expect(() => createServerConfig()).toThrow(ServerConfigOptionsError);
      try {
        createServerConfig();
        throw new Error("expected MCP config creation to fail");
      } catch (error) {
        expect(error).toMatchObject({
          name: "ServerConfigOptionsError",
          code: "invalid_mcp_server_option",
          option: "EVENTLOOM_LOCK_TIMEOUT_MS",
          value: "-1",
          suggestedAction: "Use non-negative integer millisecond values for MCP lock timing options.",
        });
      }
    });
    withEnv({ EVENTLOOM_LOCK_RETRY_MS: "1.5" }, () => {
      expect(() => createServerConfig()).toThrow("EVENTLOOM_LOCK_RETRY_MS must be a non-negative integer");
    });
  });

  it("returns typed store option diagnostics for invalid programmatic MCP lock timing", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({
      root,
      eventStore: { lockTimeoutMs: -1 },
    });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-store-options-error",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "eventloom_append",
        arguments: {
          path: "store-options.jsonl",
          type: "goal.created",
          payload: { title: "Invalid store options" },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "invalid_event_store_option",
          message: "lockTimeoutMs must be a non-negative integer",
          path: "store-options.jsonl",
          option: "lockTimeoutMs",
          value: -1,
          suggestedAction: "Use non-negative integer millisecond values for Eventloom lock timing options.",
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

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
      version: "eventloom.replay.v1",
      eventCount: 1,
      integrity: { ok: true, errors: [] },
    });
    expect(replay.structuredContent?.projectionHash).toEqual(expect.any(String));
  });

  it("verifies corrupt logs with structured diagnostics", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "corrupt.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Corrupt later" },
    });
    const logPath = resolveLogPath(config, "corrupt.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const result = await verifyLog(config, { path: "corrupt.jsonl" });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.verify.v1",
      ok: false,
      validPrefixCount: 1,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });
  });

  it("preserves hash-mismatch golden fixture diagnostics through MCP verify and replay", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "corrupt-hash-mismatch-tail.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Valid prefix before hash mismatch" },
    });
    await appendEvent(config, {
      path: "corrupt-hash-mismatch-tail.jsonl",
      type: "task.proposed",
      actorId: "planner",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_hash_mismatch", title: "Original task title" },
    });
    const logPath = resolveLogPath(config, "corrupt-hash-mismatch-tail.jsonl");
    const lines = (await readFile(logPath, "utf8")).trimEnd().split("\n");
    const tampered = JSON.parse(lines[1] ?? "{}") as { payload?: Record<string, unknown> };
    tampered.payload = { ...tampered.payload, title: "Tampered task title" };
    await writeFile(logPath, `${lines[0]}\n${JSON.stringify(tampered)}\n`, "utf8");

    const verified = await verifyLog(config, { path: "corrupt-hash-mismatch-tail.jsonl" });
    const replayed = await replayLog(config, { path: "corrupt-hash-mismatch-tail.jsonl", verbose: false });

    expect(verified.structuredContent).toMatchObject({
      version: "eventloom.verify.v1",
      ok: false,
      validPrefixCount: 1,
      diagnostics: [{ code: "hash_mismatch", line: 2, eventId: expect.any(String) }],
    });
    expect(replayed.structuredContent).toMatchObject({
      version: "eventloom.replay.v1",
      eventCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "hash_mismatch", line: 2, eventId: expect.any(String) }],
      },
    });
  });

  it("returns a consolidated inspect model from the verified prefix", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "inspect.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Inspect through MCP" },
    });
    await appendEvent(config, {
      path: "inspect.jsonl",
      type: "task.proposed",
      actorId: "planner",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_mcp_inspect", title: "MCP inspect" },
    });
    const logPath = resolveLogPath(config, "inspect.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const result = await inspectLog(config, { path: "inspect.jsonl" });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      version: "eventloom.inspect.v1",
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 3 }],
      },
      stats: {
        eventCount: 2,
      },
      timeline: {
        eventCount: 2,
        integrity: {
          ok: false,
          diagnostics: [{ code: "malformed_json", line: 3 }],
        },
      },
      handoff: {
        eventCount: 2,
        goals: [{ title: "Inspect through MCP" }],
        tasks: {
          active: [{ id: "task_mcp_inspect", status: "proposed" }],
        },
      },
    });
  });

  it("returns a filtered inspect model through MCP without narrowing full-log stats", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "inspect-filtered.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Filtered inspect through MCP" },
    });
    await appendEvent(config, {
      path: "inspect-filtered.jsonl",
      type: "task.proposed",
      actorId: "planner",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_mcp_inspect_filtered", title: "MCP filtered inspect" },
    });
    await appendEvent(config, {
      path: "inspect-filtered.jsonl",
      type: "task.claimed",
      actorId: "worker",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_mcp_inspect_filtered" },
    });

    const result = await inspectLog(config, {
      path: "inspect-filtered.jsonl",
      type: "task.proposed",
      actorId: "planner",
      limit: 1,
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      version: "eventloom.inspect.v1",
      integrity: {
        ok: true,
      },
      stats: {
        eventCount: 3,
      },
      selection: {
        totalEventCount: 3,
        matchedEventCount: 1,
        query: {
          type: "task.proposed",
          actorId: "planner",
          limit: 1,
        },
        events: [{ type: "task.proposed", actorId: "planner" }],
      },
      timeline: {
        eventCount: 1,
        events: [{ ordinal: 1, type: "task.proposed", actorId: "planner" }],
      },
      handoff: {
        eventCount: 3,
      },
    });
  });

  it("recovers a verified prefix and quarantines the rejected tail through MCP", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "recover/source.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Recover through MCP" },
    });
    const logPath = resolveLogPath(config, "recover/source.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const result = await recoverLog(config, {
      path: "recover/source.jsonl",
      out: "recover/recovered.jsonl",
      quarantineTail: "recover/bad-tail.jsonl",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      outputPath: resolveLogPath(config, "recover/recovered.jsonl"),
      recoveredEventCount: 1,
      quarantinedTailPath: resolveLogPath(config, "recover/bad-tail.jsonl"),
      quarantinedLineCount: 1,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });
    await expect(readFile(resolveLogPath(config, "recover/recovered.jsonl"), "utf8"))
      .resolves.toContain("Recover through MCP");
    await expect(readFile(resolveLogPath(config, "recover/bad-tail.jsonl"), "utf8"))
      .resolves.toBe("{broken-json\n");
  });

  it("creates an empty quarantine artifact through MCP when the source log is fully verified", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "recover-clean/source.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Clean MCP recovery" },
    });

    const result = await recoverLog(config, {
      path: "recover-clean/source.jsonl",
      out: "recover-clean/recovered.jsonl",
      quarantineTail: "recover-clean/bad-tail.jsonl",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      outputPath: resolveLogPath(config, "recover-clean/recovered.jsonl"),
      recoveredEventCount: 1,
      quarantinedTailPath: resolveLogPath(config, "recover-clean/bad-tail.jsonl"),
      quarantinedLineCount: 0,
      diagnostics: [],
    });
    await expect(readFile(resolveLogPath(config, "recover-clean/bad-tail.jsonl"), "utf8"))
      .resolves.toBe("");
  });

  it("returns structured MCP recovery diagnostics when the quarantine artifact already exists", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await appendEvent(config, {
      path: "recover-existing/source.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Existing MCP quarantine" },
    });
    const quarantinePath = resolveLogPath(config, "recover-existing/bad-tail.jsonl");
    await writeFile(quarantinePath, "existing\n", "utf8");
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));
    const client = new Client({
      name: "eventloom-mcp-recovery-existing-quarantine",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "eventloom_recover",
        arguments: {
          path: "recover-existing/source.jsonl",
          out: "recover-existing/recovered.jsonl",
          quarantineTail: "recover-existing/bad-tail.jsonl",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "recovery_output_exists",
          path: quarantinePath,
          suggestedAction: "Choose a new recovery output path or remove the existing artifact deliberately.",
        },
      });
      await expect(readFile(resolveLogPath(config, "recover-existing/recovered.jsonl"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(quarantinePath, "utf8")).resolves.toBe("existing\n");
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  it("returns structured append diagnostics when the event log lock times out", async () => {
    const root = await tempRoot();
    const logPath = resolveLogPath(createServerConfig({ root }), "locked.jsonl");
    await writeFile(`${logPath}.lock`, "held", "utf8");
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({
      root,
      eventStore: { lockTimeoutMs: 20, lockRetryMs: 1 },
    });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));
    const client = new Client({
      name: "eventloom-mcp-lock-timeout",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      const startedAt = Date.now();
      const result = await client.callTool({
        name: "eventloom_append",
        arguments: {
          path: "locked.jsonl",
          type: "goal.created",
          actorId: "user",
          threadId: "thread_main",
          payload: { title: "Locked" },
        },
      });

      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "event_store_lock_timeout",
          path: logPath,
          suggestedAction: "Wait for the active writer to finish, then retry the tool call.",
        },
      });
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await unlink(`${logPath}.lock`).catch(() => undefined);
    }
  });

  it("applies configured lock timing to built-in workflow runs", async () => {
    const root = await tempRoot();
    const logPath = resolveLogPath(createServerConfig({ root }), "run-locked.jsonl");
    await writeFile(`${logPath}.lock`, "held", "utf8");
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({
      root,
      eventStore: { lockTimeoutMs: 20, lockRetryMs: 1 },
    });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));
    const client = new Client({
      name: "eventloom-mcp-run-lock-timeout",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      const startedAt = Date.now();
      const result = await client.callTool({
        name: "eventloom_run_builtin",
        arguments: {
          workflow: "software-work",
          path: "run-locked.jsonl",
        },
      });

      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "event_store_lock_timeout",
          path: logPath,
          suggestedAction: "Wait for the active writer to finish, then retry the tool call.",
        },
      });
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await unlink(`${logPath}.lock`).catch(() => undefined);
    }
  });

  it("diffs replay projections for two local logs", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "left.jsonl",
      type: "task.proposed",
      actorId: "tester",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_diff", title: "Diff" },
    });
    await appendEvent(config, {
      path: "right.jsonl",
      type: "task.proposed",
      actorId: "tester",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_diff", title: "Diff" },
    });
    await appendEvent(config, {
      path: "right.jsonl",
      type: "task.claimed",
      actorId: "tester",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_diff" },
    });

    const result = await diffLogs(config, { leftPath: "left.jsonl", rightPath: "right.jsonl" });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.projection-diff.v1",
      sameProjectionHash: false,
      tasks: { changed: [{ taskId: "task_diff", right: { status: "claimed" } }] },
    });
  });

  it("returns projection error routing metadata in diff results", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "left.jsonl",
      type: "task.claimed",
      actorId: "tester",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_missing" },
    });
    await appendEvent(config, {
      path: "left.jsonl",
      type: "approval.requested",
      actorId: "tester",
      threadId: "thread_main",
      causedBy: [],
      payload: { effectId: "effect_missing", approvalId: "approval_missing" },
    });
    await appendEvent(config, {
      path: "left.jsonl",
      type: "source.found",
      actorId: "tester",
      threadId: "thread_main",
      causedBy: [],
      payload: {
        questionId: "question_missing",
        sourceId: "source_missing",
        title: "Missing question source",
        url: "eventloom://missing-question",
      },
    });

    const result = await diffLogs(config, { leftPath: "left.jsonl", rightPath: "right.jsonl" });

    expect(result.structuredContent?.projectionErrors).toMatchObject({
      left: [
        { projectionKind: "task", code: "missing_dependency", type: "task.claimed" },
        { projectionKind: "effect", code: "missing_dependency", type: "approval.requested" },
        { projectionKind: "research", code: "missing_dependency", type: "source.found" },
      ],
      right: [],
    });
  });

  it("returns structured stats for a local log", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "stats.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Stats" },
    });

    const result = await stats(config, { path: "stats.jsonl" });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.stats.v1",
      eventCount: 1,
      integrity: { ok: true },
      eventTypes: [{ type: "goal.created", count: 1 }],
    });
  });

  it("returns structured stats diagnostics for a corrupt log", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "stats-corrupt.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Stats before corrupt tail" },
    });
    const logPath = resolveLogPath(config, "stats-corrupt.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const result = await stats(config, { path: "stats-corrupt.jsonl" });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      version: "eventloom.stats.v1",
      eventCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      eventTypes: [{ type: "goal.created", count: 1 }],
    });
  });

  it("queries filtered event summaries through MCP from the verified prefix", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "query.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Query" },
    });
    await appendEvent(config, {
      path: "query.jsonl",
      type: "task.proposed",
      actorId: "planner",
      threadId: "thread_main",
      causedBy: [],
      payload: { taskId: "task_query", title: "Query task" },
    });
    await appendEvent(config, {
      path: "query.jsonl",
      type: "task.claimed",
      actorId: "worker",
      threadId: "thread_worker",
      causedBy: [],
      payload: { taskId: "task_query" },
    });
    const logPath = resolveLogPath(config, "query.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const result = await queryLog(config, {
      path: "query.jsonl",
      type: "task.proposed",
      actorId: "planner",
      limit: 5,
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      version: "eventloom.query.v1",
      count: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 4 }],
      },
      events: [
        {
          type: "task.proposed",
          actorId: "planner",
          threadId: "thread_main",
          payload: { taskId: "task_query", title: "Query task" },
        },
      ],
    });
  });

  it("registers eventloom_query on the MCP server", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));
    const client = new Client({
      name: "eventloom-mcp-query",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name)).toContain("eventloom_query");
      expect(tools.tools.map((tool) => tool.name)).toContain("eventloom_recover");
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  it("returns rejected option values for MCP schema validation failures", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));
    const client = new Client({
      name: "eventloom-mcp-schema-diagnostics",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "eventloom_query",
        arguments: {
          path: "query-schema.jsonl",
          limit: 0,
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "invalid_tool_input",
          message: "limit must be a positive integer no greater than 1000",
          path: "query-schema.jsonl",
          option: "limit",
          value: 0,
          suggestedAction: "Use a positive integer no greater than 1000 for MCP result limits.",
        },
      });
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  it("returns timeline and task explanation content", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    const run = await runBuiltIn(config, {
      path: "workflow.jsonl",
      workflow: "software-work",
      resume: false,
    });
    expect(run.structuredContent).toMatchObject({
      stoppedReason: "idle",
      iterations: expect.any(Number),
      appended: expect.any(Number),
      processed: expect.any(Number),
      turns: expect.any(Number),
      skipped: expect.any(Number),
      rejected: expect.any(Number),
      eventCount: expect.any(Number),
      integrity: { ok: true, errors: [] },
      projectionHash: expect.any(String),
    });

    const line = await timeline(config, { path: "workflow.jsonl", limit: 3 });
    expect(line.structuredContent?.text).toContain("integrity: ok");
    expect(line.structuredContent).toMatchObject({
      version: "eventloom.timeline.v1",
      eventCount: 3,
      integrity: { ok: true, eventCount: expect.any(Number) },
      events: [
        {
          ordinal: 1,
          id: expect.any(String),
          type: expect.any(String),
          actorId: expect.any(String),
          threadId: expect.any(String),
          parentEventId: expect.anything(),
          causedBy: expect.any(Array),
          timestamp: expect.any(String),
          hash: expect.stringMatching(/^sha256:/),
          previousHash: expect.anything(),
        },
        { ordinal: 2 },
        { ordinal: 3 },
      ],
    });

    const explanation = await explainTask(config, {
      path: "workflow.jsonl",
      taskId: "task_actor_runtime",
    });
    expect(explanation.structuredContent?.text).toContain("task: task_actor_runtime");
    expect(explanation.structuredContent).toMatchObject({
      version: "eventloom.task-explanation.v1",
      found: true,
      taskId: "task_actor_runtime",
      integrity: { ok: true, eventCount: expect.any(Number) },
      task: {
        id: "task_actor_runtime",
      },
      history: expect.arrayContaining([
        {
          id: expect.any(String),
          type: expect.any(String),
          actorId: expect.any(String),
          threadId: expect.any(String),
          parentEventId: expect.anything(),
          causedBy: expect.any(Array),
          timestamp: expect.any(String),
          hash: expect.stringMatching(/^sha256:/),
          previousHash: expect.anything(),
        },
      ]),
      causalChain: expect.any(Array),
      projectionErrors: [],
    });
  });

  it("uses the verified prefix for timeline and task explanation when a log has a corrupt tail", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "workflow-corrupt-tail.jsonl",
      workflow: "software-work",
      resume: false,
    });
    const logPath = resolveLogPath(config, "workflow-corrupt-tail.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const line = await timeline(config, { path: "workflow-corrupt-tail.jsonl", limit: 2 });
    expect(line.isError).not.toBe(true);
    expect(line.structuredContent).toMatchObject({
      version: "eventloom.timeline.v1",
      eventCount: 2,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: expect.any(Number) }],
      },
      events: [{ ordinal: 1 }, { ordinal: 2 }],
    });
    expect(line.structuredContent?.text).not.toContain("actor.started");

    const explanation = await explainTask(config, {
      path: "workflow-corrupt-tail.jsonl",
      taskId: "task_actor_runtime",
    });
    expect(explanation.isError).not.toBe(true);
    expect(explanation.structuredContent).toMatchObject({
      version: "eventloom.task-explanation.v1",
      found: true,
      taskId: "task_actor_runtime",
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: expect.any(Number) }],
      },
      task: {
        id: "task_actor_runtime",
      },
      history: expect.any(Array),
      causalChain: expect.any(Array),
      projectionErrors: [],
    });
  });

  it("returns a versioned not-found task explanation through MCP", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "workflow-missing-task.jsonl",
      workflow: "software-work",
      resume: false,
    });

    const explanation = await explainTask(config, {
      path: "workflow-missing-task.jsonl",
      taskId: "task_missing_from_mcp",
    });

    expect(explanation.isError).not.toBe(true);
    expect(explanation.structuredContent?.text).toContain("Task task_missing_from_mcp was not found.");
    expect(explanation.structuredContent).toMatchObject({
      version: "eventloom.task-explanation.v1",
      found: false,
      taskId: "task_missing_from_mcp",
      integrity: { ok: true, eventCount: expect.any(Number) },
      task: null,
      history: [],
      causalChain: [],
      projectionErrors: [],
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
    expect(result.structuredContent).toMatchObject({
      version: "eventloom.mailbox.v1",
      workflow: "software-work",
      actorId: "planner",
      count: 1,
      integrity: { ok: true, eventCount: 1 },
      items: [
        {
          ordinal: 1,
          event: {
            id: expect.any(String),
            type: "goal.created",
            actorId: "user",
            threadId: "thread_main",
            parentEventId: null,
            causedBy: [],
            timestamp: expect.any(String),
            hash: expect.stringMatching(/^sha256:/),
            previousHash: null,
          },
          task: null,
        },
      ],
    });
  });

  it("uses the verified prefix for mailbox, handoff, and visualizer tools when a log has a corrupt tail", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "read-model-corrupt-tail.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Read model from prefix" },
    });
    const logPath = resolveLogPath(config, "read-model-corrupt-tail.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const mailboxResult = await mailbox(config, {
      path: "read-model-corrupt-tail.jsonl",
      workflow: "software-work",
      actorId: "planner",
    });
    expect(mailboxResult.isError).not.toBe(true);
    expect(mailboxResult.structuredContent).toMatchObject({
      version: "eventloom.mailbox.v1",
      workflow: "software-work",
      actorId: "planner",
      count: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      items: [{ ordinal: 1, event: { type: "goal.created" } }],
    });

    const handoffResult = await handoff(config, { path: "read-model-corrupt-tail.jsonl" });
    expect(handoffResult.isError).not.toBe(true);
    expect(handoffResult.structuredContent).toMatchObject({
      version: "eventloom.handoff.v1",
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      goals: [{ title: "Read model from prefix" }],
      eventTypes: { "goal.created": 1 },
      projectionErrors: [],
      telemetry: {
        models: [],
        tools: [],
        reasoning: [],
      },
    });

    const visualizerResult = await visualize(config, { path: "read-model-corrupt-tail.jsonl" });
    expect(visualizerResult.isError).not.toBe(true);
    expect(visualizerResult.structuredContent).toMatchObject({
      version: "eventloom.visualizer.v1",
      capture: {
        eventCount: 1,
      },
      replay: {
        integrity: {
          ok: false,
          diagnostics: [{ code: "malformed_json", line: 2 }],
        },
      },
    });
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
    expect(result.structuredContent).toMatchObject({
      version: "eventloom.handoff.v1",
      eventCount: 2,
      eventTypes: {
        "goal.created": 1,
        "task.proposed": 1,
      },
      integrity: { ok: true, eventCount: 2 },
      goals: [{ title: "Summarize work" }],
      tasks: {
        active: [{ id: "task_handoff", status: "proposed" }],
        completed: [],
      },
      projectionErrors: [],
      decisions: [],
      verification: [],
      releases: [],
      risks: [],
      recentFacts: [],
      telemetry: {
        models: [],
        tools: [],
        reasoning: [],
      },
      observabilityGaps: expect.any(Array),
      nextActions: expect.arrayContaining([expect.stringContaining("task_handoff")]),
    });
  });

  it("builds visualizer output", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "visualizer.jsonl",
      workflow: "software-work",
      resume: false,
    });

    const result = await visualize(config, { path: "visualizer.jsonl" });

    expect(result.structuredContent?.version).toBe("eventloom.visualizer.v1");
    expect(result.structuredContent?.capture).toMatchObject({
      eventCount: expect.any(Number),
      eventTypes: { "goal.created": 1 },
    });
    expect(result.structuredContent?.replay).toMatchObject({
      integrity: { ok: true, errors: [] },
      projection: {
        tasks: {
          tasks: {
            task_actor_runtime: { status: "approved" },
          },
        },
      },
    });
    expect(result.structuredContent?.handoff).toMatchObject({
      tasks: {
        completed: [{ id: "task_actor_runtime", status: "approved" }],
      },
      observabilityGaps: [],
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
        version: "eventloom.export.pathlight.v1",
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

  it("exports the verified prefix to Pathlight when a log has a corrupt tail", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "pathlight-corrupt-tail.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Export recoverable prefix" },
    });
    const logPath = resolveLogPath(config, "pathlight-corrupt-tail.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");
    const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
      });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_mcp_corrupt" });
      if (String(url).endsWith("/v1/spans")) return json({ id: "span_mcp_corrupt" });
      return json({ ok: true });
    });

    try {
      const exported = await exportPathlight(config, {
        path: "pathlight-corrupt-tail.jsonl",
        baseUrl: "http://pathlight.test",
      });

      expect(exported.isError).not.toBe(true);
      expect(exported.structuredContent).toMatchObject({
        version: "eventloom.export.pathlight.v1",
        traceId: "trace_mcp_corrupt",
        exportedEventCount: 1,
        validPrefixCount: 1,
        integrity: {
          ok: false,
          diagnostics: [{ code: "malformed_json", line: 2 }],
        },
      });
      const traceCreate = requests.find((request) => request.url === "http://pathlight.test/v1/traces");
      expect(traceCreate?.body).toMatchObject({
        input: { eventCount: 1 },
        metadata: {
          integrity: {
            ok: false,
            diagnostics: [{ code: "malformed_json", line: 2 }],
          },
        },
      });
    } finally {
      fetch.mockRestore();
    }
  });

  it("returns actionable Pathlight exporter errors over MCP", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-export-error",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(failedJson({ error: "collector unavailable" }, 503));

    try {
      await client.connect(transport);
      await client.callTool({
        name: "eventloom_append",
        arguments: {
          path: "pathlight-error.jsonl",
          type: "goal.created",
          actorId: "user",
          payload: { title: "Export should fail actionably" },
        },
      });

      const result = await client.callTool({
        name: "eventloom_export_pathlight",
        arguments: {
          path: "pathlight-error.jsonl",
          baseUrl: "http://pathlight.test",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "pathlight_request_failed",
          message: expect.stringContaining("503"),
          path: "pathlight-error.jsonl",
          url: "http://pathlight.test/v1/traces",
          status: 503,
          suggestedAction: "Check the Pathlight collector URL and retry after the collector accepts requests.",
        },
      });
    } finally {
      fetch.mockRestore();
      await client.close();
      await server.close();
    }
  });

  it("rejects non-HTTP Pathlight collector URLs at the MCP schema boundary", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-pathlight-url-validation",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);
    const fetch = vi.spyOn(globalThis, "fetch");

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "eventloom_export_pathlight",
        arguments: {
          path: "missing-log.jsonl",
          baseUrl: "ftp://pathlight.test",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "invalid_tool_input",
          message: "baseUrl must be an absolute HTTP(S) URL",
          path: "missing-log.jsonl",
          option: "baseUrl",
          value: "ftp://pathlight.test",
          suggestedAction: "Use an absolute http:// or https:// URL for the Pathlight collector.",
        },
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      await client.close();
      await server.close();
    }
  });

  it("rejects non-HTTP Pathlight collector URLs from the MCP environment default", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-pathlight-env-url-validation",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);
    const fetch = vi.spyOn(globalThis, "fetch");
    const previous = process.env.EVENTLOOM_PATHLIGHT_BASE_URL;
    process.env.EVENTLOOM_PATHLIGHT_BASE_URL = "ftp://pathlight.test";

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "eventloom_export_pathlight",
        arguments: {
          path: "missing-log.jsonl",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "invalid_tool_input",
          message: "baseUrl must be an absolute HTTP(S) URL",
          path: "missing-log.jsonl",
          option: "baseUrl",
          value: "ftp://pathlight.test",
          suggestedAction: "Use an absolute http:// or https:// URL for the Pathlight collector.",
        },
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.EVENTLOOM_PATHLIGHT_BASE_URL;
      else process.env.EVENTLOOM_PATHLIGHT_BASE_URL = previous;
      fetch.mockRestore();
      await client.close();
      await server.close();
    }
  });

  it("uses the MCP Pathlight environment default when baseUrl is omitted", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "pathlight-env-default.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Export through env default" },
    });

    const previous = process.env.EVENTLOOM_PATHLIGHT_BASE_URL;
    process.env.EVENTLOOM_PATHLIGHT_BASE_URL = "http://pathlight.env.test";
    const requests: Array<{ method: string; url: string }> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(url) });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_env_default" });
      if (String(url).endsWith("/v1/spans")) return json({ id: "span_env_default" });
      return json({ ok: true });
    });

    try {
      const result = await exportPathlight(config, {
        path: "pathlight-env-default.jsonl",
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        traceId: "trace_env_default",
        exportedEventCount: 1,
      });
      expect(requests.some((request) => (
        request.method === "POST" &&
        request.url === "http://pathlight.env.test/v1/traces"
      ))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.EVENTLOOM_PATHLIGHT_BASE_URL;
      else process.env.EVENTLOOM_PATHLIGHT_BASE_URL = previous;
      fetch.mockRestore();
    }
  });

  it("returns typed projection diagnostics when a built-in workflow resume log is invalid", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-runtime-projection-error",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      await client.callTool({
        name: "eventloom_append",
        arguments: {
          path: "bad-human-ops.jsonl",
          type: "effect.applied",
          actorId: "applier",
          threadId: "thread_ops",
          payload: { effectId: "missing_effect" },
        },
      });

      const result = await client.callTool({
        name: "eventloom_run_builtin",
        arguments: {
          path: "bad-human-ops.jsonl",
          workflow: "human-ops",
          resume: true,
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "runtime_projection_failed",
          message: expect.stringContaining("Effect missing_effect does not exist"),
          path: "bad-human-ops.jsonl",
          workflow: "human-ops",
          projectionKind: "effects",
          projectionErrors: [
            {
              code: "missing_dependency",
              eventId: expect.any(String),
              type: "effect.applied",
            },
          ],
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns typed runtime option diagnostics for invalid built-in workflow limits", async () => {
    const root = await tempRoot();
    const path = "invalid-runtime-options.jsonl";
    const absolutePath = resolveLogPath(createServerConfig({ root }), path);
    await writeFile(absolutePath, "preserve me\n", "utf8");

    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-runtime-options-error",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "eventloom_run_builtin",
        arguments: {
          path,
          workflow: "software-work",
          maxIterations: 0,
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "invalid_runtime_option",
          message: "maxIterations must be a positive integer",
          path,
          option: "maxIterations",
          value: 0,
          suggestedAction: "Use positive integer values for Eventloom runtime loop limits.",
        },
      });
      expect(await readFile(absolutePath, "utf8")).toBe("preserve me\n");
    } finally {
      await client.close();
      await server.close();
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
      version: "eventloom.export.halo.v1",
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

  it("exports a workflow log to OTLP JSON", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "workflow.jsonl",
      workflow: "software-work",
      resume: false,
    });

    const exported = await exportOtlp(config, {
      path: "workflow.jsonl",
      out: "otlp-trace.json",
      serviceName: "eventloom-mcp",
      traceName: "eventloom-mcp-otlp",
    });

    expect(exported.structuredContent).toMatchObject({
      version: "eventloom.export.otlp.v1",
      outputPath: join(root, "otlp-trace.json"),
      traceCount: 1,
      spanCount: expect.any(Number),
      exportedEventCount: expect.any(Number),
      validPrefixCount: expect.any(Number),
      integrity: { ok: true },
    });

    const otlp = JSON.parse(await readFile(join(root, "otlp-trace.json"), "utf8"));
    expect(otlp.resourceSpans[0].resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "eventloom-mcp" },
    });
    expect(otlp.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
      name: "eventloom-mcp-otlp",
      status: { code: "STATUS_CODE_OK" },
    });
  });

  it("exports OTLP JSON and posts it to a collector endpoint", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await runBuiltIn(config, {
      path: "workflow.jsonl",
      workflow: "software-work",
      resume: false,
    });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const exported = await exportOtlp(config, {
        path: "workflow.jsonl",
        out: "otlp-trace.json",
        endpoint: "http://collector.test/v1/traces",
        serviceName: "eventloom-mcp",
        traceName: "eventloom-mcp-otlp-push",
      });

      expect(exported.structuredContent).toMatchObject({
        version: "eventloom.export.otlp.v1",
        outputPath: join(root, "otlp-trace.json"),
        endpoint: "http://collector.test/v1/traces",
        status: 202,
        traceCount: 1,
        spanCount: expect.any(Number),
        exportedEventCount: expect.any(Number),
        validPrefixCount: expect.any(Number),
        integrity: { ok: true },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(calls[0]).toMatchObject({
        url: "http://collector.test/v1/traces",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      });
      expect(JSON.parse(String(calls[0].init.body))).toMatchObject(
        JSON.parse(await readFile(join(root, "otlp-trace.json"), "utf8")),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns actionable OTLP collector errors over MCP", async () => {
    const root = await tempRoot();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createEventloomMcpServer({ root });
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));

    const client = new Client({
      name: "eventloom-mcp-otlp-error",
      version: "0.1.1",
    });
    const transport = new StreamClientTransport(serverToClient, clientToServer);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(failedJson({ error: "collector unavailable" }, 503));

    try {
      await client.connect(transport);
      await client.callTool({
        name: "eventloom_append",
        arguments: {
          path: "otlp-error.jsonl",
          type: "goal.created",
          actorId: "user",
          payload: { title: "OTLP delivery should fail actionably" },
        },
      });

      const result = await client.callTool({
        name: "eventloom_export_otlp",
        arguments: {
          path: "otlp-error.jsonl",
          out: "otlp-error.json",
          endpoint: "http://collector.test/v1/traces",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "otlp_response_failed",
          message: "OTLP collector returned HTTP 503",
          path: "otlp-error.jsonl",
          endpoint: "http://collector.test/v1/traces",
          status: 503,
          suggestedAction: "Check the OTLP HTTP traces endpoint and retry after the collector accepts JSON requests.",
        },
      });
    } finally {
      fetch.mockRestore();
      await client.close();
      await server.close();
    }
  });

  it("refreshes MCP HALO and OTLP exports through atomic temp writes", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "workflow.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Atomic MCP exports" },
    });
    const haloPath = join(root, "exports", "halo.jsonl");
    const otlpPath = join(root, "exports", "otlp.json");

    await exportHalo(config, { path: "workflow.jsonl", out: "exports/halo.jsonl", traceName: "First HALO" });
    await exportOtlp(config, { path: "workflow.jsonl", out: "exports/otlp.json", traceName: "First OTLP" });
    await writeFile(haloPath, "stale halo\n", "utf8");
    await writeFile(otlpPath, "stale otlp\n", "utf8");

    await exportHalo(config, { path: "workflow.jsonl", out: "exports/halo.jsonl", traceName: "Refreshed HALO" });
    await exportOtlp(config, { path: "workflow.jsonl", out: "exports/otlp.json", traceName: "Refreshed OTLP" });

    const halo = await readFile(haloPath, "utf8");
    expect(halo).toContain("Refreshed HALO");
    expect(halo).not.toContain("stale halo");
    const otlp = JSON.parse(await readFile(otlpPath, "utf8"));
    expect(otlp.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
      name: "Refreshed OTLP",
      status: { code: "STATUS_CODE_OK" },
    });
    expect((await readdir(join(root, "exports"))).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("creates parent directories for nested HALO output paths", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "workflow.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Nested HALO export" },
    });

    const exported = await exportHalo(config, {
      path: "workflow.jsonl",
      out: "exports/halo/trace.jsonl",
    });

    expect(exported.structuredContent?.outputPath).toBe(join(root, "exports", "halo", "trace.jsonl"));
    const lines = (await readFile(join(root, "exports", "halo", "trace.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(exported.structuredContent?.spanCount as number);
  });

  it("exports the verified prefix to HALO when a log has a corrupt tail", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "halo-corrupt-tail.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Export recoverable prefix" },
    });
    const logPath = resolveLogPath(config, "halo-corrupt-tail.jsonl");
    await writeFile(logPath, `${await readFile(logPath, "utf8")}{broken-json\n`, "utf8");

    const exported = await exportHalo(config, {
      path: "halo-corrupt-tail.jsonl",
      out: "halo-corrupt.jsonl",
    });

    expect(exported.isError).not.toBe(true);
    expect(exported.structuredContent).toMatchObject({
      eventCount: 1,
      exportedEventCount: 1,
      validPrefixCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
    });
    const firstSpan = JSON.parse((await readFile(join(root, "halo-corrupt.jsonl"), "utf8")).trim().split("\n")[0] ?? "{}") as {
      status?: { code?: string };
      attributes?: Record<string, unknown>;
    };
    expect(firstSpan.status?.code).toBe("STATUS_CODE_ERROR");
    expect(firstSpan.attributes).toMatchObject({
      "eventloom.event_count": 1,
      "eventloom.valid_prefix_count": 1,
      "eventloom.integrity.ok": false,
    });
    expect(String(firstSpan.attributes?.["eventloom.integrity.diagnostics"])).toContain("malformed_json");
  });

  it("writes an artifact bundle inside the configured root", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "agent.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Preserve MCP artifacts" },
    });

    const result = await writeArtifacts(config, {
      path: "agent.jsonl",
      out: "artifacts",
      title: "MCP Agent Run",
    });

    expect(result.structuredContent).toMatchObject({
      outDir: join(root, "artifacts"),
      eventCount: 1,
      integrityOk: true,
      inputDigest: {
        path: join(root, "agent.jsonl"),
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      files: {
        manifest: join(root, "artifacts", "manifest.json"),
        queryJson: join(root, "artifacts", "query.json"),
        inspectJson: join(root, "artifacts", "inspect.json"),
        visualizerHtml: join(root, "artifacts", "visualizer.html"),
        haloJsonl: join(root, "artifacts", "halo.jsonl"),
        otlpJson: join(root, "artifacts", "otlp-traces.json"),
      },
      fileDigests: {
        inspectJson: {
          path: join(root, "artifacts", "inspect.json"),
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        queryJson: {
          path: join(root, "artifacts", "query.json"),
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        otlpJson: {
          path: join(root, "artifacts", "otlp-traces.json"),
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      },
    });
    expect(await readFile(join(root, "artifacts", "visualizer.html"), "utf8")).toContain("MCP Agent Run");
    expect(JSON.parse(await readFile(join(root, "artifacts", "otlp-traces.json"), "utf8"))).toMatchObject({
      resourceSpans: expect.any(Array),
    });
    expect(JSON.parse(await readFile(join(root, "artifacts", "inspect.json"), "utf8"))).toMatchObject({
      version: "eventloom.inspect.v1",
      stats: { eventCount: 1 },
    });
    expect(JSON.parse(await readFile(join(root, "artifacts", "query.json"), "utf8"))).toMatchObject({
      version: "eventloom.query.v1",
      count: 1,
    });
    expect(JSON.parse(await readFile(join(root, "artifacts", "manifest.json"), "utf8"))).toMatchObject({
      version: "eventloom.artifact-bundle.v1",
      eventCount: 1,
      inputDigest: {
        path: join(root, "agent.jsonl"),
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      files: {
        inspectJson: join(root, "artifacts", "inspect.json"),
        queryJson: join(root, "artifacts", "query.json"),
        otlpJson: join(root, "artifacts", "otlp-traces.json"),
      },
      fileDigests: {
        inspectJson: {
          path: join(root, "artifacts", "inspect.json"),
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        queryJson: {
          path: join(root, "artifacts", "query.json"),
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        otlpJson: {
          path: join(root, "artifacts", "otlp-traces.json"),
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      },
    });
  });

  it("verifies an artifact bundle inside the configured root", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "agent.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Verify MCP artifacts" },
    });
    const bundle = await writeArtifacts(config, {
      path: "agent.jsonl",
      out: "artifacts",
    });

    const result = await verifyArtifacts(config, {
      manifest: "artifacts/manifest.json",
    });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      manifestPath: join(root, "artifacts", "manifest.json"),
      ok: true,
      checkedFiles: 10,
      issues: [],
    });
    expect(bundle.structuredContent).toMatchObject({
      fileDigests: {
        handoff: {
          path: join(root, "artifacts", "handoff.md"),
        },
      },
    });
  });

  it("reports tampered artifact bundle files through MCP", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "agent.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Tampered MCP artifacts" },
    });
    await writeArtifacts(config, {
      path: "agent.jsonl",
      out: "artifacts",
    });
    await writeFile(join(root, "artifacts", "handoff.md"), "tampered handoff\n", "utf8");

    const result = await verifyArtifacts(config, {
      manifest: "artifacts/manifest.json",
    });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      ok: false,
      checkedFiles: 10,
      issues: expect.arrayContaining([
        expect.objectContaining({
          file: "handoff",
          path: join(root, "artifacts", "handoff.md"),
          code: "byte_count_mismatch",
        }),
        expect.objectContaining({
          file: "handoff",
          path: join(root, "artifacts", "handoff.md"),
          code: "sha256_mismatch",
        }),
      ]),
    });
  });

  it("returns stable MCP artifact verification issues for malformed manifests", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await mkdir(join(root, "artifacts"), { recursive: true });
    await writeFile(join(root, "artifacts", "manifest.json"), '{"version":"eventloom.artifact-bundle.v1"}\n', "utf8");

    const result = await verifyArtifacts(config, {
      manifest: "artifacts/manifest.json",
    });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      manifestPath: join(root, "artifacts", "manifest.json"),
      ok: false,
      checkedFiles: 0,
      issues: [{
        file: "manifest",
        path: "",
        code: "invalid_manifest",
      }],
    });
  });

  it("returns stable MCP artifact verification issues for non-JSON manifests", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await mkdir(join(root, "artifacts"), { recursive: true });
    await writeFile(join(root, "artifacts", "manifest.json"), "{not-json\n", "utf8");

    const result = await verifyArtifacts(config, {
      manifest: "artifacts/manifest.json",
    });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      manifestPath: join(root, "artifacts", "manifest.json"),
      ok: false,
      checkedFiles: 0,
      issues: [{
        file: "manifest",
        path: join(root, "artifacts", "manifest.json"),
        code: "invalid_manifest",
        message: expect.stringContaining("not valid JSON"),
      }],
    });
  });

  it("returns stable MCP artifact verification issues for invalid digest metadata", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });
    await mkdir(join(root, "artifacts"), { recursive: true });
    await writeFile(join(root, "artifacts", "manifest.json"), `${JSON.stringify({
      version: "eventloom.artifact-bundle.v1",
      fileDigests: {
        handoff: {
          path: join(root, "artifacts", "handoff.md"),
          bytes: -1,
          sha256: "not-a-digest",
        },
      },
    })}\n`, "utf8");

    const result = await verifyArtifacts(config, {
      manifest: "artifacts/manifest.json",
    });

    expect(result.structuredContent).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      ok: false,
      checkedFiles: 0,
      issues: expect.arrayContaining([
        {
          file: "verify",
          path: "",
          code: "invalid_manifest",
          message: "Artifact bundle manifest fileDigests.verify must include path, bytes, and sha256",
        },
        {
          file: "handoff",
          path: "",
          code: "invalid_manifest",
          message: "Artifact bundle manifest fileDigests.handoff must include path, bytes, and sha256",
        },
      ]),
    });
  });

  it("rejects artifact bundle manifest digest paths outside the configured root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "agent.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Unsafe MCP artifact digest" },
    });
    const bundle = await writeArtifacts(config, {
      path: "agent.jsonl",
      out: "artifacts",
    });
    const manifestPath = join(root, "artifacts", "manifest.json");
    const manifest = bundle.structuredContent as { fileDigests: { handoff: { path: string } } };
    manifest.fileDigests.handoff.path = join(outside, "handoff.md");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(verifyArtifacts(config, {
      manifest: "artifacts/manifest.json",
    })).rejects.toThrow(/outside the configured Eventloom root/);
  });

  it("rejects artifact bundle source-log digest paths outside the configured root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const config = createServerConfig({ root });
    await appendEvent(config, {
      path: "agent.jsonl",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      causedBy: [],
      payload: { title: "Unsafe MCP source digest" },
    });
    const bundle = await writeArtifacts(config, {
      path: "agent.jsonl",
      out: "artifacts",
    });
    const manifestPath = join(root, "artifacts", "manifest.json");
    const manifest = bundle.structuredContent as { inputDigest: { path: string } };
    manifest.inputDigest.path = join(outside, "agent.jsonl");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(verifyArtifacts(config, {
      manifest: "artifacts/manifest.json",
    })).rejects.toThrow(/outside the configured Eventloom root/);
  });

  it("rejects paths outside the configured root", async () => {
    const root = await tempRoot();
    const config = createServerConfig({ root });

    expect(() => resolveLogPath(config, "../outside.jsonl")).toThrow(/outside the configured Eventloom root/);
  });

  it("rejects symlink escapes outside the configured root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await mkdir(join(root, "links"), { recursive: true });
    await symlink(outside, join(root, "links", "outside"), "dir");
    const config = createServerConfig({ root });

    expect(() => resolveLogPath(config, "links/outside/events.jsonl")).toThrow(/outside the configured Eventloom root/);
  });

  it("allows relative log paths under a configured root that does not exist yet", async () => {
    const parent = await tempRoot();
    const root = join(parent, "workspace");
    const config = createServerConfig({ root });

    expect(resolveLogPath(config, "events.jsonl")).toBe(join(root, "events.jsonl"));
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

      const visualizer = await client.callTool({
        name: "eventloom_visualize",
        arguments: {
          path: "stdio.jsonl",
        },
      });
      expect(visualizer.structuredContent?.capture).toMatchObject({
        eventCount: 1,
      });

      const artifacts = await client.callTool({
        name: "eventloom_write_artifacts",
        arguments: {
          path: "stdio.jsonl",
          out: "stdio-artifacts",
          title: "Stdio Agent Run",
        },
      });
      expect(artifacts.structuredContent).toMatchObject({
        eventCount: 1,
        files: {
          manifest: join(root, "stdio-artifacts", "manifest.json"),
          inspectJson: join(root, "stdio-artifacts", "inspect.json"),
          queryJson: join(root, "stdio-artifacts", "query.json"),
          otlpJson: join(root, "stdio-artifacts", "otlp-traces.json"),
        },
      });
      const artifactVerification = await client.callTool({
        name: "eventloom_verify_artifacts",
        arguments: {
          manifest: "stdio-artifacts/manifest.json",
        },
      });
      expect(artifactVerification.structuredContent).toMatchObject({
        manifestPath: join(root, "stdio-artifacts", "manifest.json"),
        ok: true,
        checkedFiles: 10,
        issues: [],
      });

      const outsideRoot = await client.callTool({
        name: "eventloom_replay",
        arguments: {
          path: "../outside.jsonl",
        },
      });
      expect(outsideRoot.isError).toBe(true);
      expect(outsideRoot.structuredContent).toMatchObject({
        error: {
          code: "path_outside_root",
          message: expect.stringContaining("outside the configured Eventloom root"),
          path: "../outside.jsonl",
          suggestedAction: "Use a path inside the configured Eventloom MCP root.",
        },
      });

      const outsideRightPath = await client.callTool({
        name: "eventloom_diff",
        arguments: {
          leftPath: "stdio.jsonl",
          rightPath: "../outside.jsonl",
        },
      });
      expect(outsideRightPath.isError).toBe(true);
      expect(outsideRightPath.structuredContent).toMatchObject({
        error: {
          code: "path_outside_root",
          path: "../outside.jsonl",
        },
      });

      const outsideRecovery = `../${basename(root)}-outside-recovered.jsonl`;
      const outsideRecoveryPath = join(root, outsideRecovery);
      const outsideRecoveryResult = await client.callTool({
        name: "eventloom_recover",
        arguments: {
          path: "stdio.jsonl",
          out: outsideRecovery,
        },
      });
      expect(outsideRecoveryResult.isError).toBe(true);
      expect(outsideRecoveryResult.structuredContent).toMatchObject({
        error: {
          code: "path_outside_root",
          path: outsideRecovery,
        },
      });
      await expect(access(outsideRecoveryPath)).rejects.toMatchObject({ code: "ENOENT" });

      const insideRecoveryWithOutsideQuarantine = "stdio-recovered-with-outside-quarantine.jsonl";
      const insideRecoveryWithOutsideQuarantinePath = join(root, insideRecoveryWithOutsideQuarantine);
      const outsideQuarantine = `../${basename(root)}-outside-bad-tail.jsonl`;
      const outsideQuarantinePath = join(root, outsideQuarantine);
      const outsideQuarantineResult = await client.callTool({
        name: "eventloom_recover",
        arguments: {
          path: "stdio.jsonl",
          out: insideRecoveryWithOutsideQuarantine,
          quarantineTail: outsideQuarantine,
        },
      });
      expect(outsideQuarantineResult.isError).toBe(true);
      expect(outsideQuarantineResult.structuredContent).toMatchObject({
        error: {
          code: "path_outside_root",
          path: outsideQuarantine,
        },
      });
      await expect(access(insideRecoveryWithOutsideQuarantinePath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(outsideQuarantinePath)).rejects.toMatchObject({ code: "ENOENT" });

      const outsideArtifacts = `../${basename(root)}-outside-artifacts`;
      const outsideArtifactsPath = join(root, outsideArtifacts);
      const outsideArtifactsResult = await client.callTool({
        name: "eventloom_write_artifacts",
        arguments: {
          path: "stdio.jsonl",
          out: outsideArtifacts,
        },
      });
      expect(outsideArtifactsResult.isError).toBe(true);
      expect(outsideArtifactsResult.structuredContent).toMatchObject({
        error: {
          code: "path_outside_root",
          path: outsideArtifacts,
        },
      });
      await expect(access(outsideArtifactsPath)).rejects.toMatchObject({ code: "ENOENT" });

      const outsideHalo = `../${basename(root)}-outside-halo.jsonl`;
      const outsideHaloPath = join(root, outsideHalo);
      const outsideHaloResult = await client.callTool({
        name: "eventloom_export_halo",
        arguments: {
          path: "stdio.jsonl",
          out: outsideHalo,
        },
      });
      expect(outsideHaloResult.isError).toBe(true);
      expect(outsideHaloResult.structuredContent).toMatchObject({
        error: {
          code: "path_outside_root",
          path: outsideHalo,
        },
      });
      await expect(access(outsideHaloPath)).rejects.toMatchObject({ code: "ENOENT" });

      const outsideOtlp = `../${basename(root)}-outside-otlp.json`;
      const outsideOtlpPath = join(root, outsideOtlp);
      const outsideOtlpResult = await client.callTool({
        name: "eventloom_export_otlp",
        arguments: {
          path: "stdio.jsonl",
          out: outsideOtlp,
        },
      });
      expect(outsideOtlpResult.isError).toBe(true);
      expect(outsideOtlpResult.structuredContent).toMatchObject({
        error: {
          code: "path_outside_root",
          path: outsideOtlp,
        },
      });
      await expect(access(outsideOtlpPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "eventloom-mcp-"));
}

function withEnv(env: Record<string, string>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(env)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function failedJson(body: unknown, status: number): Response {
  return {
    ok: false,
    status,
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
