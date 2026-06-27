# nv Roadmap

> **Single source of truth for where nv is and how far it has to go.**
> The decision log records *what was decided and why*. This roadmap records *position against
> targets* — requirements per milestone, blockers, and deferred work. The roadmap **points at**
> decision-log entries; it does not restate them. When the two disagree, the decision log is
> authoritative on *decisions*; this roadmap is authoritative on *milestone scope and status*.

**Last reconciled to `main`:** `007eaa2` (2026-06-25). Contract **v0.4.2**, Template-IR **v0.4.2**.

---

## The milestone ladder

nv is being built **correct-first, then fast**. The milestones are quality gates, not feature dumps.
Each has a distinct meaning and a distinct bar.

| Milestone | Meaning | The bar |
|---|---|---|
| **v0.1.0** | Minimum viable view engine | nv can be (a) authored as a real app end-to-end in a real browser, and (b) dropped in as the core under a competitor benchmark harness (js-framework-benchmark keyed) so performance is measured apples-to-apples. **"It works end-to-end and can be benchmarked" — not feature-complete.** |
| **v0.5.0** | Feature parity | nv expresses what the incumbents express, **filtered through nv's axioms** (run-once components + run-once-per-propagation, no VDOM, fine-grained signals, DOM-free core, the **closed four-primitive set** — `pubsub` is an out-of-graph helper, `errorBoundary` an owner-scope helper — compiler-skips-only-provable-work). Parity with what nv's architecture *can and should* do — not 1:1 API mirroring. |
| **v1.0.0** | The high bar | Everything from 0.5.0→1.0.0 is hardening and surpassing: performance, fault tolerance, efficiency, ergonomics, security, reliability — plus features/improvements that **measurably beat the status quo**, not match it. |

Detailed scope, requirements, and live status for each milestone live in its checkpoint file:

- [`roadmap/v0.1.0.md`](roadmap/v0.1.0.md) — MVP / benchmarkable
- [`roadmap/v0.5.0.md`](roadmap/v0.5.0.md) — feature parity
- [`roadmap/v1.0.0.md`](roadmap/v1.0.0.md) — hardening + surpassing

---

## How to read status

Every requirement in a checkpoint file carries one status:

- **DONE** — landed on `main`, architect-verified by source read at SHA. Links the commit/SHA.
- **IN PROGRESS** — commissioned and partially landed, or actively being executed.
- **BLOCKED** — cannot proceed until a named blocker clears. Links the blocker.
- **DEFERRED** — deliberately not now; has a falsifiable reopen trigger. Links the decision-log entry.
- **NOT STARTED** — scoped, no work begun.
- **OPEN QUESTION** — requires an architectural decision before it can be scoped.

A milestone is **reached** when every requirement on its checkpoint critical path is DONE and no
BLOCKED item remains on that path. DEFERRED items with triggers that have not fired do **not** block
a milestone — that is the whole point of recording them as deferred-with-trigger rather than as debt.

---

## How nv's axioms shape parity (read before scoping v0.5.0)

Parity is **not** "implement every Solid/Svelte API." Several incumbent features are architecturally
inapplicable, subsumed, or must take a different shape under nv's locked decisions. The mapping:

| Incumbent feature | nv's position | Why |
|---|---|---|
| `createSignal` / `$state` | **Have** (`signal`) | Direct parity; call-to-read, `.set()`-to-write. |
| `createMemo` / `$derived` | **Have** (`derived`) | Direct parity; purity is ironclad (locked). |
| `createEffect` / `$effect` | **Have** (`effect`) | Direct parity; signal-writes only as capped last resort. |
| `createResource` / async signals | **Gap → parity target (closure-constrained)** | nv has no async primitive. Parity = a read-centric async→signal construct built **by composition over the four primitives / as an out-of-graph utility** (the `pubsub`→`sync` external-source pattern), **never a new graph primitive**. Must not widen `derived`/`sync` guarantees. **Design-open.** |
| `createStore` (proxy nested state) | **Gap → parity target, axiom-constrained** | A store must be **composition over signals** (not a new graph primitive) and **preserve per-leaf granularity** (must not collapse nested objects into one coarse signal — that regresses the performance axiom). Likely a renderer-adjacent/standalone utility, not core. **Design-open.** |
| Control flow (`<For>`/`<Index>`/`<Show>`/`<Switch>`) | **Mostly have** | `list` (keyed, by-identity) ≈ `<For>`; `conditional` ≈ `<Show>`. `<Index>` (positional) and `<Switch>`/multi-branch are **gaps**. |
| Context / provide-inject | **Gap → parity target (closure-safe)** | Ownership graph (`getOwner`) exists; a context API is an **owner-graph traversal utility, not a new graph primitive**. Must avoid a global registry. **Design-open.** |
| Two-way binding (`bind:value`) | **Have** (`sync`) | `sync` is nv's single reactive→signal-write construct; `:value`/`:checked` landed. |
| Event delegation | **Partial** | Direct `addEventListener` works; delegation is a perf optimization, not a correctness gap. **v0.5.0/v1.0.0 perf item.** |
| Suspense / Transitions | **Gap** | Concurrency primitives. Likely v1.0.0 territory (depends on async signals landing first). |
| SSR / hydration | **Gap** | No server path today. DOM-free core runs identically server-side (asset), but SSR/hydration **must live in the renderer/server entry, never in core**. Target is `renderToString` + hydrate (view-engine scope), not a meta-framework. **v0.5.0-or-v1.0.0 scope decision needed.** |
| Stores ecosystem / meta-framework (router, SolidStart-equiv) | **Out of scope through v1.0.0** | nv is a view engine, not a meta-framework. A router pattern (signals + conditional) is documented, not built into core. |
| Scoped styles | **Have** (`$style`) | Slot domain closed; `$style × <each>` browser leg deferred. |

**The axiom filter is itself a v0.5.0 deliverable:** each "design-open" parity target needs an
architect ruling on *what shape it takes under nv's axioms* before it's scoped. Those rulings are
decision-log entries; this roadmap tracks whether they exist.

---

## Cross-cutting: the benchmark-compliance constraint (affects v0.1.0)

js-framework-benchmark (keyed) is the "core under a competitor harness" target. Its requirements are
concrete and one of them touches a closed nv tradeoff:

- Operations: create 1k / replace-all / partial-update (every 10th row) / **select** / **swap** /
  remove / create-10k / append-1k-to-10k / clear.
- **Keyed-swap rule:** a compliant keyed implementation must *move the actual DOM rows* on swap, not
  remove-and-reinsert. **Source read: nv's reconcile already moves existing `rootEl` nodes via
  `insertBefore` (interpreter.ts L534–544); `insertBefore` on an in-document node moves it, preserving
  identity.** nv likely satisfies this by construction — the v0.1.0 task is to *verify* `isKeyed`, not
  to reopen the LIS/move-minimization item (closed-by-tradeoff 2026-06-22). LIS reopen requires a
  *measured* swap deficit, which is not currently in evidence. Tracked as a verification in the
  checkpoint, not an assumed blocker.
- Structural: buttons with exact ids/classes, Bootstrap CSS, `npm run build-prod` produces a
  browser-loadable bundle. This is the **real-browser build path** (v0.1.0 critical path item).

---

## Maintenance rules

- **This file changes when a milestone's scope or the ladder changes** — rare. Day-to-day status
  lives in the checkpoint files.
- **Checkpoint files change when a requirement's status changes** — link the SHA (DONE) or the
  decision-log entry (DEFERRED/BLOCKED). Keep a dated "Status log" at the bottom of each checkpoint.
- **Never let a checkpoint claim DONE without a SHA.** "Tests green" is not DONE; architect-verified
  source read at SHA is.
- **Deferred work is first-class.** Every DEFERRED item names its reopen trigger. An item with no
  trigger is either DONE, NOT STARTED, or an OPEN QUESTION — never silently parked.
- The roadmap and decision log are reconciled by the architect; GitHub `main` is canonical, PK lags.
