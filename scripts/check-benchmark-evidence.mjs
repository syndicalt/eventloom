#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPORT_VERSION = "eventloom.benchmark-evidence.v1";
const DEFAULT_FULL_PATH = ".eventloom-ci/benchmark-full-node-20.json";
const DEFAULT_EXPORT_PATH = ".eventloom-ci/benchmark-export-node-20.json";
const requiredOperations = [
  "appendMany",
  "readAll",
  "verify",
  "replay",
  "visualize",
  "haloExport",
  "otlpExport",
  "pathlightExport",
];

const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");

class BenchmarkEvidenceOptionsError extends Error {
  code = "invalid_benchmark_evidence_option";

  constructor(message, option, value, suggestedAction = "Use --json, --full <path>, and --export <path> with benchmark evidence JSON reports.") {
    super(message);
    this.name = "BenchmarkEvidenceOptionsError";
    this.option = option;
    this.value = value;
    this.suggestedAction = suggestedAction;
  }
}

try {
  const args = parseArgs(argv);
  const full = await readBenchmarkReport("full", args.fullPath);
  const exportReport = await readBenchmarkReport("export", args.exportPath);
  const failures = [
    ...checkReport("full", full.report, "full"),
    ...checkReport("export", exportReport.report, "export"),
  ];
  const report = {
    version: REPORT_VERSION,
    ok: failures.length === 0,
    check: "benchmark-evidence",
    failureCount: failures.length,
    failures,
    reports: [
      reportSummary("full", full.path, full.report),
      reportSummary("export", exportReport.path, exportReport.report),
    ],
  };

  if (args.json) console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) {
    if (!args.json) {
      console.error("Benchmark evidence check failed.");
      for (const failure of failures) console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  const diagnostic = benchmarkEvidenceDiagnostic(error);
  if (wantsJson) {
    console.log(JSON.stringify({
      version: REPORT_VERSION,
      ok: false,
      check: "benchmark-evidence",
      failureCount: 0,
      failures: [],
      diagnostic,
    }, null, 2));
  } else {
    console.error(diagnostic.message);
  }
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    fullPath: DEFAULT_FULL_PATH,
    exportPath: DEFAULT_EXPORT_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") {
      parsed.json = true;
      continue;
    }
    if (flag === "--full") {
      const value = argv[index + 1];
      if (!isOptionValue(value)) throw missingValueError("--full", value);
      parsed.fullPath = value;
      index += 1;
      continue;
    }
    if (flag === "--export") {
      const value = argv[index + 1];
      if (!isOptionValue(value)) throw missingValueError("--export", value);
      parsed.exportPath = value;
      index += 1;
      continue;
    }
    throw new BenchmarkEvidenceOptionsError(`Unknown benchmark evidence option ${flag}`, flag);
  }
  return parsed;
}

function isOptionValue(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("--");
}

function missingValueError(option, value) {
  return new BenchmarkEvidenceOptionsError(
    `Missing value for ${option}`,
    option,
    value,
    "Pass a benchmark report path after the option.",
  );
}

async function readBenchmarkReport(label, path) {
  const resolved = resolve(path);
  try {
    return { path, report: JSON.parse(await readFile(resolved, "utf8")) };
  } catch (error) {
    throw new BenchmarkEvidenceOptionsError(
      `Unable to read ${label} benchmark evidence report at ${path}`,
      label === "full" ? "--full" : "--export",
      path,
      "Run the documented benchmark command with --out or pass the correct report path.",
      { cause: error },
    );
  }
}

function checkReport(label, report, expectedMode) {
  const failures = [];
  if (!isRecord(report)) {
    return [`${label}: report must be a JSON object`];
  }
  if (report.version !== "eventloom.benchmark.v1") {
    failures.push(`${label}: expected version eventloom.benchmark.v1, received ${printable(report.version)}`);
  }
  if (report.mode !== expectedMode) {
    failures.push(`${label}: expected mode ${expectedMode}, received ${printable(report.mode)}`);
  }
  if (!Number.isInteger(report.eventCount) || report.eventCount <= 0) {
    failures.push(`${label}: eventCount must be a positive integer`);
  }
  if (typeof report.generatedAt !== "string" || Number.isNaN(Date.parse(report.generatedAt))) {
    failures.push(`${label}: generatedAt must be an ISO timestamp`);
  }
  if (!Number.isFinite(report.fileSizeBytes) || report.fileSizeBytes <= 0) {
    failures.push(`${label}: fileSizeBytes must be greater than zero`);
  }
  failures.push(...checkEnvironment(label, report.environment));
  failures.push(...checkMeasurements(label, report));
  return failures;
}

function checkEnvironment(label, environment) {
  if (!isRecord(environment)) return [`${label}: environment must be present`];
  const failures = [];
  for (const field of ["node", "platform", "arch"]) {
    if (typeof environment[field] !== "string" || environment[field].length === 0) {
      failures.push(`${label}: environment.${field} must be present`);
    }
  }
  if (typeof environment.hardware !== "string" || environment.hardware.length === 0 || environment.hardware === "unspecified") {
    failures.push(`${label}: environment.hardware must describe the benchmark machine`);
  }
  return failures;
}

function checkMeasurements(label, report) {
  if (!Array.isArray(report.measurements)) return [`${label}: measurements must be an array`];
  const failures = [];
  const measurementsByOperation = new Map(report.measurements.map((measurement) => [measurement?.operation, measurement]));
  for (const operation of requiredOperations) {
    if (!measurementsByOperation.has(operation)) {
      failures.push(`${label}: missing required measurement operation ${operation}`);
    }
  }
  for (const operation of ["haloExport", "otlpExport", "pathlightExport"]) {
    const measurement = measurementsByOperation.get(operation);
    if (measurement && (!Number.isFinite(measurement.spanCount) || measurement.spanCount <= 0)) {
      failures.push(`${label}: ${operation} must include a positive spanCount`);
    }
  }
  const pathlight = measurementsByOperation.get("pathlightExport");
  if (pathlight && (!Number.isFinite(pathlight.pathlightEventCount) || pathlight.pathlightEventCount <= 0)) {
    failures.push(`${label}: pathlightExport must include a positive pathlightEventCount`);
  }
  if (pathlight && !isRecord(pathlight.pathlightRoutes)) {
    failures.push(`${label}: pathlightExport must include pathlightRoutes`);
  }
  for (const measurement of report.measurements) {
    if (!isRecord(measurement)) {
      failures.push(`${label}: measurement entries must be objects`);
      continue;
    }
    const operation = printable(measurement.operation);
    if (measurement.eventCount !== report.eventCount) {
      failures.push(`${label}: ${operation} eventCount must match report eventCount`);
    }
    for (const field of ["durationMs", "throughputPerSecond", "rssBytes", "heapUsedBytes"]) {
      if (!Number.isFinite(measurement[field]) || measurement[field] < 0) {
        failures.push(`${label}: ${operation} ${field} must be a non-negative number`);
      }
    }
  }
  return failures;
}

function reportSummary(label, path, report) {
  return {
    label,
    path,
    mode: isRecord(report) ? report.mode : "missing",
    eventCount: isRecord(report) ? report.eventCount : "missing",
    generatedAt: isRecord(report) ? report.generatedAt : "missing",
    hardware: isRecord(report) ? report.environment?.hardware ?? "missing" : "missing",
    measurementCount: Array.isArray(report?.measurements) ? report.measurements.length : 0,
  };
}

function benchmarkEvidenceDiagnostic(error) {
  if (error instanceof BenchmarkEvidenceOptionsError) {
    return compactObject({
      code: error.code,
      message: error.message,
      option: error.option,
      value: error.value,
      suggestedAction: error.suggestedAction,
    });
  }
  return {
    code: "benchmark_evidence_check_failed",
    message: error instanceof Error ? error.message : String(error),
    suggestedAction: "Inspect the benchmark evidence report and retry after correcting the release artifact.",
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printable(value) {
  return value === undefined ? "missing" : String(value);
}
