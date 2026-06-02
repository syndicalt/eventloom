import { describe, expect, it } from "vitest";
import { createEvent } from "../src/events.js";
import { exportToOtlp, formatOtlpJson, OtlpExportError, pushOtlpJson } from "../src/export/otlp.js";
import { sealEvent } from "../src/integrity.js";

describe("OTLP export", () => {
  it("maps Eventloom journals to OpenTelemetry resource spans", async () => {
    const result = await exportToOtlp(taskJournalEvents(), {
      serviceName: "eventloom-tests",
      serviceVersion: "1.0.0-test",
      traceName: "eventloom-otlp-test",
      provenance: {
        packageName: "@eventloom/runtime",
        packageVersion: "1.0.0-test",
        gitCommit: "abc123",
        gitBranch: "main",
        gitDirty: false,
      },
    });

    expect(result).toMatchObject({
      version: "eventloom.export.otlp.v1",
      traceCount: 1,
      exportedEventCount: 3,
      validPrefixCount: 3,
      integrity: { ok: true, errors: [] },
    });
    expect(result.spanCount).toBeGreaterThan(0);
    expect(result.resourceSpans).toHaveLength(1);

    const resourceSpan = result.resourceSpans[0];
    expect(resourceSpan.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "eventloom-tests" },
    });
    expect(resourceSpan.resource.attributes).toContainEqual({
      key: "service.version",
      value: { stringValue: "1.0.0-test" },
    });
    expect(resourceSpan.scopeSpans).toHaveLength(1);

    const spans = resourceSpan.scopeSpans[0].spans;
    expect(spans[0]).toMatchObject({
      name: "eventloom-otlp-test",
      kind: "SPAN_KIND_INTERNAL",
      parentSpanId: "",
      status: { code: "STATUS_CODE_OK" },
    });
    expect(spans[0].traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(spans[0].spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(spans[0].startTimeUnixNano).toMatch(/^\d+$/);
    expect(spans[0].attributes).toContainEqual({
      key: "eventloom.event_count",
      value: { intValue: "3" },
    });

    const formatted = JSON.parse(formatOtlpJson(result));
    expect(formatted.resourceSpans[0].scopeSpans[0].spans).toHaveLength(result.spanCount);
  });

  it("pushes OTLP JSON to an HTTP traces endpoint", async () => {
    const result = await exportToOtlp(taskJournalEvents(), { traceName: "eventloom-otlp-push" });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const delivery = await pushOtlpJson(result, {
      endpoint: "http://collector.test/v1/traces",
      headers: { authorization: "Bearer test-token" },
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response("", { status: 202 });
      }) as typeof fetch,
    });

    expect(delivery).toMatchObject({
      version: "eventloom.export.otlp-push.v1",
      endpoint: "http://collector.test/v1/traces",
      status: 202,
      traceCount: result.traceCount,
      spanCount: result.spanCount,
      exportedEventCount: result.exportedEventCount,
      validPrefixCount: result.validPrefixCount,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "http://collector.test/v1/traces",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
      },
    });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      resourceSpans: result.resourceSpans,
    });
  });

  it("throws typed OTLP delivery errors", async () => {
    const result = await exportToOtlp(taskJournalEvents());

    await expect(pushOtlpJson(result, { endpoint: "file:///tmp/traces" })).rejects.toMatchObject({
      code: "otlp_invalid_endpoint",
      endpoint: "file:///tmp/traces",
    });

    await expect(pushOtlpJson(result, {
      endpoint: "http://collector.test/v1/traces",
      fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch,
    })).rejects.toMatchObject({
      code: "otlp_response_failed",
      endpoint: "http://collector.test/v1/traces",
      status: 503,
    });

    await expect(pushOtlpJson(result, {
      endpoint: "http://collector.test/v1/traces",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as typeof fetch,
    })).rejects.toBeInstanceOf(OtlpExportError);
  });
});

function taskJournalEvents() {
  let previousHash: string | null = null;
  return [
    event("evt_goal", "goal.created", "user", { title: "Ship OTLP connector" }),
    event("evt_task", "task.proposed", "codex", { taskId: "task_otlp", title: "Build OTLP exporter" }),
    event("evt_done", "task.completed", "codex", { taskId: "task_otlp" }),
  ].map((item) => {
    const sealed = sealEvent(createEvent(item), previousHash);
    previousHash = sealed.integrity.hash;
    return sealed;
  });
}

function event(
  id: string,
  type: string,
  actorId: string,
  payload: Record<string, unknown>,
) {
  return {
    id,
    type,
    actorId,
    threadId: "thread_main",
    parentEventId: null,
    causedBy: [],
    timestamp: "2026-04-29T12:00:00.000Z",
    payload,
  };
}
