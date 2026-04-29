#!/usr/bin/env node
import { createSoftwareWorkRegistry } from "./actors.js";
import { JsonlEventStore } from "./event-store.js";
import { formatMailbox, formatTaskExplanation, formatTimeline } from "./inspect.js";
import { verifyEventChain } from "./integrity.js";
import { buildMailbox } from "./mailbox.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectTasks } from "./task-projection.js";
import { runSoftwareWorkDemo } from "./demo.js";
import { runSoftwareWorkRuntime } from "./runners.js";

async function main(argv: string[]): Promise<void> {
  const [command, path, extra, rest] = argv;

  if (command === "demo" && path === "software-work") {
    const outPath = extra ?? ".threadline/events.jsonl";
    await runSoftwareWorkDemo(outPath);
    console.log(JSON.stringify({ path: outPath }, null, 2));
    return;
  }

  if (command === "run" && path === "software-work") {
    const outPath = extra ?? ".threadline/events.jsonl";
    const result = await runSoftwareWorkRuntime(outPath);
    console.log(JSON.stringify({ path: outPath, ...result }, null, 2));
    return;
  }

  if (command === "timeline" && path) {
    const store = new JsonlEventStore(path);
    console.log(formatTimeline(await store.readAll()));
    return;
  }

  if (command === "explain" && path === "task" && extra && rest) {
    const store = new JsonlEventStore(rest);
    console.log(formatTaskExplanation(await store.readAll(), extra));
    return;
  }

  if (command === "mailbox" && path && extra) {
    const store = new JsonlEventStore(extra);
    const registry = createSoftwareWorkRegistry();
    console.log(formatMailbox(path, buildMailbox(registry, path, await store.readAll())));
    return;
  }

  if (command !== "replay" || !path) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const store = new JsonlEventStore(path);
  const events = await store.readAll();
  const integrity = verifyEventChain(events);
  const projection = {
    eventTypes: eventTypeCounts(events),
    tasks: projectTasks(events),
  };

  console.log(JSON.stringify({
    eventCount: events.length,
    integrity,
    projection,
    projectionHash: projectionHash(projection),
  }, null, 2));
}

function printUsage(): void {
  console.error("Usage: threadline replay <events.jsonl>");
  console.error("       threadline demo software-work [events.jsonl]");
  console.error("       threadline run software-work [events.jsonl]");
  console.error("       threadline timeline <events.jsonl>");
  console.error("       threadline explain task <taskId> <events.jsonl>");
  console.error("       threadline mailbox <actorId> <events.jsonl>");
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
