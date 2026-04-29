import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { exportToPathlight } from "../src/export/pathlight.js";
import { runSoftwareWorkRuntime } from "../src/runners.js";

describe("Pathlight export", () => {
  it("maps Eventloom actor turns to Pathlight traces and spans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloom-pathlight-"));
    const path = join(dir, "events.jsonl");
    await runSoftwareWorkRuntime(path);
    const events = await new JsonlEventStore(path).readAll();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let span = 0;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/traces")) return json({ id: "trace_1" });
      if (String(url).endsWith("/v1/spans")) return json({ id: `span_${span += 1}` });
      if (String(url).includes("/events")) return json({ id: "event_1" });
      return json({ ok: true });
    };

    const result = await exportToPathlight(events, {
      baseUrl: "http://pathlight.test",
      traceName: "eventloom-test",
      fetchImpl: fetchImpl as typeof fetch,
      provenance: {
        packageName: "eventloom",
        packageVersion: "0.1.0",
        gitCommit: "abc123",
        gitBranch: "main",
        gitDirty: true,
      },
    });

    expect(result.traceId).toBe("trace_1");
    expect(result.spanCount).toBe(5);
    expect(calls.filter((call) => call.url === "http://pathlight.test/v1/traces")).toHaveLength(1);
    expect(calls.filter((call) => call.url === "http://pathlight.test/v1/spans")).toHaveLength(5);
    expect(calls.some((call) => call.url === "http://pathlight.test/v1/traces/trace_1")).toBe(true);

    const traceCreate = JSON.parse(String(calls[0].init.body));
    expect(traceCreate.name).toBe("eventloom-test");
    expect(traceCreate.metadata.source).toBe("eventloom");
    expect(traceCreate.metadata.integrity.ok).toBe(true);
    expect(typeof traceCreate.metadata.projectionHash).toBe("string");
    expect(traceCreate.metadata.projectionKinds).toEqual(["tasks"]);
    expect(traceCreate.metadata.runtime).toEqual({ name: "eventloom", version: "0.1.0" });
    expect(traceCreate.gitCommit).toBe("abc123");
    expect(traceCreate.gitBranch).toBe("main");
    expect(traceCreate.gitDirty).toBe(true);

    const spanPatches = calls.filter((call) => (
      call.init.method === "PATCH" &&
      call.url.startsWith("http://pathlight.test/v1/spans/span_")
    ));
    expect(spanPatches).toHaveLength(5);
    for (const call of spanPatches) {
      const body = JSON.parse(String(call.init.body));
      expect(body.output.rejectedEvents).toBeUndefined();
      expect(body.output.rejectionEventIds).toBeUndefined();
    }
  });
});

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
