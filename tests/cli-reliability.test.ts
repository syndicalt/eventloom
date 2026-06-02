import { execFile } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { createEvent } from "../src/events.js";

const execFileAsync = promisify(execFile);

describe("CLI reliability commands", () => {
  it("verifies corrupt logs with JSON diagnostics and nonzero exit", async () => {
    const { path } = await corruptLog();

    await expect(execFileAsync("npx", ["tsx", "src/cli.ts", "verify", path], { env: cliTestEnv() })).rejects.toMatchObject({
      stdout: expect.stringContaining('"code": "malformed_json"'),
    });
  });

  it("validates logs as an alias of verify with identical JSON and exit code", async () => {
    const { path } = await corruptLog();

    const verify = await captureCli(["verify", path]);
    const validate = await captureCli(["validate", path]);

    expect(validate.code).toBe(verify.code);
    expect(validate.stdout).toBe(verify.stdout);
    expect(JSON.parse(validate.stdout)).toMatchObject({
      version: "eventloom.verify.v1",
      ok: false,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });
  });

  it("reports hash-mismatch golden fixture diagnostics through verify and replay", async () => {
    const path = join("fixtures", "golden", "corrupt-hash-mismatch-tail.jsonl");

    const verify = await captureCli(["verify", path]);
    const replay = await captureCli(["replay", path]);

    expect(verify.code).toBe(1);
    expect(JSON.parse(verify.stdout)).toMatchObject({
      version: "eventloom.verify.v1",
      ok: false,
      validPrefixCount: 1,
      diagnostics: [{ code: "hash_mismatch", line: 2, eventId: "evt_hash_mismatch_tampered_tail" }],
    });
    expect(replay.code).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({
      version: "eventloom.replay.v1",
      eventCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "hash_mismatch", line: 2, eventId: "evt_hash_mismatch_tampered_tail" }],
      },
      projection: {
        eventTypes: { "goal.created": 1 },
      },
    });
  });

  it("recovers a verified prefix to an output log", async () => {
    const { path, first } = await corruptLog();
    const out = join(await mkdtemp(join(tmpdir(), "eventloom-cli-recovery-")), "recovered.jsonl");

    const { stdout } = await execFileAsync("npx", ["tsx", "src/cli.ts", "recover", path, "--out", out], { env: cliTestEnv() });

    expect(JSON.parse(stdout)).toMatchObject({ recoveredEventCount: 1, outputPath: out });
    expect((await readFile(out, "utf8")).trim()).toBe(JSON.stringify(first));
  });

  it("recovers a verified prefix and quarantines the rejected tail from the CLI", async () => {
    const { path, first } = await corruptLog();
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-quarantine-"));
    const out = join(dir, "recovered.jsonl");
    const quarantine = join(dir, "bad-tail.jsonl");

    const { stdout } = await execFileAsync("npx", [
      "tsx",
      "src/cli.ts",
      "recover",
      path,
      "--out",
      out,
      "--quarantine-tail",
      quarantine,
    ], { env: cliTestEnv() });

    expect(JSON.parse(stdout)).toMatchObject({
      recoveredEventCount: 1,
      outputPath: out,
      quarantinedTailPath: quarantine,
      quarantinedLineCount: 1,
    });
    expect((await readFile(out, "utf8")).trim()).toBe(JSON.stringify(first));
    expect(await readFile(quarantine, "utf8")).toBe("{bad-json\n");
  });

  it("creates an empty CLI quarantine artifact when the source log is fully verified", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-empty-quarantine-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "recovered.jsonl");
    const quarantine = join(dir, "bad-tail.jsonl");
    const first = await new JsonlEventStore(path).append(createEvent({
      id: "evt_cli_empty_quarantine",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Clean quarantine" },
    }));

    const { stdout } = await execFileAsync("npx", [
      "tsx",
      "src/cli.ts",
      "recover",
      path,
      "--out",
      out,
      "--quarantine-tail",
      quarantine,
    ], { env: cliTestEnv() });

    expect(JSON.parse(stdout)).toMatchObject({
      recoveredEventCount: 1,
      outputPath: out,
      quarantinedTailPath: quarantine,
      quarantinedLineCount: 0,
      diagnostics: [],
    });
    expect((await readFile(out, "utf8")).trim()).toBe(JSON.stringify(first));
    expect(await readFile(quarantine, "utf8")).toBe("");
  });

  it("prints structured recovery diagnostics when the quarantine artifact already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-recovery-existing-quarantine-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "recovered.jsonl");
    const quarantine = join(dir, "bad-tail.jsonl");
    await new JsonlEventStore(path).append(createEvent({
      id: "evt_cli_existing_quarantine",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Existing quarantine" },
    }));
    await writeFile(quarantine, "existing\n", "utf8");

    const result = await captureCli(["recover", path, "--out", out, "--quarantine-tail", quarantine]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "recovery_output_exists",
        path: quarantine,
        suggestedAction: "Choose a new recovery output path or remove the existing artifact deliberately.",
      },
    });
    await expect(readFile(out, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(quarantine, "utf8")).toBe("existing\n");
  });

  it("prints structured recovery diagnostics for unsafe output paths", async () => {
    const { path } = await corruptLog();

    const result = await captureCli(["recover", path, "--out", path]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "recovery_path_collision",
        path,
        suggestedAction: "Choose distinct source, recovery output, and quarantine paths.",
      },
    });
  });

  it("prints structured recovery diagnostics when the output already exists", async () => {
    const { path } = await corruptLog();
    const out = join(await mkdtemp(join(tmpdir(), "eventloom-cli-recovery-existing-")), "recovered.jsonl");
    await writeFile(out, "existing\n", "utf8");

    const result = await captureCli(["recover", path, "--out", out]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "recovery_output_exists",
        path: out,
        suggestedAction: "Choose a new recovery output path or remove the existing artifact deliberately.",
      },
    });
    expect(await readFile(out, "utf8")).toBe("existing\n");
  });

  it("replays the verified prefix when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();

    const { stdout } = await execFileAsync("npx", ["tsx", "src/cli.ts", "replay", path], { env: cliTestEnv() });
    const replay = JSON.parse(stdout);

    expect(replay).toMatchObject({
      version: "eventloom.replay.v1",
      eventCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      projection: {
        eventTypes: { "goal.created": 1 },
      },
    });
  });

  it("accepts --json on JSON-default CLI commands", async () => {
    const { path } = await corruptLog();
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-json-defaults-"));
    const appendPath = join(dir, "append.jsonl");
    const demoPath = join(dir, "demo.jsonl");
    const runPath = join(dir, "run.jsonl");
    const otlpOut = join(dir, "otlp-traces.json");
    const recoverOut = join(dir, "recovered.jsonl");
    const artifactsOut = join(dir, "artifacts");

    const appended = await captureCli(["append", appendPath, "goal.created", "--payload", "{\"title\":\"JSON flag\"}", "--json"]);
    const demo = await captureCli(["demo", "software-work", demoPath, "--json"]);
    const run = await captureCli(["run", "software-work", runPath, "--max-iterations", "1", "--json"]);
    const replay = await captureCli(["replay", path, "--json"]);
    const verify = await captureCli(["verify", path, "--json"]);
    const validate = await captureCli(["validate", path, "--json"]);
    const stats = await captureCli(["stats", path, "--json"]);
    const otlp = await captureCli(["export", "otlp", path, "--out", otlpOut, "--json"]);
    const recover = await captureCli(["recover", path, "--out", recoverOut, "--json"]);
    const visualize = await captureCli(["visualize", path, "--json"]);
    const artifacts = await captureCli(["artifacts", path, "--out", artifactsOut, "--json"]);
    const artifactsStatus = JSON.parse(artifacts.stdout);
    const artifactsVerify = await captureCli(["artifacts", "verify", artifactsStatus.files.manifest, "--json"]);

    expect(appended.code).toBe(0);
    expect(JSON.parse(appended.stdout)).toMatchObject({
      id: expect.any(String),
      hash: expect.stringMatching(/^sha256:/),
      previousHash: null,
    });

    expect(demo.code).toBe(0);
    expect(JSON.parse(demo.stdout)).toMatchObject({ path: demoPath });

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      path: runPath,
      iterations: expect.any(Number),
      appended: expect.any(Number),
      processed: expect.any(Number),
      turns: expect.any(Number),
      skipped: expect.any(Number),
      rejected: expect.any(Number),
      stoppedReason: expect.stringMatching(/^(idle|max_iterations)$/),
    });

    expect(replay.code).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({
      eventCount: 1,
      integrity: { ok: false, diagnostics: [{ code: "malformed_json", line: 2 }] },
    });

    expect(verify.code).toBe(1);
    expect(JSON.parse(verify.stdout)).toMatchObject({
      version: "eventloom.verify.v1",
      ok: false,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });
    expect(validate).toMatchObject({
      code: verify.code,
      stdout: verify.stdout,
    });

    expect(stats.code).toBe(0);
    expect(JSON.parse(stats.stdout)).toMatchObject({
      eventCount: 1,
      integrity: { ok: false, diagnostics: [{ code: "malformed_json", line: 2 }] },
    });

    expect(otlp.code).toBe(0);
    expect(JSON.parse(otlp.stdout)).toMatchObject({
      out: otlpOut,
      traceCount: 1,
      integrity: { ok: false, diagnostics: [{ code: "malformed_json", line: 2 }] },
    });
    expect(JSON.parse(await readFile(otlpOut, "utf8"))).toHaveProperty("resourceSpans");

    expect(recover.code).toBe(0);
    expect(JSON.parse(recover.stdout)).toMatchObject({
      outputPath: recoverOut,
      recoveredEventCount: 1,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });

    expect(visualize.code).toBe(0);
    expect(JSON.parse(visualize.stdout)).toMatchObject({
      capture: { eventCount: 1 },
      replay: { integrity: { ok: false, diagnostics: [{ code: "malformed_json", line: 2 }] } },
    });

    expect(artifacts.code).toBe(0);
    expect(artifactsStatus).toMatchObject({
      outDir: artifactsOut,
      eventCount: 1,
      integrityOk: false,
    });

    expect(artifactsVerify.code).toBe(0);
    expect(JSON.parse(artifactsVerify.stdout)).toMatchObject({
      manifestPath: artifactsStatus.files.manifest,
      ok: true,
      checkedFiles: 10,
    });
  });

  it("prints timeline JSON from the verified prefix when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();

    const result = await captureCli(["timeline", path, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      eventCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      events: [
        {
          ordinal: 1,
          id: "evt_cli_recover_1",
          type: "goal.created",
          actorId: "user",
        },
      ],
    });
  });

  it("prints handoff JSON from the verified prefix when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();

    const result = await captureCli(["handoff", path, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.handoff.v1",
      eventCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      eventTypes: {
        "goal.created": 1,
      },
    });
  });

  it("builds visualizer JSON from the verified prefix when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();

    const result = await captureCli(["visualize", path]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
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

  it("queries the verified prefix when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();

    const result = await captureCli(["query", path]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.query.v1",
      count: 1,
      events: [
        {
          id: "evt_cli_recover_1",
          type: "goal.created",
        },
      ],
    });
  });

  it("prints mailbox JSON from the verified prefix when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();

    const result = await captureCli(["mailbox", "planner", path, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.mailbox.v1",
      actorId: "planner",
      count: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      items: [
        {
          event: {
            id: "evt_cli_recover_1",
            type: "goal.created",
            actorId: "user",
          },
        },
      ],
    });
  });

  it("prints mailbox text from the verified prefix when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();

    const result = await captureCli(["mailbox", "planner", path]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("mailbox: planner");
    expect(result.stdout).toContain("evt_cli_recover_1 goal.created from=user");
  });

  it("prints structured JSON diagnostics for JSON-oriented option errors", async () => {
    const result = await captureCli(["query", "events.jsonl", "--type"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "Missing value for --type",
        path: "events.jsonl",
        option: "--type",
        suggestedAction: "Check the command arguments and run eventloom help for usage.",
      },
    });
  });

  it("prints structured query limit diagnostics with the rejected option value", async () => {
    const result = await captureCli(["query", "events.jsonl", "--limit", "0"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "--limit must be a positive integer",
        path: "events.jsonl",
        option: "--limit",
        value: "0",
        suggestedAction: "Use a positive integer event count for query limits.",
      },
    });
  });

  it("does not treat the next CLI option as a missing option value", async () => {
    const cases: Array<{ args: string[]; message: string; path?: string; option: string; value?: string }> = [
      {
        args: ["append", "events.jsonl", "goal.created", "--actor", "--payload", "{}"],
        message: "Missing value for --actor",
        path: "events.jsonl",
        option: "--actor",
        value: "--payload",
      },
      {
        args: ["query", "events.jsonl", "--type", "--limit", "10"],
        message: "Missing value for --type",
        path: "events.jsonl",
        option: "--type",
        value: "--limit",
      },
      {
        args: ["recover", "events.jsonl", "--out", "--quarantine-tail", "tail.jsonl"],
        message: "Missing value for --out",
        path: "events.jsonl",
        option: "--out",
        value: "--quarantine-tail",
      },
      {
        args: ["visualize", "events.jsonl", "--html", "--title", "Run"],
        message: "Missing value for --html",
        path: "events.jsonl",
        option: "--html",
        value: "--title",
      },
      {
        args: ["artifacts", "events.jsonl", "--out", "--title", "Run"],
        message: "Missing value for --out",
        path: "events.jsonl",
        option: "--out",
        value: "--title",
      },
      {
        args: ["export", "pathlight", "events.jsonl", "--base-url", "--trace-name", "Run"],
        message: "Missing value for --base-url",
        path: "events.jsonl",
        option: "--base-url",
        value: "--trace-name",
      },
      {
        args: ["export", "halo", "events.jsonl", "--project-id", "--service-name", "eventloom"],
        message: "Missing value for --project-id",
        path: "events.jsonl",
        option: "--project-id",
        value: "--service-name",
      },
      {
        args: ["export", "otlp", "events.jsonl", "--service-version", "--trace-name", "Run"],
        message: "Missing value for --service-version",
        path: "events.jsonl",
        option: "--service-version",
        value: "--trace-name",
      },
    ];

    for (const testCase of cases) {
      const result = await captureCli(testCase.args);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "invalid_cli_option",
          message: testCase.message,
          path: testCase.path,
          option: testCase.option,
          value: testCase.value,
        },
      });
    }
  });

  it("reports rejected options for non-JSON command parser errors", async () => {
    const cases: Array<{ args: string[]; message: string; path?: string; option: string }> = [
      {
        args: ["append", "events.jsonl", "goal.created", "--bad", "value"],
        message: "Unknown append option --bad",
        path: "events.jsonl",
        option: "--bad",
      },
      {
        args: ["recover", "events.jsonl", "--bad", "value"],
        message: "Unknown recover option --bad",
        path: "events.jsonl",
        option: "--bad",
      },
      {
        args: ["visualize", "events.jsonl", "--bad", "value"],
        message: "Unknown visualize option --bad",
        path: "events.jsonl",
        option: "--bad",
      },
      {
        args: ["artifacts", "events.jsonl"],
        message: "Missing required --out for artifacts",
        path: "events.jsonl",
        option: "--out",
      },
    ];

    for (const testCase of cases) {
      const result = await captureCli(testCase.args);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "invalid_cli_option",
          message: testCase.message,
          path: testCase.path,
          option: testCase.option,
        },
      });
    }
  });

  it("rejects extra arguments for fixed-shape CLI commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-extra-args-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_extra_args");

    const cases: Array<{ args: string[]; message: string; option: string; value?: string; path?: string }> = [
      {
        args: ["verify", path, "extra"],
        message: "Unknown verify argument extra",
        option: "argument",
        value: "extra",
        path,
      },
      {
        args: ["stats", path, "--bad"],
        message: "Unknown stats option --bad",
        option: "--bad",
        path,
      },
      {
        args: ["diff", path, path, "extra"],
        message: "Unknown diff argument extra",
        option: "argument",
        value: "extra",
        path,
      },
      {
        args: ["templates", "coding-task", "extra"],
        message: "Unknown templates argument extra",
        option: "argument",
        value: "extra",
        path: "coding-task",
      },
    ];

    for (const testCase of cases) {
      const result = await captureCli(testCase.args);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      const expectedError: Record<string, unknown> = {
        code: "invalid_cli_option",
        message: testCase.message,
        path: testCase.path,
        option: testCase.option,
      };
      if (testCase.value !== undefined) expectedError.value = testCase.value;
      expect(JSON.parse(result.stderr)).toMatchObject({ error: expectedError });
    }
  });

  it("reports unknown templates with a structured option diagnostic", async () => {
    const result = await captureCli(["templates", "missing-template"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "Unknown template missing-template",
        path: "missing-template",
        option: "templateId",
        value: "missing-template",
        suggestedAction: "Run eventloom templates to list available workflow templates.",
      },
    });
  });

  it("reports invalid top-level invocations as structured diagnostics", async () => {
    const cases: Array<{ args: string[]; message: string; option: string; value?: string }> = [
      {
        args: [],
        message: "Missing command",
        option: "command",
      },
      {
        args: ["replay"],
        message: "Missing required arguments for replay",
        option: "argument",
      },
      {
        args: ["append", "events.jsonl"],
        message: "Missing required arguments for append",
        option: "argument",
      },
      {
        args: ["unknown"],
        message: "Unknown command unknown",
        option: "command",
        value: "unknown",
      },
    ];

    for (const testCase of cases) {
      const result = await captureCli(testCase.args);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      const expectedError: Record<string, unknown> = {
        code: "invalid_cli_option",
        message: testCase.message,
        option: testCase.option,
        suggestedAction: "Run eventloom help for usage.",
      };
      if (testCase.value !== undefined) expectedError.value = testCase.value;
      expect(JSON.parse(result.stderr)).toMatchObject({ error: expectedError });
    }
  });

  it("prints usage successfully for documented help commands", async () => {
    for (const args of [["help"], ["--help"]]) {
      const result = await captureCli(args);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: eventloom");
      expect(result.stderr).toBe("");
      expect(() => JSON.parse(result.stderr)).toThrow();
    }
  });

  it("prints structured append diagnostics when duplicate event ids are rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-duplicate-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_duplicate");

    const result = await captureCli([
      "append",
      path,
      "goal.created",
      "--actor",
      "user",
      "--payload",
      "{\"title\":\"duplicate\"}",
      "--id",
      "evt_duplicate",
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "duplicate_event_id",
        path,
        eventId: "evt_duplicate",
        line: 2,
        suggestedAction: "Use a unique event id or recover the log before appending.",
      },
    });
  });

  it("prints structured append diagnostics when the event envelope is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-invalid-envelope-"));
    const path = join(dir, "events.jsonl");

    const result = await captureCli([
      "append",
      path,
      "goal",
      "--actor",
      "user",
      "--payload",
      "{\"title\":\"invalid\"}",
      "--id",
      "bad-id",
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_event_envelope",
        path,
        eventId: "bad-id",
        validationIssues: expect.arrayContaining([
          expect.objectContaining({ path: "id" }),
          expect.objectContaining({ path: "type" }),
        ]),
        suggestedAction: "Correct the event envelope fields and retry the append.",
      },
    });
  });

  it("prints stable append diagnostics when the payload JSON is malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-bad-payload-"));
    const path = join(dir, "events.jsonl");

    const result = await captureCli([
      "append",
      path,
      "goal.created",
      "--payload",
      "{bad-json",
    ]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_json_payload",
        message: "Payload must be valid JSON",
        path,
        suggestedAction: "Pass --payload as a valid JSON object string.",
      },
    });
  });

  it("prints structured append diagnostics when the event log lock times out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-lock-timeout-"));
    const path = join(dir, "events.jsonl");
    await writeFile(`${path}.lock`, "held", "utf8");

    try {
      const result = await captureCli([
        "append",
        path,
        "goal.created",
        "--actor",
        "user",
        "--payload",
        "{\"title\":\"locked\"}",
      ], {
        EVENTLOOM_LOCK_TIMEOUT_MS: "20",
        EVENTLOOM_LOCK_RETRY_MS: "1",
      });

      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "event_store_lock_timeout",
          path,
          suggestedAction: "Wait for the active writer to finish, then retry the command.",
        },
      });
    } finally {
      await unlink(`${path}.lock`).catch(() => undefined);
    }
  });

  it("accepts zero-valued lock timing environment settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-zero-lock-env-"));
    const path = join(dir, "events.jsonl");

    const result = await captureCli([
      "append",
      path,
      "goal.created",
      "--actor",
      "user",
      "--payload",
      "{\"title\":\"zero lock env\"}",
    ], {
      EVENTLOOM_LOCK_TIMEOUT_MS: "0",
      EVENTLOOM_LOCK_RETRY_MS: "0",
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hash: expect.stringMatching(/^sha256:/),
      previousHash: null,
    });
  });

  it("rejects invalid lock timing environment settings with structured diagnostics", async () => {
    const result = await captureCli([
      "append",
      "events.jsonl",
      "goal.created",
      "--payload",
      "{\"title\":\"invalid lock env\"}",
    ], {
      EVENTLOOM_LOCK_TIMEOUT_MS: "-1",
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "EVENTLOOM_LOCK_TIMEOUT_MS must be a non-negative integer",
        path: "events.jsonl",
        option: "EVENTLOOM_LOCK_TIMEOUT_MS",
        value: "-1",
        suggestedAction: "Use non-negative integer millisecond values for Eventloom CLI lock timing options.",
      },
    });
  });

  it("applies lock timeout environment settings to built-in runtime run commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-run-lock-timeout-"));
    const path = join(dir, "events.jsonl");
    await writeFile(`${path}.lock`, "held", "utf8");

    try {
      const result = await captureCli(["run", "software-work", path], {
        EVENTLOOM_LOCK_TIMEOUT_MS: "20",
        EVENTLOOM_LOCK_RETRY_MS: "1",
      });

      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "event_store_lock_timeout",
          path,
          suggestedAction: "Wait for the active writer to finish, then retry the command.",
        },
      });
    } finally {
      await unlink(`${path}.lock`).catch(() => undefined);
    }
  });

  it("reports the default run log path in structured lock diagnostics", async () => {
    const project = await mkdtemp(join(tmpdir(), "eventloom-cli-run-default-lock-"));
    const eventloomDir = join(project, ".eventloom");
    await mkdir(eventloomDir, { recursive: true });
    await writeFile(join(eventloomDir, "events.jsonl.lock"), "held", "utf8");

    try {
      const result = await captureCliFromCwd(["run", "software-work"], project, {
        EVENTLOOM_LOCK_TIMEOUT_MS: "20",
        EVENTLOOM_LOCK_RETRY_MS: "1",
      });

      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "event_store_lock_timeout",
          path: ".eventloom/events.jsonl",
          suggestedAction: "Wait for the active writer to finish, then retry the command.",
        },
      });
    } finally {
      await unlink(join(eventloomDir, "events.jsonl.lock")).catch(() => undefined);
    }
  });

  it("exports a static HTML visualizer artifact and creates output parents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-html-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "nested", "visualizer.html");
    await append(path, "evt_html_export");

    const result = await captureCli(["visualize", path, "--html", out, "--title", "Agent Session"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      out,
      eventCount: 1,
    });
    const html = await readFile(out, "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Agent Session</title>");
    expect(html).toContain("eventloom-visualizer-data");
    expect(html).toContain("evt_html_export");
  });

  it("writes an agent artifact bundle for CI upload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-artifacts-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "bundle");
    await append(path, "evt_artifact_bundle");

    const result = await captureCli(["artifacts", path, "--out", out, "--title", "CI Agent Run"]);

    expect(result.code).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status).toMatchObject({
      outDir: out,
      eventCount: 1,
      integrityOk: true,
      files: {
        verify: join(out, "verify.json"),
        stats: join(out, "stats.json"),
        queryJson: join(out, "query.json"),
        inspectJson: join(out, "inspect.json"),
        visualizerJson: join(out, "visualizer.json"),
        visualizerHtml: join(out, "visualizer.html"),
        handoff: join(out, "handoff.md"),
        haloJsonl: join(out, "halo.jsonl"),
        manifest: join(out, "manifest.json"),
      },
    });
    expect(await readFile(join(out, "visualizer.html"), "utf8")).toContain("CI Agent Run");
    expect(await readFile(join(out, "handoff.md"), "utf8")).toContain("handoff summary");
  });

  it("verifies an artifact bundle manifest from the CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-artifacts-verify-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "bundle");
    await append(path, "evt_artifact_bundle_verify");
    const bundle = JSON.parse((await captureCli(["artifacts", path, "--out", out])).stdout);

    const verified = await captureCli(["artifacts", "verify", bundle.files.manifest]);

    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      manifestPath: bundle.files.manifest,
      ok: true,
      checkedFiles: 10,
      issues: [],
    });
  });

  it("exits nonzero when CLI artifact bundle verification finds tampering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-artifacts-tampered-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "bundle");
    await append(path, "evt_artifact_bundle_tampered");
    const bundle = JSON.parse((await captureCli(["artifacts", path, "--out", out])).stdout);
    await writeFile(bundle.files.handoff, "tampered handoff\n", "utf8");

    const verified = await captureCli(["artifacts", "verify", bundle.files.manifest]);

    expect(verified.code).toBe(1);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      manifestPath: bundle.files.manifest,
      ok: false,
      checkedFiles: 10,
      issues: expect.arrayContaining([
        expect.objectContaining({
          file: "handoff",
          path: bundle.files.handoff,
          code: "byte_count_mismatch",
        }),
        expect.objectContaining({
          file: "handoff",
          path: bundle.files.handoff,
          code: "sha256_mismatch",
        }),
      ]),
    });
  });

  it("returns stable CLI artifact verification issues for malformed manifests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-artifacts-invalid-manifest-"));
    const manifest = join(dir, "manifest.json");
    await writeFile(manifest, '{"version":"eventloom.artifact-bundle.v1"}\n', "utf8");

    const verified = await captureCli(["artifacts", "verify", manifest]);

    expect(verified.code).toBe(1);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      manifestPath: manifest,
      ok: false,
      checkedFiles: 0,
      issues: [{
        file: "manifest",
        path: "",
        code: "invalid_manifest",
      }],
    });
  });

  it("returns stable CLI artifact verification issues for non-JSON manifests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-artifacts-non-json-manifest-"));
    const manifest = join(dir, "manifest.json");
    await writeFile(manifest, "{not-json\n", "utf8");

    const verified = await captureCli(["artifacts", "verify", manifest]);

    expect(verified.code).toBe(1);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      version: "eventloom.artifact-bundle-verification.v1",
      manifestPath: manifest,
      ok: false,
      checkedFiles: 0,
      issues: [{
        file: "manifest",
        path: manifest,
        code: "invalid_manifest",
        message: expect.stringContaining("not valid JSON"),
      }],
    });
    expect(verified.stderr).toBe("");
  });

  it("preserves corrupt-tail diagnostics across all derived artifact bundle files", async () => {
    const { path } = await corruptLog();
    const out = join(await mkdtemp(join(tmpdir(), "eventloom-cli-artifacts-corrupt-")), "bundle");

    const result = await captureCli(["artifacts", path, "--out", out, "--title", "Damaged Agent Run"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      eventCount: 1,
      integrityOk: false,
      validPrefixCount: 1,
      diagnostics: [{ code: "malformed_json", line: 2 }],
    });

    const visualizer = JSON.parse(await readFile(join(out, "visualizer.json"), "utf8"));
    const inspect = JSON.parse(await readFile(join(out, "inspect.json"), "utf8"));
    expect(inspect).toMatchObject({
      version: "eventloom.inspect.v1",
      integrity: {
        ok: false,
        validPrefixCount: 1,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
      stats: { eventCount: 1 },
      timeline: {
        eventCount: 1,
        integrity: {
          ok: false,
          validPrefixCount: 1,
          diagnostics: [{ code: "malformed_json", line: 2 }],
        },
      },
      handoff: {
        integrity: {
          ok: false,
          validPrefixCount: 1,
          diagnostics: [{ code: "malformed_json", line: 2 }],
        },
      },
    });
    expect(visualizer).toMatchObject({
      capture: { eventCount: 1 },
      replay: {
        integrity: {
          ok: false,
          validPrefixCount: 1,
          diagnostics: [{ code: "malformed_json", line: 2 }],
        },
      },
      handoff: {
        integrity: {
          ok: false,
          validPrefixCount: 1,
          diagnostics: [{ code: "malformed_json", line: 2 }],
        },
      },
    });

    const html = await readFile(join(out, "visualizer.html"), "utf8");
    expect(html).toContain("Damaged Agent Run");
    expect(html).toContain("malformed_json");

    expect(await readFile(join(out, "handoff.md"), "utf8")).toContain("integrity: failed");

    const [rootSpanLine] = (await readFile(join(out, "halo.jsonl"), "utf8")).trim().split("\n");
    const rootSpan = JSON.parse(rootSpanLine);
    expect(rootSpan.attributes).toMatchObject({
      "eventloom.integrity.ok": false,
      "eventloom.valid_prefix_count": 1,
    });
    expect(String(rootSpan.attributes?.["eventloom.integrity.diagnostics"])).toContain("malformed_json");
  });

  it("prints typed projection diagnostics when a built-in workflow resume log is invalid", async () => {
    const path = await invalidHumanOpsResumeLog();

    const result = await captureCli(["run", "human-ops", path, "--resume"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "runtime_projection_failed",
        message: expect.stringContaining("Effect missing_effect does not exist"),
        path,
        workflow: "human-ops",
        projectionKind: "effects",
        projectionErrors: [
          {
            code: "missing_dependency",
            eventId: "evt_cli_bad_effect_applied",
            type: "effect.applied",
          },
        ],
      },
    });
  });

  it("reports the default human-ops run log path in structured projection diagnostics", async () => {
    const project = await mkdtemp(join(tmpdir(), "eventloom-cli-run-default-projection-"));
    const path = join(project, ".eventloom", "human-ops-events.jsonl");
    await invalidHumanOpsResumeLogAt(path);

    const result = await captureCliFromCwd(["run", "human-ops", "--resume"], project);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "runtime_projection_failed",
        path: ".eventloom/human-ops-events.jsonl",
        workflow: "human-ops",
        projectionKind: "effects",
      },
    });
  });

  it("honors built-in run max iteration limits from the CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-run-max-iterations-"));
    const path = join(dir, "events.jsonl");

    const result = await captureCli(["run", "software-work", "--max-iterations", "1", path]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      path,
      iterations: 1,
      stoppedReason: "max_iterations",
    });
  });

  it("rejects invalid built-in run max iteration limits before mutating the log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-run-invalid-max-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, "preserve me\n", "utf8");

    const result = await captureCli(["run", "software-work", path, "--max-iterations", "0"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_runtime_option",
        message: "maxIterations must be a positive integer",
        path,
        option: "maxIterations",
        value: "0",
        suggestedAction: "Use positive integer values for Eventloom runtime loop limits.",
      },
    });
    expect(await readFile(path, "utf8")).toBe("preserve me\n");
  });

  it("prints structured Pathlight export diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-pathlight-error-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_pathlight_cli_error");

    const result = await captureCli(["export", "pathlight", path, "--base-url", "http://127.0.0.1:9"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "pathlight_request_failed",
        path,
        url: "http://127.0.0.1:9/v1/traces",
        suggestedAction: "Check the Pathlight collector URL and retry after the collector accepts requests.",
      },
    });
  });

  it("rejects invalid Pathlight base URLs before export", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-pathlight-url-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_pathlight_cli_url");

    for (const baseUrl of ["localhost:4100", "ftp://pathlight.test"]) {
      const result = await captureCli(["export", "pathlight", path, "--base-url", baseUrl]);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "invalid_cli_option",
          message: "--base-url must be an absolute HTTP(S) URL",
          path,
          option: "--base-url",
          value: baseUrl,
          suggestedAction: "Use an absolute http:// or https:// URL for the Pathlight collector.",
        },
      });
    }
  });

  it("exports the verified prefix to Pathlight when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();
    const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    let span = 0;
    const server = createServer(async (request, response) => {
      const body = await readRequestJson(request);
      requests.push({ method: request.method ?? "GET", url: request.url ?? "", body });
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/traces") {
        response.end(JSON.stringify({ id: "trace_cli_corrupt" }));
        return;
      }
      if (request.url === "/v1/spans") {
        span += 1;
        response.end(JSON.stringify({ id: `span_cli_corrupt_${span}` }));
        return;
      }
      response.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const { port } = server.address() as AddressInfo;
      const result = await captureCli(["export", "pathlight", path, "--base-url", `http://127.0.0.1:${port}`]);

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        version: "eventloom.export.pathlight.v1",
        traceId: "trace_cli_corrupt",
        exportedEventCount: 1,
        validPrefixCount: 1,
        integrity: {
          ok: false,
          diagnostics: [{ code: "malformed_json", line: 2 }],
        },
      });
      const traceCreate = requests.find((request) => request.method === "POST" && request.url === "/v1/traces");
      expect(traceCreate?.body).toMatchObject({
        input: { eventCount: 1 },
        metadata: {
          integrity: {
            ok: false,
            diagnostics: [{ code: "malformed_json", line: 2 }],
          },
        },
      });
      expect(JSON.stringify(requests)).not.toContain("{bad-json");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("exports the verified prefix to HALO and creates output parents when a log has a corrupted tail", async () => {
    const { path } = await corruptLog();
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-halo-corrupt-"));
    const out = join(dir, "nested", "halo.jsonl");

    const result = await captureCli(["export", "halo", path, "--out", out]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.export.halo.v1",
      out,
      exportedEventCount: 1,
      validPrefixCount: 1,
      integrity: {
        ok: false,
        diagnostics: [{ code: "malformed_json", line: 2 }],
      },
    });
    const rootSpan = JSON.parse((await readFile(out, "utf8")).trim().split("\n")[0] ?? "{}") as {
      status?: { code?: string };
      attributes?: Record<string, unknown>;
    };
    expect(rootSpan.status?.code).toBe("STATUS_CODE_ERROR");
    expect(rootSpan.attributes).toMatchObject({
      "eventloom.event_count": 1,
      "eventloom.valid_prefix_count": 1,
      "eventloom.integrity.ok": false,
    });
    expect(String(rootSpan.attributes?.["eventloom.integrity.diagnostics"])).toContain("malformed_json");
  });

  it("exports a workflow log to OTLP JSON and creates output parents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-otlp-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "nested", "otlp.json");
    await append(path, "evt_otlp_cli");

    const result = await captureCli(["export", "otlp", path, "--out", out, "--service-name", "eventloom-cli-test"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.export.otlp.v1",
      out,
      traceCount: 1,
      exportedEventCount: 1,
      validPrefixCount: 1,
      integrity: { ok: true },
    });

    const otlp = JSON.parse(await readFile(out, "utf8"));
    expect(otlp.resourceSpans[0].resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "eventloom-cli-test" },
    });
    expect(otlp.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
      name: "eventloom.log",
      status: { code: "STATUS_CODE_OK" },
    });
  });

  it("exports OTLP JSON and posts it to a collector endpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-otlp-push-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "otlp.json");
    await append(path, "evt_otlp_cli_push");
    const requests: Array<{ method?: string; url?: string; body: string }> = [];
    const server = createServer(async (request: IncomingMessage, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      await once(request, "end");
      requests.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString("utf8") });
      response.statusCode = 202;
      response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;

    try {
      const result = await captureCli(["export", "otlp", path, "--out", out, "--endpoint", endpoint]);

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        version: "eventloom.export.otlp.v1",
        out,
        endpoint,
        status: 202,
        traceCount: 1,
        exportedEventCount: 1,
        validPrefixCount: 1,
        integrity: { ok: true },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ method: "POST", url: "/v1/traces" });
      expect(JSON.parse(requests[0].body)).toMatchObject(JSON.parse(await readFile(out, "utf8")));
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("prints structured OTLP endpoint diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-otlp-error-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_otlp_cli_error");

    const result = await captureCli(["export", "otlp", path, "--endpoint", "file:///tmp/traces"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "otlp_invalid_endpoint",
        path,
        endpoint: "file:///tmp/traces",
        suggestedAction: "Check the OTLP HTTP traces endpoint and retry after the collector accepts JSON requests.",
      },
    });
  });

  it("prints structured HALO export diagnostics when provenance collection fails", async () => {
    const project = await mkdtemp(join(tmpdir(), "eventloom-cli-halo-error-"));
    const path = join(project, "events.jsonl");
    const out = join(project, "halo.jsonl");
    const packageJson = join(project, "package.json");
    await writeFile(packageJson, '{"name":"unreadable"}\n', "utf8");
    await chmod(packageJson, 0o000);
    await append(path, "evt_halo_cli_error");

    const result = await execFileAsync("npx", [
      "tsx",
      join(process.cwd(), "src/cli.ts"),
      "export",
      "halo",
      path,
      "--out",
      out,
    ], { cwd: project, env: cliTestEnv() }).then(
      (success) => ({ code: 0, stdout: success.stdout, stderr: success.stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: typeof error.code === "number" ? error.code : 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );

    try {
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "halo_provenance_failed",
          path,
          suggestedAction: "Provide explicit provenance or run the export from a package with readable metadata.",
        },
      });
    } finally {
      await chmod(packageJson, 0o600);
    }
  });

  it("preserves the canonical project-local agent journal and artifact bundle layout", async () => {
    const project = await mkdtemp(join(tmpdir(), "eventloom-project-artifacts-"));
    const eventloomDir = join(project, ".eventloom");
    const logPath = join(eventloomDir, "agent-work.jsonl");
    const out = join(eventloomDir, "artifacts");
    await append(logPath, "evt_project_artifact_bundle");

    const { stdout } = await execFileAsync("npx", [
      "tsx",
      join(process.cwd(), "src/cli.ts"),
      "artifacts",
      ".eventloom/agent-work.jsonl",
      "--out",
      ".eventloom/artifacts",
      "--title",
      "Project Agent Work",
    ], { cwd: project, env: cliTestEnv() });

    const status = JSON.parse(stdout);
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));

    expect(await readFile(logPath, "utf8")).toContain("evt_project_artifact_bundle");
    expect(status).toMatchObject({
      inputPath: ".eventloom/agent-work.jsonl",
      outDir: ".eventloom/artifacts",
      files: {
        manifest: join(".eventloom/artifacts", "manifest.json"),
      },
    });
    expect(manifest).toMatchObject({
      inputPath: ".eventloom/agent-work.jsonl",
      outDir: ".eventloom/artifacts",
      files: {
        verify: join(".eventloom/artifacts", "verify.json"),
        stats: join(".eventloom/artifacts", "stats.json"),
        queryJson: join(".eventloom/artifacts", "query.json"),
        inspectJson: join(".eventloom/artifacts", "inspect.json"),
        visualizerJson: join(".eventloom/artifacts", "visualizer.json"),
        visualizerHtml: join(".eventloom/artifacts", "visualizer.html"),
        handoff: join(".eventloom/artifacts", "handoff.md"),
        haloJsonl: join(".eventloom/artifacts", "halo.jsonl"),
        manifest: join(".eventloom/artifacts", "manifest.json"),
      },
    });
  });

  it("prints a structured timeline with --json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-timeline-json-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_timeline_json");

    const result = await captureCli(["timeline", path, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.timeline.v1",
      eventCount: 1,
      integrity: { ok: true },
      events: [
        {
          ordinal: 1,
          id: "evt_timeline_json",
          type: "goal.created",
          actorId: "user",
          parentEventId: null,
        },
      ],
    });
  });

  it("limits structured timeline output with --limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-timeline-limit-json-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_timeline_limit_1");
    await append(path, "evt_timeline_limit_2");
    await append(path, "evt_timeline_limit_3");

    const result = await captureCli(["timeline", path, "--limit", "2", "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.timeline.v1",
      eventCount: 2,
      integrity: { ok: true, eventCount: 3 },
      events: [
        { ordinal: 1, id: "evt_timeline_limit_2" },
        { ordinal: 2, id: "evt_timeline_limit_3" },
      ],
    });
  });

  it("limits text timeline output with --limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-timeline-limit-text-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_timeline_text_1");
    await append(path, "evt_timeline_text_2");
    await append(path, "evt_timeline_text_3");

    const result = await captureCli(["timeline", path, "--limit", "2"]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("evt_timeline_text_1");
    expect(result.stdout).toContain("evt_timeline_text_2");
    expect(result.stdout).toContain("evt_timeline_text_3");
  });

  it("prints structured timeline limit diagnostics with the rejected option value", async () => {
    const result = await captureCli(["timeline", "events.jsonl", "--limit", "0"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "--limit must be a positive integer",
        path: "events.jsonl",
        option: "--limit",
        value: "0",
        suggestedAction: "Use a positive integer event count for timeline limits.",
      },
    });
  });

  it("prints a structured task explanation with --json", async () => {
    const { path } = await taskLog();

    const result = await captureCli(["explain", "task", "task_cli_json", path, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.task-explanation.v1",
      found: true,
      taskId: "task_cli_json",
      task: {
        id: "task_cli_json",
        status: "claimed",
        lastEventId: "evt_cli_json_claimed",
      },
      history: [
        { id: "evt_cli_json_proposed", type: "task.proposed", actorId: "planner" },
        { id: "evt_cli_json_claimed", type: "task.claimed", actorId: "worker" },
      ],
      causalChain: [
        { id: "evt_cli_json_proposed", type: "task.proposed", actorId: "planner" },
        { id: "evt_cli_json_claimed", type: "task.claimed", actorId: "worker" },
      ],
    });
  });

  it("prints a structured actor mailbox with --json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-mailbox-json-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_mailbox_json");

    const result = await captureCli(["mailbox", "planner", path, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.mailbox.v1",
      workflow: "software-work",
      actorId: "planner",
      count: 1,
      items: [
        {
          event: {
            id: "evt_mailbox_json",
            type: "goal.created",
            actorId: "user",
          },
        },
      ],
    });
  });

  it("prints a structured handoff summary with --json", async () => {
    const { path } = await taskLog();

    const result = await captureCli(["handoff", path, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: "eventloom.handoff.v1",
      eventCount: 2,
      integrity: { ok: true },
      eventTypes: {
        "task.proposed": 1,
        "task.claimed": 1,
      },
      tasks: {
        active: [{ id: "task_cli_json", status: "claimed" }],
        completed: [],
      },
    });
  });

  it("rejects unknown JSON command flags with structured diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-json-flag-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_json_flag");

    const result = await captureCli(["timeline", path, "--yaml"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "Unknown timeline option --yaml",
        path,
        option: "--yaml",
      },
    });
  });

  it("reports the event log path for nested command option diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-nested-json-flag-"));
    const path = join(dir, "events.jsonl");
    await append(path, "evt_nested_json_flag");

    const explain = await captureCli(["explain", "task", "task_cli_json", path, "--yaml"]);
    const mailbox = await captureCli(["mailbox", "planner", path, "--yaml"]);

    expect(explain.code).toBe(1);
    expect(JSON.parse(explain.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "Unknown explain option --yaml",
        path,
        option: "--yaml",
      },
    });
    expect(mailbox.code).toBe(1);
    expect(JSON.parse(mailbox.stderr)).toMatchObject({
      error: {
        code: "invalid_cli_option",
        message: "Unknown mailbox option --yaml",
        path,
        option: "--yaml",
      },
    });
  });
});

async function append(path: string, id: string) {
  await new JsonlEventStore(path).append(createEvent({
    id,
    type: "goal.created",
    actorId: "user",
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { title: id },
  }));
}

async function taskLog() {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-task-json-"));
  const path = join(dir, "events.jsonl");
  const store = new JsonlEventStore(path);
  const first = await store.append(createEvent({
    id: "evt_cli_json_proposed",
    type: "task.proposed",
    actorId: "planner",
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { taskId: "task_cli_json", title: "Structured CLI output" },
  }));
  await store.append(createEvent({
    id: "evt_cli_json_claimed",
    type: "task.claimed",
    actorId: "worker",
    threadId: "thread_main",
    parentEventId: first.id,
    causedBy: [first.id],
    timestamp: "2026-04-28T22:01:00.000Z",
    payload: { taskId: "task_cli_json" },
  }));
  return { path };
}

async function captureCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return captureCliFromCwd(args, process.cwd(), env);
}

async function captureCliFromCwd(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("npx", ["tsx", join(process.cwd(), "src/cli.ts"), ...args], {
      cwd,
      env: cliTestEnv(env),
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function cliTestEnv(env: Record<string, string> = {}): NodeJS.ProcessEnv {
  const sanitized = { ...process.env, ...env };
  delete sanitized.npm_config_json;
  return sanitized;
}

async function corruptLog() {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-reliability-"));
  const path = join(dir, "events.jsonl");
  const store = new JsonlEventStore(path);
  const first = await store.append(createEvent({
    id: "evt_cli_recover_1",
    type: "goal.created",
    actorId: "user",
    threadId: "thread_main",
    parentEventId: null,
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { title: "CLI recovery" },
  }));
  await writeFile(path, `${JSON.stringify(first)}\n{bad-json\n`, "utf8");
  return { path, first };
}

async function invalidHumanOpsResumeLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eventloom-cli-projection-error-"));
  const path = join(dir, "events.jsonl");
  await invalidHumanOpsResumeLogAt(path);
  return path;
}

async function invalidHumanOpsResumeLogAt(path: string): Promise<void> {
  await new JsonlEventStore(path).append(createEvent({
    id: "evt_cli_bad_effect_applied",
    type: "effect.applied",
    actorId: "applier",
    threadId: "thread_ops",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { effectId: "missing_effect" },
  }));
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
