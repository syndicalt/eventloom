# Package API

Threadline can be used as a library without assembling the event store, orchestrator, runners, and projections manually.

The package API is local-first. It reads and writes JSONL event logs directly. Docker Compose is not required for Threadline itself; it is only useful when you want to run optional infrastructure such as the Pathlight collector and dashboard.

## Create a Runtime

```ts
import { createRuntime } from "threadline";

const runtime = createRuntime("/tmp/threadline.jsonl");
```

`ThreadlineRuntime` is a small facade around the JSONL store, orchestrator, built-in workflow runners, replay helpers, and Pathlight export.

## Append External Events

```ts
await runtime.append({
  type: "goal.created",
  actorId: "user",
  threadId: "thread_main",
  payload: { title: "Build evented agents" },
});
```

External events are sealed into the append-only hash chain before they are written.

## Run Built-In Workflows

```ts
await runtime.runBuiltIn("software-work");
await runtime.runBuiltIn("research-pipeline");
await runtime.runBuiltIn("human-ops");
```

Use `resume: true` when continuing from an existing log:

```ts
await runtime.runBuiltIn("human-ops", { resume: true });
```

The built-in workflow names are:

- `software-work`
- `research-pipeline`
- `human-ops`

## Replay State

```ts
const replay = await runtime.replay();

console.log(replay.integrity.ok);
console.log(replay.projection.tasks);
console.log(replay.projection.research);
console.log(replay.projection.effects);
console.log(replay.projectionHash);
```

Replay returns the event count, integrity report, combined projections, and deterministic projection hash.

The replay shape is:

```ts
interface RuntimeReplay {
  eventCount: number;
  integrity: IntegrityReport;
  projection: {
    eventTypes: Record<string, number>;
    effects: EffectProjection;
    research: ResearchProjection;
    tasks: TaskProjection;
  };
  projectionHash: string;
}
```

## Submit Intentions

For custom actor registries, submit intentions through the runtime facade:

```ts
import { ActorRegistry, createRuntime } from "threadline";

const actors = new ActorRegistry();
actors.register({
  id: "planner",
  role: "Plan tasks",
  subscriptions: ["goal.created"],
  intentions: ["task.propose"],
});

const result = await createRuntime("/tmp/threadline.jsonl").submitIntention(actors, {
  type: "task.propose",
  actorId: "planner",
  threadId: "thread_main",
  parentEventId: "evt_goal",
  causedBy: ["evt_goal"],
  payload: { taskId: "task_1", title: "Write tests" },
});
```

The orchestrator validates actor permissions and projection state before accepting events.

## Run Custom Actors

```ts
await runtime.run(actorRegistry, actorRunners, { maxIterations: 10 });
```

Custom runners receive actor context, a rebuilt mailbox, and the current event history. They return structured intentions; they do not mutate state directly.

```ts
const runners = {
  planner: ({ mailbox }) => mailbox.map((item) => ({
    type: "task.propose",
    actorId: "planner",
    threadId: item.event.threadId,
    parentEventId: item.event.id,
    causedBy: [item.event.id],
    payload: { taskId: "task_1", title: "Write tests" },
  })),
};
```

For custom event domains, add projection validation before relying on the orchestrator as a state-machine boundary.

## Export to Pathlight

```ts
await runtime.exportPathlight({
  baseUrl: "http://localhost:4100",
  traceName: "threadline-run",
});
```

Pathlight export includes integrity status, projection hash, projection kinds, thread IDs, runtime package metadata, and git provenance when available.

## Lower-Level Exports

The public package still exports the lower-level modules for advanced use:

- `JsonlEventStore`
- `Orchestrator`
- `ActorRegistry`
- `runRuntimeLoop`
- `projectTasks`
- `projectResearch`
- `projectEffects`
- `exportToPathlight`
