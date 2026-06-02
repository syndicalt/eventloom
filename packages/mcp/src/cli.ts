#!/usr/bin/env node
import { runStdioServer, ServerCliOptionsError } from "./server.js";
import { ServerConfigOptionsError } from "./path-safety.js";

runStdioServer().catch((error: unknown) => {
  console.error(JSON.stringify(formatMcpCliError(error), null, 2));
  process.exitCode = 1;
});

function formatMcpCliError(error: unknown): Record<string, unknown> {
  if (error instanceof ServerConfigOptionsError || error instanceof ServerCliOptionsError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        option: error.option,
        value: error.value,
        suggestedAction: error.suggestedAction,
      },
    };
  }

  return {
    error: {
      code: "mcp_server_start_failed",
      message: error instanceof Error ? error.message : String(error),
      suggestedAction: "Inspect the MCP server startup failure, dependency versions, and local runtime package installation.",
    },
  };
}
