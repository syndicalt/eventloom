import { mkdir, readFile, stat, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validateEvent, type EventEnvelope } from "./events.js";

export class EventStoreReadError extends Error {
  constructor(path: string, line: number, cause: unknown) {
    super(`Failed to parse event log ${path} at line ${line}`);
    this.name = "EventStoreReadError";
    this.cause = cause;
  }
}

export class JsonlEventStore {
  constructor(private readonly path: string) {}

  async append(event: EventEnvelope): Promise<void> {
    const validated = validateEvent(event);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(validated)}\n`, "utf8");
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
