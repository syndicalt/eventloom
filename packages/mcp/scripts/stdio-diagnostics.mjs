export function createStderrCollector(stderr) {
  const chunks = [];
  if (!stderr) {
    return {
      text: () => "",
      destroy: () => undefined,
    };
  }

  const onData = (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  };
  stderr.on("data", onData);

  return {
    text: () => Buffer.concat(chunks).toString("utf8").trim(),
    destroy: () => {
      stderr.off("data", onData);
      stderr.destroy();
    },
  };
}

export async function readAvailableStderr(stderr) {
  if (!stderr) return "";

  const chunks = [];
  for await (const chunk of stderr) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function createStdioSmokeFailure(error, stderr) {
  const stderrText = typeof stderr?.text === "function" ? stderr.text() : await readAvailableStderr(stderr);
  const message = error instanceof Error ? error.message : String(error);
  const enriched = new Error(stderrText ? `${message}\n\nMCP server stderr:\n${stderrText}` : message);
  enriched.cause = error;
  return enriched;
}
