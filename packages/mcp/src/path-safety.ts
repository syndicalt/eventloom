import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface ServerConfig {
  root: string;
  eventStore?: {
    lockTimeoutMs?: number;
    lockRetryMs?: number;
  };
}

export class PathSafetyError extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

/**
 * Stable startup/configuration diagnostic for invalid MCP server options.
 */
export class ServerConfigOptionsError extends Error {
  readonly code = "invalid_mcp_server_option";

  constructor(
    readonly option: string,
    readonly value: unknown,
    readonly suggestedAction = "Use non-negative integer millisecond values for MCP lock timing options.",
  ) {
    super(`${option} must be a non-negative integer`);
    this.name = "ServerConfigOptionsError";
  }
}

export function createServerConfig(input: {
  root?: string | null;
  eventStore?: ServerConfig["eventStore"];
} = {}): ServerConfig {
  return {
    root: resolve(input.root ?? process.env.EVENTLOOM_MCP_ROOT ?? process.cwd()),
    eventStore: input.eventStore ?? eventStoreOptionsFromEnv(),
  };
}

function eventStoreOptionsFromEnv(): ServerConfig["eventStore"] {
  return {
    lockTimeoutMs: parseNonNegativeIntegerEnv("EVENTLOOM_LOCK_TIMEOUT_MS"),
    lockRetryMs: parseNonNegativeIntegerEnv("EVENTLOOM_LOCK_RETRY_MS"),
  };
}

function parseNonNegativeIntegerEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ServerConfigOptionsError(name, value);
  }
  return parsed;
}

export function resolveLogPath(config: ServerConfig, logPath: string): string {
  const root = resolve(config.root);
  const absolutePath = isAbsolute(logPath) ? resolve(logPath) : resolve(root, logPath);

  assertInsideRoot(root, absolutePath, logPath);

  const rootRealPath = realpathIfExists(root);
  const nearestExistingPath = nearestExistingAncestor(absolutePath);

  if (isInsideRoot(root, nearestExistingPath)) {
    const nearestExistingRealPath = realpathIfExists(nearestExistingPath);
    assertInsideRoot(rootRealPath, nearestExistingRealPath, logPath);
  }

  return absolutePath;
}

function nearestExistingAncestor(path: string): string {
  let current = path;

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }

  return current;
}

function realpathIfExists(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

function assertInsideRoot(root: string, candidate: string, logPath: string): void {
  if (isInsideRoot(root, candidate)) return;

  throw new PathSafetyError(logPath, `Log path is outside the configured Eventloom root: ${logPath}`);
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return true;
  }

  return false;
}
