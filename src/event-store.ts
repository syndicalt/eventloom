import { createReadStream } from "node:fs";
import { link, mkdir, readFile, realpath, stat, open, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { EventValidationError, validateEvent, type EventEnvelope, type EventValidationIssue } from "./events.js";
import { hashEvent, sealEvent, stripIntegrity, type IntegrityError, type SealedEvent } from "./integrity.js";

export type EventLogDiagnosticCode =
  | IntegrityError["code"]
  | "malformed_json"
  | "partial_trailing_line"
  | "invalid_event";

/**
 * One structured integrity or parse diagnostic for a physical JSONL line.
 */
export interface EventLogDiagnostic {
  code: EventLogDiagnosticCode;
  eventId: string | null;
  line: number;
  expected?: string | null;
  actual?: string | null;
  validationCode?: EventValidationError["code"];
  validationIssues?: EventValidationIssue[];
  message: string;
}

/**
 * Streaming verification report for an Eventloom JSONL log.
 *
 * The valid prefix fields identify the replay-safe portion of a damaged log.
 */
export interface EventLogVerificationReport {
  version: "eventloom.verify.v1";
  ok: boolean;
  eventCount: number;
  validPrefixCount: number;
  lastGoodLine: number | null;
  lastGoodHash: string | null;
  diagnostics: EventLogDiagnostic[];
  errors: EventLogDiagnostic[];
}

/**
 * Result of writing a non-destructive verified-prefix recovery artifact.
 */
export interface EventLogRecoveryResult {
  outputPath: string;
  recoveredEventCount: number;
  lastGoodLine: number | null;
  lastGoodHash: string | null;
  diagnostics: EventLogDiagnostic[];
  quarantinedTailPath?: string;
  quarantinedLineCount?: number;
}

/**
 * Anchor used to verify that a cached projection still matches a log prefix.
 */
export interface EventLogTailAnchor {
  eventCount: number;
  lastGoodHash: string | null;
}

/**
 * Verified tail read after comparing a caller-provided prefix anchor.
 */
export interface EventLogTailSnapshot {
  report: EventLogVerificationReport;
  anchorMatched: boolean;
  tailEvents: EventEnvelope[];
}

/**
 * Result returned by appendValidated after locked projection-aware validation.
 */
export type AppendValidationResult =
  | { ok: true; event: SealedEvent }
  | { ok: false; reason: string; diagnostic?: unknown };

/**
 * Validator callback used by appendValidated against the locked verified log.
 */
export type AppendValidator = (
  events: readonly EventEnvelope[],
  event: EventEnvelope,
) => string | null | unknown | Promise<string | null | unknown>;

/**
 * Local JSONL store tuning options.
 *
 * These values affect lock acquisition timing only; they do not alter the
 * append-only log format, hash-chain integrity, or replay semantics.
 */
export interface JsonlEventStoreOptions {
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

/**
 * Options for non-destructive verified-prefix recovery.
 */
export interface EventLogRecoveryOptions {
  /**
   * Optional file path that receives rejected physical tail lines for later
   * inspection while the recovered output receives only the verified prefix.
   */
  quarantinePath?: string;
}

/**
 * Error thrown by strict `readAll()` parsing when a log line is not a valid event.
 */
export class EventStoreReadError extends Error {
  constructor(readonly path: string, readonly line: number, cause: unknown) {
    super(`Failed to parse event log ${path} at line ${line}`);
    this.name = "EventStoreReadError";
    this.cause = cause;
  }
}

/**
 * Error thrown when a local append/recovery lock cannot be acquired in time.
 */
export class EventStoreLockError extends Error {
  constructor(readonly path: string) {
    super(`Timed out waiting for event log lock ${path}.lock`);
    this.name = "EventStoreLockError";
  }
}

/**
 * Error thrown when store construction receives invalid local tuning options.
 */
export class EventStoreOptionsError extends Error {
  readonly code = "invalid_event_store_option";

  constructor(
    readonly option: keyof JsonlEventStoreOptions,
    readonly value: unknown,
    readonly suggestedAction = "Use non-negative integer millisecond values for Eventloom lock timing options.",
  ) {
    super(`${option} must be a non-negative integer`);
    this.name = "EventStoreOptionsError";
  }
}

/**
 * Error thrown when an append would violate log integrity or id uniqueness.
 */
export class EventStoreAppendError extends Error {
  constructor(readonly path: string, readonly report: EventLogVerificationReport) {
    super(`Refusing to append to corrupt event log ${path}`);
    this.name = "EventStoreAppendError";
  }
}

/**
 * Error thrown when a recovery target would be unsafe or destructive.
 */
export type EventStoreRecoveryErrorCode = "recovery_output_exists" | "recovery_path_collision";

/**
 * Error thrown when a verified-prefix recovery output or quarantine path is unsafe.
 */
export class EventStoreRecoveryError extends Error {
  constructor(
    readonly code: EventStoreRecoveryErrorCode,
    readonly path: string,
    message: string,
    readonly suggestedAction: string = recoverySuggestedAction(code),
  ) {
    super(message);
    this.name = "EventStoreRecoveryError";
  }
}

/**
 * Append-only local JSONL event store with SHA-256 hash-chain sealing.
 *
 * All write paths verify the existing log under the local append lock before
 * adding events. Integrity-aware read and recovery paths preserve full replay as
 * the source of truth and never silently mutate the canonical log.
 */
export class JsonlEventStore {
  private readonly options: JsonlEventStoreOptions;

  constructor(private readonly path: string, options: JsonlEventStoreOptions = {}) {
    this.options = validateStoreOptions(options);
  }

  async append(event: EventEnvelope): Promise<SealedEvent> {
    const validated = validateEvent(event);
    await mkdir(dirname(this.path), { recursive: true });
    return withEventLogLock(this.path, this.options, async () => {
      const scan = await this.scan();
      if (!scan.report.ok) throw new EventStoreAppendError(this.path, scan.report);
      if (scan.seenIds.has(validated.id)) {
        throw new EventStoreAppendError(this.path, duplicateEventIdReport(scan.report, validated.id, scan.appendStartLine));
      }
      const previousHash = scan.report.lastGoodHash;
      const sealed = sealEvent(validated, previousHash);
      await appendLineDurably(this.path, JSON.stringify(sealed), { needsLeadingNewline: scan.needsLeadingNewline });
      return sealed;
    });
  }

  /**
   * Append a contiguous batch with one lock, one existing-log scan, and one durable file sync.
   */
  async appendMany(events: readonly EventEnvelope[]): Promise<SealedEvent[]> {
    const validatedEvents = events.map((event) => validateEvent(event));
    if (validatedEvents.length === 0) return [];

    await mkdir(dirname(this.path), { recursive: true });
    return withEventLogLock(this.path, this.options, async () => {
      const scan = await this.scan();
      if (!scan.report.ok) throw new EventStoreAppendError(this.path, scan.report);

      const batchIds = new Set<string>();
      for (const [index, event] of validatedEvents.entries()) {
        const line = scan.appendStartLine + index;
        if (scan.seenIds.has(event.id) || batchIds.has(event.id)) {
          throw new EventStoreAppendError(this.path, duplicateEventIdReport(scan.report, event.id, line));
        }
        batchIds.add(event.id);
      }

      const sealedEvents: SealedEvent[] = [];
      let previousHash = scan.report.lastGoodHash;
      for (const event of validatedEvents) {
        const sealed = sealEvent(event, previousHash);
        sealedEvents.push(sealed);
        previousHash = sealed.integrity.hash;
      }

      await appendLinesDurably(this.path, sealedEvents.map((event) => JSON.stringify(event)), {
        needsLeadingNewline: scan.needsLeadingNewline,
      });
      return sealedEvents;
    });
  }

  /**
   * Validate and append one event against the same locked verified snapshot.
   */
  async appendValidated(event: EventEnvelope, validate: AppendValidator): Promise<AppendValidationResult> {
    const validated = validateEvent(event);
    await mkdir(dirname(this.path), { recursive: true });
    return withEventLogLock(this.path, this.options, async () => {
      const scan = await this.scan({ collectEvents: true });
      if (!scan.report.ok) throw new EventStoreAppendError(this.path, scan.report);
      if (scan.seenIds.has(validated.id)) {
        throw new EventStoreAppendError(this.path, duplicateEventIdReport(scan.report, validated.id, scan.appendStartLine));
      }

      const reason = await validate(scan.validEvents, validated);
      if (reason) {
        const result: AppendValidationResult = { ok: false, reason: validationReason(reason) };
        if (typeof reason !== "string") result.diagnostic = reason;
        return result;
      }

      const sealed = sealEvent(validated, scan.report.lastGoodHash);
      await appendLineDurably(this.path, JSON.stringify(sealed), { needsLeadingNewline: scan.needsLeadingNewline });
      return { ok: true, event: sealed };
    });
  }

  async readAll(): Promise<EventEnvelope[]> {
    if (!(await exists(this.path))) return [];

    const text = await readFile(this.path, "utf8");
    const lines = text.split("\n");
    const events: EventEnvelope[] = [];

    for (const [index, line] of lines.entries()) {
      if (line.trim().length === 0) continue;
      try {
        events.push(validateEvent(JSON.parse(line)));
      } catch (error) {
        throw new EventStoreReadError(this.path, index + 1, error);
      }
    }
    return events;
  }

  async verify(): Promise<EventLogVerificationReport> {
    return (await this.scan()).report;
  }

  async recoverVerifiedPrefix(outputPath: string, options: EventLogRecoveryOptions = {}): Promise<EventLogRecoveryResult> {
    await assertDistinctRecoveryPath(this.path, outputPath);
    if (options.quarantinePath) {
      await assertDistinctRecoveryPath(this.path, options.quarantinePath);
      await assertDistinctRecoveryPath(outputPath, options.quarantinePath);
    }

    return withEventLogLock(this.path, this.options, async () => {
      const scan = await this.scan({ collectLines: true, collectQuarantineLines: Boolean(options.quarantinePath) });
      await assertRecoveryOutputAvailable(outputPath);
      if (options.quarantinePath) await assertRecoveryOutputAvailable(options.quarantinePath);
      await writeFileExclusiveDurably(outputPath, scan.validLines.length > 0 ? `${scan.validLines.join("\n")}\n` : "");
      if (options.quarantinePath) {
        await writeFileExclusiveDurably(
          options.quarantinePath,
          formatQuarantinedLines(scan.quarantinedLines, scan.hasTerminalNewline),
        );
      }
      const result: EventLogRecoveryResult = {
        outputPath,
        recoveredEventCount: scan.report.validPrefixCount,
        lastGoodLine: scan.report.lastGoodLine,
        lastGoodHash: scan.report.lastGoodHash,
        diagnostics: scan.report.diagnostics,
      };
      if (options.quarantinePath) {
        result.quarantinedTailPath = options.quarantinePath;
        result.quarantinedLineCount = scan.quarantinedLines.length;
      }
      return result;
    });
  }

  async readVerifiedPrefix(): Promise<EventEnvelope[]> {
    return (await this.scan({ collectEvents: true })).validEvents;
  }

  async readVerifiedSnapshot(): Promise<EventLogScan> {
    return this.scan({ collectEvents: true });
  }

  async readVerifiedTail(anchor: EventLogTailAnchor): Promise<EventLogTailSnapshot> {
    const scan = await this.scan({ collectEventsAfter: anchor.eventCount, anchorEventCount: anchor.eventCount });
    return {
      report: scan.report,
      anchorMatched: scan.anchorHash === anchor.lastGoodHash && scan.report.validPrefixCount >= anchor.eventCount,
      tailEvents: scan.validEvents,
    };
  }

  private async scan(options: EventLogScanOptions = {}): Promise<EventLogScan> {
    if (!(await exists(this.path))) return emptyScan();

    const hasTerminalNewline = await fileHasTerminalNewline(this.path);
    const validEvents: EventEnvelope[] = [];
    const validLines: string[] = [];
    const quarantinedLines: string[] = [];
    const diagnostics: EventLogDiagnostic[] = [];
    const seenIds = new Set<string>();
    let prefixOpen = true;
    let lastGoodLine: number | null = null;
    let lastGoodHash: string | null = null;
    let anchorHash: string | null | undefined = options.anchorEventCount === 0 ? null : undefined;
    let validPrefixCount = 0;
    let lineNumber = 0;

    const reader = createInterface({
      input: createReadStream(this.path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of reader) {
      lineNumber += 1;
      if (!prefixOpen && options.collectQuarantineLines) quarantinedLines.push(line);
      if (line.trim().length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        if (prefixOpen && options.collectQuarantineLines) quarantinedLines.push(line);
        diagnostics.push({
          code: "malformed_json",
          eventId: null,
          line: lineNumber,
          message: error instanceof Error ? error.message : String(error),
        });
        prefixOpen = false;
        continue;
      }

      try {
        const event = validateEvent(parsed);
        const chainErrors = verifyEventInChain(event, { line: lineNumber, previousHash: lastGoodHash, seenIds });
        if (chainErrors.length > 0) {
          if (prefixOpen && options.collectQuarantineLines) quarantinedLines.push(line);
          diagnostics.push(...chainErrors);
          prefixOpen = false;
          continue;
        }

        if (!prefixOpen) {
          diagnostics.push({
            code: "invalid_event",
            eventId: event.id,
            line: lineNumber,
            message: "Event appears after a corrupted prefix boundary",
          });
          continue;
        }

        if (options.collectEvents || (
          options.collectEventsAfter !== undefined && validPrefixCount >= options.collectEventsAfter
        )) validEvents.push(event);
        if (options.collectLines) validLines.push(line);
        seenIds.add(event.id);
        lastGoodHash = event.integrity?.hash ?? null;
        validPrefixCount += 1;
        lastGoodLine = lineNumber;
        if (options.anchorEventCount === validPrefixCount) anchorHash = lastGoodHash;
      } catch (error) {
        if (prefixOpen && options.collectQuarantineLines) quarantinedLines.push(line);
        diagnostics.push({
          code: "invalid_event",
          eventId: eventIdFromUnknown(parsed),
          line: lineNumber,
          ...eventValidationDiagnostic(error),
          message: error instanceof Error ? error.message : String(error),
        });
        prefixOpen = false;
      }
    }

    const finalDiagnostics = classifyFinalPartialLine(diagnostics, lineNumber, hasTerminalNewline);
    const report = {
      version: "eventloom.verify.v1" as const,
      ok: finalDiagnostics.length === 0,
      eventCount: validPrefixCount,
      validPrefixCount,
      lastGoodLine,
      lastGoodHash,
      diagnostics: finalDiagnostics,
      errors: finalDiagnostics,
    };
    return {
      report,
      validEvents,
      validLines,
      quarantinedLines,
      seenIds,
      anchorHash,
      appendStartLine: lineNumber + 1,
      needsLeadingNewline: lineNumber > 0 && !hasTerminalNewline,
      hasTerminalNewline,
    };
  }
}

function validationReason(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (
    typeof reason === "object" &&
    reason !== null &&
    "message" in reason &&
    typeof (reason as { message?: unknown }).message === "string"
  ) return (reason as { message: string }).message;
  return String(reason);
}

function validateStoreOptions(options: JsonlEventStoreOptions): JsonlEventStoreOptions {
  validateOptionalNonNegativeIntegerOption("lockTimeoutMs", options.lockTimeoutMs);
  validateOptionalNonNegativeIntegerOption("lockRetryMs", options.lockRetryMs);
  return { ...options };
}

function validateOptionalNonNegativeIntegerOption(
  option: keyof JsonlEventStoreOptions,
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) throw new EventStoreOptionsError(option, value);
}

function eventValidationDiagnostic(error: unknown): Pick<EventLogDiagnostic, "validationCode" | "validationIssues"> {
  if (!(error instanceof EventValidationError)) return {};
  return {
    validationCode: error.code,
    validationIssues: error.issues,
  };
}

function duplicateEventIdReport(report: EventLogVerificationReport, eventId: string, line: number): EventLogVerificationReport {
  const diagnostic: EventLogDiagnostic = {
    code: "duplicate_event_id",
    eventId,
    line,
    message: `Duplicate event id ${eventId}`,
  };
  return {
    ...report,
    ok: false,
    diagnostics: [...report.diagnostics, diagnostic],
    errors: [...report.errors, diagnostic],
  };
}

async function appendLineDurably(path: string, line: string, options: AppendDurabilityOptions = {}): Promise<void> {
  await appendLinesDurably(path, [line], options);
}

async function appendLinesDurably(
  path: string,
  lines: readonly string[],
  options: AppendDurabilityOptions = {},
): Promise<void> {
  if (lines.length === 0) return;

  const fileExisted = await exists(path);
  const handle = await open(path, "a");
  try {
    if (options.needsLeadingNewline) await handle.writeFile("\n", "utf8");
    for (const line of lines) {
      await handle.writeFile(`${line}\n`, "utf8");
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (!fileExisted) await syncContainingDirectory(path);
}

async function writeFileExclusiveDurably(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (await exists(path)) throw recoveryOutputExists(path);

  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(tempPath, "wx");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await link(tempPath, path);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw recoveryOutputExists(path);
    }
    throw error;
  } finally {
    await unlink(tempPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }
  await syncContainingDirectory(path);
}

async function assertRecoveryOutputAvailable(path: string): Promise<void> {
  if (await exists(path)) throw recoveryOutputExists(path);
}

async function syncContainingDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dirname(path), "r");
    await handle.sync();
  } catch (error) {
    if (isUnsupportedDirectorySyncError(error)) return;
    throw error;
  } finally {
    await handle?.close();
  }
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  if (!isNodeError(error)) return false;
  if (error.code === "EINVAL" || error.code === "ENOTSUP" || error.code === "ENOSYS") return true;
  return process.platform === "win32" && (error.code === "EPERM" || error.code === "EACCES");
}

interface AppendDurabilityOptions {
  needsLeadingNewline?: boolean;
}

async function assertDistinctRecoveryPath(inputPath: string, outputPath: string): Promise<void> {
  const [inputIdentity, outputIdentity] = await Promise.all([
    pathIdentity(inputPath),
    pathIdentity(outputPath),
  ]);

  if (inputIdentity === outputIdentity) {
    throw recoveryPathCollision(outputPath);
  }
}

function recoveryOutputExists(path: string): EventStoreRecoveryError {
  return new EventStoreRecoveryError(
    "recovery_output_exists",
    path,
    `Recovery output path already exists: ${path}`,
  );
}

function recoveryPathCollision(path: string): EventStoreRecoveryError {
  return new EventStoreRecoveryError(
    "recovery_path_collision",
    path,
    "Recovery output path must be different from the input log path",
  );
}

function recoverySuggestedAction(code: EventStoreRecoveryErrorCode): string {
  if (code === "recovery_output_exists") {
    return "Choose a new recovery output path or remove the existing artifact deliberately.";
  }
  return "Choose distinct source, recovery output, and quarantine paths.";
}

async function pathIdentity(path: string): Promise<string> {
  if (await exists(path)) {
    const info = await stat(path);
    return `${info.dev}:${info.ino}`;
  }

  const parent = await realpath(dirname(path));
  return join(parent, basename(path));
}

async function fileHasTerminalNewline(path: string): Promise<boolean> {
  const info = await stat(path);
  if (info.size === 0) return true;

  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, info.size - 1);
    return buffer[0] === 10;
  } finally {
    await handle.close();
  }
}

/**
 * Verified scan snapshot used by stats, replay, and snapshot-tail reads.
 *
 * Most callers should prefer the narrower helpers unless they need both the
 * verification report and the collected verified events.
 */
export interface EventLogScan {
  report: EventLogVerificationReport;
  validEvents: EventEnvelope[];
  validLines: string[];
  quarantinedLines: string[];
  seenIds: Set<string>;
  anchorHash?: string | null;
  appendStartLine: number;
  needsLeadingNewline: boolean;
  hasTerminalNewline: boolean;
}

interface EventLogScanOptions {
  collectEvents?: boolean;
  collectEventsAfter?: number;
  collectLines?: boolean;
  anchorEventCount?: number;
  collectQuarantineLines?: boolean;
}

function emptyScan(): EventLogScan {
  return {
    report: {
      version: "eventloom.verify.v1",
      ok: true,
      eventCount: 0,
      validPrefixCount: 0,
      lastGoodLine: null,
      lastGoodHash: null,
      diagnostics: [],
      errors: [],
    },
    validEvents: [],
    validLines: [],
    quarantinedLines: [],
    seenIds: new Set(),
    anchorHash: undefined,
    appendStartLine: 1,
    needsLeadingNewline: false,
    hasTerminalNewline: true,
  };
}

function classifyFinalPartialLine(
  diagnostics: readonly EventLogDiagnostic[],
  lineNumber: number,
  hasTerminalNewline: boolean,
): EventLogDiagnostic[] {
  if (hasTerminalNewline || lineNumber === 0) return [...diagnostics];
  return diagnostics.map((diagnostic) => (
    diagnostic.code === "malformed_json" && diagnostic.line === lineNumber
      ? { ...diagnostic, code: "partial_trailing_line" }
      : diagnostic
  ));
}

function formatQuarantinedLines(lines: readonly string[], sourceHadTerminalNewline: boolean): string {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}${sourceHadTerminalNewline ? "\n" : ""}`;
}

function verifyEventInChain(
  event: EventEnvelope,
  context: { line: number; previousHash: string | null; seenIds: Set<string> },
): EventLogDiagnostic[] {
  const diagnostics: EventLogDiagnostic[] = [];
  if (context.seenIds.has(event.id)) {
    diagnostics.push({
      code: "duplicate_event_id",
      eventId: event.id,
      line: context.line,
      message: `Duplicate event id ${event.id}`,
    });
  }

  if (!event.integrity) {
    diagnostics.push({
      code: "missing_integrity",
      eventId: event.id,
      line: context.line,
      message: "Missing integrity metadata",
    });
    return diagnostics;
  }

  if (event.integrity.previousHash !== context.previousHash) {
    diagnostics.push({
      code: "previous_hash_mismatch",
      eventId: event.id,
      line: context.line,
      expected: context.previousHash,
      actual: event.integrity.previousHash,
      message: `Expected previous hash ${context.previousHash ?? "null"} but found ${event.integrity.previousHash ?? "null"}`,
    });
  }

  const expectedHash = hashEvent(stripIntegrity(event), event.integrity.previousHash);
  if (event.integrity.hash !== expectedHash) {
    diagnostics.push({
      code: "hash_mismatch",
      eventId: event.id,
      line: context.line,
      expected: expectedHash,
      actual: event.integrity.hash,
      message: "Event hash does not match event contents",
    });
  }

  return diagnostics;
}

function eventIdFromUnknown(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("id" in value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function withEventLogLock<T>(path: string, options: JsonlEventStoreOptions, run: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const lock = await acquireLock(lockPath, options);
  try {
    return await run();
  } finally {
    await lock.close();
    await unlink(lockPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }
}

async function acquireLock(lockPath: string, options: JsonlEventStoreOptions): Promise<FileHandle> {
  const timeoutMs = options.lockTimeoutMs ?? 5_000;
  const retryMs = options.lockRetryMs ?? 10;
  const startedAt = Date.now();

  while (true) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (Date.now() - startedAt > timeoutMs) throw new EventStoreLockError(lockPath.replace(/\.lock$/, ""));
      await sleep(retryMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
