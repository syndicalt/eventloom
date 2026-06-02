import { createHash } from "node:crypto";
import type { EventEnvelope } from "../events.js";
import type { EventLogVerificationReport } from "../event-store.js";
import type { IntegrityReport } from "../integrity.js";
import type { RuntimeProvenance } from "../provenance.js";
import { exportToHalo, type HaloExportOptions, type HaloSpanRecord } from "./halo.js";

/**
 * Options for projecting Eventloom events into a generic OpenTelemetry OTLP
 * traces JSON payload.
 */
export interface OtlpExportOptions {
  serviceName?: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  traceName?: string;
  provenance?: RuntimeProvenance;
  provenanceImpl?: () => Promise<RuntimeProvenance>;
  integrityReport?: IntegrityReport | EventLogVerificationReport;
}

/**
 * OTLP export result with Eventloom integrity metadata retained alongside the
 * generated resource spans.
 */
export interface OtlpExportResult {
  version: "eventloom.export.otlp.v1";
  traceCount: number;
  spanCount: number;
  exportedEventCount: number;
  validPrefixCount: number;
  integrity: IntegrityReport | EventLogVerificationReport;
  resourceSpans: OtlpResourceSpan[];
}

/**
 * Options for sending a generated OTLP traces JSON payload to an HTTP collector.
 */
export interface OtlpPushOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

/**
 * Result returned after an OTLP HTTP collector accepts the trace payload.
 */
export interface OtlpPushResult {
  version: "eventloom.export.otlp-push.v1";
  endpoint: string;
  status: number;
  traceCount: number;
  spanCount: number;
  exportedEventCount: number;
  validPrefixCount: number;
}

export type OtlpExportErrorCode =
  | "otlp_invalid_endpoint"
  | "otlp_request_failed"
  | "otlp_response_failed";

/**
 * Error thrown when an OTLP collector endpoint or request is not usable.
 */
export class OtlpExportError extends Error {
  readonly suggestedAction = "Check the OTLP HTTP traces endpoint and retry after the collector accepts JSON requests.";

  constructor(
    readonly code: OtlpExportErrorCode,
    message: string,
    readonly endpoint: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OtlpExportError";
  }
}

export interface OtlpResourceSpan {
  resource: {
    attributes: OtlpKeyValue[];
  };
  scopeSpans: OtlpScopeSpan[];
}

export interface OtlpScopeSpan {
  scope: {
    name: string;
    version: string;
  };
  spans: OtlpSpan[];
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: {
    code: string;
    message?: string;
  };
  attributes: OtlpKeyValue[];
}

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } };

/**
 * Project an Eventloom event sequence into generic OTLP trace JSON.
 *
 * This adapter intentionally reuses the existing Eventloom span projection so
 * HALO, Pathlight-adjacent, and vendor-neutral OpenTelemetry exports preserve
 * the same task, telemetry, integrity, and provenance semantics.
 */
export async function exportToOtlp(
  events: readonly EventEnvelope[],
  options: OtlpExportOptions = {},
): Promise<OtlpExportResult> {
  const halo = await exportToHalo(events, haloOptions(options));
  return {
    version: "eventloom.export.otlp.v1",
    traceCount: halo.traceCount,
    spanCount: halo.spanCount,
    exportedEventCount: halo.exportedEventCount,
    validPrefixCount: halo.validPrefixCount,
    integrity: halo.integrity,
    resourceSpans: buildResourceSpans(halo.spans),
  };
}

/**
 * Serialize an OTLP export result as a stable JSON payload suitable for file
 * upload or `curl` submission to an OTLP-compatible collector.
 */
export function formatOtlpJson(result: OtlpExportResult): string {
  return `${JSON.stringify({ resourceSpans: result.resourceSpans }, null, 2)}\n`;
}

/**
 * Send an OTLP export result to a generic OpenTelemetry HTTP traces endpoint.
 *
 * The caller controls when to preserve the JSON artifact. This function only
 * sends the already-generated payload and returns collector delivery metadata.
 */
export async function pushOtlpJson(
  result: OtlpExportResult,
  options: OtlpPushOptions,
): Promise<OtlpPushResult> {
  const endpoint = normalizeOtlpEndpoint(options.endpoint);
  const fetcher = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...options.headers,
      },
      body: formatOtlpJson(result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OtlpExportError("otlp_request_failed", `OTLP collector request failed: ${message}`, endpoint);
  }

  if (!response.ok) {
    throw new OtlpExportError(
      "otlp_response_failed",
      `OTLP collector returned HTTP ${response.status}`,
      endpoint,
      response.status,
    );
  }

  return {
    version: "eventloom.export.otlp-push.v1",
    endpoint,
    status: response.status,
    traceCount: result.traceCount,
    spanCount: result.spanCount,
    exportedEventCount: result.exportedEventCount,
    validPrefixCount: result.validPrefixCount,
  };
}

function normalizeOtlpEndpoint(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new OtlpExportError("otlp_invalid_endpoint", "OTLP endpoint must be an absolute HTTP(S) URL", endpoint);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OtlpExportError("otlp_invalid_endpoint", "OTLP endpoint must be an absolute HTTP(S) URL", endpoint);
  }
  return parsed.toString();
}

function haloOptions(options: OtlpExportOptions): HaloExportOptions {
  return {
    projectId: "eventloom-otlp",
    serviceName: options.serviceName,
    serviceVersion: options.serviceVersion,
    deploymentEnvironment: options.deploymentEnvironment,
    traceName: options.traceName,
    provenance: options.provenance,
    provenanceImpl: options.provenanceImpl,
    integrityReport: options.integrityReport,
  };
}

function buildResourceSpans(spans: readonly HaloSpanRecord[]): OtlpResourceSpan[] {
  if (spans.length === 0) return [];
  const [first] = spans;
  return [{
    resource: {
      attributes: attributesToKeyValues(first.resource.attributes),
    },
    scopeSpans: [{
      scope: first.scope,
      spans: toOtlpSpans(spans),
    }],
  }];
}

function toOtlpSpans(spans: readonly HaloSpanRecord[]): OtlpSpan[] {
  const spanIds = new Map(spans.map((span) => [span.span_id, otlpSpanId(span.span_id)]));
  return spans.map((span) => toOtlpSpan(span, spanIds));
}

function toOtlpSpan(span: HaloSpanRecord, spanIds: ReadonlyMap<string, string>): OtlpSpan {
  return {
    traceId: span.trace_id,
    spanId: spanIds.get(span.span_id) ?? otlpSpanId(span.span_id),
    parentSpanId: span.parent_span_id ? spanIds.get(span.parent_span_id) ?? otlpSpanId(span.parent_span_id) : "",
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: isoToUnixNano(span.start_time),
    endTimeUnixNano: isoToUnixNano(span.end_time),
    status: {
      code: span.status.code,
      ...(span.status.message ? { message: span.status.message } : {}),
    },
    attributes: attributesToKeyValues(span.attributes),
  };
}

function otlpSpanId(value: string): string {
  if (/^[a-f0-9]{16}$/.test(value)) return value;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function attributesToKeyValues(attributes: Record<string, unknown>): OtlpKeyValue[] {
  return Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value: toAnyValue(value) }));
}

function toAnyValue(value: unknown): OtlpAnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { intValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toAnyValue) } };
  if (value && typeof value === "object") {
    return { kvlistValue: { values: attributesToKeyValues(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

function isoToUnixNano(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,9})Z$/);
  if (!match) return String(BigInt(Date.parse(value)) * 1_000_000n);
  const millis = BigInt(Date.parse(`${match[1]}.000Z`));
  const nanos = BigInt(match[2].padEnd(9, "0"));
  return String(millis * 1_000_000n + nanos);
}
