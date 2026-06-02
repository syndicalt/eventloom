# Pathlight Bridge Spike

Date: 2026-04-29

## Decision

Keep Eventloom as a separate runtime prototype and integrate with Pathlight through an export adapter for now. Do not merge Eventloom into Pathlight until the runtime model has more than one workflow and the Pathlight UI needs native Eventloom concepts.

The current Pathlight trace/span/event schema is sufficient for the first bridge:

- Eventloom runtime run -> Pathlight trace
- Eventloom actor turn -> Pathlight agent span
- Eventloom events related to a turn -> Pathlight span events
- Eventloom integrity and projection hash -> Pathlight trace metadata

No Pathlight database schema extension is required for this slice.

## Visualizer Affordance Update

Date: 2026-04-30

Eventloom now exports a versioned trace-level visualizer contract in Pathlight trace metadata:

```json
{
  "version": "eventloom.pathlight.visualizer.v1",
  "outputPath": "visualizer",
  "panels": [
    { "id": "capture", "title": "Capture", "outputPath": "visualizer.capture" },
    { "id": "replay", "title": "Replay", "outputPath": "visualizer.replay" },
    { "id": "handoff", "title": "Handoff", "outputPath": "visualizer.handoff" }
  ]
}
```

The final Pathlight trace output carries the same `VisualizerModel` produced by the runtime API, CLI, MCP tool, and browser visualizer. Pathlight can render Capture, Replay, and Handoff panels from `output.visualizer` while keeping the underlying trace/span/event export unchanged.

This keeps the current boundary:

- Eventloom owns event-sourced runtime semantics, replay, handoff summaries, and the visualizer model.
- Pathlight owns trace ingestion and visual inspection.
- The bridge remains an adapter contract rather than a Pathlight schema migration.

## Verification

Generated a deterministic software-work run and exported it to the local Pathlight collector at `http://localhost:4100`.

First export:

```text
traceId: SFqwBrU22x9iKBO5lZpo4
spanCount: 5
eventCount: 15
```

This confirmed the native endpoints accept Eventloom traces, spans, and span events. It also exposed a schema-shape issue: clean Eventloom actor span outputs included `"rejectedEvents":[]`, and Pathlight's list heuristic flags span output containing the word `rejected`.

Eventloom now omits empty rejection lists from exported span output and only includes `rejectionEventIds` when there are actual rejection events.

Second export after the adjustment:

```text
traceId: nCXNN1s4HuW2qr9dvuiCd
spanCount: 5
eventCount: 15
```

The trace detail shows five completed `agent` spans and fifteen span events. Clean span outputs now include `turnId`, `sourceEventId`, `intentions`, and `acceptedEvents`; they do not include empty rejection fields.

## Implications

Pathlight can serve as the inspection surface for Eventloom runs without Eventloom depending on Pathlight internals.

The bridge should stay as an adapter in Eventloom while the runtime semantics evolve. Pathlight-specific behavior should remain limited to the export package and CLI command.

## Follow-Up

- Add project/git provenance to exported traces when Eventloom has a stable package or run context.
- Consider parent span links if Eventloom grows nested actor turns or parallel actor branches.
- Add a dashboard affordance in Pathlight that detects `metadata.visualizer.version` and renders `output.visualizer.capture`, `output.visualizer.replay`, and `output.visualizer.handoff`.
- Choose the next runtime milestone from the updated development roadmap candidates.
