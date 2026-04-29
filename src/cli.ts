#!/usr/bin/env node
import { JsonlEventStore } from "./event-store.js";
import { verifyEventChain } from "./integrity.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectTasks } from "./task-projection.js";
import { runSoftwareWorkDemo } from "./demo.js";

async function main(argv: string[]): Promise<void> {
  const [command, path, extra] = argv;

  if (command === "demo" && path === "software-work") {
    const outPath = extra ?? ".threadline/events.jsonl";
    await runSoftwareWorkDemo(outPath);
    console.log(JSON.stringify({ path: outPath }, null, 2));
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
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
