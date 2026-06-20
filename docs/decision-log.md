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

_Last updated: 2026-06-19 (Contract **v0.4.1** — runtime correctness verified; compiler steps 1–4 closed; renderer interpreter complete [all 6 PoC bindings]; core DOM-lib strict defect resolved; PoC coherence gate closed [sandbox portion]; **3 pre-existing defects fixed during repo migration, cascade cap split into two budgets [§8.5.4]**; **wide-graph profiling spike closed: gap structural/accepted, field reorder attempted-and-reverted, escalation proposal noted [2026-06-18], architect-affirmed; kind-split tripwire set**; **Spec #4 CLOSED: `_compilerSources` oracle wired into real core, Gate A+B green [2026-06-19]**; **Spec #2 CLOSED: step-4 oracle measured, no wired benefit path, net-negative on all realistic workloads → SHELVED [2026-06-19]**; **Spec 3c CLOSED: import-extension convergence, nodenext config, test hygiene [2026-06-19]**; **Step-3 integration CLOSED: `_compilerEquals` wired into `equals` slot, Gate A+B green [2026-06-19]**; **Step-3 beats-baseline CLOSED: net-neutral on speed; `false` case is correctness-not-speed; compiler specialization layer (steps 1–4) fully measured [2026-06-19]**; **Compiler back-end Phase 1 erasure design APPROVED, scope locked [2026-06-19]**; **PK = documentation only; GitHub authoritative for code [2026-06-19]**; **Phase 1a LANDED: read/write erasure analyzer placed, 235→250 tests, cross-pass seam confirmed [2026-06-19]**; **Phase 1b-1 LANDED: emitted-mount placer placed, 250→262 tests, all 5 §5 differential gate cases green against real interpreter [2026-06-19]**; **Phase 1b-2 LANDED: Child + Conditional added to emitter, 262→272 tests, all gate cases green, 1000-flip no-leak confirmed, direct-capture preserved [2026-06-19]**; **Phase 2 CLOSED: step-3 hook emission landed, 272→282 tests, FALSE-policy sites emit setCompilerEquals(fn, false), first specialization to reach compiled output; HC perturbation finding carried forward as createSignals tripwire companion [2026-06-19]**; **`.nv` front-end SCOPED: syntax + component model settled ($component/$script/$style/$render/holes); TS-API-delegation parser strategy; FE-equivalence seam carries all back-end proofs; renderer-session handoff pending §7 confirmations [2026-06-19]**; **`.nv` front-end scope APPROVED: all four §7 confirmations resolved (IR structural comparison, TS-API delegation + mutation-write rewrite ordering load-bearing, PoC binding set only); renderer-session handoff ready [2026-06-19]**; **`.nv` front-end IMPLEMENTED: nv-parser.ts ~770 lines, 48 FE-equivalence + 34 interpreter tests green, erasure sound (mutation-write RHS fix, compound desugaring, scope-aware shadowing closed); pending CC placement [2026-06-19]**; **`.nv` front-end PLACED: nv-parser.ts in-repo, 48 FE-equivalence tests live against real seam, 330/330 green, stale v0-limitations comment corrected [2026-06-19]**; **Real-browser gate COMMISSIONED: Playwright, headless Chromium, both back-ends + interaction; cross-engine tripwire set; parse-divergence flag remains open [2026-06-19]**)_

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
  Sanctioned exception (Spec #4, 2026-06-19): a Set/Map may live on the node as
  a `_compiler*` field iff every access is gated behind a `!= null` check on that
  field, so non-annotated nodes never touch it and it stays off the hot path for
  the common case (`_compilerSources: ReadonlySet` is the reference pattern). The
  discipline is "no such structure on the hot path," not "no such structure as a
  field"; the guard is what keeps the promise.
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
  **Integration boundary CLOSED (2026-06-19, Spec #4):** `_compilerSources` /
  `_diverged` wired into the real `core.ts`; Gate A (220/220, tsc clean, perf
  regression gate passed — no regression on createSignals/createComputations/
  4-1000x12/25-1000x5) and Gate B (17 soundness tests across null/correct/
  wrong-narrow/wrong-wide/empty variants, all green) passed against the real
  intrusive linked-list edge machinery. `reconcileEdges`, tracking-context
  enter/exit, and the epoch-stamp dedup were untouched. **Spec #2
  (compiler beats-baseline) is now unblocked.**
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
- Beating an alien-signals-class performance baseline. **Opt-A (2026-06-18) closed the two
  named deferrals** (Link free-list pool + O(1) epoch-stamp dedup): wide-graph cases
  improved 4.7–11.3x; `updateSignals`/`repeatedObservers`/`unstable` beat alien;
  `createComputations`/`molBench` tie. **Perf phase at a characterized stopping point — no
  further tuning queued.** Two remaining gaps are both proven **structural** and both trace
  to the single 29-field `ReactiveNode` width (= 3 cache lines vs alien's 1):
  - **`createSignals` (6x)** — dominated by WeakMap.set + fn.set, not struct width; only
    API redesign moves it (struct-shape spike 2026-06-18). List-churn tripwire: validate
    under a realistic ListBinding churn harness before treating as permanently accepted.
  - **Wide-graph `4-1000x12`/`25-1000x5` (1.47x/1.66x)** — field-count→cache-line cost in
    `fn`/`runRecompute`, not algorithmic (wide-graph spike 2026-06-18). The one in-stream
    candidate (field reorder) regressed +18/+27% by breaking an accidental BFS→DFS cache
    pre-fetch; **original field order is now locked as cache-load-bearing.**
  Both gaps share one remedy — **kind-split** (separate Signal/Computed/Effect structs) —
  which is **noted, not approved**, gated behind a tripwire: opens only on real-app evidence
  that wide-graph or list-churn perf is user-facing, never on the synthetic gap alone. It is
  §9-contract-adjacent and cross-stream. **Spec #4 and #2 unblocked; field layout settled.**
- Compiler specializations as optimization hypotheses, each of which must beat the
  unspecialized baseline on the benchmark before shipping.
  **Step 4 (`_compilerSources` oracle) measured 2026-06-19 (Spec #2): net-negative
  on all realistic workloads (+40–46% on wide-stable, the design-target case);
  no wired benefit path in the current core — `_diverged` is computed but nothing
  acts on it to save reconcile work. SHELVED behind a reconcile-cost consumer
  (deferred E2 aggressive skip-tracking path). Reopen trigger: real-app profiling
  shows reconcile cost climbing, OR E2 lands and provides the consumer.
  Step 3 benchmarking remains blocked — `_compilerEquals?` is an inert stub; a
  separate step-3 integration spec (wire the value-change-path hook) is required
  before step 3 can be benchmarked.**

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

### 2026-06-18 — Benchmark baseline pinned (alien-signals@3.1.2, js-reactivity-benchmark SHA 56eb45e)

**Baseline.** Machine: Apple M2 Max arm64 / Node v20.19.0 / V8 11.3.244.8-node.26.
Benchmark fork: `milomg/js-reactivity-benchmark` commit `56eb45e84b3f6fcfa867840725e66b59a9b7467a`.
Primary reference frame: alien-signals@3.1.2 (pinned in benchmark lockfile).

Selected pre-optimization nv times (ms, lower is better) vs alien-signals:

| Case | nv (baseline) | alien | ratio |
|---|---|---|---|
| createSignals | 49.9 | 8.9 | 5.6x |
| createComputations | 240 | 120 | 2.0x |
| updateSignals | 878 | 450 | 1.95x |
| 4-1000x12 - dyn5% | 6772 | 410 | 16.5x |
| 25-1000x5 | 4032 | 499 | 8.1x |
| molBench | 16.8 | 16.7 | 1.0x |

Root cause of wide-graph outliers: nv was creating new Link objects on every recompute
(~336M allocations for `4-1000x12` over 7000 iterations), while alien-signals reuses
links via version stamps. Secondary: O(k) source-list dedup walk in `trackRead` (minor
for narrow graphs; masked by GC churn in wide ones).

**Status.** Baseline locked as the reference for Spec #1 optimizations.

### 2026-06-18 — Spec #1 Opt-A: Link free-list pool + O(1) epoch-stamp dedup in trackRead

**Approach.**

1. **Link free-list pool (§9 in core.ts):** Added `linkPoolHead: Link | null` and a
   `poolLink(link)` helper. `makeLink` pulls from the pool if available; `reconcileEdges`
   and `disposeNodeFull` return links to the pool instead of letting them GC. Eliminates
   per-recompute heap allocation for wide graphs.

2. **O(1) epoch-stamp dedup in `trackRead` (§5.1):** Replaced the O(k) source-list walk
   (`while cur !== null { if cur.source === source return; cur = cur.nextSource }`) with a
   two-field compound stamp on the source node: `_seenBy: ReactiveNode | null` and
   `_seenRunId: number`. Each `runRecompute` assigns a fresh `_runId` to the observer via a
   global `_nextRunId` counter (incremented at entry). `trackRead` checks
   `source._seenBy === observer && source._seenRunId === observer._runId` and returns early
   on a match, otherwise stamps and proceeds. Compound key is nesting-safe: a nested
   `runRecompute` (inner source recomputed via `updateIfNecessary` during the outer run)
   overwrites the source's `_seenBy` with the inner observer's identity, so the outer
   observer's subsequent check sees `_seenBy !== observer` and does not falsely dedup.
   Rare edge case: outer observer reads the same source _after_ a nested recompute of that
   source — a benign duplicate link results (correct graph, minor overhead, no missed
   edges).

3. **Deferral #2 (makeNode class):** Tested a class-based `ReactiveNodeImpl` to get a
   monomorphic V8 hidden class for node allocation. Result: universally worse
   (`createComputations` 122ms → 275ms, `updateSignals` 394ms → 527ms). Root cause:
   TypeScript `useDefineForClassFields` compiles class field initialisers to
   `Object.defineProperty`, which is slower than the object-literal fast path V8 uses for
   same-shape literals. Reverted. The plain object literal stays.

**Results** (Apple M2 Max / Node v20.19.0, post-optimization):

| Case | before | after | improvement | vs alien |
|---|---|---|---|---|
| 4-1000x12 - dyn5% | 6772ms | 596ms | **11.3x** | 1.45x (was 16.5x) |
| 25-1000x5 | 4032ms | 861ms | **4.7x** | 1.72x (was 8.1x) |
| updateSignals | 878ms | 394ms | **2.2x** | **beats alien** (450ms) |
| createComputations | 240ms | 123ms | **2.0x** | **tied** (120ms) |
| molBench | 16.8ms | 16.7ms | — | **tied** |
| repeatedObservers | 28ms | 25ms | — | **beats alien** (34ms) |
| unstable | 30ms | 26ms | — | **beats alien** (34ms) |
| createSignals | 49.9ms | 49.4ms | 0% | 5.5x behind (structural) |

**createSignals gap (5.5x) is structural.** nv's single `ReactiveNode` struct carries
27 fields spanning all node kinds (ownership tree, sync, error, perf stamps). Alien-signals
signals are thinner objects. Splitting into per-kind structs would close this gap but
requires escalation; marked as a genuine constraint-vs-benchmark tension rather than a
tuning opportunity at this scope.

**Conformance.** 203/203 green (vitest, both before and after each change).

**Status.** Shipped. Pool + epoch stamp are in `src/core/core.ts` v0.4.1+.

### 2026-06-18 — Ruling on the `createSignals` struct-shape escalation: field-reduction authorized in-stream; thin-signal spike commissioned; full kind-split declined pending evidence

**Context.** Opt-A (same date) closed the two named perf deferrals and left one
structural gap: `createSignals` stays 5.5x behind alien-signals because the single
`ReactiveNode` struct carries 27 fields spanning all node kinds, while alien signals are
thin. Claude Code correctly **escalated** rather than splitting the struct unilaterally
(the single kind-distinguished struct is a locked decision; data-structure discipline,
§9 / "Data-structure discipline"). This entry rules on that escalation.

**Why the gap is taken seriously (not deferred as cosmetic).** Initial architect lean was
"construction is a microbenchmark, signals are created once and updated many times." That
assumption was challenged and does **not** hold for nv's own idiom: nv is fine-grained,
run-once, no-VDOM, with ListBinding on the roadmap — its apps create many signals and
churn them under row/list lifecycle. A framework that is 5.5x slow at constructing the
thing it constructs most, under list churn, has a real exposure. The gap is worth closing.

**But the motivation does not make the mechanism safe.** Closing the gap by splitting the
struct into per-kind types risks turning the propagation hot paths (`propagate`,
`updateIfNecessary`, `trackRead`) **polymorphic** — they currently see one hidden class at
every `obs.state`/`link.observer` access. A second node shape could regress the wide-graph
propagation cases Opt-A just won 11x (`4-1000x12`, `25-1000x5`). The class-allocation
experiment in Opt-A already demonstrated that shape changes can regress net-negative. So
the §10 / Spec-#1 rule applies: a change that helps one case and regresses others
net-negative does not ship.

**Ruling — three tiers:**

1. **Field-reduction within the single struct — AUTHORIZED in-stream, no escalation.**
   27 fields is wide for every node, not just signals. Folding/sharing fields that no node
   needs simultaneously (candidates: the up-walk temps `_walkParent`/`_walkCursor` vs. the
   BFS temp `_markNext` — a node is plausibly never in an up-walk and a mark-walk at the
   same instant; test-only perf stamps) shrinks **every** allocation including the won
   cases, with zero polymorphism risk because the shape stays singular. This is ordinary
   data-structure tuning, in-stream, do it and measure.

2. **Thin-signal allocation shape — COMMISSIONED as a time-boxed spike (this escalation's
   substance).** Keyed on a verified structural fact: **signals are never observers.** In
   the real core a `KIND_SIGNAL` node has `compute: null`, is never recomputed
   (`runRecompute` early-returns), is never enqueued, and therefore never becomes a
   `currentObserver` — so it never accumulates a source list and never uses the
   observer-role fields (`compute`, the walk temps, source-list head/tail). It is a pure
   *source*: it still needs `value`, `equals`, `state`, and the **observer-list** fields
   (`firstObserver`/`lastObserver`) because it is read. The spike investigates whether a
   signal can be allocated in a thinner shape **without** making the hot paths polymorphic
   — the hard gate being that `propagate`/`updateIfNecessary`/`trackRead` must never branch
   on node shape and must not regress the won propagation cases. The spike may come back
   "no" (the thin shape can't be introduced without polymorphism, or doesn't move
   `createSignals` enough to justify the complexity); a negative result is a complete,
   valid outcome and gets logged as a closed finding, not a failure.

3. **Full per-kind struct split (4 distinct node types) — DECLINED pending spike evidence.**
   This is the locked-decision reversal. It is not approved now; it is only reconsidered if
   the spike shows (a) `createSignals` genuinely needs it and (b) the polymorphism tax can
   be avoided. Until then the single kind-distinguished struct holds. Do not split to win a
   microbenchmark.

**Sequencing.** The spike runs **before** Spec #4 (`_compilerSources` wiring) and Spec #2
(compiler beats-baseline). Rationale: the spike may restructure the signal allocation
shape, and #4 adds a field to that struct — wiring #4 first would mean adding to a struct
about to be restructured. Resolve the shape first; then #4 wires into the settled struct.
The spike is field-subtractive, #4 is field-additive, so they are unlikely to fight, but
shape-first is the clean order.

**Escalation boundary for the spike.** Tier-1 field-reduction is in-stream. The thin-signal
shape (tier 2) touches the node model the contract's §9 discipline rests on — if the spike
finds a shape that works, **introducing it is contract-adjacent and comes back to
architecture before it ships**, with the measurement showing no propagation regression. The
spike *investigates and measures*; it does not unilaterally land a second node shape. A
negative spike result ships nothing and just gets logged.

**Contract impact.** None from this ruling. If the thin-signal shape is later adopted, the
§9 "single kind-distinguished struct" wording would need a versioned edit — but that is a
future decision gated on the spike, not this entry.

**Status.** Tier 1 authorized in-stream. Tier 2 commissioned (spike, time-boxed, result to
be logged). Tier 3 declined pending tier-2 evidence. Spike precedes Spec #4 and #2.

### 2026-06-18 — Spike result: `createSignals` struct-shape investigation; gap confirmed structural-and-accepted; Spec #4 and #2 unblocked

**Authorizing ruling:** 2026-06-18 struct-shape escalation ruling (three tiers: field-reduction in-stream, thin-signal spike commissioned, kind-split declined).

**Method.** Profiled the actual `signal()` call path at 100k iterations, isolated each cost contributor, verified the walk-temp interleave hazard by code-path analysis, and measured thin-signal shape alternatives. Confirmed results against a clean benchmark run (benchmark node runner rebuilt after Opt-A revert of class makeNode).

---

**Tier 1 — field reduction (authorized in-stream).**

*Profile first.* Micro-profile of `signal()` (100k iters, Apple M2 Max / Node v20.19.0):

| Component | Cost/100k | % of signal() |
|---|---|---|
| `signal()` total | 27.70ms | 100% |
| `makeNode` 29-field literal | 5.19ms | 19% |
| closure creation | 1.18ms | 4% |
| WeakMap.set | 7.06ms | 26% |
| fn.set method attach (est.) | ~5ms | ~18% |
| alien-style 3-field object | 1.15ms | alien baseline |

*Walk-temp interleave hazard — verified SAFE.* Candidates: `_markNext` (BFS propagate temp,
§4) and `_walkParent`/`_walkCursor` (DFS up-walk temp, §5). Hypothesis: a node is never
simultaneously mid-BFS and mid-DFS. **Verified correct.** The `enqBFS(obs)` call in
`propagate` (and the CHECK-propagation phase 2) is gated on `wasClean = obs.state === CLEAN`
— line 340: `if (wasClean && obs.firstObserver !== null) enqBFS(obs)`. Nodes on the
`_walkParent` stack are in CHECK or DIRTY state, never CLEAN (they were pushed onto the stack
*because* they were not Clean). Therefore `enqBFS` is never called for a node that has
`_walkParent` set, and `_markNext` is never written to a walk-stack node. The fields cannot
alias.

*But the savings are negligible.* The only provably safe merge is `_markNext` + `_walkParent`
(both `ReactiveNode | null`, never simultaneously non-null) — reducing 29 to 28 fields. From
the profile, the 29-field literal costs 5.19ms / 100k. A 28-field literal costs proportionally
less: ~4.9ms. Savings: ~0.3ms / 100k signals ≈ 1% of total signal creation time. The
complexity — a dual-purpose field with a confusing name, comment burden, and future confusion
risk — exceeds a <1% gain. **Not shipped.** The hazard finding IS logged (prevents a future
session from re-attempting the merge under a wrong assumption).

---

**Tier 2 — thin-signal allocation shape (commissioned spike).**

*The hypothesis.* Signals are never observers: `KIND_SIGNAL` nodes never use `compute`,
`firstSource`/`lastSource`, `_walkParent`/`_walkCursor`, `_runId`, or the observer-role fields.
A thin signal (keeping only `value`, `equals`, `state`, `firstObserver`/`lastObserver`,
ownership fields, `_seenBy`/`_seenRunId`, `isDisposed`/`hasError`) would allocate ~12 fields
instead of 29. Profiled savings:

| Allocation | Cost/100k |
|---|---|
| 29-field literal (current) | 5.19ms |
| 17-field thin-signal literal | ~0.7ms |
| 12-field thin literal | 0.57ms |

Savings from going thin: ~4.6ms / 100k = 46ns/signal. Applied to total signal() cost: 27.70ms
→ ~23.1ms. CreateSignals ratio to alien: **~4.6x behind** (was 6x). Gap narrowed by 23%, but
not closed.

*WeakMap is not replaceable.* The `nodeForFn` WeakMap is used in `sync()` target resolution
(a public API, not test-only) and in `__test` utilities. Replacing it with a symbol property
on the fn (`fn[NODE_SYM] = node`) was measured:

| Mechanism | Cost/100k |
|---|---|
| WeakMap.set | 7.06ms (8.49ms in second run) |
| fn[SYM] = node | **12.95ms — 53% SLOWER** |

Symbol property assignment on closure functions is slower because each unique closure gets its
own V8 hidden class, and adding a property triggers a per-closure hidden class transition.
WeakMap.set avoids this (it stores the mapping externally via the hash table). The WeakMap
cannot be replaced.

*The gap after max addressable improvement.* Even eliminating ALL node allocation cost (0ns):
- WeakMap.set: ~71ns/signal (irreducible without API redesign)
- fn.set method: ~30ns/signal (irreducible — it's the public `.set()` write API)
- closure: ~12ns/signal
- Total floor without node: ~113ns/signal vs alien ~11ns/signal → still ~10x behind on allocation

With thin signal (best case, no polymorphism): ~113 + 7 = ~120ns/signal → still 10x behind. The gap
is dominated by WeakMap + fn.set, not struct width. **Thin-signal shape addresses only 19% of
the gap driver.**

*Polymorphism risk is real.* The Opt-A class-makeNode experiment (a shape change to a single
node type, not even a second type) caused `createComputations` to regress from 122ms to 275ms
(2.2x regression) and `updateSignals` from 394ms to 527ms (1.4x regression). A thin-signal
shape introduces a SECOND allocation shape for the same conceptual type, which is a strictly
stronger polymorphism risk than changing the single shape's constructor mechanism. V8's
inline caches in `propagate`/`updateIfNecessary`/`trackRead` would go from monomorphic to
polymorphic or megamorphic on every `link.observer`/`link.source` access. The 11x wide-graph
wins from Opt-A would likely regress significantly.

**Tier 2 verdict: NEGATIVE.** The thin-signal shape:
1. Addresses only 19% of the `createSignals` gap driver (WeakMap + fn.set dominate)
2. Cannot close the gap to competitive — floor is ~10x behind alien on allocation
3. Carries demonstrated polymorphism risk that could regress the Opt-A won cases
4. Does not move the benchmark enough to justify the complexity or risk

*Outcome:* No code change from Tier 2. Result logged as a closed finding.

---

**`createSignals` gap — final status: structural-and-accepted.**

The gap (6.0x behind alien on this run, run-to-run variance ±10%) is a composite of three
design costs, none addressable by struct-shape changes:

1. **29-field `ReactiveNode` allocation (19% of signal cost):** One of the largest object
   literals in common reactive frameworks. Narrowing to 12 fields saves ~17% of node cost
   = ~3% of total signal cost — too small to matter, and the thin-shape risk is prohibitive.
2. **`WeakMap.set` for fn→node lookup (26%):** Required for `sync()` target resolution and
   `__test`. Cannot be replaced by symbol property (53% slower in measurement). Cannot be
   eliminated without redesigning the API surface.
3. **`fn.set` method attachment (~18%):** The `.set()` write method is part of the public
   `SignalAccessor` type. Cannot be removed.

These are design costs for the richness nv's signal API provides. Alien-signals' signal is
a thin `{value, subs, subsTail}` object — no WeakMap, no method attachment. nv's node
carries ownership, sync, error, dedup stamps, and the full `SignalAccessor<T>` API surface.
That richness has a cost. The cost is accepted.

The gap is not cosmetic: list churn under row/ListBinding lifecycle is a real exposure (per
ruling). But the mechanism to close it is **API redesign** (thin the lookup, separate fn.set
into a different handle type) — not struct-shape tuning. That is a future escalation at a
different scope; it does not block current work.

**Confirmed Opt-A numbers (clean run, benchmark runner rebuilt):**

| Case | nv | alien | status |
|---|---|---|---|
| createSignals | 57.83ms | 9.64ms | 6.0x behind (structural) |
| createComputations | 129.06ms | 135.64ms | **nv wins** |
| updateSignals | 411.09ms | 486.23ms | **nv wins** |
| 4-1000x12 - dyn5% | 616.82ms | 420.36ms | 1.47x (was 16.5x before Opt-A) |
| 25-1000x5 | 853.46ms | 514.65ms | 1.66x (was 8.1x before Opt-A) |
| repeatedObservers | 27.42ms | 35.38ms | **nv wins** |
| molBench | 17.59ms | 17.07ms | tied |

**Conformance:** 203/203 green. No code changes shipped from this spike.

**Status.** Spike complete. Tier 1: no field merges shipped (savings negligible, one hazard
finding logged). Tier 2: negative result, logged as closed finding. `createSignals` gap
confirmed structural-and-accepted. **Spec #4 (`_compilerSources` wiring) and Spec #2
(compiler beats-baseline) are now unblocked.**

### 2026-06-18 — Wide-graph profiling spike commissioned; createSignals list-churn validation deferred (tripwire set)

**Context.** The struct-shape spike (same date) confirmed `createSignals` is
structural-and-accepted (WeakMap + fn.set dominate, not struct width; closing it needs API
redesign, not tuning). Post-Opt-A standing: nv wins or ties 5 of 7 benchmark cases. Two
remain ~1.5x behind alien — `4-1000x12 - dyn5%` (1.47x) and `25-1000x5` (1.66x), down from
16.5x/8.1x before Opt-A. This entry decides what to do next on perf.

**Decision 1 — wide-graph profiling spike commissioned (before Spec #4/#2 perf-sensitive work).**
1.5x is the range where a *constant-factor* win in the propagation hot path is plausible
(unlike the 6x `createSignals` gap, which is API-richness). The spike profiles where the 1.5x
actually goes — same method as the createSignals spike: **profile first, trust the profile
over hypotheses, hard gate on the won cases (no net-negative regression), log the result
positive or negative.** A "the remaining gap is irreducible constant-factor, accepted" result
is a complete, valid outcome.

The highest-value hypothesis to test (architect flag, unprofiled): nv may **rebuild a stable
edge set every recompute** (full `reconcileEdges` teardown + `trackRead` rebuild) where
alien-signals reuses persistent links via version stamps. If the wide-graph dependency set is
unchanged across recomputes, that teardown/rebuild is wasted work. **Crucially, fixing this is
NOT in-stream** — persisting edges across recomputes touches §5.4.1 (reconcile-always-in-finally
is the soundness net) and changes what the graph *is* across recomputes. The spike
*investigates and characterizes*; if the win lives here, it returns a proposal for architect
review with its own soundness obligation, it does not change reconciliation in place. The
in-stream/escalation line: making the *existing* rebuild cheaper is in-stream; *not rebuilding*
is an architecture change that comes back here.

**Decision 2 — createSignals list-churn validation deferred, tripwire set.** The accepted-
structural ruling on `createSignals` carries a real worry: list-heavy UIs (ListBinding, row
churn) create signals constantly, and a 6x construction cost could compound. This worry is
currently **untested** — and the createSignals spike just demonstrated that untested cost
hypotheses are often wrong (the cost wasn't where anyone predicted). So the worry is converted
to a scheduled measurement, not a standing fear:

> **Deferred validation (tripwire):** before treating `createSignals` as permanently accepted,
> benchmark signal-construction cost under a *realistic ListBinding churn harness* (create/
> destroy N rows, each row = signal + derived(s) + bindings), not the isolated `createSignals`
> microbench. Rationale it may be a non-issue: the microbench creates bare signals in a tight
> loop, but a real row also creates deriveds — and **nv already wins `createComputations`** — so
> the blended per-row create cost may be competitive even though raw signal creation is 6x. If
> the realistic harness shows construction dominating row churn, *then* the API-redesign question
> (should the signal be a callable; can fn→node lookup avoid the WeakMap) opens as its own
> architecture pass. Not before — chasing a microbench into an API reversal is the tail wagging
> the dog. Trigger: real ListBinding work, or first real-app profiling, whichever comes first.

**Standing practice reaffirmed.** Both decisions reaffirm the Opt-A loop as the perf method
going forward: one hypothesis at a time, profile-led, single trial, hard gate on won cases,
logged result. Novel bottleneck-shaving is welcome but always one trial at a time against the
gate — never a batch of speculative changes.

**Contract impact.** None from this entry. The persistent-edge proposal, *if* the spike returns
one and *if* architecture later approves it, would be a §5.4.1-adjacent change with its own
versioned entry — gated on the spike, not decided here.

**Status.** Wide-graph spike commissioned (time-boxed, result to be logged). createSignals
list-churn validation deferred with tripwire. Spec #4/#2 remain unblocked; the wide-graph spike
runs first only because it shares the `core.ts` hot path #4 will wire into — but it is
field/logic-light and unlikely to fight #4.

---

### 2026-06-18 — Wide-graph profiling spike RESULT: gap is structural; field reorder attempted and reverted

**Spike mandate (from entry above).** Profile the `4-1000x12 - dyn5%` (1.47x gap) and
`25-1000x5` (1.66x gap) wide-graph benchmark cases. Test hypothesis that nv rebuilds a stable
edge set every recompute (H3/H4). Profile first; if constant-factor win found, measure and ship;
if win requires persistent-edges, write characterized proposal; always log.

**Baseline (post-Opt-A, alien-signals@3.1.2):**
- `4-1000x12 - dyn5%`: nv 616.82ms vs alien 420.36ms → **1.47x**
- `25-1000x5`: nv 853.46ms vs alien 514.65ms → **1.66x**

**Profiling method.** Custom micro-profiler (`/tmp/profile_wg4.mjs`) replicating the wide-graph
structure. `node --cpu-prof --cpu-prof-interval=50`. V8 sampling profiler on M2 Max / Node
v20.19.0. 38,623 samples over ~3,092ms.

**Profile result — top self-time:**
| Function | Self-time |
|---|---|
| `fn` (derived accessor wrapper) | 37% |
| `runRecompute` (recompute machinery) | 34% |
| `trackRead` | 0.05% |
| `poolLink + makeLink` combined | ~0.2% |

**Hypothesis H3/H4 REFUTED.** Edge rebuild (trackRead + poolLink + makeLink) = ~4ms total out of
~3,092ms = **0.2% of runtime**. The Opt-A free-list pool completely solved the allocation cost.
Persistent edges cannot recover meaningful time because there is no meaningful time to recover
here.

**Actual bottleneck — structural.** The 71% concentration in `fn` + `runRecompute` reflects the
overhead of nv's 29-field monomorphic `ReactiveNode` struct relative to alien-signals' 7-field
computed node. Key contributors:

1. **`fn` (37%):** The derived accessor wrapper `() => { isDisposed check; trackRead; updateIfNecessary; hasError; value }`. This is the outer frame for every reactive read. With pointer compression, the node's 29 fields span 3 cache lines (CL0=0-13, CL1=14-27, CL2=28). For CLEAN reads, only CL0 is needed — but it is loaded regardless of how short the path is.

2. **`runRecompute` (34%):** Setup and teardown around every recompute — context save/restore (`prevObserver`, `prevOwner`), pre-run cleanup, try/finally, edge reconciliation. These operations touch CL0 and CL1. alien-signals has fewer fields → fewer cache lines → less work per recompute.

3. **Structural gap:** alien-signals' 7-field computed fits entirely in one pointer-compressed cache line. nv's 29-field struct cannot. At wide-graph scale (thousands of nodes, reads per update), the extra CL misses per node dominate. The gap is not algorithmic — both runtimes run the same DFS traversal at the same O() complexity — it is purely field-count → cache-line count.

**Field reordering attempted (in-stream candidate).** V8 assigns property indices in initialization
order. The DFS walk-stack fields `_walkParent` (field 24, CL1) and `_walkCursor` (field 25, CL1)
were candidates to move to CL0 — if the BFS propagation phase loads CL1 for `_markNext`, then
the DFS phase can read `_walkParent`/`_walkCursor` from warm CL1 cache for free. Moving them to
CL0 would require a separate CL0 load per node in the DFS. Similarly, `_seenRunId` was at field
28 (isolated CL2); moving it to CL1 alongside `_seenBy` (field 27) would eliminate a CL miss
per `trackRead` write.

Conservative reorder implemented: `_walkParent`/`_walkCursor` → CL0 (fields 12-13), `_seenRunId`
→ CL1 (field 16), `error`/`owner` evicted from CL0 to CL1 (cold). Tests: 203/203 green.

**Field reorder CAUSED REGRESSION — reverted.** Conservative-reorder benchmark result
(b9mq3us44, clean run with alien numbers matching baseline to within noise):
- `4-1000x12 - dyn5%`: nv 733ms vs alien 423ms → **1.73x** (baseline 1.47x — **+18% regression**)
- `25-1000x5`: nv 1085ms vs alien 503ms → **2.16x** (baseline 1.66x — **+27% regression**)

**Root cause of regression — BFS→DFS accidental pre-fetch broken.** In the original field layout,
`_markNext` (field 23), `_walkParent` (field 24), `_walkCursor` (field 25), `_runId` (field 26),
`_seenBy` (field 27), `_seenRunId` (field 28) are all adjacent. When `propagate`'s BFS phase
accesses `node._markNext` to iterate the BFS queue, it loads CL1 (fields 14-27), accidentally
pre-fetching `_walkParent`/`_walkCursor`. When `updateIfNecessary`'s DFS phase then runs for
those same nodes, the walk-stack fields are already warm in the cache — a free pre-fetch. Moving
`_walkParent`/`_walkCursor` to CL0 breaks this: BFS still loads CL1, but DFS now needs a separate
CL0 load per node. The regression is consistent in direction and magnitude across both wide-graph
cases; alien (unaffected) matches baseline. The original co-location in CL1 was accidentally
optimal.

**Field reorder reverted.** Original field order restored in `makeNode` and `ReactiveNode`.
203/203 tests still green.

**Conclusion — gap is structural, accepted.**
The 1.47x / 1.66x gap on wide-graph cases reflects the fundamental difference in struct width
(29 fields vs 7 fields = 3 CL vs 1 CL). No in-stream fix exists: the one candidate optimization
(field reordering) made things measurably worse by breaking an accidental cache-prefetch synergy.
The correct path to close the gap is **struct reduction** — kind-split (separate signal/derived
structs with only their own fields) or equivalent field reduction per §9. That is an architecture
change touching the kind-distinguished monomorphism invariant and requires a separate spike with
its own proposal, not an in-stream edit.

**Escalation proposal — struct reduction.**
If closing the wide-graph gap is a future priority, the proposal is:
- Split `ReactiveNode` into `SignalNode` (kind=SIGNAL: kind, state, value, firstObserver,
  lastObserver, equals = ~6 fields, 1 CL) and `ComputedNode` (kind=DERIVED: all of the above +
  compute, firstSource, lastSource, _walkParent, _walkCursor, _runId, _seenBy, _seenRunId,
  _markNext = ~15 fields, 2 CL) and `EffectNode`/`SyncNode` (include scheduling and ownership
  fields = ~20 fields, 2-3 CL).
- `fn`/`runRecompute` would operate on the narrower `ComputedNode` type, reducing CL traffic by
  ~30% per recompute on wide-graph cases.
- Soundness: the kind-discrimination code (`if (node.kind === KIND_DERIVED)`) becomes a type
  guard rather than a runtime branch. No semantic change.
- Risk: requires touching every call-site that currently passes `ReactiveNode`. Large change,
  coordinate with renderer and compiler streams. Not in-stream.

**This escalation is noted, not approved.** The gap is accepted at the current level (the ratio
for the profiled cases is 1.47x / 1.66x, not 6x). The nv wins or ties 5/7 benchmark cases;
the 1.5x-ish wide-graph gap is a known structural deficit without an in-stream remedy. Revisit
if wide-graph performance becomes a user-facing priority.

**Status.** Spike closed. No ship. Original field layout locked. Gap characterized. Spec #4
(compiler `_compilerSources` wiring) and Spec #2 (compiler beats-baseline) are next.

---

### 2026-06-18 — Architect confirmation: wide-graph spike result affirmed; kind-split escalation gated behind real-app evidence (tripwire)

**Reviewing:** the wide-graph profiling spike RESULT entry (same date, directly above).
Architect reviewed the findings, did not re-run (the spike's method and numbers are
self-consistent and the regression came from the real benchmark, not the micro-profiler).

**Affirmed.**
- **H3/H4 (stable-edge-rebuild) correctly refuted.** Edge rebuild is ~0.2% of wide-graph
  runtime; the Opt-A free-list pool already eliminated the allocation cost. The architect's
  own pre-spike "highest-value hypothesis" was wrong, and the profile-first discipline is
  what surfaced that — recorded as a calibration point: a flagged hypothesis is a place to
  look, never a conclusion to ship toward.
- **Root cause accepted as structural, not algorithmic.** The 1.47x/1.66x gap is field-count
  → cache-line count (29-field struct = 3 CL vs alien's 7-field computed = 1 CL), same DFS at
  the same O(). No in-stream remedy.
- **The field-reorder regression is the keeper finding.** Moving `_walkParent`/`_walkCursor`
  out of CL1 regressed both cases (+18%, +27%) by breaking an *accidental* BFS→DFS cache
  pre-fetch: `propagate` loading CL1 for `_markNext` warms the adjacent walk-stack fields for
  `updateIfNecessary`'s DFS. **The original field order is therefore cache-load-bearing and is
  now locked** — a future "tidy the struct layout" edit must treat field order as a measured
  property, not cosmetics (same class of lesson as deepest-first fuzzer pull order). Revert was
  correct; 203/203 green on the restored layout.

**Kind-split escalation — affirmed NOTED, NOT APPROVED; gated behind real-app evidence.**
The spike's proposed remedy (split `ReactiveNode` into `SignalNode`/`ComputedNode`/
`EffectNode`+`SyncNode`) is the *same* kind-split the createSignals struct-shape ruling
already declined as Tier 3. Two independent perf investigations — construction cost and
wide-graph propagation cost — now converge on the identical conclusion: the single 29-field
struct is the cost, the kind-split is the only lever, and the kind-split risks polymorphism
across `propagate`/`updateIfNecessary`/`trackRead`. The wide-graph spike *strengthens* the
case against splitting: it empirically demonstrated that even a within-single-struct field
*reorder* regressed via an unpredicted cache effect — a full kind-split is a far larger
perturbation of exactly that cache behavior, across multiple node shapes, with the demonstrated
pattern being "struct-shape changes regress unpredictably."

Decision: **do not open the kind-split as a spike now.** 1.47x/1.66x on two synthetic
wide-graph cases, against a 5-of-7 win/tie record, does not justify a large cross-stream
change with demonstrated regression risk. Set the tripwire instead:

> **Kind-split tripwire (evidence-gated).** The kind-split spike opens only if real-app
> profiling shows wide-graph reactive propagation (deep/wide graphs under churn) as a
> top user-facing cost — not on the synthetic benchmark gap alone. When triggered, its
> evidence base is BOTH this wide-graph spike result AND the createSignals struct-shape
> spike result (they converge on the same lever). The spike, if ever run, carries its own
> soundness obligation (kind-discrimination becomes a type guard, not a runtime branch —
> no semantic change intended, but it must be proven) and coordinates with the renderer and
> compiler streams (every `ReactiveNode` call-site is touched). It is contract-adjacent
> (§9 single kind-distinguished struct) and comes back to architecture before it ships.
> Trigger: real-app wide-graph profiling evidence, or a deliberate decision that wide-graph
> perf is a launch-blocking priority.

**Perf phase standing (architect summary).** The runtime perf phase is at a characterized,
defensible stopping point. Opt-A delivered the structural wins (16.5x→1.47x, 8.1x→1.66x, plus
`updateSignals`/`repeatedObservers`/`unstable` outright wins and `createComputations`/`molBench`
ties). Two follow-up spikes then *bounded* the two remaining gaps: both `createSignals` (6x) and
the wide-graph cases (~1.5x) are proven structural, both trace to the single-struct field width,
both have the same and only remedy (kind-split), and both are correctly deferred behind real-app
evidence rather than chased into a risky reversal on synthetic numbers. "Stuck" would be an
uncharacterized gap; this is a characterized one with the single remaining lever identified and
gated. No further perf tuning is queued; the loop reopens on evidence (the two tripwires) or when
a compiler specialization (Spec #2) proposes a hook that must beat baseline.

**Carry-forward constraint for Spec #4 (and any struct edit).** The field layout is now known
to be cache-load-bearing on the wide-graph cases. Spec #4 adds `_compilerSources`/`_diverged` to
the struct — new fields on the hot struct. Spec #4's existing perf-regression gate is sharpened
here to a hard requirement: **after the struct edit, re-run `4-1000x12 - dyn5%` and `25-1000x5`
specifically** and confirm no regression beyond noise; keep the new fields optional/absent on
non-annotated nodes so signals and plain deriveds do not grow or shift the existing field order.
Append new fields at the end of the struct (after `_seenRunId`) rather than interleaving them,
to avoid disturbing the BFS→DFS CL1 adjacency that the reorder regression proved load-bearing.

**Contract impact.** None. The kind-split, if ever pursued, would carry a §9 wording change with
its own versioned entry — gated on the tripwire, not decided here.

**Status.** Wide-graph spike closed and affirmed. Kind-split noted, not approved, tripwire set.
Original field layout locked as cache-load-bearing. Spec #4 and Spec #2 proceed. No further perf
work queued.

---

### 2026-06-19 — Spec #4 CLOSED: `_compilerSources` oracle wired into real `core.ts`; both gates green

**What shipped.** The §10 row-4 branch-variant mechanism, previously proven only against
`variantRuntimeHarness.ts`, is now integrated into the production `core.ts` and proven
against the real intrusive linked-list edge machinery, the real free-list pool, and the
real epoch-stamp dedup.

**Struct changes (placement rule honoured).** Two optional fields appended at the tail of
`ReactiveNode`, after `_seenRunId`, per the cache-load-bearing placement rule from the
2026-06-18 wide-graph spike — no existing field shifted, BFS→DFS CL1 adjacency preserved:
- `_compilerSources?: ReadonlySet<ReactiveNode> | null` — the declared union; absent (undefined)
  on non-annotated nodes. A node without `_compilerSources` pays exactly zero on every call.
- `_diverged?: boolean` — reset per recompute (gated: unannotated nodes skip the write).

**Hook wiring.** `trackRead`: oracle check at the pre-existing §10 attachment-point comment,
after the epoch-stamp early-return, before `makeLink`. Fires only when
`observer._compilerSources != null && !observer._diverged`. Sets `_diverged = true` on first
out-of-union read; `_diverged` then acts as the "oracle deactivated" guard for the rest of that
run. Never touches `firstSource`/`lastSource`/any `Link`/stamp fields.
`runRecompute`: `if (node._compilerSources != null) node._diverged = false` at the point where
`_runId` is incremented. **`reconcileEdges`, tracking-context enter/exit, and the
always-reconcile-in-finally guarantee are untouched.**

**Membership structure choice.** `ReadonlySet<ReactiveNode>` — stored off the hot path (only
consulted when `_compilerSources != null`), one `Set.has()` call per distinct source read per
annotated run. Non-annotated nodes: zero cost (`undefined != null → false` short-circuits).

**`__test` additions.** `setCompilerSources(fn, set | null)`, `isDiverged(fn)`,
`sourceNodes(fn)` — integration API for Gate B tests; converts accessor fns → ReactiveNodes
via the existing `nodeForFn` WeakMap.

**Gate A — regression (all green).**
- Full suite: **220/220** (17 new Gate B tests; prior 203 unchanged).
- `tsc --strict` clean.
- Perf regression gate vs Opt-A baseline (post–struct-field addition):

  | Case | Opt-A baseline | Spec #4 | Δ |
  |---|---|---|---|
  | createSignals | ~48.9ms | 48.52ms | −0.8% (noise) |
  | createComputations | 129.06ms | 125.53ms | −2.7% (improved) |
  | 4-1000x12 - dyn5% | 616.82ms | 599.80ms | −2.8% (improved) |
  | 25-1000x5 | 853.46ms | 860.26ms | +0.8% (noise; alien also moved) |

  No regression on any case. Optional tail fields invisible to non-annotated nodes.

**Gate B — soundness (all green, 17 tests).**
All 7 model tests ported and green against the real core. 8 additional differential/property
tests covering null / correct / wrong-narrow / wrong-wide / empty `_compilerSources` variants.
Key assertions confirmed against the real machinery:
- Wrong-narrow still establishes the omitted edge (reconcile is ground truth) and produces the
  correct value; `_diverged = true`.
- Empty union: all reads diverge; edges and value identical to null run.
- Wrong-wide (extra in union, never read): `_diverged = false`; only actual reads are tracked.
- Source count and live/dead propagation behavior identical across all variants.
- Source read order preserved (intrusive list append order): verified by node identity
  comparison across null vs annotated deriveds that share the same signal instances.
- Recompute counts identical across all variants (oracle causes zero extra recomputes).
- `_diverged` resets per recompute: diverged in run N → `false` at start of run N+1.
- Epoch-stamp dedup untouched: double-read of same source in one compute still tracks once;
  oracle never runs on the deduped second read.

**No escalations raised.** Real machinery and model agreed on all cases; no §7 trigger hit.

**Contract impact.** None — §10 row 4 was already specified. No contract version bump.

**Status.** Spec #4 closed. Integration boundary resolved. Spec #2 (compiler beats-baseline)
is now unblocked and meaningful.

---

### 2026-06-19 — Spec #2 CLOSED: step-4 `_compilerSources` oracle measured; no wired benefit path → SHELVED

**Environment (pinned per §4).** Apple M2 Max arm64 / macOS Darwin 24.6.0 / Node v20.19.0 / V8 11.3.244.8-node.26. Measured against commit `39d3600` (post-Spec-#4). Suite: 220/220, tsc --strict clean.

**Step 4 only.** This spec covers the `_compilerSources` branch-variant oracle (§10 row 4) only. Step 3 (`_compilerEquals?`) is an **inert stub** in the current `core.ts` — the equality-policy hook is declared but nothing in `runRecompute` or the value-change path consults it. Step 3 benchmarking remains blocked on a separate step-3 integration spec (a `runRecompute`/value-change-path edit with its own Gate A/B), which has not been authored. This entry does not cover step 3.

**§3.1 crux — does a benefit path exist? NO (found by code inspection, confirmed by measurement).**

Code analysis of the post-Spec-#4 `core.ts` (commit `39d3600`):
- `trackRead` sets `observer._diverged = true` on the first out-of-union read.
- `runRecompute` resets `node._diverged = false` at the start of each run (gated on `_compilerSources != null`).
- **`_diverged` has exactly one consumer: itself, as a guard to skip further `Set.has()` calls later in the same run.**
- `reconcileEdges` runs identically regardless of `_diverged`. The Spec #4 design explicitly left `reconcileEdges` untouched and ground-truth.
- **No other code in `core.ts` reads `_diverged` or `_compilerSources` to branch on or skip any work.**

Conclusion from code: the oracle computes a flag that is used only to bound its own redundant checks. It has **zero benefit path** in the current core. The cost side (one `Set.has()` per distinct tracked read per annotated node, plus one field write per annotated recompute) is real. The benefit side is structurally zero until a consumer exists that uses `_diverged`/`_compilerSources` to skip reconcile work — the deferred E2 aggressive skip-tracking design, which is out of scope and requires its own soundness proof before it can be considered.

**A/B micro-benchmark (the §3 instrument; the only valid measurement method given the standard harness has no notion of a declared union).**

Method: same graph, same writes, same flush calls per shape. Only variable: `_compilerSources` null (baseline arm) vs. correct declared union (specialized arm). 15 trials per arm, median reported. `--expose-gc` between trials.

| Shape | Baseline (ms) | Specialized (ms) | Δms | Δ% | Verdict |
|---|---|---|---|---|---|
| wide-stable (w=200, iters=2000) | 8.61 | 12.12 | +3.51 | **+40.8%** | SLOWER |
| wide-stable (w=1000, iters=500) | 12.68 | 18.51 | +5.83 | **+46.0%** | SLOWER |
| branch-flip (iters=5000) | 0.61 | 0.65 | +0.05 | +7.9% | SLOWER |
| many-narrow (n=500, iters=5000) | 0.61 | 0.53 | −0.08 | −12.7% | FASTER (noise) |
| deep-chain (d=20, iters=5000) | 6.87 | 8.75 | +1.88 | **+27.4%** | SLOWER |
| deep-chain (d=100, iters=2000) | 17.03 | 19.22 | +2.19 | **+12.8%** | SLOWER |

**Notes on results:**
- **Wide-stable** (+40–46%) is the design-target case — large stable read-set, many recomputes. The oracle pays `width × Set.has()` per recompute against zero reconcile savings. The wide-graph spike already placed reconcile at ~0.2% of runtime; the oracle adds ~40% overhead to the case it was designed for. Decisive finding.
- **Deep-chain** (+12–27%) maximizes the per-annotated-recompute cost (field write + conditional check × depth). Confirms the cost is proportional to recompute frequency × annotated depth.
- **Many-narrow** (−12.7% apparent): absolute values 0.61 vs. 0.53ms — within measurement noise on a sub-millisecond workload. Treated as no-difference. One-element Sets and trivially-inline membership tests may interact with JIT specialization; this is not a reliable signal.
- **Branch-flip** (+7.9%): oracle fires `_diverged` on every flip (first read after branch switch is always off-union), then reconcile still runs fully. Pure overhead, no savings.

No shape showed a reliable, regression-free speedup. The design-target case (wide-stable) shows the largest regression.

**Recommendation: SHELVE.** The oracle mechanism is correct and wired (Spec #4). It is harmless to non-annotated nodes (zero cost proven by Spec #4 Gate A). But it is a net-negative on every workload where it can be measured with confidence, and the benefit path is structurally zero in the current core. There is no tuning path: the `Set.has()` cost is irreducible on the cost side, and reconcile is already near-free on the benefit side (Opt-A free-list pool effect).

**Reopen triggers (either suffices):**
1. The deferred **E2 aggressive skip-tracking path** lands: a consumer of `_diverged`/`_compilerSources` in `reconcileEdges` or `trackRead` that actually skips work when the union is trusted. That path requires its own soundness proof (it reintroduces the missed-edge failure mode) and is contract-level — not in scope here.
2. **Real-app profiling** shows reconcile cost climbing in a production workload (e.g., dynamically-determined dependency sets with many additions/removals per frame). That would shift the benefit/cost ratio and warrant re-measurement.

**No escalation triggered.** The measurement confirms the prior; nothing unexpected surfaced. `reconcileEdges`, tracking-context enter/exit, and §5.4.1 finally were not modified.

**Contract impact.** None. §10 row 4 is already specified; the oracle remains wired and dormant. No version bump.

**Step 3 status.** `_compilerEquals?` is an inert stub. The equality-policy benefit path (the value-change branch in `runRecompute`) has not been wired. Benchmarking step 3 requires a step-3 integration spec first, authored by architecture. Flagged; not started here.

---

### 2026-06-19 — Spec 3c CLOSED: repo-wide import-extension convergence + nodenext config + test hygiene

**Type.** In-stream cleanup; no contract change, no version bump.

**Item 1 — Import-extension convergence (`.js`-explicit, repo-wide).**

Root cause of the latent breakage: `tsconfig.base.json` had `moduleResolution: "bundler"` with `"type": "module"` and a plain-`tsc` emit build. Node's native ESM resolver requires explicit extensions at runtime; `tsc` copies specifiers verbatim; extensionless or `.ts`-explicit imports are both runtime-broken on published output (and `.ts`-explicit also fails under emit — `allowImportingTsExtensions` requires `noEmit`).

Fix: `tsconfig.base.json` switched to `module: "nodenext"`, `moduleResolution: "nodenext"`. This enforces `.js`-explicit at the type-checker level — a stray extensionless or `.ts` import is now a typecheck error, so the divergence cannot silently reopen.

All relative specifiers converted to `.js`-explicit across:
- `src/compiler/` — 6 files (all intra-compiler imports: `./signal-type-utils`, `./types`, `./sync-target-classifier`, etc.)
- `src/core/index.ts` — barrel re-exports
- `src/renderer/` — 3 files (`./interpreter`, `./html-tag`, `./comparator`, `./ir`, `../core/core`)
- `test/**/*.ts` — all relative `../../src/...` and `./` imports
- `integration/poc-integration.test.ts` — all `../src/...` imports

Three fixture string literals confirmed intentionally untouched (they are test *inputs*, not real imports):
- `integration/poc-integration.test.ts` line 217 (`cycleFixtureSrc`)
- `integration/poc-integration.test.ts` line 229 (`cleanFixtureSrc`)
- `test/compiler/test-helpers.ts` line 82 (template-literal `from './core'` replacement)

All compiler/classifier tests that consume these fixtures still pass — fixture integrity confirmed.

**Item 2 — `core_ts6_patched.ts`.** Already absent. Retired with the `Node → ReactiveNode` rename (2026-06-17). No references found, no action required. Renderer re-point to real core exposed nothing new — the rename fully resolved the `TS7022` DOM-collision as confirmed at the time.

**Item 3 — Test hygiene.**
- `test/compiler/branch-variant-analyzer.test.ts`: `expect(![...].some(...)).toBe(true)` → `expect([...].some(...)).toBe(false)`.
- `integration/poc-integration.test.ts` Gate-4: added `// structural-intent marker` comment to the `expect(true).toBe(true)` placeholder so it is not misread as a real assertion.

**Gates (all passed).**
1. `tsc -p tsconfig.build.json` emits clean. `dist/` produced; spot-checked emitted imports: `./signal-type-utils.js` in `dist/compiler/branch-variant-analyzer.js`, `../core/core.js` in `dist/renderer/interpreter.js`. ✓
2. Full vitest suite: **220/220**. ✓
3. `tsc --strict` clean with DOM lib. ✓
4. biome clean. ✓
5. Fixture integrity: all three `'./core'` string literals unchanged; all compiler/classifier tests green. ✓
6. No `core_ts6_patched` references. ✓

**Stale artifact removed.** `MIGRATION.md` (the one-time repo-scaffold ruleset)
declared `moduleResolution: "bundler"` + extensionless as the settled import style —
the opposite of this entry's `.js`-explicit/nodenext decision, and wrong on the
hard constraint (extensionless relative imports do not resolve in published
native-ESM JS, and there is no bundler to rewrite them). Its reasoning predated the
build mode being pinned to plain `tsc`. The migration it described is complete, so
the file was deleted rather than corrected — the decision log is the authority for
the import style. Recorded here so a future session does not mistake a remembered
`MIGRATION.md` reference for an unsettled question. (`git grep MIGRATION` after
deletion shows only historical prose references in `docs/` — no live pointers.)

---

### 2026-06-19 — Step-3 `_compilerEquals` integration CLOSED; both gates green

**What was wired.** `_compilerEquals?` (§10 row 2) moved from inert stub to a live
slot-resolution step. Option 1 (fill-the-slot) was chosen and confirmed by architecture:
the inferred value populates the node's existing `equals` slot as a default at
construction time. No new runtime evaluation path; the hot path (`runRecompute` lines
~543–545, `nodeSet` lines ~947–949) is completely unchanged.

**Precedence (§2.1) — the one rule that makes this sound.**
1. Explicit user `opts.equals` (highest; never displaced).
2. Inferred `_compilerEquals` (fills the slot only when (1) is absent).
3. `Object.is` default (when neither is present).

**Mechanism.** `nodesWithUserEquals: WeakSet<ReactiveNode>` tracks nodes where the
user passed explicit `opts.equals` at construction. `signal()` and `derived()` mark the
node in this set when `opts.equals !== undefined`. The `__test.setCompilerEquals(fn, eq)`
setter sets `node._compilerEquals` and re-resolves `node.equals` under the precedence —
it checks `nodesWithUserEquals` and refuses to displace a user-provided predicate. This
is a construction-time operation; zero cost on the hot path.

**Emit channel: (b) post-construction setter**, matching Spec #4's `setCompilerSources`
pattern. `false` is a legal inferred value (mutable-container always-propagate case);
the presence check uses `=== undefined` (not falsy) so `false` is treated as present.
`setCompilerEquals(fn, undefined)` clears back to `Object.is`.

**`__test` additions.**
- `setCompilerEquals(fn, eq | false | undefined)` — plants inferred value, re-resolves slot.
- `getEquals(fn)` — returns resolved slot for assertion.

**Gate A — regression.**
- Full vitest suite: **235/235** (220 prior + 15 Gate B tests). ✓
- `tsc --strict` clean with DOM lib. ✓
- `biome` clean. ✓
- Hot path confirmed untouched: `_compilerEquals` / `nodesWithUserEquals` appear only at
  lines 141 (struct field), 243 (WeakSet def), 991 + 1022 (construction marking in
  `signal`/`derived`), and the `__test` setter. Grep confirms zero occurrences in
  `runRecompute` or `nodeSet`.

**Gate B — soundness (15 tests in `test/core/compiler-equals-real-core.test.ts`).**
- B-1: Explicit user `opts.equals` wins over inferred (signal + derived). Verified with
  observably-different predicates: slot is user's, observer count follows user's policy.
- B-2: Inferred fills slot only when explicit is absent. No-inference case stays `Object.is`.
- B-3: `false` inferred — in-place mutation (`arr.push(); s.set(arr)`) propagates where
  `Object.is` would wrongly suppress. Confirms the mutable-container correctness win.
- B-4: Wrong-narrow (`() => true`) — damage confined to annotated node only. Non-annotated
  sibling node retains `Object.is` behavior byte-for-byte. Documents the dependency:
  soundness is inherited from the compiler's conservatism (DECLINE for unprovable types),
  not enforced at runtime. No runtime path found that applies an inferred equals the
  compiler would not emit — escalation tripwire not triggered.
- B-5: Wrong-wide (`() => false`) — extra recomputes, values always correct. Safe direction.
- B-6: `wasError` path propagates regardless of inferred equals (error-recovery unaffected).
- B-7: `false` presence uses `=== undefined` check; `undefined` clears back to `Object.is`.

**No escalation tripwire triggered.** The runtime has no path that applies an inferred
`equals` the compiler would not emit. All runtime code that touches the `equals` slot is
unchanged from before this spec; only the one-time construction block and the `__test`
setter are new.

**Next.** The "step-3 beats-baseline" spec (Spec #2 shape) is now unblocked. Measurement
baseline: the prior stated expectation is that `equals:false` on mutable-container nodes
is a correctness/ergonomics win (not a speed win); `OBJECT_IS` on primitive nodes is
identical to the `Object.is` default (no delta). A net-neutral result confirming the
`false` case is a complete, honest outcome.

**Status: CLOSED.**

---

### 2026-06-19 — Step-3 beats-baseline CLOSED; compiler specialization layer (steps 1–4) fully measured

**Instrument.** Within-core A/B micro-benchmark (`bench/spec3-equals-ab.mjs`), mirroring
Spec #2's method. Same graph, same writes, same flushes; only variable is the `equals`
slot. Baseline arm: `Object.is` default (no `setCompilerEquals`). Specialized arm:
`OBJECT_IS` for primitive shapes, `false` for mutable-container shapes. 15 trials each,
median, GC between trials. Environment: Apple M2 Max arm64 / Node v20.19.0 /
V8 11.3.244.8-node.26. Measured against commit `be5841f` (suite at 235/235).

**Results (median of 15 trials, two runs for stability).**

| Shape | Baseline (ms) | Specialized (ms) | Δms | Δ% | Stable? |
|---|---|---|---|---|---|
| prim-changing (w=200, iters=50000) | 5.00–5.40 | 4.15–4.33 | −0.84–−1.07 | −17 to −20% | ✗ (see below) |
| prim-changing (w=1000, iters=10000) | 0.81–0.87 | 0.81–0.87 | ~0 | ~0% | ✓ **~same** |
| prim-no-op (w=200, iters=50000) | 1.21–1.30 | 1.20–1.21 | ~0 | −0.1 to −7% | borderline |
| prim-no-op (w=1000, iters=10000) | 0.24 | 0.24 | ~0 | +0.6 to +2.7% | ✓ **~same** |
| mut-in-place (n=100, iters=20000) | 1.56–1.58 | 1.98 | +0.40–0.42 | **+25 to +27%** | ✓ **SLOWER** |
| mut-ref-chg (n=100, iters=20000) | 1.90–1.95 | 1.81–1.85 | −0.09–0.10 | −5% | ✓ **~same** |

**Result interpretation — confirms prior.**

*Primitive shapes (OBJECT_IS vs Object.is):* The w=1000 variants (the authoritative signal)
show zero delta both runs, confirming the prior: replacing `Object.is` with `Object.is` is
a no-op. The w=200 prim-changing shape shows an apparent −17 to −20% speedup, but this is
a **V8 hidden-class artifact**: `setCompilerEquals` writes `node._compilerEquals = Object.is`
on each derived, transitioning the node to a new hidden class. The JIT generates slightly
different code for the HC-transitioned nodes in the small-graph case. The w=1000 variant
dilutes this per-node JIT bias across more nodes and shows zero — that is the real signal.
No real equality-slot cost savings exist here.

*Mutable-container, in-place mutation (`false` vs `Object.is`):* **+26% SLOWER, stable.**
This is exactly the prior's prediction and is **correct** behavior. The baseline arm
(`Object.is`) wrongly suppresses propagation when the same array reference is re-set after
in-place mutation (`arr.push(); set(arr)`), doing less work only because it is buggy.
The specialized arm (`false`) correctly propagates every write, doing the downstream
recomputes the baseline silently skipped. The specialized arm is slower because it is doing
the right amount of work. Do not read this as a regression. The correctness payoff is
already banked in Gate B-3 (proven correct in the step-3 integration gate).

*Mutable-container, ref-change:* ~same / borderline (−5% within noise). Consistent with
the "skipped `Object.is` call" theory but within measurement variance.

**Verdict: CONFIRMED PRIOR. Keep the hook.**

Unlike step 4 (`_compilerSources`, SHELVED — zero benefit path at runtime), step 3 has a
real consumer (`node.equals` is called on every value-change check) and a real correctness
payoff (the `false` case fixes the in-place-mutation footgun). The hook is **not dormant**
and does not get shelved. Speed is neutral; the value is correctness.

**Hook status note.** The hook is wired and gated but not yet fed by real compiler-emitted
output. Production components do not yet receive specialized equality — the compiler back-end
(emitting `setCompilerEquals` calls on annotated signal/derived sites) is downstream work.
A future session should not assume compiled components already get specialized equality.

**No core code changed.** `src/` is clean. Only file added: `bench/spec3-equals-ab.mjs`.
Suite remains 235/235.

**Compiler specialization layer closed.** Steps 1–4 are now all wired + gated + measured:
- Step 1 (sync-target classification): wired, gated, measured (compiler stream).
- Step 2 (write-graph cycle checking): wired, gated, measured (compiler stream).
- Step 3 (`_compilerEquals` equality policy): wired, gated, **measured today** — keep for correctness.
- Step 4 (`_compilerSources` branch-variant oracle): wired, gated, measured (Spec #2) — SHELVED (no benefit path).

**Status: CLOSED.**

---

### 2026-06-19 — Compiler back-end Phase 1 (read/write erasure) design APPROVED; scope locked

**Decision.** The compiler back-end's first piece — the read/write syntax erasure pinned
2026-06-18 (bare-read → accessor call; mutation-write → `nodeSet`/`.set()`) — has an
architect-approved soundness design (`design-compiler-backend-phase1-erasure.md`), gated
before code per the step-4 discipline. This is IR back-end #2 (interpreter is #1); it proves
the IR *compiles* to code observably identical to the interpreter.

**Soundness obligation.** Back-end equivalence (Invariant BE, IR v0.2): a differential gate —
emitted code vs. interpreter on the same IR, structural DOM comparison + reactive behavior,
the TC-01–TC-09 corpus through both back-ends. The whole proof reduces to one capability:
**reliably identifying which identifiers are reactive bindings**, reusing the existing
nominal-origin discipline (not structural shape). All-or-nothing: anything not provably
reactive is left as plain JS, untouched. The load-bearing gate test is the unprovable-binding
case — it must be left plain *and surface visibly* (diagnostic / differential mismatch), never
a silent stale read; if a miss can be silent, the erasure is unsound and escalates rather than
ships.

**Escalation tripwire (write-erasure analog of step 4's forbidden skip-tracking):** never
rewrite a binding the analysis cannot prove reactive. Doing so trades a compile-visible miss
for a silent wrong-target/wrong-write. Decline and diagnose.

**Scope locked (architect-ruled):**
- **Front-end: tagged-template only, Phase 1** (proven interpreter path = differential ground
  truth). `.nv` is a close follow-up iff tagged-template lands clean.
- **Emit target: executable form** (in-memory, run directly by the gate). String-codegen is a
  later separate concern.
- **Write-rewrite + `sync` composition: DECLINE + diagnose.** A mutation-write to a
  `sync`-written signal is not rewritten — erasing a second write would create silent
  last-write-wins races and a write the §8.5.2 cycle checker never analyzed (a silent hole in
  build-time cycle safety). To detect this, the erasure pass consults sync-classification via
  the shared `signalSymbolId` identity (named as a wired input, not a rediscovery). Added as a
  required gate case.

**Deferred (separate follow-up doc):** hook emission (`setCompilerEquals`/`setCompilerSources`
onto rewritten sites) — attaches to sites this erasure produces, sequenced after.

**Path.** Architect-approved (here) → compiler session builds correctness/logic + sandbox
differential gate (claude.ai, where steps 1–4 were built) → CC confirms the real-browser half
of back-end equivalence (same convergence trigger as the PoC Phase 0 final gate). Touches no
`core.ts` (emits calls *to* the existing runtime API; if a core change appears needed, stop —
separate escalation, though 2026-06-18 predicts it should not).

**Contract impact.** None. Read/write syntax is an authoring-layer concern above the contract
(per 2026-06-18). No version bump.

**Status.** Design approved, scope locked. Handoff to the compiler session pending (with the
four live GitHub files: `src/compiler/signal-type-utils.ts`, `src/renderer/interpreter.ts`,
`src/renderer/ir.ts`, `src/core/index.ts`).

---

### 2026-06-19 — PK code files removed; GitHub authoritative for code, PK documentation-only

**Decision.** All source-code files are removed from project knowledge. PK holds
**documentation only** (decision log, contract, design docs). GitHub is the single source of
truth for code; the decision log + contract remain the single source of truth for decisions
and semantics.

**Rationale.** Post-migration, the PK code copies had drifted into a competing, stale second
source of truth — pre-migration names (`syncTargetClassifier.ts`, flat layout, `.ts`/extensionless
mix) against a post-migration repo (kebab-case, `src/{core,compiler,renderer}/`, `.js`-explicit,
vitest). Same failure class as the deleted MIGRATION.md: a stale artifact asserting things no
longer true. Building against stale PK copies risks sandbox false-greens that break at the
GitHub merge — exactly what the two-gate discipline exists to prevent.

**Consequence for sessions.** claude.ai sessions cannot `git clone`; they read GitHub via
fetch/paste. Removing the PK mirror means each session pulls the specific live files it needs
from GitHub at start, rather than trusting a local mirror. More correct (always-live), slightly
more per-session friction. Handoffs name the exact paths a session must read.

**Contract impact.** None. Process/sourcing decision.

**Status.** Locked. PK = documentation only going forward.

---

### 2026-06-19 — Phase 1a LANDED: read/write erasure analyzer placed into repo

**What landed.** The compiler-session's read/write erasure analysis pass (the verdict pass
from the approved 2026-06-18/19 soundness design) was placed into the live repo under live
convention. Commit `b6fe5b8`.

**Files placed.**
- `src/compiler/read-write-erasure-analyzer.ts` — the analysis pass
- `test/compiler/read-write-erasure-analyzer.test.ts` — 15 verdict tests (vitest)
- `src/compiler/types.ts` — `BindingErasureVerdict` + `TemplateErasureResult` merged in
- `src/compiler/index.ts` — `ReadWriteErasureAnalyzer` and both new types barrel-exported

**Convention changes from compiler-session output.** Rename (camelCase → kebab-case),
`.js`-explicit imports, test harness conversion (custom `assert`/`test`/`summarize` →
vitest `expect`/`test`). No logic changes.

**Gates.**
- Suite: 235 → 250 (15 new tests, all pass).
- `tsc -p tsconfig.build.json` clean.
- `biome check` clean.
- Cross-pass seam confirmed: DECLINE fires through the real `SyncTargetClassifier` with the
  real `signalSymbolId` derivation — the seam is a live integration check, not a stubbed unit
  test. No derivation mismatch found.

**Scope note.** Phase 1a = analysis pass (verdicts) only. Phase 1b (code emission + the
back-end-equivalence differential gate) is the next step in the compiler session; this
placement task does not touch emission.

**Status.** Phase 1a landed. Phase 1b pending (compiler session).

---

### 2026-06-19 — Phase 1b-1 LANDED: emitted-mount placer + differential gate

**What landed.** The compiler-session's emitter pass (Phase 1b-1) and its differential gate
placed into the live repo under live convention. Commit `24fd3fd`.

**Files placed.**
- `src/compiler/emitted-mount.ts` — specialized mount function emitter
- `test/compiler/emitted-mount.test.ts` — differential gate (vitest, 12 tests)
- `src/compiler/index.ts` — `emitMount` + `EmitResult` barrel-exported

**Convention changes.** Stale imports (`./core`, `./ir`, `../src/*`) rewritten to
`.js`-explicit, kebab-case. Custom `node:assert`/`test`/`summarize` harness → vitest
`expect`/`test`. No logic changes.

**Differential gate: all five §5 cases pass against the real interpreter.**
- GATE 1 — tracked-read parity (ACCEPT): Text + Attr + boolean-attr semantics, DOM identical after signal write
- GATE 2 — PLAIN binding: wired identically, no diagnostic, DOM matches
- GATE 3 — DECLINE: diagnostic produced, binding not suppressed, DOM matches interpreter
- GATE 4 — no-leak lockstep: 2→1→0 observer count, post-dispose writes produce no DOM change
- GATE 5 — corpus parity: Prop + Event + multi-binding + out-of-slice throw at emit time

No PK–live-interpreter mismatch found. The differential gate ran against the real interpreter
(not a stale copy) and converged on first placement.

**§7 perf characterization (logged, not a gate):** emitter 1.42x faster at mount,
0.38x update ratio (update path identical to interpreter — expected zero delta; JSDOM
scheduling variance explains the spread).

**Emit-shape rule preserved.** Closures capture binding fields directly (`name`, `expr`,
`eventName`, `handler`, `options`), never the binding object. Confirmed in code review.

**Suite:** 250 → 262 (12 new tests, all pass). `tsc` clean. `biome` clean. `core.ts` untouched.

**Status.** Phase 1b-1 landed. Phase 1b-2 (ChildBinding/ConditionalBinding) is the next slice.

---

### 2026-06-19 — Phase 1b-2 LANDED: ChildBinding + ConditionalBinding added to emitter

**What landed.** Phase 1b-2 merges ChildBinding and ConditionalBinding support into
the emitter and its differential gate. Placement only — no logic changes beyond the 1b-1
slice. Commit `0e903c5`.

**Structural change (required for ConditionalBinding).** Flat `emitMount` split into:
- `emitSetup(ir, verdicts)` — internal; resolves IR into `SetupFn` within the CURRENT
  reactive scope (no `createRoot`). Used by ConditionalBinding to mount branch templates
  inside their own per-branch root.
- `emitMount(ir, verdicts)` — public API; wraps `emitSetup` in `createRoot`. Identical
  contract to interpreter `mount()`.

**Carry-forward rules preserved.**
- Direct-capture rule: all closures capture `expr`/`name`/`condition` directly. No
  binding-object reference in any closure. Confirmed in code review.
- DECLINE: diagnostic collected, binding still wired.
- PLAIN: wired identically to ACCEPT.
- core.ts untouched. Emitted code calls `createRoot`/`effect`/`onCleanup` only.

**Gate cases (all pass against real interpreter).**
- GATE 1 (Child) ×2 — reactive update as `.data` mutation; null/undefined → `''`
- GATE 2 (Child) — non-primitive rejection routes error identically (TC-09 parity)
- GATE 3 (Conditional) ×2 — flip parity; null alternate (pure-if)
- GATE 4 (Conditional) — 1000-flip no-leak: no DOM accumulation, observer count stays 1
  per back-end, drops to 0 after dispose. THE load-bearing case.
- GATE 5 (Conditional) ×2 — severance parity (stale write to old branch has no DOM
  effect); parent-dispose-while-mounted full cleanup
- GATE 6 (Conditional + Text) — reactive text inside branch updates correctly

**§6 perf characterization (2000 mount iters, 200 flips; logged, not a gate).**
  Child mount:   interpreter 127ms  emitter 82ms  (1.54x)
  Cond mount:    interpreter 151ms  emitter 133ms  (1.14x)
  Cond flip:     interpreter 11ms   emitter 9ms    (1.29x)

Emitter is faster at mount for both binding kinds. Flip parity is essentially
equal — expected, since flip cost is dominated by the shared condition `effect` and
`createRoot` in both back-ends.

**`GATE 5: Out-of-slice` test updated.** `kind: 'child'` (now in scope) replaced with
`kind: 'list'` (deferred). Error regex updated from `/1b-1 scope/` → `/Phase 1b scope/`.

**Suite:** 262 → 272 (10 new tests, all pass). `tsc` clean. `biome` clean. `core.ts` untouched.

**Status.** Phase 1b complete (all six PoC bindings emit at interpreter parity). Next: Phase 2
(hook emission — setCompilerEquals/setCompilerSources onto emitted sites, separate doc), built on
the emitSetup/emitMount shape. The compiler back-end is now at interpreter parity for the PoC
binding set; the deferred items (.nv front-end, List/Sync bindings, string codegen, real-browser
confirmation) remain as previously scoped.

---

### 2026-06-19 — Phase 2 CLOSED: step-3 hook emission; first specialization to reach compiled output

**What landed.** The emit back-end now feeds the step-3 equality hook. New file
`src/compiler/equality-hook-emitter.ts` (`emitEqualityHook` / `emitEqualityHooks`); for each
FALSE-policy site (mutable container) it emits `setCompilerEquals(fn, false)`. First time a
closed compiler specialization reaches real compiled output. Barrel-exported from
`src/compiler/index.ts`. `core.ts` untouched — Phase 2 only calls the existing (wired + gated)
`setCompilerEquals` setter.

**Phase 2 is NOT an emitMount extension.** Hooks attach to signal/derived CONSTRUCTION sites in
component code, before the template mounts — distinct from emitMount's template wiring.

**Step-4 NOT emitted** (decided): `setCompilerSources` stays shelved (Spec #2 net-negative);
emitting a dormant net-negative hook into production contradicts the shelve. Deferred to
step-4's own reopen trigger (Phase 2b, if ever).

**Emission policy (option-1 fidelity, §2 skip-OBJECT_IS decision).**
- FALSE → emit `setCompilerEquals(fn, false)` — the only behavior-changing case.
- OBJECT_IS → SKIP. No-op by construction (Object.is → Object.is) AND avoids the HC
  perturbation a setter write triggers (§5 finding). Confining emission to FALSE keeps the cost
  off the OBJECT_IS majority.
- DECLINE / explicit-user-`equals` → SKIP. The step-3 analysis DECLINES explicit-equals sites
  (primary protection); the runtime `nodesWithUserEquals` guard is the backstop.

**Gate 4a — emission fidelity (5/5).** FALSE emits + slot becomes `false`; OBJECT_IS no call;
DECLINE no call; explicit-equals site stays the user's predicate (analysis declines + runtime
guard both hold); batch emission touches only FALSE sites.

**Gate 4b — behavioral differential (4/4, the payoff).** `arr.push(x); set(arr)`: without
emission → Object.is sees the same reference → DOM suppressed (`0`); with emission → slot
`false` → propagates → DOM updates (`1`, `2`). Confirmed through the full `emitMount` compiled
stack. Primitive/OBJECT_IS-skipped: identical behavior, no regression. **First mechanical proof
a closed specialization benefits compiled output.**

**Finding — HC perturbation real at scale (carry forward; intersects the createSignals
tripwire).** §5 characterization (10k signals, jsdom): no-emission ~1.1μs/signal; FALSE-path
emission ~2.0μs/signal — ~82% per-signal construction overhead on the FALSE path, from
`setCompilerEquals` writing two fields (`_compilerEquals` + `equals`) → a hidden-class
transition per node. Consequences:
1. Validates the §2 skip-OBJECT_IS decision — emit-all would have put this cost on every
   non-declined signal; skipping confines it to the FALSE minority (mutable-container signals,
   typically a small fraction of a component's signals).
2. Latent tripwire, joined to the createSignals list-churn tripwire (2026-06-18) — both concern
   signal-construction cost. A FALSE-heavy component under list churn pays the structural
   createSignals cost AND this emission multiplier on its FALSE fraction. Do NOT act on the
   synthetic 10k number; when the createSignals list-churn validation runs, it should include a
   FALSE-policy-heavy row to capture the combined cost. Reopen lever for both: real-app
   list-churn evidence, not the microbench.

**Gates.** Suite 272 → 282 (10 new: 4a ×5, 4b ×4, §5 ×1). `tsc -p tsconfig.build.json` clean;
`tsc --strict` clean; biome clean. `core.ts` untouched.

**Contract impact.** None. No version bump.

**Status.** Phase 2 closed. The compiler back-end now emits binding wiring (1b) + step-3
specialization (2) for tagged-template input. Remaining renderer threads: `.nv` front-end;
real-browser gate (CC convergence). Step-4 emission and the eager/lazy (row 3) / wide-fanout
(row 5) hooks remain deferred/unbuilt as previously scoped.

---

### 2026-06-19 — `.nv` front-end scoped; syntax + component model settled

**Decision.** The `.nv` front-end (renderer stream 3, second front-end) is scoped, syntax
settled. `.nv` is a parser-owned superset of TS + HTML producing the existing IR — parallel to
the tagged-template front-end, not lowered to it. Tagged-template remains a permanent first-class
no-build path; `.nv` is the additional ergonomic surface. Both produce IR directly.

**Component model.** A `.nv` file is one or more `const Name = $component((props) => { ... })`.
Const-bound `$component(...)` calls, **not** a `component Name {}` keyword — chosen because the
const form keeps the file's top level valid TS, which (a) preserves the TS-API-delegation parser
strategy and (b) makes exports/imports the **TS module system, inherited for free** (`export const
Card = $component(...)` / plain `import`). Multiple components per file supported v0 (each → own
IR, own scope). Cross-component **composition (ComponentBinding) deferred** — define/export/import
is in scope; rendering one component inside another is not.

**Settled markers (per component):**
- `$component(...)` — enclosure; 1..N per file; each its own scope + IR.
- `$render(() => html`...`)` — **exactly 1**; the component's single output. `` html` `` markup is
  shared with tagged-template (the equivalence seam); `$render` is the singular designation
  wrapper.
- `$script(() => {...})` — **0..N**; all sharing one reactive scope = the enclosing component.
  Bare-read + mutation-write inside, compiler-erased to `count()` / `count.set()` (the 2026-06-18
  authoring-ergonomics decision, concrete). Mutation-write works *because* `.nv` owns its grammar
  (invalid TS against an accessor type; rewritten before TS sees it).
- `$style(obj | (args) => obj)` — **0..1**; the scoped rule sheet. Object or once-run factory
  (parameterizes values by constants/props, never reactive; static key-set required). Separate
  from inline reactive `style="${...}"` (→ AttrBinding).
- Holes `${ ... }` — shared delimiter with tagged-template.

**Parser strategy.** Delegates TS-body parsing to the TS compiler API; owns only the nv constructs
(`$component`/`$script`/`$style`/`$render`/`` html` ``/bare-read/mutation-write/`${}`). No hand-rolled
TS parser.

**Soundness obligation.** Front-end equivalence (Invariant FE): `.nv` produces structurally
identical IR to tagged-template on equivalent input. This single seam transitively carries every
back-end proof (interpreter/emit parity, erasure verdicts, step-3 emission) without re-proving.
Mutation-write is rewritten to the write path *before* Phase 1a erasure analysis, so the
sync-target DECLINE check still fires through the new syntax.

**Fork resolution (recorded).** Considered `.nv` file vs. marker-in-plain-`.ts`. Chose `.nv` file:
marker-in-TS cannot express mutation-write (invalid TS against accessor types). `.nv` keeps
JSX-spirit colocation (markup + code in one file) while owning the grammar — both benefits.

**Nothing prior wasted; performance unaffected.** IR-as-contract made the front-end a late, cheap,
swappable choice; every closed phase stays closed. Both front-ends erase to the same IR → same
back-ends → identical runtime code; all runtime measurements are below the front-end. The fork was
decided on ergonomics + machinery, not perf.

**Deferred (named):** `$style` scoping transform (open research, construct reserved);
ComponentBinding composition; build-pipeline integration (`.nv`→`.js` output naming + the pre-`tsc`
compile step — separate toolchain task, not parser scope).

**Path.** Renderer session builds parser + front-end-equivalence gate (sandbox); CC places + later
real-browser. Live files: `src/renderer/{ir,html-tag,comparator,interpreter}.ts`,
`src/compiler/{read-write-erasure-analyzer,signal-type-utils,types}.ts`.

**Contract impact.** None — authoring syntax is above the contract (2026-06-18). No version bump.

**Status.** Scoped, syntax + component model settled. Renderer-session handoff pending the §7
review confirmations (IR-comparison normalization, TS-API delegation, mutation-write-rewrite
ordering before erasure, PoC-binding-set-only).

---

### 2026-06-19 — `.nv` front-end review confirmations resolved; scope APPROVED

**Supplements** the same-day "`.nv` front-end scoped; syntax + component model settled" entry.
That entry settled syntax; this resolves the four approach confirmations and marks the scope
APPROVED for the renderer-session handoff.

1. **IR-comparison granularity — structurally identical at the IR-tree level, not raw bytes.**
   Same `NodePath[]`, same binding kinds in the same positions, same binding-field shapes, and
   `TemplateShape.html` equal *after the comparator's normalization* (whitespace, attribute order,
   self-closing). Whitespace/quoting differences that parse to the same tree are serialization
   noise, not drift. Reuse the renderer comparator's `structurallyEqual` normalization (same as
   the back-end differential gate) — catches real drift without false-failing.

2. **`$script` body parsing via TS compiler API — confirmed.** TS API parses bodies; the `.nv`
   parser owns only the nv constructs. **Coupled to (3):** mutation-write is invalid TS, so the
   `.nv` parser must rewrite it before a body reaches the TS API. TS-API delegation works
   *because* mutation-write is rewritten first — the ordering is load-bearing for the delegation,
   not only for erasure.

3. **Mutation-write rewrite ordering — confirmed: before Phase 1a erasure analysis and before
   TS-API body parsing.** The analyzer sees a normal write site; the sync-target DECLINE check
   (Phase 1a §4) still fires on a mutation-write to a sync-target signal — same conflict, new
   syntax.

4. **PoC binding set only — confirmed.** Six bindings; **List/Sync explicitly scoped out** of
   this phase (they follow soon after, their own work).

**Status.** `.nv` front-end scope APPROVED. Renderer-session handoff ready (scope doc + live
files). Contract impact: none.

---

### 2026-06-19 — `.nv` front-end IMPLEMENTED: parser + front-end-equivalence gate; erasure sound

**What was built (renderer session).** `nv-parser.ts` (~770 lines) + `nv-parser-test.ts`. 48/48
FE-equivalence tests + 34/34 interpreter tests green, `tsc --strict` clean. Produces structurally-
identical IR to the tagged-template front-end (IR-tree + normalized HTML), per the approved scope.

**Parser shape.** `parseNvFile` → preprocess (mutation-write + bare-read erasure) → TS-API parse →
extract `$component`s → per-component IR + erasure verdicts + diagnostics. TS-body parsing delegated
to the TS compiler API; the parser owns only the nv constructs. Hole position-classification:
text→Text, `attr=`→Attr, `.prop=`→Prop, `@event=`→Event, ternary-of-`` html` ``→Conditional (recursed
to sub-IRs).

**Erasure correctness (verified in code).**
- **Mutation-write RHS erased before wrapping:** `count = count + 1` → `count.set(count() + 1)`
  (runtime-tested 0→1→2). The earlier LHS-only rewrite (`count.set(count + 1)`) was a correctness
  bug; fixed.
- **Compound assignment desugared:** `x op= e` → `x.set(x() op erased(e))`, all 15 operators.
  `count() += 1` is structurally impossible.
- **Read-set ≠ write-set:** mutation-write fires only on `signal()` names; assignment to a
  `derived()` → compile-time diagnostic (read-only), never `double.set(...)`.
- **Scope-aware shadowing (write-safety invariant):** destructured-parameter shadowing,
  function-scoped `var`, and block-scoped `let`/`const` (with nesting) all detected via
  `collectBindingNames`/`collectVarShadows`/`gatherBlockShadows`. A name shadowing a signal is
  never rewritten to `.set()` nor erased to `()`. The "never rewrite a non-signal" invariant is
  **closed** (was partially open after the first iteration — destructuring/nested-blocks; FE-09k/l
  pin it). Self-shadow trap avoided: the `$script` body block is walked via `forEachChild`, not
  `walk`, so `const count = signal(0)` isn't collected as a shadow of itself.

**Verdict direction.** `exprReadsSignal` ACCEPT-biased — never under-reports (false PLAIN = stale
DOM = bug); false-positive ACCEPT = unnecessary effect, correctness-safe. `derived()` collected
into the read set so `${double}` is correctly ACCEPT.

**Scope §2 clarifications landed.** (a) Hole bare-reads erase to *thunks* `() => expr()` (binding
`expr` is a reactive closure); `$script` bare-reads erase to plain calls `expr()` (imperative
setup). (b) ChildBinding has no `.nv` v0 syntax — text-position holes → TextBinding; ChildBinding
stays manual-IR (back-end parity case, not front-end-syntax).

**Expressiveness delta (documented, allowed by scope §3).** `.nv` auto-produces Prop (`.prop=`) and
Event (`@event=`) bindings that tagged-template expresses only via manual IR — a genuine `.nv`
ergonomic gain. (`@` on events disambiguates event-vs-attribute, same nominal-discipline role `.`
plays for prop-vs-attribute; not decoration.)

**Known v0 limits (named, narrow).**
- Shorthand property `{ count }` not erased — author writes `{ count: count() }` (auto-expanding
  shorthand is a feature, deferred).
- TDZ corner: a `let`/`const` block-shadow treats a same-block reference *before* the declaration
  as shadowed (not rewritten). That code is already a TDZ ReferenceError in JS — "defensible out."

**Gates.** 48 FE + 34 interpreter (renderer-local). `tsc --strict` clean. No IR change, no
back-end change, no `core.ts` change.

**Contract impact.** None. No version bump.

**Status.** `.nv` front-end functionally complete for the PoC binding set, equivalence-gated.
Both authoring surfaces now feed the same proven IR → both back-ends. **Pending CC placement**
(kebab-case → `src/renderer/nv-parser.ts`, `.js` imports, vitest, full-suite count). Deferred as
scoped: `$style` scoping, ComponentBinding composition, build-pipeline integration, List/Sync,
real-browser gate.

---

### 2026-06-19 — `.nv` front-end PLACED: parser in-repo, seam confirmed live

**Supplements** the same-day "`.nv` front-end IMPLEMENTED" entry — that entry recorded the
renderer-session build; this records CC placement into the live repo under repo convention.

**Files placed.**
- `src/renderer/nv-parser.ts` — kebab-case, `.js`-explicit imports (only change from the
  renderer-session drop: `./ir.ts` → `./ir.js`). No logic changes.
- `test/renderer/nv-parser.test.ts` — 48 FE-equivalence tests, vitest harness, repo-canonical
  `.js` imports against live `src/core/core.js`, `src/renderer/{comparator,html-tag,ir}.js`.
- `src/renderer/index.ts` — barrel exports `parseNvFile`, `preprocessMutationWrites`, and types
  `NvComponentResult` / `NvDiagnostic` / `NvStyleInfo`.

**Seam confirmed live.** All 48 FE-equivalence tests pass against the live comparator/ir/html-tag
(the FE-equivalence seam: `.nv` IR structurally identical to tagged-template IR). Note the parser
does not directly import the erasure analyzer — equivalence is proven structurally against the
tagged-template front-end, which is the seam that carries the back-end proofs.

**Gates.** Full suite: 330/330 green. `tsc` clean. `biome` clean. `core.ts`, IR,
and both back-ends untouched.

**Follow-up applied.** Stale header comment in `nv-parser.ts` (claiming block-scoped shadowing is
not tracked — the pre-fix statement) corrected to match the closed write-safety invariant.

**Status.** `.nv` front-end placed and live-gated. Both authoring surfaces feed the same proven
IR → both back-ends, in-repo. Phase 0 ROADMAP: only the **real-browser gate** (CC convergence)
remains. Deferred as scoped: `$style` scoping, ComponentBinding composition, build-pipeline
integration, List/Sync.

---

### 2026-06-19 — Real-browser gate COMMISSIONED (Phase 0 final item); Chromium-to-pass, cross-engine tripwire set

**What this gate is.** The last open Phase 0 ROADMAP item — the claim deliberately
never made from jsdom: **both back-ends drive a real browser DOM identically, and real
interaction updates the DOM.** It is a CC-from-the-start task (real-browser behavior by
definition; no claude.ai half). Architect scopes; CC runs and reports; architect
verifies the claim before it is marked passed.

**Two halves (both required to pass).**
1. Back-end equivalence in a real engine: interpreter `mount()` vs emitted `emitMount()`
   on the same IR → structurally-identical real DOM, holding after signal write + flip.
   The jsdom differential gate (TC-01–TC-09 + 1000-flip no-leak) re-run against a real
   engine via the same `structurallyEqual` comparator.
2. Real interaction: a real dispatched event fires the handler, the write propagates,
   the DOM updates — the thing synthetic jsdom dispatch never proved.

**Harness.** Playwright, headless-default (CI-ready), `--headed --debug` as a flag on
the same config. Separate gate from the vitest suite (new `test/browser/`, own config,
own script) — the 330-test vitest run stays the unit/differential gate; this is additive.
No `src/` logic changes; real renderer/core/emitter modules bundled into the page.

**Engine coverage — Chromium to pass; cross-engine is a NEAR-TERM tripwire, not someday.**
- **Pass bar:** Chromium green on the full corpus (both back-ends) + interaction tests.
- **Narrowed claim (logged so it isn't over-read):** passing closes "real *Chromium* DOM
  identity + interaction," NOT "cross-engine DOM identity." Headless Chromium and jsdom
  are both non-WebKit/non-Gecko, so the original **parse5-vs-platform parse-divergence
  flag** (raised at the renderer slice, 2026-06-17) remains **OPEN** after this gate.
- **Tripwire (dated near-term):** add WebKit (+ optionally Firefox) as additional
  Playwright `projects` — near-zero harness cost, only run-time. Trigger: the next
  renderer session OR any real-app/launch milestone, whichever is first. The
  parse-divergence flag stays open until this runs.

**Flags this gate must settle (not code around).** jsdom-vs-real event dispatch (handler
path matches the interpreter suite's assumption); regex sentinel-strip survives a real
`<template>.innerHTML` parse identically to parse5. Both were explicitly deferred to
this gate since 2026-06-17.

**Soundness bar.** A real-browser back-end mismatch is a HARD STOP + escalation, not a
CC patch — it would mean the differential gate was green on a jsdom artifact. Same for a
dispatch or sentinel-strip divergence: report as a finding, do not work around.

**Out of scope.** `.nv` build-pipeline, List/Sync, `$style` scoping, perf. Behavioral
identity + interaction only.

**Contract impact.** None. No version bump.

**Status.** Commissioned, handed to CC. On pass: Phase 0 ROADMAP closes (Chromium
scope); cross-engine tripwire remains the one open follow-up.
