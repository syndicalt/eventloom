#!/usr/bin/env node
import { JsonlEventStore } from "./event-store.js";
import { eventTypeCounts, projectionHash } from "./projection.js";
import { projectTasks } from "./task-projection.js";

async function main(argv: string[]): Promise<void> {
  const [command, path] = argv;

  if (command !== "replay" || !path) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const store = new JsonlEventStore(path);
  const events = await store.readAll();
  const projection = {
    eventTypes: eventTypeCounts(events),
    tasks: projectTasks(events),
  };

  console.log(JSON.stringify({
    eventCount: events.length,
    projection,
    projectionHash: projectionHash(projection),
  }, null, 2));
}

function printUsage(): void {
  console.error("Usage: threadline replay <events.jsonl>");
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
