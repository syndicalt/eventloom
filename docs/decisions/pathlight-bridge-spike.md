# Pathlight Bridge Spike

Date: 2026-04-29

## Decision

Keep Threadline as a separate runtime prototype and integrate with Pathlight through an export adapter for now. Do not merge Threadline into Pathlight until the runtime model has more than one workflow and the Pathlight UI needs native Threadline concepts.

The current Pathlight trace/span/event schema is sufficient for the first bridge:

- Threadline runtime run -> Pathlight trace
- Threadline actor turn -> Pathlight agent span
- Threadline events related to a turn -> Pathlight span events
- Threadline integrity and projection hash -> Pathlight trace metadata

No Pathlight database schema extension is required for this slice.

## Verification

Generated a deterministic software-work run and exported it to the local Pathlight collector at `http://localhost:4100`.

First export:

```text
traceId: SFqwBrU22x9iKBO5lZpo4
spanCount: 5
eventCount: 15
```

This confirmed the native endpoints accept Threadline traces, spans, and span events. It also exposed a schema-shape issue: clean Threadline actor span outputs included `"rejectedEvents":[]`, and Pathlight's list heuristic flags span output containing the word `rejected`.

Threadline now omits empty rejection lists from exported span output and only includes `rejectionEventIds` when there are actual rejection events.

Second export after the adjustment:

```text
traceId: nCXNN1s4HuW2qr9dvuiCd
spanCount: 5
eventCount: 15
```

The trace detail shows five completed `agent` spans and fifteen span events. Clean span outputs now include `turnId`, `sourceEventId`, `intentions`, and `acceptedEvents`; they do not include empty rejection fields.

## Implications

Pathlight can serve as the inspection surface for Threadline runs without Threadline depending on Pathlight internals.

The bridge should stay as an adapter in Threadline while the runtime semantics evolve. Pathlight-specific behavior should remain limited to the export package and CLI command.

## Follow-Up

- Add project/git provenance to exported traces when Threadline has a stable package or run context.
- Consider parent span links if Threadline grows nested actor turns or parallel actor branches.
- Add a dashboard affordance in Pathlight later only if generic trace/span/event views are not enough to explain Threadline runs.
- Choose the next runtime milestone from the updated development roadmap candidates.
