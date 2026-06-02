import { mkdtemp, open, realpath, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { EventStoreAppendError, EventStoreLockError, EventStoreOptionsError, EventStoreRecoveryError, JsonlEventStore, EventStoreReadError } from "../src/event-store.js";
import { createEvent } from "../src/events.js";
import { verifyEventChain } from "../src/integrity.js";

describe("JsonlEventStore", () => {
  it("appends and reloads validated events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));
    const event = createEvent({
      id: "evt_append_test",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: "2026-04-28T22:00:00.000Z",
      payload: { title: "Test append" },
    });

    const sealed = await store.append(event);

    expect(sealed.integrity.previousHash).toBeNull();
    await expect(store.readAll()).resolves.toEqual([sealed]);
  });

  it("appends multiple events under one contiguous hash chain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));
    const first = await store.append(goal("evt_batch_existing", "Existing"));
    const batch = [
      goal("evt_batch_1", "Batch 1"),
      goal("evt_batch_2", "Batch 2"),
      goal("evt_batch_3", "Batch 3"),
    ];

    const sealed = await store.appendMany(batch);

    expect(sealed).toHaveLength(3);
    expect(sealed[0].integrity.previousHash).toBe(first.integrity.hash);
    expect(sealed[1].integrity.previousHash).toBe(sealed[0].integrity.hash);
    expect(sealed[2].integrity.previousHash).toBe(sealed[1].integrity.hash);
    await expect(store.readAll()).resolves.toEqual([first, ...sealed]);
    expect(verifyEventChain(await store.readAll())).toEqual({ ok: true, errors: [] });
  });

  it("preserves JSONL framing when appending after a valid log without a terminal newline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_no_newline_1", "No terminal newline"));
    await writeFile(path, JSON.stringify(first), "utf8");

    const second = await store.append(goal("evt_no_newline_2", "Append after no newline"));

    await expect(store.readAll()).resolves.toEqual([first, second]);
    await expect(store.verify()).resolves.toMatchObject({
      version: "eventloom.verify.v1",
      ok: true,
      eventCount: 2,
    });
  });

  it("preserves JSONL framing when batch appending after a valid log without a terminal newline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_batch_no_newline_1", "No terminal newline"));
    await writeFile(path, JSON.stringify(first), "utf8");

    const batch = await store.appendMany([
      goal("evt_batch_no_newline_2", "Batch 2"),
      goal("evt_batch_no_newline_3", "Batch 3"),
    ]);

    await expect(store.readAll()).resolves.toEqual([first, ...batch]);
    await expect(store.verify()).resolves.toMatchObject({ ok: true, eventCount: 3 });
  });

  it("rejects duplicate ids within a batch without appending partial events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_batch_duplicate_existing", "Existing"));

    await expect(store.appendMany([
      goal("evt_batch_duplicate_new", "New"),
      goal("evt_batch_duplicate_new", "Duplicate"),
    ])).rejects.toMatchObject({
      name: "EventStoreAppendError",
      report: {
        ok: false,
        diagnostics: [
          {
            code: "duplicate_event_id",
            eventId: "evt_batch_duplicate_new",
            line: 3,
          },
        ],
      },
    });
    await expect(store.readAll()).resolves.toEqual([first]);
  });

  it("reports duplicate append diagnostics on the inserted physical line after a valid log without a terminal newline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_duplicate_no_newline", "Existing"));
    await writeFile(path, JSON.stringify(first), "utf8");

    await expect(store.append(goal("evt_duplicate_no_newline", "Duplicate"))).rejects.toMatchObject({
      report: {
        diagnostics: [
          {
            code: "duplicate_event_id",
            eventId: "evt_duplicate_no_newline",
            line: 2,
          },
        ],
      },
    });
  });

  it("rejects ids already present in the log before writing a batch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_batch_existing_duplicate", "Existing"));

    await expect(store.appendMany([
      goal("evt_batch_unique", "Unique"),
      goal("evt_batch_existing_duplicate", "Duplicate existing"),
    ])).rejects.toMatchObject({
      name: "EventStoreAppendError",
      report: {
        ok: false,
        diagnostics: [
          {
            code: "duplicate_event_id",
            eventId: "evt_batch_existing_duplicate",
            line: 3,
          },
        ],
      },
    });
    await expect(store.readAll()).resolves.toEqual([first]);
  });

  it("appendValidated rejects duplicate event ids before running validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_validated_duplicate", "Existing"));
    let validationCalls = 0;

    await expect(store.appendValidated(goal("evt_validated_duplicate", "Duplicate"), () => {
      validationCalls += 1;
      return null;
    })).rejects.toMatchObject({
      name: "EventStoreAppendError",
      report: {
        diagnostics: [
          {
            code: "duplicate_event_id",
            eventId: "evt_validated_duplicate",
            line: 2,
          },
        ],
      },
    });
    expect(validationCalls).toBe(0);
    await expect(store.readAll()).resolves.toEqual([first]);
  });

  it("appendValidated returns validation failures without appending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_validated_existing", "Existing"));

    const result = await store.appendValidated(goal("evt_validated_rejected", "Rejected"), (events, event) => {
      expect(events).toEqual([first]);
      expect(event.id).toBe("evt_validated_rejected");
      return "blocked by projection state";
    });

    expect(result).toEqual({ ok: false, reason: "blocked by projection state" });
    await expect(store.readAll()).resolves.toEqual([first]);
  });

  it("appendValidated refuses corrupt existing logs without appending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_validated_corrupt_existing", "Existing"));
    await writeFile(path, `${JSON.stringify({ ...first, payload: { title: "Tampered" } })}\n`, "utf8");

    await expect(store.appendValidated(goal("evt_validated_after_corrupt", "After corrupt"), () => null))
      .rejects.toThrow(EventStoreAppendError);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("reports duplicate batch ids at the physical append line after blank lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_batch_blank_line_1", "Existing"));
    await writeFile(path, `\n${JSON.stringify(first)}\n\n`, "utf8");

    await expect(store.appendMany([
      goal("evt_batch_blank_line_2", "New"),
      goal("evt_batch_blank_line_2", "Duplicate"),
    ])).rejects.toMatchObject({
      report: {
        diagnostics: [
          {
            code: "duplicate_event_id",
            eventId: "evt_batch_blank_line_2",
            line: 5,
          },
        ],
      },
    });
    await expect(store.readAll()).resolves.toEqual([first]);
  });

  it("preserves hash-chain integrity under concurrent appends", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const store = new JsonlEventStore(join(dir, "events.jsonl"));

    await Promise.all(Array.from({ length: 50 }, (_, index) => store.append(createEvent({
      id: `evt_concurrent_${index}`,
      type: "task.proposed",
      actorId: "codex",
      threadId: "thread_main",
      parentEventId: null,
      timestamp: `2026-04-28T22:00:${String(index).padStart(2, "0")}.000Z`,
      payload: { taskId: `task_concurrent_${index}`, title: `Concurrent append ${index}` },
    }))));

    const events = await store.readAll();
    expect(events).toHaveLength(50);
    expect(verifyEventChain(events)).toEqual({ ok: true, errors: [] });
  });

  it("times out with a typed lock error when another process holds the append lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-lock-"));
    const path = join(dir, "events.jsonl");
    const lock = await open(`${path}.lock`, "wx");
    const store = new JsonlEventStore(path, { lockTimeoutMs: 20, lockRetryMs: 1 });

    try {
      await expect(store.append(goal("evt_lock_timeout", "Blocked by held lock"))).rejects.toMatchObject({
        name: "EventStoreLockError",
        path,
      });
      await expect(store.append(goal("evt_lock_timeout", "Blocked by held lock"))).rejects.toBeInstanceOf(EventStoreLockError);
    } finally {
      await lock.close();
      await unlink(`${path}.lock`).catch(() => undefined);
    }
  });

  it("rejects invalid lock timing options at construction time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-options-"));
    const path = join(dir, "events.jsonl");

    expect(() => new JsonlEventStore(path, { lockTimeoutMs: -1 })).toThrow(EventStoreOptionsError);
    expect(() => new JsonlEventStore(path, { lockRetryMs: 1.5 })).toThrow(EventStoreOptionsError);
    expect(() => new JsonlEventStore(path, { lockTimeoutMs: -1 })).toThrow("lockTimeoutMs must be a non-negative integer");
    expect(() => new JsonlEventStore(path, { lockRetryMs: 1.5 })).toThrow("lockRetryMs must be a non-negative integer");
    expect(() => new JsonlEventStore(path, { lockTimeoutMs: 0, lockRetryMs: 0 })).not.toThrow();
  });

  it("returns an empty list for a missing log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const store = new JsonlEventStore(join(dir, "missing.jsonl"));

    await expect(store.readAll()).resolves.toEqual([]);
  });

  it("rejects malformed event log lines with line context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, "{\"id\":\"not-valid\"}\n", "utf8");

    const store = new JsonlEventStore(path);

    await expect(store.readAll()).rejects.toThrow(EventStoreReadError);
    await expect(store.readAll()).rejects.toThrow("line 1");
  });

  it("reports physical line numbers for strict read errors across blank lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, "\n{\"id\":\"not-valid\"}\n", "utf8");

    const store = new JsonlEventStore(path);

    await expect(store.readAll()).rejects.toMatchObject({
      name: "EventStoreReadError",
      line: 2,
    });
  });

  it("includes typed envelope validation details in read and verification diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, `${JSON.stringify({
      id: "bad",
      type: "goal",
      actorId: "",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      timestamp: "not-a-date",
      payload: {},
    })}\n`, "utf8");

    const store = new JsonlEventStore(path);

    await expect(store.readAll()).rejects.toMatchObject({
      name: "EventStoreReadError",
      line: 1,
      cause: {
        name: "EventValidationError",
        code: "invalid_event_envelope",
        eventId: "bad",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "id" }),
          expect.objectContaining({ path: "type" }),
          expect.objectContaining({ path: "actorId" }),
          expect.objectContaining({ path: "timestamp" }),
        ]),
      },
    });

    await expect(store.verify()).resolves.toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "invalid_event",
          eventId: "bad",
          line: 1,
          validationCode: "invalid_event_envelope",
          validationIssues: expect.arrayContaining([
            expect.objectContaining({ path: "id" }),
            expect.objectContaining({ path: "type" }),
            expect.objectContaining({ path: "actorId" }),
            expect.objectContaining({ path: "timestamp" }),
          ]),
        },
      ],
    });
  });

  it("reports unknown top-level envelope fields as validation diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, `${JSON.stringify({
      id: "evt_extra_envelope",
      type: "goal.created",
      actorId: "user",
      threadId: "thread_main",
      parentEventId: null,
      causedBy: [],
      timestamp: "2026-04-29T12:00:00.000Z",
      payload: { title: "Extra envelope", schemaVersion: 1 },
      schemaVersion: 1,
    })}\n`, "utf8");

    const store = new JsonlEventStore(path);

    await expect(store.verify()).resolves.toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "invalid_event",
          eventId: "evt_extra_envelope",
          validationCode: "invalid_event_envelope",
          validationIssues: expect.arrayContaining([
            expect.objectContaining({
              code: "unrecognized_keys",
              path: "<root>",
              message: expect.stringContaining("schemaVersion"),
            }),
          ]),
        },
      ],
    });
  });

  it("streams diagnostics for malformed lines and reports the recoverable prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_prefix_1", "Recoverable prefix"));
    await writeFile(path, `${JSON.stringify(first)}\n{"not valid json"\n`, "utf8");

    const report = await store.verify();

    expect(report).toMatchObject({
      ok: false,
      eventCount: 1,
      validPrefixCount: 1,
      lastGoodLine: 1,
      lastGoodHash: first.integrity.hash,
      diagnostics: [
        {
          code: "malformed_json",
          line: 2,
          eventId: null,
        },
      ],
    });
  });

  it("refuses to append onto a tampered existing log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_tampered_1", "Original"));
    await writeFile(path, `${JSON.stringify({ ...first, payload: { title: "Tampered" } })}\n`, "utf8");

    await expect(store.append(goal("evt_tampered_2", "Should fail"))).rejects.toThrow(EventStoreAppendError);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("rejects duplicate event ids before appending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(goal("evt_duplicate", "Original"));

    await expect(store.append(goal("evt_duplicate", "Duplicate"))).rejects.toMatchObject({
      name: "EventStoreAppendError",
      report: {
        ok: false,
        diagnostics: [
          {
            code: "duplicate_event_id",
            eventId: "evt_duplicate",
            line: 2,
          },
        ],
      },
    });
    expect(await store.readAll()).toHaveLength(1);
  });

  it("recovers only the verified prefix to a separate output path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "events.recovered.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_recover_1", "First"));
    await writeFile(path, `${JSON.stringify(first)}\nnot-json\n`, "utf8");

    const result = await store.recoverVerifiedPrefix(out);

    expect(result).toMatchObject({
      outputPath: out,
      recoveredEventCount: 1,
      lastGoodHash: first.integrity.hash,
    });
    await expect(new JsonlEventStore(out).verify()).resolves.toMatchObject({ ok: true, eventCount: 1 });
    expect((await readFile(out, "utf8")).trim()).toBe(JSON.stringify(first));
  });

  it("quarantines the rejected tail during prefix recovery without mutating the source log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "events.recovered.jsonl");
    const quarantine = join(dir, "events.bad-tail.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_quarantine_1", "First"));
    const damagedLog = `${JSON.stringify(first)}\n{"id":"evt_quarantine_2"\n\n{"id":"evt_quarantine_3"}\n`;
    await writeFile(path, damagedLog, "utf8");

    const result = await store.recoverVerifiedPrefix(out, { quarantinePath: quarantine });

    expect(result).toMatchObject({
      outputPath: out,
      recoveredEventCount: 1,
      quarantinedTailPath: quarantine,
      quarantinedLineCount: 3,
    });
    expect(await readFile(path, "utf8")).toBe(damagedLog);
    expect((await readFile(out, "utf8")).trim()).toBe(JSON.stringify(first));
    expect(await readFile(quarantine, "utf8")).toBe("{\"id\":\"evt_quarantine_2\"\n\n{\"id\":\"evt_quarantine_3\"}\n");
  });

  it("creates an empty quarantine artifact when requested for a fully verified log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "events.recovered.jsonl");
    const quarantine = join(dir, "events.bad-tail.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_empty_quarantine_1", "Clean quarantine"));

    const result = await store.recoverVerifiedPrefix(out, { quarantinePath: quarantine });

    expect(result).toMatchObject({
      outputPath: out,
      recoveredEventCount: 1,
      quarantinedTailPath: quarantine,
      quarantinedLineCount: 0,
    });
    expect((await readFile(out, "utf8")).trim()).toBe(JSON.stringify(first));
    expect(await readFile(quarantine, "utf8")).toBe("");
  });

  it("refuses recovery when the quarantine artifact already exists even without a bad tail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "events.recovered.jsonl");
    const quarantine = join(dir, "events.bad-tail.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(goal("evt_existing_quarantine_1", "Existing quarantine"));
    await writeFile(quarantine, "do not overwrite\n", "utf8");

    await expect(store.recoverVerifiedPrefix(out, { quarantinePath: quarantine })).rejects.toMatchObject({
      name: "EventStoreRecoveryError",
      code: "recovery_output_exists",
      path: quarantine,
      suggestedAction: "Choose a new recovery output path or remove the existing artifact deliberately.",
    });
    await expect(readFile(out, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(quarantine, "utf8")).toBe("do not overwrite\n");
  });

  it("refuses recovery when output resolves to the same source path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(goal("evt_same_path_1", "Same path"));

    const outputPath = join(await realpath(dir), "events.jsonl");
    await expect(store.recoverVerifiedPrefix(outputPath)).rejects.toThrow(EventStoreRecoveryError);
    await expect(store.recoverVerifiedPrefix(outputPath)).rejects.toMatchObject({
      name: "EventStoreRecoveryError",
      code: "recovery_path_collision",
      path: outputPath,
      suggestedAction: "Choose distinct source, recovery output, and quarantine paths.",
    });
  });

  it("refuses recovery when the output path already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "events.recovered.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(goal("evt_existing_recovery_1", "Existing recovery"));
    await writeFile(out, "do not overwrite\n", "utf8");

    await expect(store.recoverVerifiedPrefix(out)).rejects.toThrow(EventStoreRecoveryError);
    await expect(store.recoverVerifiedPrefix(out)).rejects.toMatchObject({
      name: "EventStoreRecoveryError",
      code: "recovery_output_exists",
      path: out,
      suggestedAction: "Choose a new recovery output path or remove the existing artifact deliberately.",
    });
    expect(await readFile(out, "utf8")).toBe("do not overwrite\n");
  });

  it("refuses recovery when output is a symlink to the source log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const link = join(dir, "linked.jsonl");
    const store = new JsonlEventStore(path);
    await store.append(goal("evt_symlink_path_1", "Symlink path"));
    await symlink(path, link);

    await expect(store.recoverVerifiedPrefix(link)).rejects.toThrow(EventStoreRecoveryError);
    await expect(store.recoverVerifiedPrefix(link)).rejects.toMatchObject({
      name: "EventStoreRecoveryError",
      code: "recovery_path_collision",
      path: link,
    });
  });

  it("times out with a typed lock error when recovering while another process holds the append lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-recovery-lock-"));
    const path = join(dir, "events.jsonl");
    const out = join(dir, "events.recovered.jsonl");
    const lock = await open(`${path}.lock`, "wx");
    const store = new JsonlEventStore(path, { lockTimeoutMs: 20, lockRetryMs: 1 });

    try {
      await expect(store.recoverVerifiedPrefix(out)).rejects.toMatchObject({
        name: "EventStoreLockError",
        path,
      });
    } finally {
      await lock.close();
      await unlink(`${path}.lock`).catch(() => undefined);
    }
  });

  it("reports physical last-good line across blank lines and CRLF endings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_crlf_1", "CRLF"));
    await writeFile(path, `\r\n${JSON.stringify(first)}\r\n{bad-json\r\n`, "utf8");

    await expect(store.verify()).resolves.toMatchObject({
      ok: false,
      eventCount: 1,
      validPrefixCount: 1,
      lastGoodLine: 2,
      diagnostics: [{ code: "malformed_json", line: 3 }],
    });
  });

  it("reports a partial trailing line separately from malformed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_partial_1", "Partial tail"));
    await writeFile(path, `${JSON.stringify(first)}\n{"id":"evt_partial_2"`, "utf8");

    await expect(store.verify()).resolves.toMatchObject({
      ok: false,
      eventCount: 1,
      validPrefixCount: 1,
      diagnostics: [{ code: "partial_trailing_line", line: 2 }],
    });
  });

  it("classifies only the final unterminated malformed line as a partial trailing line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-store-"));
    const path = join(dir, "events.jsonl");
    const store = new JsonlEventStore(path);
    const first = await store.append(goal("evt_partial_classification_1", "Partial classification"));
    await writeFile(path, `${JSON.stringify(first)}\n{bad-json\n{"id":"evt_partial_classification_2"`, "utf8");

    await expect(store.verify()).resolves.toMatchObject({
      ok: false,
      eventCount: 1,
      validPrefixCount: 1,
      diagnostics: [
        { code: "malformed_json", line: 2 },
        { code: "partial_trailing_line", line: 3 },
      ],
    });
  });
});

function goal(id: string, title: string) {
  return createEvent({
    id,
    type: "goal.created",
    actorId: "user",
    threadId: "thread_main",
    parentEventId: null,
    timestamp: "2026-04-28T22:00:00.000Z",
    payload: { title },
  });
}
