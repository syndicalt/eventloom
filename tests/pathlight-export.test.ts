import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/event-store.js";
import { exportToPathlight } from "../src/export/pathlight.js";
import { runSoftwareWorkRuntime } from "../src/runners.js";

describe("Pathlight export", () => {
  it("maps Threadline actor turns to Pathlight traces and spans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "threadline-pathlight-"));
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
      traceName: "threadline-test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.traceId).toBe("trace_1");
    expect(result.spanCount).toBe(5);
    expect(calls.filter((call) => call.url === "http://pathlight.test/v1/traces")).toHaveLength(1);
    expect(calls.filter((call) => call.url === "http://pathlight.test/v1/spans")).toHaveLength(5);
    expect(calls.some((call) => call.url === "http://pathlight.test/v1/traces/trace_1")).toBe(true);

    const traceCreate = JSON.parse(String(calls[0].init.body));
    expect(traceCreate.name).toBe("threadline-test");
    expect(traceCreate.metadata.source).toBe("threadline");
    expect(traceCreate.metadata.integrity.ok).toBe(true);
    expect(typeof traceCreate.metadata.projectionHash).toBe("string");
  });
});

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
