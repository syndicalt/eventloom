import { mkdir, readFile, stat, appendFile, open, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { validateEvent, type EventEnvelope } from "./events.js";
import { sealEvent, verifyEventChain, type IntegrityReport, type SealedEvent } from "./integrity.js";

export class EventStoreReadError extends Error {
  constructor(path: string, line: number, cause: unknown) {
    super(`Failed to parse event log ${path} at line ${line}`);
    this.name = "EventStoreReadError";
    this.cause = cause;
  }
}

export class EventStoreLockError extends Error {
  constructor(path: string) {
    super(`Timed out waiting for event log lock ${path}.lock`);
    this.name = "EventStoreLockError";
  }
}

export class JsonlEventStore {
  constructor(private readonly path: string) {}

  async append(event: EventEnvelope): Promise<SealedEvent> {
    const validated = validateEvent(event);
    await mkdir(dirname(this.path), { recursive: true });
    return withEventLogLock(this.path, async () => {
      const existing = await this.readAll();
      const previousHash = existing.at(-1)?.integrity?.hash ?? null;
      const sealed = sealEvent(validated, previousHash);
      await appendFile(this.path, JSON.stringify(sealed) + "\n", "utf8");
      return sealed;
    });
  }

  async readAll(): Promise<EventEnvelope[]> {
    if (!(await exists(this.path))) return [];

    const text = await readFile(this.path, "utf8");
    const lines = text.split("\n").filter((line) => line.trim().length > 0);

    return lines.map((line, index) => {
      try {
        return validateEvent(JSON.parse(line));
      } catch (error) {
        throw new EventStoreReadError(this.path, index + 1, error);
      }
    });
  }

  async verify(): Promise<IntegrityReport> {
    return verifyEventChain(await this.readAll());
  }
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

async function withEventLogLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const lock = await acquireLock(lockPath);
  try {
    return await run();
  } finally {
    await lock.close();
    await unlink(lockPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }
}

async function acquireLock(lockPath: string): Promise<FileHandle> {
  const timeoutMs = 5_000;
  const startedAt = Date.now();

  while (true) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (Date.now() - startedAt > timeoutMs) throw new EventStoreLockError(lockPath.replace(/\.lock$/, ""));
      await sleep(10);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
