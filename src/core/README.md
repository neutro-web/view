# @neutro/view/core

The fine-grained reactive runtime. DOM-free and framework-agnostic — usable in Node,
a worker, or any host. The renderer consumes this; it does not depend on the renderer.

## Surface

- `signal(initial, opts?)` — writable reactive root.
- `derived(fn, opts?)` — pure computed; never writes (purity is ironclad).
- `effect(fn)` — side effects; the only nodes scheduled in the down phase.
- `sync(source, target, compute)` — the single reactive→signal-write construct;
  feedback loops are caught at build time where the target is statically enumerable.
- `pubsub()` — non-graph fan-out event utility (events, not state).
- `errorBoundary(fn, handler)` — owner-scoped error routing.
- `batch`, `untrack`, `createRoot`, `onCleanup`, `flushSync` — scheduling + ownership.

## Guarantees

Specified in [`docs/reactive-core-contract.md`](../../docs/reactive-core-contract.md):
efficient (no over-recompute), glitch-free, run-once, dynamic-dependency-correct,
disposal-total, reentrancy-safe, cycle-safe-by-construction, error-safe.

## Status

Correctness-complete: the §12 conformance suite passes in full, including a property
fuzzer asserting per-node run-once and no-leak across seeded random graphs.
Performance tuning (against an alien-signals-class baseline) is the next phase and
requires real-hardware benchmarking.
