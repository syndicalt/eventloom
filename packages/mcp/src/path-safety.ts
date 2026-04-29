import { isAbsolute, resolve } from "node:path";

export interface ServerConfig {
  root: string;
}

export function createServerConfig(input: { root?: string | null } = {}): ServerConfig {
  return {
    root: resolve(input.root ?? process.env.EVENTLOOM_MCP_ROOT ?? process.cwd()),
  };
}

export function resolveLogPath(config: ServerConfig, logPath: string): string {
  const root = resolve(config.root);
  const absolutePath = isAbsolute(logPath) ? resolve(logPath) : resolve(root, logPath);
  const relative = absolutePath.slice(root.length);

  if (absolutePath !== root && !relative.startsWith("/")) {
    throw new Error(`Log path is outside the configured Eventloom root: ${logPath}`);
  }

  return absolutePath;
}
