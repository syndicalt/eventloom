import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createStderrCollector, createStdioSmokeFailure } from "./stdio-diagnostics.mjs";

const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const repoRoot = resolve(packageRoot, "../..");
const tempRoot = mkdtempSync(join(tmpdir(), "eventloom-mcp-v1-local-runtime-bin-"));
const stagedMcpRoot = join(tempRoot, "mcp");
const targetVersion = "1.0.0";

try {
  const runtimeTarball = pack(repoRoot);
  stageMcpPackage(runtimeTarball);
  execFileSync("npm", ["install"], { cwd: stagedMcpRoot, stdio: "inherit" });
  execFileSync("npm", ["test"], { cwd: stagedMcpRoot, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: stagedMcpRoot, stdio: "inherit" });
  const mcpTarball = pack(stagedMcpRoot);

  const consumerRoot = join(tempRoot, "consumer");
  const logRoot = join(tempRoot, "logs");
  writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ private: true }), "utf8");
  execFileSync("npm", ["init", "-y"], { cwd: tempRoot, stdio: "ignore" });
  mkdirSync(consumerRoot, { recursive: true });
  writeFileSync(join(consumerRoot, "package.json"), JSON.stringify({
    type: "module",
    dependencies: {
      "@eventloom/runtime": `file:${runtimeTarball}`,
      "@eventloom/mcp": `file:${mcpTarball}`,
    },
  }), "utf8");
  execFileSync("npm", ["install"], { cwd: consumerRoot, stdio: "inherit" });

  const client = new Client({ name: "eventloom-mcp-v1-local-runtime-bin-smoke", version: "0.1.0" });
  const binPath = join(consumerRoot, "node_modules", ".bin", process.platform === "win32" ? "eventloom-mcp.cmd" : "eventloom-mcp");
  const transport = new StdioClientTransport({
    command: binPath,
    args: ["--root", logRoot],
    cwd: consumerRoot,
    stderr: "pipe",
  });
  const stderr = createStderrCollector(transport.stderr);

  try {
    try {
      await client.connect(transport);
      const serverVersion = client.getServerVersion();
      if (serverVersion?.name !== "eventloom" || serverVersion.version !== targetVersion) {
        throw new Error(`Unexpected MCP server version: ${JSON.stringify(serverVersion)}`);
      }

      const listed = await client.listTools();
      const toolNames = new Set(listed.tools.map((tool) => tool.name));
	      for (const required of [
	        "eventloom_append",
	        "eventloom_replay",
	        "eventloom_stats",
	        "eventloom_query",
	        "eventloom_run_builtin",
	        "eventloom_write_artifacts",
	        "eventloom_verify_artifacts",
	        "eventloom_export_otlp",
	      ]) {
        if (!toolNames.has(required)) throw new Error(`Staged MCP v1 server did not expose ${required}`);
      }

      const appended = await client.callTool({
        name: "eventloom_append",
        arguments: {
          path: "staged-v1.jsonl",
          type: "task.proposed",
          actorId: "codex",
          threadId: "thread_main",
          payload: { taskId: "task_staged_mcp_v1", title: "Smoke staged MCP v1" },
        },
      });
      if (!String(appended.structuredContent?.hash ?? "").startsWith("sha256:")) {
        throw new Error(`Unexpected append response: ${JSON.stringify(appended.structuredContent)}`);
      }

      const stats = await client.callTool({
        name: "eventloom_stats",
        arguments: { path: "staged-v1.jsonl" },
      });
      if (stats.structuredContent?.eventCount !== 1 || stats.structuredContent?.integrity?.ok !== true) {
        throw new Error(`Unexpected stats response: ${JSON.stringify(stats.structuredContent)}`);
      }

      const query = await client.callTool({
        name: "eventloom_query",
        arguments: { path: "staged-v1.jsonl", type: "task.proposed", actorId: "codex" },
      });
      if (
        query.structuredContent?.count !== 1 ||
        query.structuredContent?.events?.[0]?.payload?.taskId !== "task_staged_mcp_v1" ||
        query.structuredContent?.integrity?.ok !== true
      ) {
        throw new Error(`Unexpected query response: ${JSON.stringify(query.structuredContent)}`);
      }

      const inspect = await client.callTool({
        name: "eventloom_inspect",
        arguments: { path: "staged-v1.jsonl" },
      });
      if (
        inspect.structuredContent?.version !== "eventloom.inspect.v1" ||
        inspect.structuredContent?.integrity?.ok !== true ||
        inspect.structuredContent?.stats?.eventCount !== 1 ||
        inspect.structuredContent?.timeline?.eventCount !== 1 ||
        inspect.structuredContent?.handoff?.eventCount !== 1
      ) {
        throw new Error(`Unexpected inspect response: ${JSON.stringify(inspect.structuredContent)}`);
      }

      const run = await client.callTool({
        name: "eventloom_run_builtin",
        arguments: {
          path: "staged-v1-workflow.jsonl",
          workflow: "software-work",
          resume: false,
        },
      });
      if (
        run.structuredContent?.stoppedReason !== "idle" ||
        typeof run.structuredContent?.appended !== "number" ||
        typeof run.structuredContent?.processed !== "number" ||
        run.structuredContent?.integrity?.ok !== true
      ) {
        throw new Error(`Unexpected run_builtin response: ${JSON.stringify(run.structuredContent)}`);
      }

      const artifacts = await client.callTool({
        name: "eventloom_write_artifacts",
        arguments: {
          path: "staged-v1-workflow.jsonl",
          out: "artifacts",
          title: "Staged MCP v1 Smoke",
        },
      });
      const artifactContent = artifacts.structuredContent;
      const artifactOtlp = artifactContent?.files?.otlpJson;
      if (
        artifactContent?.outDir !== join(logRoot, "artifacts") ||
        artifactContent?.inputDigest?.path !== join(logRoot, "staged-v1-workflow.jsonl") ||
        artifactContent?.integrityOk !== true ||
        artifactContent?.validPrefixCount < 1 ||
        artifactContent?.files?.inspectJson !== join(logRoot, "artifacts", "inspect.json") ||
        artifactContent?.files?.queryJson !== join(logRoot, "artifacts", "query.json") ||
        artifactOtlp !== join(logRoot, "artifacts", "otlp-traces.json") ||
        !existsSync(artifactContent.files.manifest) ||
        !existsSync(artifactContent.files.queryJson) ||
        !existsSync(artifactContent.files.inspectJson) ||
        !existsSync(artifactContent.files.visualizerHtml) ||
        !existsSync(artifactOtlp)
      ) {
        throw new Error(`Unexpected write_artifacts response: ${JSON.stringify(artifactContent)}`);
      }
      const artifactOtlpPayload = JSON.parse(readFileSync(artifactOtlp, "utf8"));
	      if (!Array.isArray(artifactOtlpPayload.resourceSpans) || artifactOtlpPayload.resourceSpans.length < 1) {
	        throw new Error("Staged MCP v1 artifact bundle did not write OTLP resource spans");
	      }
	      const artifactVerification = await client.callTool({
	        name: "eventloom_verify_artifacts",
	        arguments: { manifest: artifactContent.files.manifest },
	      });
	      if (
	        artifactVerification.structuredContent?.version !== "eventloom.artifact-bundle-verification.v1" ||
	        artifactVerification.structuredContent?.ok !== true ||
	        artifactVerification.structuredContent?.checkedFiles !== 10 ||
	        artifactVerification.structuredContent?.issues?.length !== 0
	      ) {
	        throw new Error(`Unexpected verify_artifacts response: ${JSON.stringify(artifactVerification.structuredContent)}`);
	      }

	      const collector = await createOtlpCollector();
      const otlp = await client.callTool({
        name: "eventloom_export_otlp",
        arguments: {
          path: "staged-v1-workflow.jsonl",
          out: "staged-v1-otlp.json",
          endpoint: collector.endpoint,
          serviceName: "eventloom-mcp-v1-local-runtime-bin-smoke",
        },
      });
      try {
        const otlpContent = otlp.structuredContent;
        if (
          otlpContent?.outputPath !== join(logRoot, "staged-v1-otlp.json") ||
          otlpContent?.endpoint !== collector.endpoint ||
          otlpContent?.status !== 202 ||
          otlpContent?.integrity?.ok !== true ||
          otlpContent?.spanCount < 1 ||
          !existsSync(otlpContent.outputPath)
        ) {
          throw new Error(`Unexpected export_otlp response: ${JSON.stringify(otlpContent)}`);
        }
        const otlpPayload = JSON.parse(readFileSync(otlpContent.outputPath, "utf8"));
        if (!Array.isArray(otlpPayload.resourceSpans) || otlpPayload.resourceSpans.length < 1) {
          throw new Error("Staged MCP v1 OTLP export did not write resource spans");
        }
        await waitForCollectorRequests(collector, 1);
        assertCollectorReceivedPayload(collector, otlpPayload, "Staged MCP v1");
      } finally {
        await collector.close();
      }
    } catch (error) {
      throw await createStdioSmokeFailure(error, stderr);
    }
  } finally {
    await client.close();
    await transport.close();
    stderr.destroy();
  }

  console.log(`MCP v1 local runtime bin smoke passed with ${basename(mcpTarball)} and ${basename(runtimeTarball)}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function stageMcpPackage(runtimeTarball) {
  mkdirSync(stagedMcpRoot, { recursive: true });
  for (const entry of ["package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "README.md", "src", "tests"]) {
    const from = join(packageRoot, entry);
    if (!existsSync(from)) continue;
    cpSync(from, join(stagedMcpRoot, entry), { recursive: true });
  }
  mkdirSync(join(stagedMcpRoot, "scripts"), { recursive: true });
  cpSync(
    join(packageRoot, "scripts", "stdio-diagnostics.mjs"),
    join(stagedMcpRoot, "scripts", "stdio-diagnostics.mjs"),
  );
  cpSync(
    join(repoRoot, "scripts", "chmod-cli-bins.mjs"),
    join(stagedMcpRoot, "scripts", "chmod-cli-bins.mjs"),
  );

  const packagePath = join(stagedMcpRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.version = targetVersion;
  packageJson.scripts.build = "node -e \"import('node:fs/promises').then(({ rm }) => rm('dist', { recursive: true, force: true }))\" && tsc && node scripts/chmod-cli-bins.mjs dist/cli.js";
  packageJson.dependencies["@eventloom/runtime"] = `file:${runtimeTarball}`;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const versionPath = join(stagedMcpRoot, "src", "version.ts");
  writeFileSync(versionPath, `export const EVENTLOOM_MCP_VERSION = "${targetVersion}";\n`, "utf8");
  useInstalledRuntimeForSmoke(join(stagedMcpRoot, "vitest.config.ts"));
}

function useInstalledRuntimeForSmoke(configPath) {
  const config = readFileSync(configPath, "utf8");
  if (!config.includes("@eventloom/runtime")) return;
  writeFileSync(configPath, `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
`, "utf8");
}

function pack(cwd) {
  const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot], {
    cwd,
    encoding: "utf8",
  });
  const parsed = JSON.parse(output);
  const manifest = Array.isArray(parsed) ? parsed[0] : parsed;
  return join(tempRoot, manifest.filename);
}

async function createOtlpCollector() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    await once(request, "end");
    requests.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.setHeader("connection", "close");
    response.statusCode = 202;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/v1/traces`,
    requests,
    async close() {
      server.closeAllConnections?.();
      server.close();
      await once(server, "close");
    },
  };
}

function assertCollectorReceivedPayload(collector, payload, label) {
  if (collector.requests.length !== 1) {
    throw new Error(`${label} OTLP export sent ${collector.requests.length} collector requests`);
  }
  const request = collector.requests[0];
  if (request.method !== "POST" || request.url !== "/v1/traces") {
    throw new Error(`${label} OTLP export used unexpected collector request: ${JSON.stringify(request)}`);
  }
  if (JSON.stringify(JSON.parse(request.body)) !== JSON.stringify(payload)) {
    throw new Error(`${label} OTLP collector did not receive the exported payload`);
  }
}

async function waitForCollectorRequests(collector, expected) {
  const deadline = Date.now() + 2000;
  while (collector.requests.length < expected && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}
