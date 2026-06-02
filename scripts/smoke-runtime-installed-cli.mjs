import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(new URL("..", import.meta.url).pathname);
const tempRoot = mkdtempSync(join(tmpdir(), "eventloom-runtime-installed-cli-"));
const execFileAsync = promisify(execFile);

try {
  const packOutput = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot], {
    cwd: root,
    encoding: "utf8",
  });
  const packed = JSON.parse(packOutput);
  const runtimeTarball = join(tempRoot, packed[0].filename);
  const logPath = join(tempRoot, "software-work.jsonl");
  const artifactsDir = join(tempRoot, "artifacts");
  const otlpPath = join(tempRoot, "otlp-traces.json");
  const humanOpsLogPath = join(tempRoot, "human-ops.jsonl");
  const collector = await createOtlpCollector();

  try {
    writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    execFileSync("npm", ["install", "--no-save", runtimeTarball], { cwd: tempRoot, stdio: "inherit" });

    const run = runEventloom(["run", "software-work", logPath]);
    if (run.stoppedReason !== "idle" || run.appended !== 5 || run.processed !== 5) {
      throw new Error(`Unexpected installed CLI run result: ${JSON.stringify(run)}`);
    }

    const replay = runEventloom(["replay", logPath]);
    if (replay.eventCount < 1 || replay.integrity?.ok !== true) {
      throw new Error(`Unexpected installed CLI replay result: ${JSON.stringify(replay)}`);
    }

    const stats = runEventloom(["stats", logPath]);
    if (stats.eventCount !== replay.eventCount || stats.integrity?.ok !== true) {
      throw new Error(`Unexpected installed CLI stats result: ${JSON.stringify(stats)}`);
    }

    const artifacts = runEventloom(["artifacts", logPath, "--out", artifactsDir, "--title", "Installed CLI Smoke"]);
    if (
      artifacts.outDir !== artifactsDir ||
      artifacts.files?.manifest !== join(artifactsDir, "manifest.json") ||
      artifacts.files?.otlpJson !== join(artifactsDir, "otlp-traces.json") ||
      artifacts.files?.inspectJson !== join(artifactsDir, "inspect.json") ||
      artifacts.files?.queryJson !== join(artifactsDir, "query.json") ||
      artifacts.inputDigest?.path !== logPath ||
      artifacts.integrityOk !== true ||
      artifacts.validPrefixCount < 1 ||
      !existsSync(artifacts.files.manifest) ||
      !existsSync(artifacts.files.visualizerHtml) ||
      !existsSync(artifacts.files.queryJson) ||
      !existsSync(artifacts.files.inspectJson) ||
      !existsSync(artifacts.files.otlpJson)
    ) {
      throw new Error(`Unexpected installed CLI artifact result: ${JSON.stringify(artifacts)}`);
    }
	    const artifactOtlp = JSON.parse(readFileSync(artifacts.files.otlpJson, "utf8"));
	    if (!Array.isArray(artifactOtlp.resourceSpans) || artifactOtlp.resourceSpans.length < 1) {
	      throw new Error("Installed CLI artifact bundle did not write OTLP resource spans");
	    }
	    const artifactVerification = runEventloom(["artifacts", "verify", artifacts.files.manifest]);
	    if (
	      artifactVerification.version !== "eventloom.artifact-bundle-verification.v1" ||
	      artifactVerification.ok !== true ||
	      artifactVerification.manifestPath !== artifacts.files.manifest ||
	      artifactVerification.checkedFiles !== 10 ||
	      artifactVerification.issues?.length !== 0
	    ) {
	      throw new Error(`Unexpected installed CLI artifact verification result: ${JSON.stringify(artifactVerification)}`);
	    }

	    const otlp = await runEventloomAsync([
      "export",
      "otlp",
      logPath,
      "--out",
      otlpPath,
      "--endpoint",
      collector.endpoint,
      "--service-name",
      "eventloom-installed-cli-smoke",
    ]);
    if (
      otlp.out !== otlpPath ||
      otlp.endpoint !== collector.endpoint ||
      otlp.status !== 202 ||
      otlp.integrity?.ok !== true ||
      otlp.spanCount < 1 ||
      !existsSync(otlpPath)
    ) {
      throw new Error(`Unexpected installed CLI OTLP export result: ${JSON.stringify(otlp)}`);
    }
    const otlpPayload = JSON.parse(readFileSync(otlpPath, "utf8"));
    if (!Array.isArray(otlpPayload.resourceSpans) || otlpPayload.resourceSpans.length < 1) {
      throw new Error("Installed CLI OTLP export did not write resource spans");
    }
    await waitForCollectorRequests(collector, 1);
    if (collector.requests.length !== 1) {
      throw new Error(`Installed CLI OTLP export sent ${collector.requests.length} collector requests`);
    }
    if (collector.requests[0].method !== "POST" || collector.requests[0].url !== "/v1/traces") {
      throw new Error(`Installed CLI OTLP export used unexpected collector request: ${JSON.stringify(collector.requests[0])}`);
    }
    if (JSON.stringify(JSON.parse(collector.requests[0].body)) !== JSON.stringify(otlpPayload)) {
      throw new Error("Installed CLI OTLP collector did not receive the exported payload");
    }

    const humanOpsRun = runEventloom(["run", "human-ops", humanOpsLogPath]);
    if (humanOpsRun.stoppedReason !== "idle" || humanOpsRun.appended !== 2 || humanOpsRun.processed !== 2) {
      throw new Error(`Unexpected installed CLI human-ops run result: ${JSON.stringify(humanOpsRun)}`);
    }

    const approval = runEventloom([
      "append",
      humanOpsLogPath,
      "approval.granted",
      "--actor",
      "human",
      "--thread",
      "thread_ops",
      "--payload",
      JSON.stringify({
        effectId: "effect_runtime_mitigation",
        approvalId: "approval_runtime_mitigation",
        reason: "Installed CLI smoke approval",
      }),
    ]);
    if (!String(approval.hash ?? "").startsWith("sha256:")) {
      throw new Error(`Unexpected installed CLI approval append result: ${JSON.stringify(approval)}`);
    }

    const resumedHumanOps = runEventloom(["run", "human-ops", humanOpsLogPath, "--resume"]);
    if (resumedHumanOps.appended !== 1 || resumedHumanOps.processed !== 1 || resumedHumanOps.rejected !== 0) {
      throw new Error(`Unexpected installed CLI human-ops resume result: ${JSON.stringify(resumedHumanOps)}`);
    }

    const humanOpsReplay = runEventloom(["replay", humanOpsLogPath]);
    if (
      humanOpsReplay.eventCount !== 29 ||
      humanOpsReplay.integrity?.ok !== true ||
      humanOpsReplay.projection?.effects?.effects?.effect_runtime_mitigation?.status !== "applied"
    ) {
      throw new Error(`Unexpected installed CLI human-ops replay result: ${JSON.stringify(humanOpsReplay)}`);
    }

    console.log(`Runtime installed CLI smoke passed with ${basename(runtimeTarball)}`);
  } finally {
    await collector.close();
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function runEventloom(args) {
  return JSON.parse(execFileSync("npx", ["--no-install", "eventloom", ...args], {
    cwd: tempRoot,
    encoding: "utf8",
  }));
}

async function runEventloomAsync(args) {
  const result = await execFileAsync("npx", ["--no-install", "eventloom", ...args], {
    cwd: tempRoot,
    encoding: "utf8",
  });
  return JSON.parse(result.stdout);
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

async function waitForCollectorRequests(collector, expected) {
  const deadline = Date.now() + 2000;
  while (collector.requests.length < expected && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}
