# nv — Decision Log

> **How to read this file.** Two surfaces:
> 1. **Current State** (below) — the *resolved* picture: what is locked, open, or
>    superseded **right now**. This is the only section that gets *edited*. Read
>    this first to know what is true today.
> 2. **Log** (further down) — an **append-only, date-timed** history of decisions
>    and their rationale. Never edit or delete entries; only append. Read
>    oldest→newest to reconstruct *how* and *why* a decision was reached.
>
> **How to write to this file.** When a session reaches a decision (locks
> something, opens a question, supersedes a prior call, or resolves a research
> finding), append a new dated entry to the Log **and** update the Current State
> header to match. Never rewrite history in the Log; record reversals as new
> entries that explicitly supersede the old one (cite its date).
>
> **Maintenance.** When the Log grows unwieldy, move superseded/stale entries to
> `nv-decision-log-archive.md` and leave a one-line pointer here — do **not**
> delete, because a superseded decision's rationale is often what prevents
> re-making the mistake. Editing the Current State header is the light-touch
> consolidation; archiving is the heavier one.
>
> **Authority.** The **nv Reactive Core Runtime Contract** is the source of truth
> for reactive-core *semantics*. This log records decisions, including ones that
> change the contract (note the contract version bump in the entry). If this log
> and the contract conflict, the conflict must be flagged, not silently resolved.

---

## Current State

_Last updated: 2026-06-18 (Contract **v0.4.1** — runtime correctness verified; compiler steps 1–4 closed; renderer interpreter complete [all 6 PoC bindings]; core DOM-lib strict defect resolved; PoC coherence gate closed [sandbox portion]; **3 pre-existing defects fixed during repo migration, cascade cap split into two budgets [§8.5.4]**)_

### Locked (do not drift without explicit reversal)
- **Reactivity model:** fine-grained signals, three-state (Clean/Check/Dirty)
  graph-coloring, synchronous push-down marking + lazy pull-up resolution
  (`updateIfNecessary`). Components run once. No VDOM, no re-render.
- **Primitive set (4 reactive + 2 helpers):** `signal`, `derived` (pure, never
  writes), `effect` (side effects; signal-writes only as a capped last resort for
  non-enumerable dynamic targets), `sync` (the single reactive→signal-write
  construct). Helpers: `pubsub` (non-graph fan-out *event* utility — events not
  state; no memory, no operators) and `errorBoundary`.
- **`sync` shape:** `sync(source, target, compute)`. Source = reactive thunk OR
  external `{ subscribe }` producer. Target = single or statically enumerable
  signal. `compute` arity selects map `(incoming)` vs. reduce `(incoming, current)`,
  `current` delivered untracked-by-construction.
- **Ironclad rules:** `derived` purity is absolute. `sync`/`pubsub` stay strict —
  never add coverage-widening flags that dissolve their static guarantees.
- **Cycle safety:** reactive→signal-write loop hazard moved to build-time
  structural impossibility wherever the target is statically enumerable; global
  write-graph cycle check; soundness fallback always applies.
- **Compiler license:** may only *skip provable work*; misclassification costs
  performance, never correctness.
- **Agnosticism:** reactive core is DOM-free. Renderer consumes the core. Web
  Components are a compile *target*, not the programming model.
- **Data-structure discipline:** intrusive doubly-linked-list edges; no
  Array/Set/Map in the hot path; no data-dependent recursion in the core walks.
- **Error semantics:** specified for the synchronous model (Contract §5.4).
- **Flush ordering:** within a flush, inter-node dependencies self-order via the
  up-walk; syncs drain before purely-terminal effects so effects reading a
  sync-written signal see final values (glitch-free). Sequential same-target syncs
  observe prior in-flush writes (Contract §8.7). **Cascade cap is two budgets
  (§8.5.4, v0.4.1):** a reactive-cascade budget (cycle/runaway guard, reactive sync
  nodes only) and a separate larger external-event safety budget — external bursts
  must not be bounded by the reactive budget (conflating them drops legitimate
  events). The separation is the contract guarantee; the multiplier is an
  implementation constant.
- **Runtime correctness baseline:** §12 conformance suite passes **36/36** against
  contract v0.4 (23 checklist items + §12.17a/b error-path cases + property fuzzer +
  §B2–B8 invariant/coverage tests). Three implementation bugs surfaced and fixed
  during the build: BFS tail-mutation in `propagate` Phase 2 (`next` captured before
  observer loop, causing early exit on deep chains); `drainSyncPhase` inner-while
  infinite loop on cyclic syncs (fix: one entry per outer iteration); §12.20 test
  over-counted handler calls across two flushes. `core.ts` + `conformance.ts` are the
  locked correctness baseline for perf tuning. **v0.4.1 (2026-06-18):** two further
  `drainSyncPhase` defects fixed during repo migration — cap off-by-one (exactly-
  MAX_CASCADE now settles cleanly) and the reactive/external counter split (external
  bursts no longer capped by the reactive budget; see §8.5.4 and the dated entry).
  36/36 still green against the patched core.
  **Architect review closed (2026-06-15):** two correctness hardenings (sync-target
  Signal guard in `nodeSet`; `resolveTarget` untracking invariant documented) and the
  full set of coverage gaps were landed and verified. The run-once invariant (§1.3) is
  now asserted at **per-node** granularity within a measurement window, with the fuzzer
  pulling **deepest-first** so interior nodes resolve via CHECK up-walks (the path where
  run-once bugs hide). Validated by planting an interior double-recompute bug: the
  tightened fuzzer fails on it; the prior total-count assertion did not. No-leak
  (edge-list-empty-after-dispose) is asserted across 200 seeded random graphs.
- **Compiler correctness baseline (steps 1–2):** the `sync`-correctness layer is
  built and verified — `sync`-target classification (§8.5.3: ACCEPT/REJECT/
  UNDECIDABLE, nominal nv-signal detection, enumerable element-access) and the
  global write-graph cycle checker (§8.5.2: source-read analysis, DFS cycle
  detection, structured `CycleReport[]`). 41/41 across both suites; all four
  compiler files typecheck clean under `tsc --strict`. The cross-pass SignalId seam
  (a signal as a `sync` target and the same signal read in another `sync` source
  produce identical IDs) is test-locked.
- **Compiler specialization layer (steps 3–4 done):** two §10 hooks built and
  verified.
  - **Step 3 — equality-policy inference (§7.1 / §10 row 2).** Maps a node's static
    value-type to a per-node `equals`: primitives/primitive-unions → `OBJECT_IS`;
    std-lib mutable containers (`Array`, tuple, `Map`/`Set`/`WeakMap`/`WeakSet`,
    lib-origin-verified) → `false`; everything unprovable (readonly variants,
    `Date`, typed arrays, object literals, user types, generics) → DECLINE.
    `STRUCTURAL` recognized but **not emitted** (benchmark hypothesis, §10 hard
    rule). Explicit user `equals` deferred to via a two-layer check (AST for
    literals incl. shorthand/spread; type-property for non-literal options). 45/45.
  - **Step 4 — branch-variant dependency sets (§10 row 4).** Analyzer proves the
    complete union of reactive reads across all branches (ternary/nested/flat/
    single-exit block; declines opaque calls, loops, switch, try/catch, async,
    optional chaining) and emits a `DECLARED { declaredUnion } | DECLINE` verdict.
    Soundness design arch-reviewed and approved *before* implementation. Scope
    locked: **union-only, tracking-always-on**; the declared union is an
    expected-reads *oracle* for cheaper reconciliation, never a replacement for
    tracking — so `reconcileEdges` (in the `finally`, §5.4.1) is always ground
    truth and a wrong/narrow union causes only redundant work, never a missed edge
    (a wrong result is structurally impossible). Per-branch variants and the
    skip-tracking path explicitly deferred (E2/E3 — separate future gated designs).
    Analyzer 21/21; runtime mechanism 7/7 against a faithful model harness.
    Architect adversarially verified that a deliberately-wrong narrow union still
    produces correct results and establishes the omitted edge.
  - **Specialization-layer standing rule:** every hook is built to "provably
    correct, with the mechanism in place"; the *perf win* is a hypothesis for
    Claude Code benchmarking (§10 hard rule). No hook is "proven faster" from a
    sandbox number.
  **Integration boundary (deferred, runtime stream / Claude Code):** the step-4
  runtime side is proven against a faithful *model* (`variantRuntimeHarness.ts`),
  not the real `core.ts`. Wiring the `_compilerSources` §10 hook into the actual
  core and re-running the property + soundness tests against it is a **runtime-
  stream integration task**, not done yet — the convergence point where compiler
  output meets the real runtime.
  **Not started:** eager/lazy bias (§10 row 3) and wide-fanout grouping (§10 row 5)
  — both *performance-defined* hooks (no correctness verdict; the policy IS the
  benchmark question), so scaffold-here / decide-in-Claude-Code; disposal scope
  (§10 row 6).
- **Compiler-stream standing practice:** `tsc --noEmit --strict` is a gate
  **separate** from running the tests. The test runner (`tsx`) strips types and
  does not enforce strict checking, so a green suite does **not** imply a clean
  compile (a strict-only defect hid behind green tests in step 2). Both gates must
  pass.
- **Authoring syntax resolved as architecture:** one template language, one IR,
  two front-ends (`.nv` file + tagged-template), two back-ends (interpreter +
  compiler). The JSX-vs-single-file fork dissolved — the authoring surface and the
  parse/compile machinery are independent; front-end is just *where the template
  string comes from* + delimiter choice. Template IR approved at **v0.2**
  (2026-06-17). Established parse → IR → multi-backend shape (Vue Vapor is prior
  art).
- **Renderer/templating stream (stream 3) open.** IR contract: `TemplateShape`
  (static HTML + `NodePath[]`, no runtime sentinel scanning) + six PoC binding
  kinds (TextBinding, AttrBinding, PropBinding, EventBinding, ChildBinding [v0
  primitives-only], ConditionalBinding); ListBinding + SyncBinding designed-and-
  deferred. **All PoC DOM-mutation bindings → `effect`** (a DOM write is a side
  effect; `derived` would violate purity, `sync` is for reactive→signal writes).
  `sync` reserved for SyncBinding's DOM→signal write-back (deferred). No `derived`
  in binding plumbing. Disposal: one `createRoot` per mounted region (§6);
  ConditionalBinding branches get their own roots bridged via `onCleanup`.
  Differential conformance suite uses **structural DOM comparison** (not
  `outerHTML` string equality). **Interpreter back-end functionally complete for
  the PoC:** all six binding kinds implemented and verified against the real
  `core.ts` — TextBinding, AttrBinding, PropBinding, EventBinding, ChildBinding
  (primitives; non-primitive rejected identically per TC-09), ConditionalBinding.
  34/34, strict-clean with the DOM lib in scope. Owner-tree disposal §6-correct;
  ConditionalBinding flip-no-leak verified adversarially to 1000 flips (max
  childNodes never exceeds branch+anchor; observer count stays 1 while live, 0
  after dispose; post-flip write to old branch is a no-op). Files: `ir.ts`,
  `htmlTag.ts`, `interpreter.ts`, `comparator.ts`, `interpreter_test.ts`.
  ChildBinding update semantics: updates the existing text node's data (not
  node-replace). Compiler back-end still deferred (pending the SignalId seam with
  stream 2). v0 front-end constraint: attribute holes must be quoted
  (`class="${x}"`); unquoted/partial-value interpolation unsupported (documented).
  Harness note: the interpreter is async-scheduled — tests/probes must `flushSync()`
  after a signal write before asserting DOM state.

### Open design decisions (chosen later; not blocking)
- Compile-time vs. runtime split — the boundary of what is compiled away vs.
  shipped. (Be deliberate; does not self-resolve.) **Narrowed 2026-06-18:** the
  read/write *syntax* transform is now pinned — authoring surface gets bare-read +
  mutation-write via compiler erasure; the runtime core stays explicit
  call-to-read/`.set()`-write; the boundary is "is there a compile step over this
  code." The rest of the split (scheduling, encapsulation, what else compiles away)
  stays open. See dated entry.
- Effect-flush timing primitive (microtask vs. custom scheduler).
- Compile-time *full* encapsulation (DOM + style), beyond Svelte-style style
  scoping — genuinely open research.

### Known issues / pending cross-stream fixes
- **`core.ts` DOM-lib strict defect — RESOLVED (2026-06-17).** The nv-local
  `interface Node` was renamed to `ReactiveNode` throughout `core.ts`, eliminating
  the collision with the DOM global `Node` that caused the two `TS7022` errors when
  core was imported alongside the DOM lib. Verified: strict-clean *with the DOM lib
  in scope* (the config that exposed the bug), 36/36 conformance still green (rename
  was behavior-neutral). The fix is source-level, not suppression — no
  `@ts-expect-error` remains. Institutional close: `tsconfig.json` and
  `tsconfig_check.json` now both set `strict: true` + `lib: ["ES2022", "DOM"]`, so
  strict-with-DOM-lib is the standing build/check configuration and a future
  DOM-global collision surfaces immediately. See the dated entry below for detail.
- **Renderer to retire `core_ts6_patched.ts` (pending).** The renderer's temporary
  `@ts-expect-error` forked core is now obsolete. Renderer re-points its interpreter
  import to the real `core.ts` and deletes the patched copy — restoring single
  source of truth. One-line import change + file deletion.
- **Repo-wide import-extension style inconsistency (cleanup, non-urgent).** Compiler
  files use **extensionless** imports (`from './types'`); renderer/core files use
  **`.ts`** imports (`from './core.ts'`). Each stream's own tsconfig tolerates its
  style, but there is not yet *one* config under which the whole codebase compiles —
  a single consumer importing both (the PoC) had to use a CommonJS/node-resolution
  tsconfig to bridge them. No defect (both styles work, code is correct), but the
  Claude Code convergence (one shared build) should settle on one import style
  repo-wide. Surfaced by the PoC integration; resolved poc-locally, not at source.
- **Test-hygiene follow-up (non-blocking, from the 2026-06-18 migration review).**
  The integration PoC's Gate-4 `expect(true).toBe(true)` is a structural-intent
  placeholder, not a real assertion — give it a clarifying comment so it is not
  mistaken for a passing check. Compiler tests have some `expect(!expr).toBe(true)`
  double-negations worth tidying. No correctness impact.

### PoC coherence gate (Phase 0 ROADMAP)
- **Sandbox portion CLOSED (2026-06-18).** Stream 5 (integration) built and
  architect-verified `poc_integration.ts` — 15/15, strict-clean — proving the four
  sandbox-reachable gate criteria. The example (counter signal + derived label +
  ConditionalBinding, rendered via the interpreter into jsdom) consumes runtime,
  compiler, and renderer as fixed artifacts; no component modified; all cross-stream
  interaction via contract surfaces only.
  - **Gate 1 (compose):** signal writes flow through derived → bindings → DOM across
    state changes; conditional flips correctly; glitch-free (§1.2).
  - **Gate 2 (build-time cycle rejection):** classifier yields 2 ACCEPTs for a
    deliberate `a→b + b→a` sync cycle; checker returns a CycleReport (length 2,
    names syncs); clean fixture → 0 reports (no false positives).
  - **Gate 3 (no-leak):** architect independently reproduced the exact counts —
    pre-dispose `observerCount(count)=3`, `(label)=1`; post-dispose `(label)=0`
    (mount effects severed), `(count)=1` (the module-scope `label` derived correctly
    survives — verified it still recomputes post-dispose). Adversarial post-dispose
    write leaves DOM untouched; flip-then-dispose leaves zero leaked edges.
  - **Gate 4 (seams only):** import audit confirms only §11 primitives, the IR
    contract (`mount`/`TemplateIR`), and compiler public APIs cross the boundary.
- **NOT claimed:** "runs in a real browser, interaction updates the DOM" — the final
  ROADMAP Phase 0 item, deliberately not claimed from a jsdom result. This is the
  Claude Code convergence trigger.
- **No composition bug surfaced** — all three streams composed cleanly at first
  integration. (The only adjustment was the import-style bridge above, a
  poc-tsconfig matter, not a stream defect.)

### Genuine research problems (unknown answers, can fail)
- The propagation algorithm *correctness* is settled. The open research is beating an
  alien-signals-class performance baseline — correctness-phase implementation uses O(k)
  dedup scan in trackRead and plain-object node allocation; both are known deferrals.
  Trigger to move to Claude Code: any answer that depends on a real hardware number.
- Compiler specializations as optimization hypotheses, each of which must beat the
  unspecialized baseline on the benchmark before shipping.

### Superseded (kept for rationale; see Log for detail)
- _none yet._

### Naming
- `neutro/view` / `nv` is a working name; may change. The package will sit under
  `@neutro` if the ecosystem promise is "no framework lock-in" (the view engine is
  *portable*, not strong-agnostic like the pure-logic packages — describe it as
  *portable/interoperable*, not *agnostic*).

---

## Log (append-only, oldest → newest)

### 2026-06-15 — Reactive model and primitive foundation locked
**Decision.** Adopt fine-grained signals with three-state graph-coloring push-pull
as the core; components run once; no VDOM. Derive semantics from the
Reactively/alien-signals lineage (algorithm understanding reimplemented, not code
ported).
**Rationale.** Signals are the current performance frontier; coloring + lazy
pull-up is the proven linear-time approach that solves the diamond and dynamic-
dependency cases that static topological sort handles poorly. Run-once execution
eliminates the entire React re-render tax (dep arrays, memo hints, hook rules,
stale closures).
**Status.** Locked.

### 2026-06-15 — Best-parts synthesis fixed as the design thesis
**Decision.** Take Solid's reactive core + run-once execution, Svelte's compiler
ergonomics (mutation syntax over signals), React's `UI = f(state)` as the *mental
model only* (not the VDOM machinery), and Vue's proxy reactivity quarantined to a
future opt-in `store`. VDOM is rejected as structurally incompatible with
run-once.
**Rationale.** These cohere because all agree the component describes a graph once
and disagree only about syntax, which a compiler erases. Proxy deep-reactivity and
signal-granular tracking genuinely conflict at the performance layer (proxies cost
per-access); resolved by defaulting to signals and making the proxy `store` an
explicit escape hatch, not a co-equal.
**Status.** Locked.

### 2026-06-15 — Agnosticism scoped: core agnostic, renderer portable-via-WC
**Decision.** The reactive core is strong-agnostic (zero DOM, usable in Node). The
renderer is a consumer of the core. Web Components are a compile *target* for
cross-framework portability, authored as functions+signals and compiled to custom
elements — not the programming model. Default to Light DOM + a plain `mount`
escape hatch; Shadow DOM opt-in.
**Rationale.** "View" and "strong-agnostic" are in tension by definition — the
view is the framework-specific part. WC gives interop-via-target (an asterisk:
attribute/prop boundary, React<19 quirks, SSR gaps, Shadow DOM cost). Making WC
the *model* would force the class model and string boundary into authoring — the
exact DX we beat. Lit chose to *be* WC and accepts middling DX/perf; nv beats it
by treating WC as a target.
**Status.** Locked.

### 2026-06-15 — "Reimplement WC functionally" reframed
**Decision.** Do not try to extract performance from Web Components (there is none
to extract — signals are already faster; Shadow DOM is a *cost*). Instead take
WC's *architectural properties* — self-contained components with clear boundaries,
mount/unmount lifecycle, encapsulation — and implement them with signals + owner
tree (lifecycle) + compile-time style scoping (encapsulation).
**Rationale.** The valuable part of WC is structure, not speed. Solid's owner tree
already does lifecycle better than `conndisconnected/connectedCallback` (finer-
grained, not DOM-attachment-bound). Net-new research that remains: compile-time
*full* encapsulation.
**Status.** Locked (the reframing); compile-time full encapsulation remains open
research.

### 2026-06-15 — Research scope clarified (4 items → 2 research + 1 decision + 1 seam)
**Decision.** The genuine research problems are (a) the propagation algorithm
(diamond is its *test*, not a separate item) and (b) compile-time full
encapsulation. Syntax is a *decision* that gates the compiler, not research. The
compile-vs-runtime split is a fourth thing to decide deliberately (doesn't
self-resolve).
**Rationale.** Diamond + push-pull collapse into one item (push-pull exists to
solve the diamond). Syntax space is well-mapped (JSX vs. single-file); the choice
sets compiler complexity, not success.
**Status.** Locked framing.

### 2026-06-15 — Baseline source clarified: learn from Reactively, benchmark vs. alien-signals
**Decision.** Derive the algorithm's *semantics* from Reactively's coloring (the
clearest explanation) and the *implementation discipline* from alien-signals
(intrusive linked lists, no Array/Set/Map in hot path, no recursion). Benchmark
the runtime against alien-signals using the js-reactivity-benchmark.
**Rationale.** Reactively is the best teaching reference; alien-signals is the
current speed leader (used by Vue) and post-dates/improves Reactively with better
data structures. Same family — take coloring concept + performance discipline.
The data-structure constraints belong in the contract, not bolted on later,
because they shape the node model and how the compiler references edges.
**Status.** Locked.

### 2026-06-15 — Reactive Core Runtime Contract authored (v0.1 → v0.2 → v0.3)
**Decision.** Wrote the contract as the fixed design target. Key calls pinned:
effects are the only nodes scheduled in the down phase (values never eagerly
computed; eagerness is a per-node *compiler hook*, not a global mode); the `break`
in `updateIfNecessary` is **correctness, not optimization**; the signal-vs-derived
equality asymmetry (`equals:false` first-class for in-place mutation); owner tree
decoupled from dependency graph and from DOM lifecycle; compiler hooks may only
*skip* provable work.
**Rationale.** These are the non-obvious decisions where implementation bugs hide.
Pinning them in the contract makes them invariants, not rediscoverable edge cases.
**Status.** Locked. Contract at v0.3.

### 2026-06-15 — Reactive→signal writes: from runtime cap to declarative construct
**Decision.** Rather than rely on a runtime cascade cap alone (Solid/Vue/Svelte's
approach), introduce a declarative construct so the loop hazard is caught at build
time. Evolved within the session: first a `bridge`/`ingress` split (v0.2), then
collapsed to a **single `sync(source, target, compute)`** (v0.3) where source-kind
(reactive vs. external) and compute-arity (map vs. reduce) infer the safety
mechanism. External entry handled by `pubsub` (the source protocol's default
implementation), not a separate primitive. `effect` + cap survives only for
non-enumerable dynamic targets.
**Rationale.** The `bridge`/`ingress` split carved one concept along an
implementation axis (cycle-safety mechanism) instead of the user's mental model
("when X, write Y") — incoherent surface. Collapsing to one `sync` puts variation
in argument shapes where it belongs and makes safety *inferred*, not *chosen*.
Three user pushbacks improved it: conditional targets are fine if *enumerable*
(not just single); external triggers are the *safest* case (no reactive source ⇒
no cycle); accumulation is safe via reduce-arity `current`-as-data (structural
untrack). Cycle check must be **global** (two syncs can form a cycle neither shows
alone).
**Supersedes.** The `bridge`/`ingress` two-construct design from earlier the same
day (never shipped beyond contract v0.2).
**Status.** Locked. Contract §8.5–8.6 at v0.3.

### 2026-06-15 — `pubsub` as general event utility (bounded)
**Decision.** Generalize the external-source adapter into a named `pubsub()`
utility (`{ subscribe, publish, clear }`, Set-backed), usable by `sync`'s external
path *and* by the view layer for event (non-state) coordination. Mirror the
`addEventListener` shape (`subscribe(cb): unsubscribe`) so any EventTarget/
WebSocket/EventEmitter/observable adapts trivially. Implement as a plain callback
Set, **not** an EventTarget (DOM-free, allocation-light).
**Rationale.** It already had to exist for `sync`; naming/exposing it is free *if*
the surface is frozen. Generators were rejected (pull, not push — wrong control
direction; impose buffering). **Bright line (hard constraint):** `pubsub` is for
events, `signal` for state; no memory, no replay, no operators — anything holding
a value is a `signal`, anything transforming streams belongs in userland or
`@neutro/sync`. This prevents drift into a stream library.
**Status.** Locked. Contract §8.6.

### 2026-06-15 — Error/throw semantics specified (closed a silent gap)
**Decision.** Added Contract §5.4: a throw in any `compute` completes edge
reconciliation in a `finally` (structural integrity preserved); `Error` is a flag
orthogonal to Clean/Check/Dirty; errored Derived caches and re-throws on read, and
on recovery (source change → successful recompute) notifies observers; errors
route to owner-scoped `errorBoundary` → global → host, never swallowed; a throw
during flush isolates to its node and does not abort the batch; error handling
cannot loop; disposal still runs on error. Added `errorBoundary` to the primitive
surface.
**Rationale.** This was the one genuinely silent invariant — a throw mid-recompute
can leave edges half-reconciled and corrupt all future propagation. Specifying it
before implementation prevents a whole class of bugs. Noted: specified for the
*synchronous* model; concurrency (if ever added) must revisit error-vs-
interruption.
**Status.** Locked. Contract §5.4, v0.3.

### 2026-06-15 — `sync`-target classification promoted to a first-class compiler hook
**Decision.** The compiler classifies every `sync` target: provably enumerable →
accept (+ cycle check); provably non-enumerable → **reject with a diagnostic
directing to `effect`**; undecidable (`any`/cross-boundary) → conservative default
(never an unsound guess). Enumerability is a static, largely type-driven property.
Added as a named hook in Contract §10 and tests in §12.
**Rationale.** This analysis is what justifies the whole `sync` ergonomic — it
answers "can the compiler tell me this write belongs in `effect`?" with yes. Safe
because misclassification costs performance, never correctness (soundness
fallback).
**Status.** Locked. Contract §8.5.3, §10, v0.3.

### 2026-06-15 — Tooling workflow established
**Decision.** Prototype in claude.ai (Sonnet) for correctness/logic/analysis;
escalate to Opus for architectural questions; move to Claude Code when the work
needs real hardware (perf tuning) or a real browser (real-DOM/WC behavior), or
when the codebase outgrows sandbox file management. Four streams: runtime
build+tune, compiler specialization, renderer/templating, architect.
**Rationale.** The claude.ai sandbox runs code (good for deterministic correctness
— e.g. the §12 conformance tests) but gives unreliable perf numbers (shared CPU,
no GC control) and has no real browser DOM. Trigger to leave the sandbox is "the
answer depends on a real-hardware number or real-browser behavior," not
"feels hairy." Correct-first-then-fast is the right order. Cross-session memory is
**not** automatic — it works only via project-knowledge files (this log + the
contract), so decisions must be written here to persist.
**Status.** Locked (workflow).

### 2026-06-15 — Flush ordering specified: syncs before terminal effects (Contract §8.7, v0.4)
**Decision.** Added Contract §8.7 pinning intra-flush ordering when syncs and
effects are queued together: (1) inter-node dependencies self-order via the
existing `updateIfNecessary` up-walk — no separate topological pass over scheduled
nodes; (2) as a drain-order tiebreaker, syncs are processed before purely-terminal
effects, so an effect reading a sync-written signal observes the final value, not
a partial one — preserving glitch-freedom (§1.2) and run-once (§1.3). Sequential
same-target syncs observe each other's in-flush writes (the §4 write path running
once per queued entry), so N coalesced `publish` calls into
`sync(src, count, (e, current) => current + 1)` produce `count + N`. Added
conformance test §12.22; renumbered hook-off equivalence to §12.23.
**Rationale.** Surfaced by the runtime session (Stream 1) while planning the
scheduler: it had proposed "external syncs run in a mini-batch before reactive
effects" as an *implementation* detail. As architect, judged this contract-level,
not implementation-level, because it determines what a computation observes
mid-flush and therefore touches the glitch-freedom invariant. Verified the right
rule from first principles: dependency ordering is already handled by the up-walk
(reuse, no new mechanism); the *only* genuinely new rule needed is the drain-order
tiebreaker for independently-queued producer/consumer pairs, which is the same
"writes before terminal reads" principle that already orders the down-phase before
the effect flush (§8). Sequential read-back is forced (the alternative silently
drops events), and falls out of the §4 write path running per entry — not a
special mechanism. Termination of the sync phase is bounded by the build-time
cycle check (§8.5.2) and the cascade cap (§8.5.4).
**Process note.** First parallel-stream escalation. Stream 1 correctly *surfaced*
the ambiguity but under-classified it as implementation-level; architect reclassified
it as contract-level (touches a locked invariant) and ratified. Calibration for
streams: anything that affects what a computation observes, or that touches a
locked invariant (§1), is contract-level and escalates — even if it feels like a
scheduler detail.
**Status.** Locked. Contract §8.7, §12.22, v0.4.

### 2026-06-15 — §12 conformance suite passing (27/27); runtime implementation complete
**Decision.** The v0.4 contract §12 conformance suite passes in full. Three bugs
surfaced and fixed during implementation:

1. **BFS tail-mutation (propagate Phase 2).** `next = cur._markNext` was captured
   *before* processing observers. When `cur` was the queue tail, `enqBFS` during
   processing wrote into `cur._markNext`, but `next` had already captured `null`,
   terminating the BFS after one node. Fix: read `next` *after* the observer loop.
   Wide fanout (§12.5) didn't catch this because its nodes have no further observers;
   deep chain (§12.4) did. Escalation note: this is a core-walk correctness bug but
   does NOT touch a §1 invariant independently — it caused wrong transitive marking,
   which manifests as stale values, which is a glitch-freedom failure (§1.2). Could
   be classified contract-level by that reading; noted for calibration.

2. **drainSyncPhase inner-while infinite loop.** The inner `while (syncQHead !== null)`
   loop ran unbounded because processing a sync re-queued another sync (cyclic pair).
   The cascade cap counter incremented only in the outer loop. Fix: process *one entry
   per outer iteration* — both reactive syncs and external entries. Cap now fires
   correctly on cyclic and cascade scenarios (§8.5.4, §12.12).

3. **§12.20 test design.** `A.set(1)` + second flush caused the effect to re-run,
   calling the inner handler a second time via normal mechanics (not re-entry). The
   no-re-entry property is demonstrable in one flush. Removed the second trigger.
**Rationale.** Correctness bugs surfaced during implementation rather than design
are expected at this stage; the contract's §12 suite exists specifically to catch
them before the perf phase. Bug 1 (BFS tail-mutation) is worth noting for
escalation calibration: it caused stale values under the right graph shape, which
is a glitch-freedom failure (§1.2), but the root cause was a loop ordering error
rather than a semantic ambiguity — reasonable to handle in-stream. Bug 2 was a
pure implementation error with no spec interaction. Bug 3 was a test design
mistake, not a runtime bug.
**Status.** Stream 1 correctness phase complete. Contract v0.4.

### 2026-06-15 — Architect review of runtime + conformance (hardenings + coverage gaps)
**Decision.** Reviewed `core.ts` and `conformance.ts` against contract v0.4. Verdict:
implementation is sound and contract-faithful — iterative up-walk, BFS propagate,
reconcile-in-`finally`, error routing, and the two prior bug fixes (BFS tail-mutation,
`drainSyncPhase` one-per-iteration cap) are correct. Two correctness *hardenings* and
a set of conformance *coverage gaps* identified; all are Stream-1 work, **no contract
change**. Handed to runtime as `handoff-to-runtime-review`.
- **Hardenings:** (A1) enforce `sync` target is a Signal — runtime currently permits
  writing `.value` on a Derived target, silently corrupting it; add a `KIND_SIGNAL`
  guard in `nodeSet`. (A2) document/assert the `currentObserver` save-restore invariant
  in `resolveTarget` so a future edit can't leak a dependency onto the conditional-target
  thunk (not a bug today; fragility).
- **Coverage gaps (starred = close before declaring correctness-complete):** ★graph
  fuzzer asserting run-once + no-leak across random seeded graph shapes (the highest-value
  add, because the next phase is tuning and hand-written tests structurally miss the
  invariant-violation bug class); ★deep/nested disposal totality; ★`untrack` severs
  tracking (primitive currently untested directly); ★diamond-under-batching; `onCleanup`
  LIFO + pre-recompute disposal order; `sync` map-form on a reactive source;
  `equals:false` on a derived; (judgment) batch+effect-write+`flushSync` interleave.
**Rationale.** The suite faithfully covers all 23 checklist items but tests *named
scenarios*, not *invariants under varied shapes*. That distinction is acceptable for a
provisional correctness baseline but not for entering perf tuning, where refactors
introduce exactly the run-once / stale-edge / leak violations a property fuzzer catches
and fixed scenarios do not. The two hardenings close runtime gaps where the contract
states a guarantee (§8.5 target-is-signal) that the implementation did not enforce.
**Process note.** Architect flags, runtime implements — review did not edit `core.ts`/
`conformance.ts` directly. Softened the "27/27 = complete" implication in Current State
so a future session does not over-trust the green checkmark.
**Status.** Resolved 2026-06-15 — all hardenings and gaps landed and verified; see
closing entry below.

### 2026-06-15 — Architect review CLOSED: hardenings + coverage landed, fuzzer tightened
**Decision.** The review opened in the prior entry is closed. Everything flagged was
implemented by the runtime session and independently verified by the architect by
running the suite (sandbox, deterministic):
- **Hardenings:** (A1) `nodeSet` now throws if a `sync` target is not `KIND_SIGNAL`,
  closing the silent-Derived-corruption path the contract (§8.5) forbade but the
  runtime permitted. (A2) `resolveTarget` carries an explicit invariant comment that
  it must not create dependency edges (the save/restore around the conditional-target
  thunk is load-bearing).
- **Coverage:** all starred and unstarred gaps landed — property fuzzer (run-once +
  no-leak, 200 seeded graphs), deep/nested disposal totality (§B2), `untrack` severs
  tracking (§B3), diamond-under-batch (§B4), `onCleanup` LIFO + pre-recompute disposal
  (§B5a/b), `sync` map-form on a reactive source (§B6), `equals:false` on a derived
  (§B7), and the batch+effect-write+`flushSync` interleave (§B8, which had been marked
  deferrable but was completed).
- **Fuzzer tightening (done now, not deferred):** the run-once assertion was upgraded
  from a coarse total-count bound (`recomputes ≤ node count`) to **per-node** (`each
  node ≤ 1 recompute per propagation`), measured in a window opened after initial
  compute, with a second pull asserting no recompute-on-read. Crucially, the fuzzer now
  pulls **deepest-first** so interior nodes resolve via CHECK up-walks rather than the
  DIRTY early-return shortcut.
- **Final state:** 36/36 passing, deterministic across repeated runs.
**Rationale.** The per-node + deepest-first combination was validated empirically, not
assumed: the architect prototyped the instrumentation, planted an interior
double-recompute bug, and confirmed (a) the coarse total-count assertion passed the
bug — a real false-negative — while (b) the per-node assertion *with deepest-first
pull* failed it. The per-node counter alone was insufficient: with forward-order pulls,
buggy interior nodes hit `updateIfNecessary`'s DIRTY early-return and never enter the
frame-loop where the bug lived, so the fuzzer missed it (only the hand-built diamond
tests caught it). Pull order is therefore a correctness property of the fuzzer, not a
style choice — recorded so a future "simplification" back to forward-order does not
silently reopen the gap. Instrumentation is a module-level `WeakMap` gated by a boolean,
JIT-removable in production, no `Node` struct field, no hot-path cost.
**Process note.** This closes the first full architect-review loop end to end:
flag (architect) → implement (runtime) → independent re-verification (architect ran the
suite and a planted-bug test, did not trust the green checkmark or edit the code
directly). Correctness phase for Stream 1 is now on an accurate footing; the run-once
invariant is pinned at the granularity that protects the upcoming perf-tuning phase,
where run-once / stale-edge / leak regressions are most likely to be introduced.
**Status.** Closed. Stream 1 correctness phase complete and verified; ready for perf
tuning (Claude Code — real-hardware benchmarking) when chosen.

### 2026-06-15 — Compiler steps 1–2 CLOSED: sync-correctness layer built and verified
**Decision.** The compiler stream's foundation — the `sync`-correctness layer — is
complete and architect-verified. This is distinct from the §10 specialization layer
(step 3+), which is the stream's actual novel thesis and has not started.
- **Step 1 — `sync`-target classification (§8.5.3, §10 row 1).** Classifies every
  `sync` target as ACCEPT (provably enumerable, carries target set) / REJECT
  (provably non-enumerable, directs to `effect`) / UNDECIDABLE (conservative
  default = force effect, §8.5.3 option a). Files: `syncTargetClassifier.ts`,
  `signalTypeUtils.ts`, `types.ts`, with tests. 21/21.
- **Step 2 — write-graph cycle checker (§8.5.2).** Analyzes each `sync` source for
  reactive reads, builds the global directed write-graph, runs three-color DFS cycle
  detection, returns structured `CycleReport[]`. Files: `writeGraphCycleChecker.ts`
  + tests. 20/20.
**Architect rulings applied (in-stream, no contract change):**
- (Step 1) **Nominal** nv-signal detection required, not structural — a structural
  false match would corrupt the write-graph the cycle checker consumes. Verified
  against a real lookalike: a user type shaped `() => T; set(v)` is correctly NOT
  classified as nv.
- (Step 1) Element-access **literal keys resolve to enumerable** targets
  (`signals["submit"]`), not blanket-UNDECIDABLE — precision matters because
  accepting-the-provable is the classifier's job.
- (Step 2, Q1) Reads inside `untrack()` **and** the reduce-form `current` are
  excluded from source reads. The reduce form is safe by construction because the
  checker walks only the *source* argument, never `compute`; a genuine cycle (source
  reactively reading its own target) is still caught. Both directions verified.
- (Step 2, Q2) Cycle checker **returns `CycleReport[]`**; throwing/build-error policy
  is left to a separate reporting layer. Consistent with the classifier's
  return-structured-verdicts shape; surfaces all cycles at once; lets the caller
  choose severity.
**Verification & defect found.** Architect ran both suites against the real files
(41/41) and probed adversarial cases through the suite's single-`ts.Program` harness.
One real defect surfaced **only** under `tsc --strict`: `isUntrackedCall` was missing
the `ts.isIdentifier(callee.name)` guard that `isSyncCall` has, making `callee.name`
(`MemberName`) unassignable to `Identifier | null` — the file did not compile under
strict, though `tsx` ran it green. Fixed (one line, mirroring `isSyncCall`); all four
compiler files now strict-clean, suites still 41/41, untrack-exclusion and
genuine-cycle detection both re-verified intact.
**Process note (institutionalized).** `tsx` strips types and does not enforce strict
checking, so a green suite does not imply a clean compile. `tsc --noEmit --strict` is
now a standing compiler-stream gate, separate from the test run (recorded in Current
State). Same shape as the runtime stream's "tests green ≠ benchmark validated."
Also: any harness combining the classifier and cycle checker must use the **same**
`ts.Program`/checker instance, or cross-program type queries silently return nothing
(an architect probe hit this and chased it to ground rather than report a phantom bug).
**Status.** Closed. Compiler steps 1–2 complete and verified, strict-clean. Clear to
proceed to step 3 (equality-policy inference, §7.1 / §10 row 2) — the first
*specialization* hook.

### 2026-06-15 — Compiler step 3 CLOSED: equality-policy inference (first specialization hook)
**Decision.** Equality-policy inference (§7.1 / §10 row 2) is built and verified —
the compiler stream's first *specialization* hook (steps 1–2 were the `sync`-
correctness layer; this is the first hook that makes a per-node performance-oriented
decision). Files: `equalityPolicyInference.ts` + tests; `types.ts` extended with
`EqualityPolicy`/`EqualityPolicyVerdict`. 45/45, strict-clean.
**What it does.** Infers a per-node `equals` from the node's static value-type
(extracted via `getTypeArguments` on `SignalAccessor<T>`, correct for both `signal`
and `derived`):
- primitives + primitive-only unions → `OBJECT_IS`;
- std-lib mutable-in-place containers (`Array`, tuples, `Map`/`Set`/`WeakMap`/
  `WeakSet`) → `false` (the §7 in-place-mutation footgun: `arr.push(); set(arr)`);
- everything else → DECLINE (leaves runtime default `Object.is`).
Explicit `OBJECT_IS` verdicts are emitted (not silent no-ops) so "analyzed" is
distinguishable from "never looked," enabling future conflict detection.
**Architect rulings applied (in-stream):**
- **`readonly` containers (`ReadonlyArray`, readonly tuples) → DECLINE.** `readonly`
  is erasable at type level, not a runtime guarantee; can claim neither `OBJECT_IS`
  (unproven immutability) nor `false` (unknown intent). The *inverted conservatism*
  vs. the sync classifier: here erring toward the `Object.is` default is safe EXCEPT
  for in-place mutation, where "do nothing" suppresses updates (a wrong result). The
  load-bearing rule, written into the file header: when immutability can't be proven,
  DECLINE — never `OBJECT_IS`.
- **Std-lib container detection is origin-verified**, not name-based:
  `isStandardLibDeclaration` uses `normPath(dirname(getDefaultLibFilePath))` as a
  directory prefix, so a user-defined `class Map` correctly → DECLINE, not `false`.
  Verified adversarially.
- **`STRUCTURAL` deferred** (recognized, not emitted) — a benchmark hypothesis per
  the §10 hard rule; whether injecting a structural compare beats `Object.is` is a
  real-hardware question for Claude Code.
**Explicit-`equals` deference — found over three review rounds, final design.** A
specialization must never override a user's explicit `equals` (overriding it changes
observable behavior — a wrong-result bug, the stream's escalation tripwire). Initial
fix covered only the property-assignment literal form; architect probing surfaced
that shorthand `{ equals }`, spread `{ ...opts }`, and — the realistic one —
non-literal options (`const opts = { equals }; signal(arr, opts)`) all bypassed it.
Final design is two-layer:
- **AST layer** for direct object literals — matches property-assignment, shorthand,
  and any spread (spread → DECLINE conservatively, can't prove it lacks `equals`);
- **type layer** for non-literal options — `getProperty('equals')` present (incl.
  optional), or type is `any`/unresolvable → DECLINE.
Asymmetry rule decides ambiguity: can't prove `equals` absent → DECLINE. Critically,
it does **not** over-correct — non-literal options *without* `equals` still infer
normally (a specific `equals`-property check, not "any non-literal defers"). Verified
both directions.
**Known precision gap (fails safe).** Aliased nv imports (`import { signal as s }`)
are not analyzed — the text pre-filter keys on the call-site identifier, consistent
with steps 1–2. A renamed import → not analyzed → runtime default. Costs
specialization, never correctness. Noted for the renderer/codegen stream.
**Process note.** Three rounds of "is there really nothing to add" each found a real
layer (explicit-equals override → literal forms → non-literal options). Green tests
covered only the forms someone thought to write; architect probing past the
checkmark surfaced the root cause and drove the principled AST-for-literals/
type-for-non-literals design. Same pattern as the runtime fuzzer and the
`tsc --strict` catch.
**Status.** Closed. Step 3 complete and verified. Next: branch-variant dependency
sets (§10 row 4) — the hardest hook, where the dynamic-correctness invariant (§1.4)
is most at risk; architect check required before it is called done.

### 2026-06-17 — Compiler step 4 CLOSED (compiler side): branch-variant dependency sets
**Decision.** Branch-variant dependency-set analysis (§10 row 4) is built and
verified on the compiler side. This was the highest-risk hook — the only one whose
naive failure mode is a silent wrong result (declare a read-set narrower than reality
→ runtime skips a real dependency → node stops updating, violating §1.4). Files:
`branchVariantAnalyzer.ts` + `branchVariantAnalyzer_test.ts`, `variantRuntimeHarness.ts`
+ `branchVariantRuntime_test.ts`; `types.ts` extended with `BranchVariantVerdict`.
Analyzer 21/21, runtime harness 7/7, strict-clean.
**Process — gated soundness design first (different from steps 1–3).** Because a
wrong design here passes its tests and still ships a correctness bug, the soundness
design (`step4-soundness-design.md`) was written and **architect-reviewed before any
analysis code**. The review approved it and locked scope via three escalation rulings.
**The decision that de-risked the whole hook.** The session chose to **keep the
tracking context on** and use the declared union only as an *expected-reads oracle*
for cheaper reconciliation — never as a replacement for tracking. Consequence: the
runtime never relies on the declared set to know what was read; `reconcileEdges` (in
the `finally`, §5.4.1) remains the sole authority over edges, which always reflect
*actual* reads. A wrong/narrow declared union can therefore only cause redundant
reconciliation work, never a missed edge — collapsing the §1.4 correctness risk to a
pure performance question, exactly where the §10 hard rule wants it. The session
reached this itself and explicitly declined to build the dangerous "skip-tracking"
variant.
**Scope locked (architect rulings E1/E2/E3):**
- E1 — logical `&&`/`||`/`??`: treated as ordinary binary, folded into the union (no
  short-circuit awareness). Under union-only they fold to the same set, so special-
  casing adds nothing; per-branch awareness would only pay off with E3, deferred.
- E2 — **conservative only**: tracking stays on, union used for cheaper reconciliation.
  The aggressive skip-tracking path is a different hook with a different soundness
  proof (it reintroduces the missed-edge failure mode) — out of scope, future gated
  design if benchmarking ever justifies it.
- E3 — **union-only**: per-branch variants deferred (they require pre-evaluating the
  condition before tracking — a reordering with its own correctness questions).
**Analyzer specifics.** All-or-nothing rule (any unanalyzable sub-expression →
DECLINE whole body); `Math.max(a(),b())` safe (non-nv callee, direct signal args) vs.
`computeVal()` opaque (may read signals via closure) → decline; untrack subtree
skipped; cross-boundary parameter signals → decline; shared `signalSymbolId` so a
signal in a declared union and the same signal in a `sync` target/source produce
identical identity.
**Verification.** Architect ran both suites and adversarially fed a deliberately-wrong
narrow union (`{cond,a}` for `cond ? a : b`): confirmed the result stays correct on
the flipped branch, divergence flags, and the omitted edge (`b`) is established by
reconciliation so a later `b.set()` still updates — proving the missed-edge failure
mode is structurally prevented, not merely untested.
**Integration boundary (deferred — runtime stream / Claude Code).** The runtime
mechanism is proven against a faithful *model* (`variantRuntimeHarness.ts`: tracking-
always-on, fresh `_sources` each run, reconcile in `finally` by actual reads, union as
oracle only), NOT the real `core.ts` (which uses three-state coloring / up-walk; the
model uses a `_dirty` boolean). The property under test lives entirely in edge-
reconciliation-by-actual-reads, which the model reproduces faithfully, so the soundness
proof holds for that property. But wiring the `_compilerSources` §10 hook into the
actual core and re-running the property + soundness tests against it is a separate
**runtime-stream integration task** (Claude Code), not yet done. Recorded so the green
model tests are not mistaken for real-core integration.
**Status.** Closed (compiler side). Steps 1–4 of the compiler stream complete and
verified. Remaining §10 hooks: eager/lazy bias (row 3) and wide-fanout grouping
(row 5) — performance-defined, scaffold-in-sandbox / decide-in-Claude-Code; disposal
scope (row 6). Plus the deferred real-core variant integration above.

### 2026-06-17 — Renderer/templating stream opened; Template IR v0.2 approved
**Decision.** The renderer/templating workstream (stream 3) is opened. The Template
IR design (`nv-template-ir.md`) is approved at **v0.2** after architect review (gated-
design discipline, same as the step-4 soundness design — no front-end/back-end code
until the IR contract was reviewed). PoC implementation may begin.
**Architecture (the resolved-syntax decision).** The JSX-vs-single-file fork was
dissolved into one architecture: one template language (HTML-superset + a small set
of binding forms), one shared Template IR, two front-ends producing it (`.nv` file
with `{}` delimiters as primary ergonomic mode; tagged-template `` html`...` `` with
`${}` as no-build/drop-in mode), two back-ends consuming it (runtime interpreter;
compiler-emit). The front-end is just *where the template string comes from* +
delimiter choice, erased before the IR. This is the established parse → IR → multi-
backend shape (Vue Vapor is prior art; verified during review).
**IR contract confirmed.**
- Static/dynamic split: `TemplateShape` = static HTML + `NodePath[]` (positional
  binding addresses; `<!--nv-->` comments are debug-only, `NodePath` is the
  authoritative locator — no runtime sentinel scanning). Instantiation = one
  `cloneNode` + one walk per path; all subsequent reactivity lives in `effect`
  closures.
- Six PoC binding kinds (TextBinding, AttrBinding, PropBinding, EventBinding,
  ChildBinding [primitives only], ConditionalBinding). ListBinding + SyncBinding
  designed-and-deferred. Out of v0: ComponentBinding, SSR, Shadow DOM, store.
- **Primitive mapping (Q5 confirmed — no contract violations).** All PoC DOM-
  mutation bindings → `effect` (a DOM write is a side effect). `derived` absent
  from binding plumbing (would violate ironclad purity). `sync` reserved for
  SyncBinding's DOM→signal write-back only (external pubsub source path, §8.5–8.6).
  EventBinding setup is imperative (`addEventListener` + `onCleanup`).
- Disposal: each mounted region = one `createRoot` scope (§6); ConditionalBinding
  branches get their own roots bridged to parent via `onCleanup`. No-leak assertable
  via `__test` edge inspection (reuses the contract's §12.6 check).
- Front-end equivalence (Invariant FE): both front-ends produce structurally
  identical IR; delimiters/source spans erased before the IR.
- Back-end equivalence (Invariant BE): "compiler = interpreter partially evaluated"
  + a differential conformance suite as mechanical enforcement.
**Four fold-ins from arch review (applied in v0.2):**
1. `handlerKind: 'stable' | 'reactive'` added to EventBinding. v0 always emits
   `'reactive'` and always uses the wrapper-effect; the skip-effect optimization for
   `'stable'` is a deferred performance hypothesis (§10 hard-rule precedent from
   step 3 — design the field now, defer the optimization to benchmark).
2. TC-09 added to the corpus: a non-primitive ChildBinding value must **fail
   identically in both back-ends** in v0. Closes the drift gap at the ChildBinding-
   node boundary; the test flips to "asserts identical node handling" when that case
   is implemented.
3. Differential suite switched from `outerHTML` string comparison to **structural
   DOM comparison** (node type, tag, attributes-as-a-set/order-independent, text,
   children recursively). `outerHTML` produces both false failures (attribute order,
   whitespace, serialization quirks) and false passes — unacceptable for the sole
   mechanical defense against back-end drift.
4. `writeTargetId?: SignalId` recorded as the agreed SyncBinding field (compiler path
   only), to be built when SyncBinding is scoped. Its SignalId MUST use the same
   `signalSymbolId` derivation as compiler steps 1–2/4, or the §8.5.2 cycle check
   won't connect the renderer's write-back edge to the compiler's write-graph (the
   identical cross-pass identity seam that has applied at every compiler step).
**Implementation order (stream 3):** (1) tagged-template front-end → IR; (2) runtime
interpreter back-end → jsdom DOM + live bindings; (3) differential conformance suite
(TC-01–TC-09) alongside the interpreter; (4) compiler back-end deferred, pending
interpreter proof + seam agreement with stream 2. Both gates as always
(`tsc --noEmit --strict` + tests, separate).
**Status.** Closed (IR design, v0.2). Implementation open.

### 2026-06-17 — Renderer interpreter slice (Text + Attr) landed; core strict-typecheck defect surfaced
**Decision.** The renderer's minimal-slice interpreter implementation is complete and
architect-verified. Scope: the whole pipeline (tagged-template front-end → IR →
runtime interpreter → differential suite) on two binding kinds, TextBinding and
AttrBinding — proving the *seams* before building the remaining four bindings on the
shape. Files: `ir.ts`, `htmlTag.ts`, `interpreter.ts`, `comparator.ts`,
`interpreter_test.ts`. 16/16 (TC-01/02/07/09), strict-clean (against the patched core,
see defect below).
**Verified by architect (ran the suite + adversarial probes).**
- Pipeline is genuinely end-to-end, not stubbed at a seam.
- **No-leak proven in the strong form:** a signal write *after* disposal leaves the
  DOM untouched — the binding effect is severed, not merely counter-zeroed. (The
  suite's `observerCount → 0` is corroborated by this behavioral check.)
- **Owner-tree wiring is §6-correct:** binding effects are created inside the region's
  `createRoot`, so `currentOwner = root` → automatic `addChild`, no manual edge
  tracking; disposal runs cleanups LIFO then severs observer edges. ConditionalBinding
  wiring (branch `createRoot` + `onCleanup` bridge) implemented per IR §3.6, not yet
  tested (out of slice scope).
- Two real renderer defects caught and soundly fixed: a `buildHtmlStrings` stray-quote
  bug (leading-quote consumption only handled in the past-holes branch → broke
  attr-hole-then-text adjacency) and the core TS6 issue below.
**Design constraint confirmed (not a defect).** The front-end requires attribute holes
to be **quoted** (`class="${x}"`); unquoted holes and partial-value interpolation
(`class="p ${x}"`) are unsupported in v0 and documented in `htmlTag.ts`. All TC tests
use the quoted form. (Minor deferred DX: unquoted attr fails with "could not locate
sentinel" rather than a directed message.)
**jsdom-vs-browser flags (correctly raised, not coded around).** `<template>`/
`innerHTML` parsing (jsdom parse5 vs. platform parsers) and the regex-based sentinel
strip are flagged for Claude Code validation, not assumed.
**Cross-stream defect surfaced — `core.ts` not strict-clean with the DOM lib present.**
The interpreter imports `core.ts` alongside the DOM lib, which surfaced two `TS7022`
loop-variable errors (≈ lines 285, 679): the nv-local `interface Node` collides with
the DOM global `Node`, so `Node | null` annotations resolve to DOM `Node` and collapse
to `never`. The underlying code is correct — purely a TS inference limitation from the
name collision. Same two errors were visible-but-unexplained in the step-2 compiler
review; the renderer is the first DOM-adjacent consumer to hit them for real. **Routed
to the runtime stream**: rename the nv-local `interface Node` (resolves both sites at
source); the renderer's `@ts-expect-error` `core_ts6_patched.ts` is a temporary unblock
to be retired once the rename lands. Recorded under Known Issues. Lesson: core was only
strict-checked *without* the DOM lib in scope — strict-with-DOM-lib is now a required
runtime gate, since renderers import core alongside DOM types.
**Status.** Slice closed and verified. Renderer proceeds to `prop`/`event`/`child`-
primitive/`conditional` on the proven shape. Runtime stream owns the core `Node`-rename.

### 2026-06-17 — core.ts DOM-lib strict defect resolved (Node → ReactiveNode rename)
**Decision.** The cross-stream defect from the renderer-slice entry is resolved at the
source. The runtime stream renamed the nv-local `interface Node` to `ReactiveNode`
throughout `core.ts`, eliminating the name collision with the DOM global `Node`. Both
`TS7022` loop-variable errors (≈ lines 285, 679) are gone — not suppressed.
**Verified by architect.** Typechecked `core.ts` under `--strict` *with `lib: DOM` in
scope* (the exact configuration that produced the errors): zero errors. Ran conformance:
36/36 still green, confirming the rename was behavior-neutral (mechanical type-name
change, no semantic effect; `__test` surface unaffected).
**Institutional close (better than the minimal fix).** Two tsconfigs were added/updated
so the gap that hid the defect cannot recur: `tsconfig.json` (build) and
`tsconfig_check.json` (`noEmit` typecheck gate) both set `strict: true` +
`lib: ["ES2022", "DOM"]`. Strict-with-DOM-lib is now the standing configuration —
previously core was only strict-checked *without* the DOM lib, which is why a
DOM-global collision went unseen. This also formalizes the long-standing "tsc --strict
is a gate separate from running tests" practice as a checked-in config.
**Remaining (renderer stream).** The renderer's temporary `core_ts6_patched.ts`
(`@ts-expect-error` workaround) is now obsolete; renderer re-points its import to the
real `core.ts` and deletes the patched copy. Tracked under Known Issues until confirmed.
**Supersedes** the "routed/pending" status in the 2026-06-17 renderer-slice entry.
**Status.** Resolved. Core strict-clean with DOM lib; conformance green; gate
configuration checked in.

### 2026-06-17 — Renderer interpreter complete: all six PoC bindings (prop/event/child/conditional added)
**Decision.** The remaining four PoC bindings are implemented onto the proven
Text+Attr pipeline shape, completing the renderer interpreter back-end for the PoC.
Build order was easiest-to-§6-heaviest (prop → event → child → conditional), each
landed before the next. 34/34, strict-clean with the DOM lib in scope, against the
real renamed `core.ts`.
**The four bindings.**
- **PropBinding:** `effect` writing a DOM property (`el[prop]`); clean extension of
  AttrBinding.
- **EventBinding:** imperative `addEventListener` + `onCleanup` removal; wrapper-effect
  always; `handlerKind: 'stable' | 'reactive'` field present, v0 always `'reactive'`,
  the skip-effect optimization for `'stable'` deferred (step-3 precedent: design the
  field, defer the optimization to benchmark). jsdom event-dispatch semantics flagged
  for Claude Code validation; not coded around.
- **ChildBinding (primitives):** primitive → text node at the comment anchor.
  Non-primitive (DOM Node / TemplateIR) values rejected with a directed error
  (TC-09 pins identical rejection). **Update semantics decided deliberately:** updates
  the existing text node's `.data`, not node-replacement (the observable behavior is
  now spec, per interpreter-is-ground-truth).
- **ConditionalBinding (the §6-heavy one):** each branch mounts in its own
  `createRoot`; on condition flip the old branch's root is disposed (effects severed,
  DOM removed) before the new branch mounts; a bridge `onCleanup` tears the branch down
  on parent-region disposal.
**Verification (architect ran the suite + adversarial probes).**
- 34/34 green; strict-clean with `lib: DOM` in scope; renderer + real core typecheck
  together cleanly.
- **Flip-many-times no-leak (the required property test):** suite has TC-06e/f at
  N=20 (exactly-2-childNodes each flip; 0 observers after dispose). Architect pushed to
  **1000 flips**: max childNodes never exceeded branch+anchor (no DOM accumulation),
  observer count on the condition signal stayed 1 while live and 0 after dispose (no
  per-flip subscription/cleanup accumulation — the bridge-`onCleanup`-stacking risk was
  checked and does not occur; the effect's cleanup cycle clears per-run registrations).
- Adversarial severance confirmed: TC-06g (post-flip write to old branch → DOM
  unchanged) and TC-06h (parent dispose while branch mounted → full cleanup).
**Harness lesson (recorded in Current State).** The interpreter's effects are
async-scheduled; any test or probe must `flushSync()` after a signal write before
asserting DOM state. The suite does this; ad-hoc probes that omit it produce spurious
"never subscribes / DOM accumulates" results (architect hit this and chased it to
ground rather than report a phantom bug — same discipline as the step-2 single-program
harness lesson).
**Status.** Renderer interpreter back-end functionally complete for the PoC. All six
binding kinds work end-to-end against the real core. Next: the PoC coherence gate
(counter + derived label + conditional, proving runtime + renderer compose; build-time
cycle rejection via compiler; no-leak disposal) is now mostly sandbox-reachable — only
real-browser confirmation needs Claude Code.

### 2026-06-18 — PoC coherence gate CLOSED (sandbox portion); Stream 5 integration verified
**Decision.** The PoC integration stream (stream 5) built `poc_integration.ts` and
proved the four PoC gate criteria that are sandbox-reachable. 15/15, strict-clean
(`tsc --noEmit --strict`, DOM lib in scope). Architect independently ran the suite
against the real project files and reproduced the load-bearing claims rather than
trusting the green result. The one remaining ROADMAP gate item — real-browser
confirmation — is explicitly NOT claimed from a jsdom result; it is the Claude Code
handoff.
**What was built.** A single integration file consuming runtime, compiler, and
renderer as **fixed completed artifacts** — no component modified. Example: `count`
(signal) + `label` (derived reading count) + a ConditionalBinding switching high/low
spans, rendered via the interpreter into jsdom. TemplateIR constructed manually
against the IR contract (the correct authoring seam). This is the integration
stream's defining discipline: it owns only the example + gate assertions.
**Gates (architect-verified).**
- **Gate 1 — compose:** signal writes (count 0→5→2) flow through derived → bindings
  → DOM; conditional flips low↔high correctly; no intermediate values visible
  (glitch-free, §1.2). `flushSync()` between write and assertion (standing harness
  lesson, correctly applied).
- **Gate 2 — build-time cycle rejection:** `sync(()=>b(),a) + sync(()=>a(),b)`
  fixture → classifier 2 ACCEPTs, cycle checker CycleReport (length 2, names syncs);
  acyclic fixture → 0 reports. Single-`ts.Program` pattern (step-2 lesson).
- **Gate 3 — no-leak (architect reproduced exact counts independently):** pre-dispose
  `observerCount(count)=3` (count-text effect + label derived + conditional effect),
  `(label)=1`; post-dispose `(label)=0` (mount effects severed), `(count)=1` — the
  module-scope `label` derived correctly outlives the mount (created outside the
  mount's `createRoot`, owner=null). Verified the survivor is genuinely the label
  derived: `label()` still reflects a post-dispose `count.set(99)`. Adversarial
  post-dispose write leaves DOM untouched; flip-then-dispose leaves zero leaked edges.
  This is precise §6 behavior — disposal severs exactly the mount's effects, nothing
  module-scoped.
- **Gate 4 — seams only:** import audit confirms only §11 primitives
  (`signal/derived/flushSync/__test`), the IR contract (`mount`/`TemplateIR`), and
  compiler public APIs (`SyncTargetClassifier`/`WriteGraphCycleChecker`/
  `ClassifierConfig`/`TargetVerdict`) cross the boundary. No internals.
**Composition finding — no stream defect, but a real (benign) repo-wide inconsistency
surfaced.** The integration session correctly identified that the compiler files use
extensionless imports while renderer/core files use `.ts` imports, and bridged it with
a CommonJS/node-resolution poc tsconfig rather than touching either stream's files
(the right call per the don't-fix-other-streams mandate). Sharpening the session's
framing: this is not merely a poc-local module-resolution choice — it is a latent
**repo-wide import-style divergence**. Each stream's own tsconfig tolerates its style,
but there is not yet *one* config under which the whole codebase compiles. No defect
(both styles work, code correct), but the Claude Code convergence (one shared build)
must settle on one import style repo-wide. Recorded under Known Issues as a non-urgent
cleanup.
**No composition bug** — all three streams composed cleanly at first integration,
which is the substantive result: the contract-as-seam discipline held end to end.
**Claude Code handoff (sandbox now exhausted for Phase 0).** Remaining work all needs
real hardware or a real browser: runtime perf tuning (alien-signals baseline; the two
named deferrals); compiler beats-baseline validation for steps 3–4, the two
perf-defined hooks (eager/lazy, wide-fanout), and wiring `_compilerSources` into real
`core.ts`; renderer real-DOM behavior + the compiler back-end for the IR; and the PoC
final gate (real-browser interaction). These converge against one shared runtime in
Claude Code.
**Status.** Sandbox PoC closed and verified. No contract change; no version bump.
ROADMAP Phase 0 sandbox-completable work is exhausted.

### 2026-06-18 — Three pre-existing defects fixed during repo migration; contract → v0.4.1
**Context.** During the Claude Code repo assembly, a fresh reviewer surfaced defects in
the original source that the migration had carried through unchanged. The architect
verified all of them **empirically** (re-ran the exact probes that characterize each
boundary against the fixed code), not by reading. The migration "no logic changes" rule
was correctly overridden: that rule prevents *introducing* drift, not *preserving*
pre-existing bugs. Two are contract-level (decision-log + contract entry); one is
in-stream; one is a public-surface correction.

**C1 (contract-level) — classifier could emit a partial ACCEPT. RESOLVED.**
`sync-target-classifier.ts resolveFunctionBody`: a block-body conditional thunk
`() => { if (c) return sigA; return sigB }` returned only the *first* return expression
found (`sigB`), silently dropping `sigA` from the ACCEPT target set. An incomplete
target set means the write-graph misses the edge to `sigA`, so a cycle through `sigA`
goes undetected at build time — violating the conservative-on-incompleteness invariant
(§8.5.3 / the `TargetVerdict.ACCEPT` contract: the classifier must never assert a
target set it has not fully proven). Fix: bail to `null` (→ UNDECIDABLE → effect) on
any non-`ReturnStatement` in a block body, on both the arrow and function-expression
paths. **Verified:** the `if/return` block now yields UNDECIDABLE; the concise ternary
`c ? sigA : sigB` control case still correctly yields `ACCEPT {sigA, sigB}` (fix is
precise, does not over-decline).
*Architect correction:* the original step-1 review mischaracterized this as "fails safe
to UNDECIDABLE." It did not — it returned a partial ACCEPT, the one unsafe outcome. The
review reasoned about the block-body path instead of running it. The fresh-reviewer
catch is exactly why a second pass on migrated code was worth it; recorded as an
escalation-calibration lesson (reason-vs-run).

**I2 (contract-level) — cascade cap conflated reactive depth with external-event count.
RESOLVED; contract §8.5.4 clarified, → v0.4.1.**
`core.ts drainSyncPhase` counted reactive sync nodes and external `pubsub` entries in a
single counter capped at MAX_CASCADE. A burst of ≥100 synchronous `publish()` calls (no
cycle) exhausted the cap: only 100 landed, the rest were silently dropped with a
spurious cap error. A burst of external events is a normal workload (rapid input, a
socket flushing) — this was silent data loss. Fix: **two separate budgets** — a
reactive-cascade budget (MAX_CASCADE, reactive sync nodes only, the cycle/runaway guard)
and a larger external-event safety budget (runaway external feedback only). **Verified:**
150 external events all land; a pathological external A↔B republish feedback loop still
terminates via the safety budget (does not hang). **Contract change:** §8.5.4 rewritten
to specify the two-budget *property* (external draining must not be bounded by the
reactive-cascade budget; both runaway modes must terminate). The specific multiplier
(implementation uses 10×) is explicitly an implementation tuning constant, **not** a
contract-committed value — the contract pins the separation (the correctness-relevant
guarantee, since conflation drops events = wrong result), not the magnitude. Contract
bumped v0.4 → **v0.4.1**.

**I1 (in-stream) — cascade cap off-by-one. RESOLVED.**
A cascade of exactly MAX_CASCADE rounds completed its work but spuriously fired the cap
error and nulled the queues (`iterations >= MAX_CASCADE` / `cycles >= MAX_CASCADE` after
the boundary round). Fix: `> MAX_CASCADE` (and `cycles <= MAX_CASCADE` loop bound) so
exactly-MAX_CASCADE settles cleanly and only >MAX_CASCADE is flagged. **Verified:** N=100
chain completes with no cap; N=101+ caps. Pure off-by-one, no contract impact.

**EnumResult barrel over-export (public-surface) — RESOLVED.** `EnumResult` (an internal
enumeration result type) was exported from `src/compiler/index.ts`'s public API. Removed
before first publish (adding it back later would be a breaking change; removing an
internal type from the public surface now is free). `ReadEnumResult` correctly remains —
a distinct, legitimately-public type.

**Regression check.** 36/36 conformance passes against the patched core — the I1/I2 core
changes are behavior-neutral except at the boundaries they corrected.

**Minors tracked as follow-up (non-blocking):** the integration PoC's Gate-4
`expect(true).toBe(true)` structural-intent placeholder (should get a clarifying comment
so it is not mistaken for a real assertion) and the `expect(!expr).toBe(true)`
double-negations in compiler tests. Test-hygiene only; no correctness impact.

**Status.** All four resolved and architect-verified by execution. Contract v0.4.1.

### 2026-06-18 — Authoring-surface read/write ergonomics pinned (bare-read + mutation-write via compiler erasure); runtime core stays explicit call-to-read

**Decision.** Pin the read/write *syntax* answer to the compile-vs-runtime split, for
the read/write transform specifically (the general split remains open for other
concerns — see Status):

- **Runtime core (`core.ts`, the DOM-free agnostic layer): explicit call-to-read,
  explicit `.set()`-write, permanently.** Signals are getter functions; reading is
  `count()`, writing is `count.set(v)` / the `nodeSet` path. This is not an ergonomic
  compromise — the read *call* is the mechanism by which `trackRead` attaches a
  dependency edge to `currentObserver` (§5.1). A bare variable read has no hook point
  and cannot register a dependency. Every fine-grained system makes the read site do
  something for this reason (Solid `s()`, alien-signals, Preact `.value`, Angular
  signals). The core layer keeps it and does not change.
- **Authoring surface (the `.nv` / tagged-template front-end → Template IR → compiler
  back-end): bare-read and mutation-write ergonomics, produced by compiler erasure.**
  Source authors write `count` (read) and `count = count + 1` (write); the compiler,
  which sees every read/write site statically in the surface it controls, emits the
  `count()` read and the `nodeSet`/`.set()` write into generated code. This realizes
  the locked design thesis ("Svelte's compiler ergonomics — mutation syntax over
  signals … disagree only about syntax, which a compiler erases", 2026-06-15) for the
  read/write transform concretely, rather than as general intent.
- **The boundary is "is there a compile step over this code."** Bare ergonomics exist
  exactly where the compiler is authoritative (templates, `.nv` components, and any
  compiled `.nv.ts`-class surface if one is later defined). Hand-written `.ts` against
  the raw runtime stays call-to-read/`.set()`-write — the same boundary Svelte draws
  (runes in `.svelte`/`.svelte.js`, not arbitrary `.ts`).

**Rationale.** The "do I have to call a function" ergonomic was raised as a preference;
it turns out to be already-decided in spirit (the compiler-erasure thesis) but never
pinned to the read/write transform. Pinning it now matters because the **compiler
back-end for the IR is the next renderer-stream piece** (Current State: "Compiler
back-end still deferred"), and that back-end is exactly what implements the erasure —
it needs this as a target, not a vibe. Reading-bare is the cheap half (static read-site
rewrite). Writing-bare is the harder half: the compiler must detect assignment to a
reactive binding and rewrite to the write path, which is more machinery and is where the
broader compile-vs-runtime split still has to be worked out.

**Scope / what stays open.** This pins *only* the read/write syntax transform and its
boundary. The general "Compile-time vs. runtime split" item (what else is compiled away
vs. shipped — scheduling, encapsulation, etc.) remains open; this entry narrows it, does
not close it. Per-binding write-rewrite semantics, and how mutation-write composes with
`signal`/`sync` write paths, are authoring/compiler-stream design, deferred to that
back-end's design doc.

**Contract impact.** None. The contract governs reactive-core semantics; read/write
*syntax* is an authoring-layer concern above the contract. Verified: v0.4.1 contains no
authoring-syntax language. No version bump. If the write-rewrite later forces a
core-visible change (it should not — it compiles to the existing `nodeSet` path), that
would be a separate escalation.

**Status.** Locked (the read/write syntax boundary). The general compile-vs-runtime split
remains open. The compiler back-end for the IR is the consumer of this decision.
