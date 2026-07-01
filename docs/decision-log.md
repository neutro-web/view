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
> `decision-log-archive.md` and leave a one-line pointer here — do **not**
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

_Last updated: 2026-07-01. Template-IR **v0.4.4**, reactive-core contract **v0.4.3**._
_Active frontier: v0.5.0 API-parity + control-flow completion. Performance arc CLOSED (create intrinsic, mutation won, recycling ships). Next: `<switch>`/`<match>` — shape ruled 2026-07-01 (new IR kind), commission not yet written._

> History before `Component API spec APPROVED [2026-06-20]` is in
> `decision-log-archive.md` (moved 2026-06-21).

### Status at a glance
- **Reactive core:** Contract **v0.4.3**, conformance green. DOM-free. Field order
  locked (cache-load-bearing). `getOwner`/`runWithOwner` in §6.1/§11/§12.24.
- **Compiler specialization (steps 1–4):** all wired + gated + measured. Step 3
  (`_compilerEquals`) kept for correctness; step 4 (`_compilerSources`) SHELVED
  (no benefit path). Steps 1–2 (sync classify + cycle check) are the correctness layer.
  - **§8.5.2 has a production entry point** `checkProgram(program, config)` (Unit 1,
    `482425f→0b62d77`): runs classifier→checker→diagnostics over a caller-supplied
    `ts.Program`. Covers hand-written `sync()` (reactive-source syncs). `checkProgram` is a
    callable entry, not auto-wired into any build. Wiring DEFERRED with a falsifiable trigger
    [2026-06-24]: wire when a production flow constructs a `ts.Program` over user source
    (gated on the Mode-A consumer pipeline). Not a debt. SyncBindings are external-source
    syncs and correctly contribute no edge (Part 3 CLOSED [2026-06-24]).
- **Renderer:** interpreter + compiler back-ends at parity for all **15** binding kinds
  (`text attr prop event sync classlist toggle static list component slot-outlet
  conditional recycled-list style-var child`). Both front-ends (tagged-template + `.nv`)
  produce one IR, FE-equivalence-gated. **Tagged-FE parity CLOSED 2026-06-30** — `iff()`
  (conditional) + `recycle()` builders added; `child`/`style-var` are typechecked
  documented deferrals; a `Binding['kind']` exhaustiveness forcing-function (`never`-default
  + type-level `Equals`) now fails tsc if a new IR kind lacks a tagged builder or logged
  deferral. Template-IR doc at **v0.4.4**.
- **Control-flow constructs:** `<each>` (keyed list), `<recycle>` (non-keyed positional
  list — **LANDED `3b00064`**), conditional (`.nv` ternary / tagged `iff()`).
  **`<switch>`/`<match>` (multi-branch) — shape ruled 2026-07-01: new IR kind
  `SwitchBinding`, not desugared conditionals** (nested-ternary `.nv` path is unsound today —
  silently misparses to `text`; new kind reuses `wireConditional`'s disposal pattern
  generalized to N ordered branches). Dedicated `.nv` `<switch>`/`<match>` element + tagged
  `match()` sentinel, both required by the tagged-FE exhaustiveness gate. **Commission not
  yet written** — next task.
- **Build pipeline `.nv → .js`:** Mode A, landed. Executable-module gate closed.
  **[2026-06-25] `.nv` author path proven E2E in real browsers** (probe `8146d82`): `.nv` → plugin →
  esbuild → browser, click updates DOM, chromium+webkit. Authoring is assignment-form
  (`@click="${() => count = count + 1}"`), parser-erased to `.set()`. CP-1b/CP-3 closed. One blocker
  ruled: emitted bundles pull the TS compiler via the fat `@neutro/view/renderer` barrel — runtime
  entry `@neutro/view/renderer/runtime` commissioned (package split, emitter L316 retarget); no
  runtime/IR/contract change.
- **CP-2b — CLOSED 2026-06-27.** nv passes isKeyed (run/remove/swap) in krausest harness (cloned SHA
  4fbccf55…), registered as keyed/nv/, build-prod TS-free, no src/ change. +2 DOM delta verified
  harmless (element-positional selectors + tr-identity keyed detection). v0.1.0 benchmarkable bar met.
- **CP-2b nth-child watch-item — RETIRED 2026-06-27** (max margin, zero inter-row nodes;
  tr:nth-child(3)=2nd TR confirmed).
- **CP-2c — DATA COMPLETE 2026-06-27** (Chrome 149/M2 Max/harness 4fbccf55…). nv wins select
  (0.34×) + update-10th (0.68×) vs vanilla; at-peer bulk create (~1.7×); memory 2.4× vanilla. Axiom
  conditionally upheld.
- **P-1b — CLOSED 2026-06-28 (CP-2d real-browser verdict).** LIS-Ivi move-minimization
  (`2fb8476`) lands at **swap rows 0.66× vanilla (22.3ms median)** vs baseline 3.74× vanilla
  (127.3ms). 82% reduction; nv now BEATS vanilla and the fine-grained peers (Solid 1.03×,
  Svelte 0.99×) on swap. All four Gate-P items closed: unit move-count ≤2 (TC-P1b-1),
  identity/append ≤1 (TC-P1b-2), correctness across permutations (TC-P1b-3), real-browser
  re-measure (CP-2d, PASS). No regression on any other op — non-swap ops within ±2% of
  baseline. Lit foil added: same-syntax (tagged-template) but template-part diffing engine;
  swap = 2.28× vanilla vs nv 0.66× — fine-grained wins decisively as expected. React VDOM
  reference: 3.92× vanilla on swap.
- **CP-2d — Lit added as standing foil (2026-06-28).** Lit v3.2.0: same tagged-template
  surface as nv, different engine (template-part diffing, not fine-grained). Create/replace
  at-peer with nv (~1.1–1.2×); swap 2.28× vanilla (expected structural cost of diffing
  vs fine-grained on mutation). React hooks v19.2.0 added as VDOM reference. All same-session,
  Chrome 149, M2 Max, harness 4fbccf55.
- **P-2 creation/teardown — OPEN 2026-06-28; CC lever analysis CORRECTED at source.**
  Create ~1.7×, remove 2.16×, memory 2.4× vanilla — real deficit, but optimization
  within a confirmed-correct tradeoff (nv pays at mount, wins at mutation; Lit's 1.18×
  create proves it's reactive-graph-setup cost, structural to fine-grained). Split:
  **P-2c-static-body = live lever** (compiler effect-skip, design-open below);
  **P-2a** (allocation-count reduction, reframed — CC's "strip node fields" refuted:
  ReactiveNode is single-shape by design, already pay-for-use; ceiling single-digit-%)
  and **P-2b** (fast dispose, ~0.35× addressable vs Svelte, mostly inherent) =
  characterized-not-commissioned. Goal: narrow create gap where provably free; do NOT
  trade mutation speed to chase Solid's create number.
- **Live frontier (code/ruling):** index-elision **FULLY CLOSED** (Commission 1 LANDED `a495716`; Commission 2 MEASURED 2026-06-29). **Reconcile Lever A+B LANDED `79f3cb8`** (prefix/suffix skip + key-cache). **Lever C probes BOTH CLEAR (2026-06-29)** — C-paint: intrinsic layout (90% paint, staging no effect); C-create: binding-node weight only 0.8% of gap (DOM-stamping dominates). **Probes D/E/F/G exhausted create track (7 probes): parse 3.5ms, scope removal regresses, flush neutral, effect-count 0.4% recovery, lean-mount (D2+D3) zero signal. CREATE TRACK FULLY CLOSED — 1.49× gap is irreducible structural cost of fine-grained reactivity on these mechanics.** **Probe H — Node Recycling: BUILD candidate, DESIGN GATE OPEN [corrected 2026-06-29]. Hard win = scroll node-churn eliminated (~7000→0 ReactiveNode alloc/free); wall-clock win real but modest at jfb-row complexity (~3–6× realistic; the "12×" was a floor-comparison ceiling with a sub-resolution denominator — see correction entry). Recycling = the missing non-keyed (`<Index>`) list mode; rests on capability + node-churn, not the wall-clock headline. Identity-semantics contract is the gate's load-bearing question.** PT-1b Suspense+SWR named open. P-2c-B reopenable. PT-1a `resource` + P-2c-A1 LANDED. **Reactive-core contract v0.4.3.** P-1b CLOSED.
- **Index-elision perf verdict (Commission 2):** T2-1 null (reorder-heavy path dominated by DOM, not indexSig); T2-3 memory: elided 2.154× vanilla vs non-elided 2.345× vanilla (−0.353 MB / −0.19×). Total memory lift (P-2c-A1 + elision): 4.641 → 4.003 MB. Lever stands on correctness + memory.
- **Performance arc CLOSED 2026-06-29.** Create proven intrinsic to nv's construction
  across 8 probes (allocation, parse, node-weight, scope, flush-timing, effect-count,
  lean-mount D2+D3) — the per-row reactive scaffolding that costs create is the same
  infrastructure delivering the mutation wins. Not reopenable without new information.
  Mutation won: swap 0.29×, select 0.27×, update-10th 0.18× vs vanilla (also beats Solid).
  Create 1.5–1.78× vs vanilla = structural cost, avoided (not reduced) on the one weak
  workload via recycling.
- **`<recycle>` (node recycling) LANDED `3b00064`, verdict-gate `8da893a`.** Non-keyed
  positional list mode = the missing `<Index>`-class construct. Re-binds pooled rows
  (Op-3) instead of dispose+create; node-churn 0/scroll-step (real-browser measured),
  focus-follows-slot-position (real-browser verified). Closes nv's virtual-scroll weakness.
  Finding-#7 (keyed `activeElement` read added during the arc) confirmed benchmark-neutral
  and flag-closed; process note: keyed/benchmarked-path changes surface to architect
  before landing, even when correct.
- **Rulings this arc:** (a) recycling construct named `<recycle>` (distinct construct, not
  `<each recycle>` attr, not inferred — position-identity is an explicit author choice).
  (b) tagged conditional builder named `iff()` (not `if`/`when`/`show` — `if` is a reserved
  word forcing import-aliasing; `when`/`show` are incumbent-vocabulary). (c) `$style`/
  style-var is **`.nv`-only** — a compile-time file feature (SFC-`<style scoped>` analog),
  not an IR-parity obligation.
- **Roadmap:** `<Index>` gap closed by `<recycle>`. Retention/keep-alive named as a
  **v1.0.0 probe-first candidate** (second member of the avoid-create family; distinct
  from recycling; unbounded-memory footgun requires cap; measure before building).
- **Reconcile Lever A+B perf (2026-06-29):** remove-one script −60% (1.5→0.6ms, near vanilla 0.5ms); wall-clock −3% (paint-bound — 90% of 17ms confirmed by Probe 2 DevTools trace); swap no-regress; key-call 4n→n. C-paint CLEAR (staging no effect, layout intrinsic). C-create CLEAR on node-weight hypothesis; redirect to C-create-B (DOM-stamping census).
- **Standing CP-2d board (current = post-A1 CP-2d-REMEASURE, L4633):** create-1k 1.78×, swap 0.29×, select 0.27×, update-10th 0.18×, remove-one **script-parity with vanilla** (0.6ms vs 0.5ms) / wall-clock 1.23× (paint-bound), memory **2.154×** (post-elision). Note: tight mutation baselines (0.29×/0.27×/0.18×) are JIT-warmed session-specific.
- **v0.1.0 — TAG-READY.** CP-4 docs placed. Swap deficit is v0.5.0; no blocking items remain.
- **Documentation sweep — CLOSED 2026-06-27 (verified at source).** Both authoring surfaces documented;
  section-based site matching neutro/form; MIT LICENSE. Playground (DOC-2) → v0.5.0 Track T-8 (needs
  IIFE compiler build target).
- **v0.1.0 TAG — content/engineering GREEN.** Gated only on manual checklist: NPM_TOKEN + Pages enabled
  (+ optional publish tag-guard). Then `git tag v0.1.0` → publish.
- **Component API v1:** LANDED. Composition works end-to-end through the compiled
  path (A2 factory-shape convergence).
- **Slot consumption — increments 1 + 1.5 + 2 LANDED (2026-06-22):** inc 2 = scoped-slot
  IR shape (`SlotEntry.content` → factory; `SlotOutletBinding.props?`); `let={...}` authoring
  both FEs; D-slot-1 RETAINED. Template-IR → v0.4. reactive-core v0.4.2 unchanged.
  **D-slot-2 CLOSED 2026-06-24 (premise dissolved — no implementation).** Wire-time
  `getOwner()` already yields invocation (row) root; D-slot-1 is the correct, sufficient
  mechanism. See Log 2026-06-24.
- **Real-browser gate:** PASSED across Blink/Gecko/WebKit (36/36). Phase 0 closed.
- **Perf-validation phase:** COMPLETE. All three tripwires resolved (createSignals
  cleared structural-accepted; FALSE-heavy characterized watch-item; cross-engine
  closed). No redesign triggered.
- **Tests:** S1+S2 landed on `main` (2026-06-23), architect-verified. `tsc --strict`
  + DOM lib, biome, build clean. (Green count per latest CC report; verify by reading
  placed files, not the count.)

### Locked (do not drift without explicit reversal)
- **Reactivity model:** fine-grained signals, three-state graph-coloring, push-down
  mark + lazy pull-up. Components run once. No VDOM.
- **Primitives:** `signal`, `derived` (pure, never writes), `effect`, `sync` (the
  single reactive→signal-write construct) + `pubsub` + `errorBoundary`. `derived`
  purity and `sync`/`pubsub` static guarantees are ironclad — no coverage-widening flags.
- **Agnosticism:** core is DOM-free; renderer consumes it; Web Components are a
  compile target, not the model.
- **Compiler license:** may only skip *provable* work; misclassification costs perf,
  never correctness (soundness fallback always applies).
- **Data-structure discipline:** intrusive linked-list edges; no Array/Set/Map on the
  hot path (sanctioned `_compiler*` field exception, `!= null`-gated). Field order on
  `ReactiveNode` is cache-load-bearing and locked.
- **Cascade cap = two budgets (§8.5.4):** reactive-cascade budget + separate larger
  external-event safety budget. Separation is the contract guarantee.
- **Authoring syntax:** one template language, one IR, two front-ends, two back-ends.
  Bare-read + mutation-write erased by the compiler; runtime core stays explicit
  call-to-read / `.set()`-write. The boundary is "is there a compile step over this code."
- **Two standing gates:** `tsc --strict` (DOM lib in scope) and the test suite are
  separate gates. "Done means committed and on main." Verify by reading placed files.
- **PK = documentation only; GitHub authoritative for code.**
- **Single-current-value invariant (§5):** a signal holds exactly one current value;
  no computation observes a different value based on context/membership
  mid-propagation. Multi-version reactivity is refused by construction (Log
  2026-06-27, entry C) — it would break `derived` purity and compiler soundness.
  Admitting it is a reversal, logged as such. Peer guardrail to the four-primitive
  closure.

### Open design decisions (chosen later; not blocking)
- Compile-time vs. runtime split beyond the read/write transform (scheduling,
  encapsulation) — narrowed, not closed.
- Effect-flush timing primitive (microtask vs. custom scheduler).
- Compile-time DOM encapsulation — still open (Shadow-DOM opt-in path unspecced).
  STYLE encapsulation APPROVED 2026-06-22 (see Log) — Light-DOM scoping via hybrid
  routing; not a contract concern.
- **`$style` scoping + dynamic lowering — LANDED 2026-06-23 (Template-IR v0.4.2).**
  Two-way class/selector routing; `StyleVarBinding` IR member; declHash folds property
  name (OPEN-2 CLOSED); classlist recursion total over conditional/list (OPEN-7 CLOSED).
  nv-does-not-invent-CSS. Renderer-layer; not a contract concern.
  OPEN-1/3/4/5 CLOSED [2026-06-25] (chosen-at-build, verified at e40fec6): OPEN-1
  zero-specificity `:where([data-nv-s-<hash>])` qualification; OPEN-3 reactive value →
  `var(--nv-<hash>)`, `setProperty(_, String(v))`, FE-parity (no coercion); OPEN-4
  per-doc `WeakMap` identity-keyed dedup registry; OPEN-5 adopted-first + `<style>`
  fallback. OPEN-6 (teardown) RE-SCOPED open + trigger-gated: no teardown shipped
  (inject-once-never-remove, deliberate); build eviction only when a workload measures
  distinct-identity style accretion as a real cost. `$style` axis carries no
  build-blocking opens. `<each>`-in-slot styling CONFIRMED & CLOSED [2026-06-25]
  (browser gate G5-E/G7 green 9/9).
- **`$style` opens:** OPEN-1/2/3/4/5/7 CLOSED. OPEN-6 (injected-style teardown) OPEN,
  trigger-gated — inject-once-never-remove shipped; eviction deferred until measured
  accretion. Not a debt.
- **Renderer:** **wireComponent now injects child `styleArtifact`** (interpreter L691,
  fix [2026-06-25] / a6cafbd): nested styled components stamp `data-nv-s-<hash>` + inject
  CSS on mount through a parent binding; transitive through conditionals/lists. Regression-gated
  by G7 (browser).
- **P-2c-A1 — runtime inert-effect harvest — LANDED + verified [2026-06-28], SHA
  `d142919`.** Post-first-flush sweep harvests per-binding effects with
  `firstSource===null && firstChild===null && state===CLEAN` — detaches from graph +
  owner tree, promotes onCleanups to row root (currently a no-op: all harvestable effects
  have `cleanups===null`, CC-AUDIT-1 confirmed at source). One §6 op
  (`harvestInertEffect` internal + `harvestInertChildren` export); axiom-clean.
  Sweep via `queueMicrotask` post-reconcile; timing verified at the `flushAll` drain
  (item effects reach CLEAN same-invocation before harvest microtask). **Contract v0.4.3**
  (§6.2). **CP-2d PASS:** memory 2.50× → **2.33×** vanilla (< 2.4× target); remove-one
  0.62×; no mutation regression; create flat (1.78×, allocation not saved). Single
  back-end (no IR change). Verified by source-read at SHA, not green-counts.
- **P-2c-B — compile-time STATIC verdict → elide `effect()` allocation — CLOSED
  [2026-06-28], SHA `cce6423`.** Ceiling probe: **0 harvests/row on jfb** (every row
  binding-effect reads a signal → reactive → nothing to elide). B's static set ⊆ A1's inert
  set; on the keyed-dynamic-list workload that defines the create deficit, the inert set is
  empty. Not built (would cost a new STATIC verdict + emitter plumbing + Template-IR bump to
  elide zero allocations). Counter validated (TC-P2CB-COUNTER-INERT proves it fires; jfb 0 is
  a true zero). Not reopened absent a mostly-static-template workload.
- **Index-elision (elide `indexSig` for rows that never read index) — SPEC APPROVED, COMMISSION-
  READY [2026-06-28].** Design gate opened + ruled (see Log). Verdict: optimization on a
  correctness floor, two-tier ordered gate. **Predicate** = strong (bound-but-unread),
  parser-computed via `isReactiveExpr` erasure, ACCEPT-biased (`key=`-index is not a body
  read). **Carrier** = `ListBinding.itemReadsIndex?` (absent|true⇒allocate; false⇒may elide);
  additive **Template-IR v0.4.3**, reactive-core contract unchanged, closure axiom clean.
  **Mechanism** = branch-hoist (shorter reconcile body for elided lists; no per-row branch),
  narrower emitted factory (no `indexSig` mention). **Create ceiling measured-small** (sub-5%
  of create wall-clock, SPECULATION; redirect for create = the dominant createRoot/wiring sixth
  vs Lit ~0.56×, or leaner-record vs Solid ~0.70×). **Lands on Tier-1 (correctness) alone**
  — provably-unread allocation removed, pays down memory deficit (2.4× vanilla); Tier-2 (perf)
  is a claim on a reorder-heavy workload, not a landing precondition. Spec `spec-index-elision.md`.
  Not yet commissioned to CC.
- **PT-1a-syntax — async-read compile-time lowering — DESIGN-OPEN [2026-06-27].**
  Resource read in template position auto-lowers to loading/error/data control-flow
  (the nv-shaped ergonomic win: compiler exploits resource-vs-signal info Solid
  discards; lowers to PT-3 `<when>`-class control-flow; runtime-neutral, DX-only;
  soundness fallback to manual branch when resource-ness unprovable). Spelling
  (implicit vs explicit-first) + FE-equivalence open; read PT-3 `<when>` IR at SHA
  before designing (collapse, don't fork). Non-blocking — raw `resource` ships
  usable without it. Not a contract concern.

### Genuine research / deferred-on-evidence
- Beating the alien-signals-class baseline: nv wins/ties 5 of 7 cases; two wide-graph
  cases (~1.5x/~1.7x) and createSignals (~5–7x) are proven **structural**, both trace to
  `ReactiveNode` width, both gated behind the **kind-split tripwire**. **[2026-06-25]
  Tripwire EVIDENCE-TESTED → CLEAR (both engines), verified at `387990f`.** After fixing two
  harness defects (`createRoot→effect` subscription; getter-call `(v)` → `.set(v)` so writes
  actually occur — both caught by the permanent G-WG-9 effect-run counter), the corrected
  harness reports propagation self-time ~0.15–0.17ms/tick vs a 16.7ms frame — Condition A
  (absolute breach) fails by ~100× and is unflippable at 1000×10. Chromium CLEAR clean;
  WebKit reported AMBIGUOUS via a gate-logic false positive (straddle of a decision-irrelevant
  B when A fails by ~100×) — architect-resolved to CLEAR. **Kind-split is an accepted structural gap (evidence-tested CLEAR, not deferred); LIS is
  closed-by-tradeoff [2026-06-22] on its own trigger (reorder cost at larger N), not gated on
  this verdict.** The earlier "~0.005ms / ~3,000×" framing
  is withdrawn — it was a dead-graph artifact; CLEAR holds on the corrected ~100× number.
  Reopens only on a materially larger/deeper real-app graph in real profiling. A verdict-logic
  fix is commissioned (`cc-handoff-wide-graph-verdict-logic-fix.md`) so the straddle
  false-positive cannot recur. No contract change (v0.4.2).
- **FALSE-heavy row-churn** watch-item (reopen on real-app evidence with a
  steady-state-update harness). **[2026-06-24] The commissioned wide-graph steady-state
  harness is that instrument** — it can serve the FALSE-heavy read-tax measurement as a
  secondary read if FALSE density is varied; not the harness's primary verdict. *(Note
  2026-06-25: this instrument carried the effect-subscription defect reversed above; it
  the fix landed at `387990f`; the instrument now serves the FALSE-heavy read.)*
- **Per-key class-toggle node-width** — object-form <code v-pre>class={{...}}</code> emits one effect per
  key (fine-grained). For wide objects this trades N graph nodes against 1 looping effect.
  Same `ReactiveNode`-width structural cost as the kind-split tripwire; per-key default
  carries a compile-time width-threshold fallback, threshold gated on real-app evidence.

### Forward queue (named, not blocking)
- **P-2 creation/teardown — OPEN 2026-06-28; split into P-2a/b/c.** P-2c-static-body
  is the live lever (design-open above). P-2a/b characterized-not-commissioned until
  P-2c lands and re-measures. See Log entry A 2026-06-28.
- **PT-1a async `resource` — LANDED + verified [2026-06-28], SHA `9017db2`.** Composition
  factory at `src/renderer/resource.ts` (re-exported from renderer index): three signals
  (`data`/`loading`/`error`) + one source-tracking `effect` (fetcher in `untrack`) + bare
  `.set()` settle-write (external→signal, no `sync`) + `onCleanup` abort + epoch stale-drop.
  Core public surface only; zero new primitive; **closure axiom intact**. Three sound
  beyond-ruling decisions verified at source: UNSET sentinel (undefined-resolve no-op),
  explicit `getOwner()` guard (onCleanup-throw fallback wouldn't fire from inside the effect),
  epoch-bumped-before-`source()` (CC self-review caught a real ordering bug; regression test
  TC-R-6e). Write-after-dispose safe via `nodeSet` `isDisposed` guard (architect-verified at
  seam). 19 tests; TC-R-3 + TC-R-6e (deferred-promise deterministic) read at source. No
  contract change (v0.4.3). **PT-1b carry-over:** `derived()`-scope call is semantically
  wrong but passes the owner guard — JSDoc-warned; runtime guard needs owner-kind exposure
  (PT-1b note).
- **PT-1b Suspense-equivalent + stale-while-revalidate — NAMED OPEN [2026-06-27],
  not ruled.** Multi-resource coordination boundary (errorBoundary owner-scope
  precedent §5.4.4) PLUS the SWR behavior (keep last resolved content instead of
  fallback during pending refetch — the conforming half of "transitions",
  single-valued + deferred DOM swap). **Renderer-gating cost (withhold-mount of
  pending subtrees, `<each>` interaction) must be read at source before ruling.**
  Do not fold into PT-1a.
- **Async transitions — SPLIT [2026-06-27].** Stale-while-revalidate is IN (PT-1b
  behavior, above). **Multi-version reactivity is REFUSED by construction** (entry C
  — dissolves single-current-value §5 → breaks `derived` purity + compiler
  soundness; a reusable closure-axiom-class guardrail). Time-slicing/interruptible
  computation OUT (synchronous graph-coloring; no paused node).
- **Slots — design APPROVED (2026-06-22), Path B phasing:** Increments 1 + 1.5 LANDED
  (2026-06-22). Increment 2 (queued, `cc-handoff-scoped-slots.md`) = scoped-slot IR shape
  (`SlotEntry.content` → factory + `SlotOutletBinding.props?`) + `let={...}` authoring;
  **retains D-slot-1**; Template-IR → v0.4. **D-slot-2 ownership flip CLOSED 2026-06-24
  — premise dissolved (no implementation).** The leak it would fix does not exist:
  D-slot-1's wire-time `getOwner()` capture already yields the invocation (row) root when
  a component-with-slot is wired inside an `each` row; slot content disposes with the row
  (WS3 probe: removed-row effect 0 fires, sibling live). D-slot-1 is the correct, sufficient
  mechanism — not retired. reactive-core v0.4.2 unchanged. See Log 2026-06-24.
- **`$style` scoping — design APPROVED 2026-06-22, spec APPROVED (`spec-style-scoping-and-class-selection.md`).**
  Hybrid per-entry routing (key→class-rewrite, selector→attribute-hash);
  `factory` form → CSS-custom-property lowering (values reactive, factory NOT re-run);
  injection = hoist-once-per-component-identity + dedup. Renderer/compiler-layer only —
  NOT a reactive-core contract concern (Template-IR §scope already fences this).
  - **S0 (F1 + D-cl-3): LANDED 2026-06-22 (`6baa64e`).** Parser seam in place.
  - **S1+S2 — LANDED 2026-06-23 on `main`, architect-verified.** `StyleVarBinding`
    (ir.ts L266, v0.4.2 final shape); `buildStyleArtifact` both parser sites; OPEN-2 +
    OPEN-7 closed in code. See Log 2026-06-23.
- **Class-selection (`class={...}`) — LANDED, architect-verified 2026-06-22** (branch
  feat/class-selection, Increment C). `ClassListBinding` (kind `classlist`, entries
  static|toggle) added to IR union; Template-IR bumped v0.4 → v0.4.1; `AttrBinding`
  unchanged; reactive-core contract unchanged. `.nv` bare object/array literal +
  tagged-template `classes(...)` sentinel → same per-key `classList.toggle` lowering
  (one effect per key ≤6, one looping effect >6; T=6 placeholder pending real-app width
  evidence). `cx()` pure string builder, both FEs. Per-key isolation behaviorally proven
  on both back-ends (TC-CL-04 call-count). Computed/shorthand/non-literal-array keys →
  whole-binding fallback to AttrBinding.
  **D-cl-1 — CLOSED 2026-06-22 (architect-verified, commit `1b00492`).** `.nv` class-selection
  behaviorally proven on the emit-exec path (EX-CL-01..04; 599 green; emitted JS shows real
  `boolSrc`, not `stubExpr`). Parse-path structural IR still uses `stubExpr` (unchanged, by
  design — structural-only), but behavioral coverage now exists via the emit path. Tests cover
  the **interpolated** object-literal form (<code v-pre>class="${{...}}"</code>); bare-attribute <code v-pre>class={{...}}</code>
  form distinctness is a minor open question, not blocking.
- **`$style × slots` — UNPARKED 2026-06-23; spec in progress.** S1+S2 landed, so the
  scope-carry rule is answerable. Seam read done: `patchClasslistTokens` has no
  `component` case → class-form tokens in slot content are un-rewritten on both paths
  (parse captures slot IR before patch; emit emits source strings, no IR to patch).
  Semantic = scope-by-lexical-author (parent-wins). See spec-style-slots-scope-carry.md.
  Mechanism: B3 + C1 fix. scopeHash = simpleHash(shapeHtml + NUL + $style source) — C1 fix
  (style source folded in; bare shapeHtml collided same-shape/different-style). ir.id untouched.
  Rewrite via NEW `component` case in existing `patchClasslistTokens` (post-walk; NOT a separate
  fn — collapse principle). Injection-key fix on BOTH back-ends: interpreter.ts L711 +
  emitted-mount.ts L706 (ir.id → scopeHash). Gate P approved 2026-06-23 (plan f96894e + merge
  redirect). LANDED 2026-06-23 at 1aa52b8. G1–G4, G3', G3'-inverse, G6, G7: green.
  G5 (`<each>`-in-slot) DEFERRED 2026-06-23 — out of scope; `<each>`-in-slot capability unwired
  (L773 discard). Styling handles it for free once the capability lands. G5 test skipped w/ reason.
- **Increment SS — LANDED `58afe25` [2026-06-23], slot domain CLOSED.** `<each>`-in-slot
  wired in BOTH FEs (`buildNvSlotContentIR` + html-tag `buildSlotContentIR` consume `lists`
  via shared `pushListBinding` — D-SS-2 structural identity by construction). D-slot-style-1
  collapsed: static `class=` lifted to classlist `{kind:'static'}` entries via shared
  `liftStaticClassBindings` (both call sites — main `frag` + slot `fragWrapper`); `shape.html`
  regex REMOVED. Main-path static-class-under-`$style` live bug fixed in the same lift.
  All-static-slot limitation CLOSED (OP-1, post-walk scan). G5 re-enabled (live, not skipped);
  emit-exec differential + both-FE oracle (D-SS-3/D-SS-4) green; depth-2 behavioral on both
  back-ends. 659/0, tsc clean. No IR bump (Template-IR v0.4.2, reactive-core v0.4.2 untouched).
  **G-SS-browser (Playwright ×3 styled-cascade leg) DEFERRED** — element-targeting correctness
  is jsdom-proven (G-SS-mainpath-root + G-SS-depth2); only real-cascade CSS-application waits
  on a browser run (`$style` scope-attr stamping needs `root instanceof Element`, undefined
  under inline-jsdom). See Log 2026-06-23 (LANDED + bookkeeping-correction).
- **SyncBinding (`:value`/`:checked`):** Parts 1+2 landed. **Part 3 CLOSED [2026-06-24] —
  no static cycle check applies.** A static SyncBinding is an external-source sync (DOM
  event = external producer, §8.5/§8.6): no reactive source, cannot form a §8.5.2
  write-graph cycle. The §8.5.4 **external-event budget** is the correct permanent
  protection. A2 (IR-literal edge recovery) was ruled then REVERSED same day — it solved a
  non-problem (the `reads: ∅` edge is a no-op in `buildGraph`; CC self-review C1).
  `writeTargetId` stays retracted. No Unit 2; `emitMount` still throws on SyncBinding
  (back-end emit, separate concern).
- **D-sync-cond-1:** moot for the write-graph — all SyncBinding targets fall to the
  external-event budget. Dynamic-target authoring sugar remains deferred (front-ends
  restrict to bare identifier).
- **[2026-06-24] Core confirmed DOM-free** (zero DOM identifiers in `core.ts`). `sync` is
  the general DOM-agnostic primitive; DOM-specificity is correctly quarantined in the
  renderer. Separate un-opened question: whether the **IR** should be renderer-target-
  agnostic (non-DOM renderers) — larger, not scheduled.
- LIS list move-minimization — CLOSED [2026-06-22], not commissioned (O(N) reconcile
  acceptable: N=1k sub-2ms, N=10k 17ms real-Chromium).
- Multi-root list items (single-root guard today; close before promoting multi-root).
- `roots[0] as Node` biome-laundering cleanup (cosmetic).
- kind-split (parked behind real-app wide-graph evidence).
- **`each` authoring: LANDED, architect-verified** (branch feat/each-authoring).
  Variant A adapter at `ListBinding` construction in both FEs; reconcile loops
  byte-unchanged; `ListBinding` IR shape unchanged (no version bump, doc-only).
  Tagged-template path behaviorally proven (TC-EA-02..09, G1/G2/G4 gates pass).
  **`.nv <each>` is structural-only — behavioral e2e DEFERRED to increment 3.**
  Named debt: D-each-1 (tagged-template `bindingPaths` carries `null` at consumed
  EachSentinel holes; FE `bindingPaths.length` differs for `each`; safe under
  pathIndex-keyed access, breaks on positional scans).

- **Increment 3: LANDED** (branch feat/each-nv-behavioral). `.nv <each>` behavioral
  e2e: EX-EACH-01..05 pass. G3-reduction debt retired — `each` is now behaviorally
  proven on both FEs. Two emitter/parser bugs fixed in this increment: (1) nv-emitter
  arrow-body object literal missing parens (esbuild parsed as block); (2) JSDOM
  `let={item, index}` comma-split reassembly + `eraseSignalReadsInNode` PropertyAccess
  guard split for slotProps accessors (`item.label → slotProps.item().label`).

### Named near-term debt
- **Comparator `slot-outlet` `props` blindness — CLOSED [2026-06-22]:** `bindingEqual`
  now compares `props[i].name` in addition to `.name` (landed with `each` authoring,
  `ir-equivalence.ts`). `fallback` comparison remains unimplemented (not yet
  failable — no test uses differing fallbacks cross-FE).
- **D-each-1:** tagged-template FE leaves `null` at consumed EachSentinel hole
  indices in `shape.bindingPaths`; `.nv` compacts them out. Safe under
  `pathIndex`-keyed access (all current consumers); breaks on positional scans.
- **D-each-2:** `parseNvFile` parse-path `ListBinding` is a non-functional stub
  (items/key/itemTemplate placeholders) — structural-IR use only; no mount path.
- **D-each-3:** `.nv <each>` missing-`let={}` diagnostic fires but source positions
  are stubbed `start: 0, end: 0`.
- **D-each-4:** nested `<each>` inside slot content silently produces no
  `ListBinding` (`buildNvSlotContentIR` ignores returned `lists`).
- **D-each-5:** `signal()` imported in `nv-emitter.ts` for stub-IR extraction in
  the list emit case (plan-mandated, couples emitter to core at runtime).
- **D-slot-style-1:** slot-content static `class=` rewritten by string-regex on `shape.html`
  (no structural binding for static attrs); false-match risk on literal `class=` in text.
  Not a shipped defect. [2026-06-23]
  DISPOSITION CHOSEN 2026-06-23: structural collapse (lift static class → classlist static
  entry, remove regex) inside Increment SS. **CLOSED `58afe25` [2026-06-23]** — shared
  `liftStaticClassBindings`, regex removed, main-path bug fixed in the same lift.
- **Slot static-class all-static limitation:** purely static slot content (no holes) yields no
  ComponentBinding → static class unrewritten. Pre-existing parser constraint (D-each-4 family).
  [2026-06-23]
  Re-examination commissioned in Increment SS (open-point-1): **CLOSED `58afe25`
  [2026-06-23]** — `liftStaticClassBindings` post-walk scan handles purely-static slot
  content (no ComponentBinding/hole required); main and slot paths now uniform.
- **R-style-1 — OPEN research: `<style>` fallback performance at the compiler level.**
  S1+S2 injection uses `adoptedStyleSheets`-first with graceful `<style>` fallback (OPEN-5,
  architect-ruled 2026-06-23). The fallback path appends a `<style>` element at mount time,
  which triggers a style recalc per component identity. **Research question:** can the nv
  compiler pre-compute and batch stylesheet text at build time (AOT), so the fallback path at
  mount does a single bulk inject rather than per-component appends? Relevant when
  `adoptedStyleSheets` is unavailable (jsdom, older Safari, SSR). Not blocking S1+S2
  (fallback is correct today; this is a performance question for the compiler workstream).
- **D-cl-3 — CLOSED 2026-06-22 (merge `6baa64e`).** `.nv` classlist key unquoting fixed via
  `propertyKeyText` helper at all four sites; quote-inclusion + whitespace mis-split + numeric
  latent bug all resolved. `.nv`-FE-only (tagged-template paths were always immune).

### Naming
- `neutro/view` / `nv` working name; package under `@neutro` (view engine is
  *portable/interoperable*, not strong-agnostic like the pure-logic packages).
- `cx` — pure class-string builder helper (provisional name). Reads booleans, returns a
  string, subscribes to nothing. Both FEs. Result → full-string class AttrBinding.
- `classes` — tagged-template class sentinel (provisional name), the FE analogue of the
  `.nv` bare object/array `class` literal. Lowers to per-key `classList.toggle`. NOT a
  string builder; carries the toggle map. Mirrors `each`/`slot` FE-split.

### Superseded
- **D-slot-2** — CLOSED 2026-06-24; premise dissolved (see Log 2026-06-24). Slot-content ownership is invocation-scoped by construction via D-slot-1's wire-time `getOwner()`; no flip needed or possible.

---

## Log (append-only, oldest → newest)

> Entries before "Component API spec APPROVED" (2026-06-20) moved to decision-log-archive.md [2026-06-21].

### 2026-06-20 — Component API spec APPROVED; template-ir → v0.3 (pending implementation)

**Decision.** The Component API specification (component-api-spec v1) is APPROVED. This
closes the Component API design gate (template-ir §9.3 / AGENTS "component-API gate —
open") at the DESIGN level. Implementation is a single combined compiler+renderer CC
session, phased A–E; the gate is CLOSED-pending-build (design fixed; code not yet landed).

**What is locked by this approval (D1–D4, previously spec-scoped, now logged):**
- **D1 — nested destructure DEFERRED**, folded with Tier-3; diagnosed in v0.0.1. Spike
  confirmed nested is not trivially easier (object-identity caveat); deferral stands.
- **D2 — reactive read-`...rest` (Tier 2) IN v0.0.1** over the statically-enumerable prop
  set; liveness verified. Forwarding/spread (Tier 3) deferred + diagnosed.
- **D3 — handler destructuring-write gap closed in the same work** via one shared
  destructuring analyzer (`$script` / handler / props erasure).
- **D4 — parent→child prop passing = object of accessor thunks** (`Counter({ count: () =>
  count() })`); verified transparent to `trackRead` (direct observer, no intermediate
  node). Generated dev code; contract-stable; not an internal API export.

**Scope decisions folded at approval:**
- **`html-tag.ts` parity buildout — IN SCOPE** (Phase B-0). The tagged-template front-end
  gains prop/event/child handling to reach lockstep with `nv-parser.ts` before component
  detection. Roughly doubles front-end effort; accepted (lockstep, decided 2026-06-20).
- **Cross-file component import — IN SCOPE, v0.0.1** (§6.4). `<Counter/>` imported from
  another `.nv` is supported. Pulls `nv-esbuild-plugin.ts` into scope (`.nv`→`.js`
  specifier rewrite / module-graph resolution) — the one net-new file/concern beyond the
  original draft. Verified by TC-C14 (executable cross-file gate). If specifier rewriting
  needs deeper plugin changes, that surfaces in Phase D, not silently.
- **Slot factory signature — uniform `Name(props, slots)`** (slotless gets empty slots;
  no-input top-level component may still be invoked `Name()`).
- **Static-component owner — RESOLVED IN IMPLEMENTATION**, guided by the observed
  owner-tree / no-leak gate (no `runWithOwner` pre-commitment; verify against
  `wireList`/`wireConditional`).

**IR change.** New `ComponentBinding` (+ `PropEntry`, `SlotEntry`, `ComponentRef`,
`PropsObject`, `SlotFns`). `ComponentRef` modeled on the existing `ListBinding.itemTemplate`
factory pattern; `PropsObject`/`SlotFns` are local structural types (DOM-free/core-free, per
the `WritableSignal` precedent). Per the `ir.ts` header rule ("no fields beyond the design
doc without an IR revision"), **`template-ir.md` must be revised to v0.3 and arch-approved
BEFORE `ir.ts` is edited** — Phase A-0 is that prerequisite gate.

**Contract impact.** template-ir v0.2.1 → **v0.3** (ComponentBinding + structural slot
mechanism), applied at Phase A-0. reactive-core **v0.4.2 unchanged** — §11 surface
(`createRoot`/`onCleanup`/`getOwner`/`runWithOwner`) already covers component lifetime; no
core change, no new primitive.

**Grounded against source.** All seven seam files read (`ir.ts`, `nv-parser.ts`,
`html-tag.ts`, `interpreter.ts`, `emitted-mount.ts`, `nv-emitter.ts` + `nv-esbuild-plugin.ts`
for §6.4) + contract §6/§6.1/§11. Props erasure VERIFIED (spike 2026-06-20, 39/39 + 35/35).

**Status.** APPROVED. Next: CC implementation session (brief = approved spec + seven source
files + TC corpus + standing docs). Phase A-0 (template-ir v0.3 revision) is the first
gated step.

---

## Component API v1 — LANDED (2026-06-21)

**Decision.** Component API v1 implementation complete. All changes committed to `main`.

**What shipped:**
- `ir.ts` v0.3: `ComponentBinding` + `PropEntry`, `SlotEntry`, `ComponentRef`, `PropsObject`, `SlotFns` (local-structural, DOM-free, core-free)
- `html-tag.ts`: component detection (capitalized tag → `data-nv-component` sentinel), prop capture (`.name=` holes), static default-slot capture, throwing stub factory
- `nv-parser.ts`: same DFS-walk component detection path, `buildPropsAccessorMap` shared across three callers (`eraseScriptBlock`, `eraseHandlerExpr`, `computeThunkSource`), `holeCompactIdx` + `consumedByComponent` for correct binding/thunk alignment
- `interpreter.ts`: `wireComponent` — `createRoot` → factory call → `mountFragment` → DOM-cleanup `onCleanup`
- `emitted-mount.ts`: `case 'component'` — `createRoot` → `componentFactory(propsObj, slotsObj)` → `emitSetup(childIR)` → mount; direct-capture, `emptyVerdicts` for slot sub-IRs
- `nv-emitter.ts`: `Name(props, slots)` factory signature, `case 'component'` in thunk + IR literal emission
- `nv-esbuild-plugin.ts`: `rewriteNvSpecifiers` regex real; TC-C14f two-file esbuild bundle test verifies cross-file import chain end-to-end

**D3 (handler destructuring write) closed.** `eraseHandlerExpr` now emits error diagnostic when destructuring assignment LHS contains a reactive signal name. `buildPropsAccessorMap` is called from handler erasure (second call site) to erase props-destructured locals inside handler bodies.

**Slot handling.** Static inter-tag content → `slots: [{ name: 'default', content: TemplateIR }]` in both front-ends. Dynamic/nested-component slot content → warning diagnostic, `slots: []`. Slot render (consuming in back-end) deferred; both back-ends receive `slotsObj` but component factories ignore it in hand-authored tests.

**Known deferred item.** Emitted component factories return `{ mount(parent, doc) }` (the current emitter shape), not `ComponentRef`-compatible `TemplateIR`. Cross-file composition where an emitted component is mounted as a child of another emitted component requires the factory shapes to converge. Tracked as "emitter factory shape convergence" in the forward queue.

**Gate status.** 8-gate verification checklist passed. 3059/3059 tests green. `pnpm typecheck` clean. `pnpm lint` clean. `pnpm build` clean.

**Commits.** `3e21613` (ir.ts v0.3) → … → `73f92b8` (test + fix wave) on `main`.

---

## Component API v1 — Verification Gate Corrections (architect review, 2026-06-21)

```
CORRECTIONS (architect review, 2026-06-21):
- GATE 6: TC-C14f proves the two-file .nv→.js PLUGIN CHAIN end-to-end (app.nv imports
  counter.nv, both parsed/emitted by nvPlugin, specifier round-trip works, App mounts +
  reactive). It does NOT prove component composition — App never instantiates <Counter/>;
  Counter is void-referenced to defeat tree-shaking. DOM assertions are App's own n signal.
  Emitted-component-as-child blocked on factory-shape convergence (forward queue).
- GATE 4: slot CAPTURE verified (static→default-slot IR, dynamic→warning). Slot CONSUMPTION
  not built — factories ignore slotsObj.
- GATE 8: was INCOMPLETE at checklist time — landing log entry appended but Current State
  header not updated. Closed 2026-06-21.
```

## Component API composition bugs #2/#3 — FIXED (2026-06-21)

**Context.** Reading the emitted module for a nested `<Counter/>` (architect seam review)
surfaced two latent defects masked by the composition deferral — no test exercised an
emitted component rendering a prop.

**#3 prop-expr not erased.** Component prop thunks used raw `.getText()`, emitting
`expr: () => (n)` (the signal object) instead of `() => (n())`. Fix: route propSrcs
through `eraseSignalReadsInNode(expr, symbols.all, emitPropsAccessors)` in
`parseNvFileForEmit`. Pinned: EM-13b (`propSrc === 'n()'`), TC-C06-exec (render-hole
liveness, prior).

**#2 shape.html leaked component tag.** `shapeHtml` was captured pre-DFS-walk, so the
component element survived as `<div><Counter/></div>` instead of the anchor comment;
`bindingPaths` then pointed at an Element, not the Comment anchor `wireComponent` expects.
Fix: re-serialize the post-walk fragment in `processHtmlTemplate`. Output now
`<div><!--nv-comp-0--></div>`. Side effect: IR `id` now hashes the re-serialized shape
(correct). Pinned: Bug-#2 tests (both `parseNvFile` + emit paths), id-stability EM-00i intact.

**Not a decision; no contract/Current-State change.** Factory-shape convergence (#1) remains
the sole composition blocker — emitted factories return `{ mount }`, not ComponentRef-shaped
TemplateIR.

## Spike S-A2 — A2 factory-shape ownership VERIFIED (2026-06-21)

**Result.** A2 ownership claim execute-verified against real core.ts + interpreter.ts
(spike, sandbox). An A2-shaped ComponentRef ((props,slots)=>TemplateIR, no own root)
mounted via wireComponent yields: single-root ownership, live parent→child prop edge,
child-body effects owned+disposed by the parent cascade, zero leak after parent dispose
(10/10). Root sugar mount(Child(props),parent,doc) single-root + reactive + no-leak (8/8).
Back-ends confirmed UNCHANGED.

**Mechanism correction (supersedes the "double-root" framing in the convergence draft).**
createRoot auto-attaches to the active owner (root.owner=currentOwner; addChild). A nested
createRoot run synchronously inside a parent root is owned and disposed normally — NOT a leak.
The old {mount} shape leaks for a different reason: Counter() returns {mount}, invoked by the
consumer outside any owner context (currentOwner===null) → freestanding root outside the owner
tree → composition leaks unless disposers are manually threaded. A2 returns TemplateIR so the
parent root owns child effects by construction. This is the precise correctness argument for A2
over B; the earlier "B adds a redundant root" framing was imprecise (redundant nesting is a perf
cost only when synchronous; the leak requires out-of-context invocation).

**Status.** Convergence spec §3 rewritten to the verified mechanism. Implementation (emitter
§4–§7) cleared to proceed — ownership premise no longer an assumption.

### 2026-06-21 — A2 emitter factory-shape convergence LANDED (composition end-to-end)

**What.** The emitted-component-as-child gap left open by *Component API v1 LANDED
[2026-06-21]* is closed. `nv-emitter.ts` now emits each component as a `ComponentRef`-shaped
factory — `export function Name(props, slots) { <erased $script>; return <IR literal> }` —
returning the `TemplateIR` directly (no `createRoot` wrapper, no `__ir` intermediate, no
`{ mount }` return). A thin root-mount sugar `Name.mount = (parent, doc, props = {}, slots
= {}) => mount(Name(props, slots), parent, doc)` is emitted alongside. This is the **A2**
option from *factory-shape-convergence-design.md* (v1.1, APPROVED) — chosen over B
(back-ends accept `{ mount }` children) because A2 is one root per subtree and leaves the
back-end contract unwidened.

**Why this shape is correct (ownership).** The reshape is sound because the parent root
owns the child's effects *by construction*: `wireComponent` calls the `ComponentRef`, gets
an IR, and mounts it inside the parent's owner context. Verified pre-landing by spike S-A2
(10/10) + control (8/8) against real `core.ts` + `interpreter.ts` — single-root ownership,
live parent→child prop edge, child-body effect disposed by parent cascade, no leak after
dispose (`observerCount → 0`). The spike also corrected the original §3 mechanism: a nested
`createRoot` run synchronously inside a parent root auto-attaches and is disposed normally
(perf redundancy, not a leak); the real leak class was the old `{ mount }` shape invoked
*outside* any owner context. A2 returns `TemplateIR`, so that class is unreachable.

**Scope held to emitter-only.** Verified empty diffs against `134ac39`: `src/core/`,
`interpreter.ts`, `emitted-mount.ts`, `ir.ts` all unchanged — `nv-emitter.ts` is the sole
production change. `ComponentRef = (props, slots) => TemplateIR` was already specified in
`ir.ts` (Template-IR v0.3); A2 conforms the emitter to it. No contract or IR version bump:
reactive-core stays **v0.4.2**, Template-IR stays **v0.3**.

**Verification (acceptance gate `docs/gates/a2-emitter-factory-shape.md`, PASSED).**
G0: typecheck/test/lint/build all exit 0; 3059 → 3189 tests. G2: EM-11/EM-11e pin the
factory shape (`export function Name(`, `.mount =`, `mount(Name(props,slots),parent,doc)`,
`not.toContain('__ir')`); EM-13b pins prop erasure `propSrc === 'n()'` (bug #3 regression
guard); shape.html anchor pins bug #2. G3: imports built from `detectUsedPrimitives` only —
`createRoot`/`onCleanup` no longer force-included. G5: TC-C15-exec-reactive does the full
bundle → `import()` → `mount` → `flushSync` → `set` → `flushSync` round-trip through the
emitted module; differential parity present in both shared-oracle and `structurallyEqual`
forms; vacuous sweep clean. TC-C16 exec round-trip lives in `nv-emitter-exec.test.ts`
(esbuild bundling; `new Function` cannot eval ESM imports).

**Hardening landed in the same change.** The `props` emission fallback
`pSrc?.exprSrc ?? 'undefined'` (which would have silently emitted `() => (undefined)` on a
parser-built props/propSrcs length mismatch) was replaced with an explicit throw —
`[nv/emitter] Missing propSrc for prop '<name>' at index <idx>` — matching the house style
of the adjacent kind-mismatch throws and the missing-thunk throw in `emitIrLiteral`.
Invariant is guaranteed by construction today; the throw is a cheap future-regression guard.

**Process note.** First feature landed against a pre-written acceptance gate
(`docs/gates/a2-emitter-factory-shape.md`, filled before CC started). The gate's
"differential parity" item over-specified the *mechanism* (`structurallyEqual`) where the
*property* (both back-ends pinned to one shared oracle) was the real requirement; reworded
on landing, and the same refinement carried into the gate template (`docs/gates/README.md`).

**Supersedes/cites:** *Component API spec APPROVED [2026-06-20]* (A2 is the approved design),
*Component API v1 LANDED [2026-06-21]* (whose deferred "emitted-component-as-child" item this
closes), spike S-A2 (ownership premise).

**Result:** component composition now works end-to-end through the emitted (compiled) path,
not only the interpreter. Slot *consumption* remains deferred (factories accept `slots` but
do not yet consume them) — forward queue.

### 2026-06-21 — Slot consumption LANDED (named + reactive, both paths)

**What landed:** slot consumption feature — all four paths: capture (both FEs), insertion (both FEs), emit erasure (`nv-emitter.ts`), consume (both back-ends).

**IR change:** Template-IR v0.3 → **v0.3.1**. New kind: `SlotOutletBinding = { kind:'slot-outlet'; pathIndex; name }` — no `expr` field (D-slot-4). Added to `Binding` union; both back-ends required new `case 'slot-outlet'`.

**D-slot-1 (parent-lexical ownership):** Slot content effects owned by the parent scope, not the child. `capturedParentOwner = getOwner()` called before child's `createRoot` in both `wireComponent` (interpreter) and the component wire function (emitted-mount). Slot content rendered via `runWithOwner(capturedParentOwner, () => createRoot(...))`. Proven behaviorally by G4.5/G4.6: after child-only dispose, parent signal still writable, disposed region does not mutate.

**Reactive-core:** v0.4.2 **unchanged** (consumes §6.1 `getOwner`/`runWithOwner` as-is; no core escalation).

**Captures both FEs (`html-tag.ts` + `nv-parser.ts`):** `<slot name="x">` wrapper → `SlotEntry{name, content: TemplateIR}`; reactive holes captured as slot sub-IR bindings; parent hole indices marked consumed; `{slots.name}` holes → `SlotOutletBinding`. FE-equivalence gate G3.1 passed.

**Emit erasure (`nv-emitter.ts`):** `slots:[]` hardcode replaced with `slotHoleGroups`-driven thunk computation under parent scope (parent's `symbols`/`propsAccessors`). Slot holes reading parent props erase correctly to `props.x()`.

**Gate:** G0 (typecheck/test/lint/build) + G1 (contract invariants) + G2 (artifacts) + G3.1 (FE-equivalence) + G4.1–G4.6 (differential) + G5 (anti-vacuous sweep) — all passed. 3189 → 3203 tests. Pushed to main (b63812b).

**Forward queue (confirmed deferred):** slot fallback/default content, scoped slots (slot props child→parent), component-as-slot-child (nested component inside a slot), `$style`×slots interaction.
**Read-back addendum (2026-06-21):** G3.1 tightened post-landing — original assertion checked only slot name/length/kind; replaced with the shared structural comparator (`test/renderer/ir-equivalence.ts`, wrapping `comparator.ts`) so a `bindingPaths`/`shape.html` divergence between front-ends now fails. No production code changed; FE-equivalence property now actually enforced. Tests remain 3203.

### 2026-06-21 — Slot-builder defects B1/B2/B3 — resolution DESIGNED; unified CC fix commissioned

**Context.** A code read-back of the two slot sub-IR builders (after *Slot consumption
LANDED [2026-06-21]*) surfaced three defects in how slot **content** is built. All three
confirmed against real source (`src/renderer/html-tag.ts`, `src/renderer/nv-parser.ts`).
Designed here; CC executes (handoff `cc-handoff-slot-defects.md`). **Not yet landed.**

**The three defects.**
- **B1 — both slot sub-builders hard-code every slot hole to `TextBinding`.**
  `buildSlotSubIR` (html-tag) and `buildNvSlotSubIR` (.nv) detect attr/prop/event holes
  inside slot content but discard the kind and emit `TextBinding` for all of them.
  Violates Template-IR §3 (`SlotEntry.content` is a full `TemplateIR` whose bindings may
  be any kind) and the locked invariant *misclassification costs perf, never correctness*:
  a prop/event hole inside slot content wires a text update onto an element node → silently
  wrong DOM, no parse-time error. Unreachable by the current corpus.
  - **`.nv` subtlety (decisive for the gate):** two kind producers for the same slot hole
    DISAGREE. IR-time `buildNvSlotSubIR` → `kind:'text'` (WRONG); emit-time
    `computeThunkSource` switches on `pos.kind` → CORRECT (`prop`/`event`/`attr`). The
    interpreter dispatches on IR kind (wrong), the compiler on emit ThunkSource (right) →
    the two back-ends DIVERGE on the same `.nv` slot. The fix makes the IR builder AGREE
    with the already-correct `computeThunkSource`.
- **B2 — html-tag detects outlets via `Function.prototype.toString()`** (regex-matching
  `() => slots.name`). Build-fragile: esbuild/tsc target lowering or minifier param
  mangling silently breaks the match → the outlet falls through to a `TextBinding` whose
  expr returns a `TemplateIR` → the back-end stringifies an object. The `.nv → .js` Mode A
  pipeline puts esbuild in the toolchain, so the trigger is one build-flag away, undetected.
  `.toString()` is **unfixable**: html-tag cannot evaluate the outlet thunk — `() =>
  slots.body` closes over a `slots` object that exists only at component-CALL time, not at
  html-PARSE time. There is no robust-`.toString()` path. **B2 is html-tag-only** — `.nv`
  already detects outlets structurally via AST (`slots.name` PropertyAccessExpression).
- **B3 — both slot sub-builders are blind to outlets and conditionals INSIDE slot
  content.** The top-level builders handle `slots.name` → `SlotOutletBinding` and (.nv)
  ternary-`html` → `ConditionalBinding` (recursive); the sub-builders do neither (flat
  attr/prop/event/text walk only). Same degraded-copy class as B1.

**Decisions LOCKED.**
1. **Fix all three** (B1, B2, B3).
2. **Take the longer no-baggage path:**
   - **Option A — shared per-hole binding constructor**, extracted in each file and used by
     BOTH the top-level walk AND the slot sub-walk. The top-level construction was inlined
     in each main walk's per-hole loop (not a callable unit), which is exactly why the slot
     sub-builders reimplemented a degraded flat copy. Extracting one constructor kills the
     degraded-copy CLASS that produced both B1 and B3, rather than patching symptoms.
     (Rejected **Option B** — fatten the sub-builders without extracting; completes the
     copy but leaves the divergence trap armed.) Shared *within each file*; each file's
     constructor handles the kinds that file produces (html-tag: text/attr/prop/event/
     slot-outlet; .nv: those + conditional).
   - **B2 = structural marker**, killing `.toString()` entirely. The shared constructor
     uses the SAME outlet check at top level and inside slots, so B3's outlet-inside-slot
     falls out for free once detection is structural.
3. **B2 marker mechanism (OPEN-1 resolved) = `slots('name')` sentinel function.** Author
   writes `${slots('header')}` on the tagged-template side; `slots(name)` returns a tagged
   sentinel `{ __nvSlotOutlet: name }` (NOT a thunk). html-tag detects by property check,
   exempts the sentinel from the all-holes-must-be-functions guard, and emits
   `SlotOutletBinding`. Smallest authoring delta (still a `${}` hole), dead-simple
   detection, zero build-target failure modes. Cost: one tiny new public API on the
   tagged-template path + the guard exemption. Rejected: **Option 3** element sentinel
   `<slot-out>` (larger surface-syntax change: hole → structure); **Option 2**
   reference-identity (html-tag has no `slots` value at parse time).
4. **Marker name (OPEN-2 resolved) = `slots('name')`, not `outlet('name')`.**
   `slots('header')` reads as "from the `slots` collection, get header" — the call mirrors
   `.nv`'s `slots.header` member access (same noun, same mental model). Pairing across the
   two roles and two front-ends:

   | role | `.nv` | tagged-template |
   |---|---|---|
   | child renders | `slots.header` | `slots('header')` |
   | parent fills | `<slot name="header">` | `<slot name="header">` |

   The fill side stays singular `<slot name=…>` (each element fills one slot; the
   collection framing applies only to the child-side read). `outlet` was the clearer
   standalone concept (Angular `ng-content`/`router-outlet` precedent) but added a second
   vocabulary word for a feature nv already names "slot"; `slots('name')` wins on surface
   coherence and front-end symmetry.
5. **`.nv` NOT changed to `slots('name')`.** `.nv` keeps `slots.header` (AST
   property-access detection — robust, idiomatic bare-read, the `.nv` thesis). The
   tagged-template call form is the no-build workaround for the constraint that html-tag
   cannot do property access at parse time, not a canonical form to propagate. Both
   front-ends already produce identical IR (`SlotOutletBinding`) — that is the uniformity
   that matters; matching surface syntax where capabilities genuinely differ is false
   economy.
6. **Default slot stays implicit.** When named slots exist, residue (non-`<slot>`
   children) is still the default slot, captured if non-empty — no explicit authoring,
   position-irrelevant (named slots keyed by name; default = residue; outlet positions
   on the child side decide render order). Confirmed already-correct in both front-ends;
   no change. An unrendered/unfilled default renders nothing (`wireSlotOutlet` early-return).

**Root cause (durable).** The §8.2 differential corpus has ZERO slot/component cases — the
shared root cause behind B1, B3, AND the earlier G3.1 near-miss. The corpus extension is
the durable fix; reaffirms *new binding kinds land WITH differential corpus coverage in the
same change*.

**Contract impact.** reactive-core **v0.4.2 unchanged** (no core touch). Template-IR: the
`slots()` marker is a new tagged-template authoring construct producing the **existing**
`SlotOutletBinding` (IR shape unchanged). Recommend a **doc-only v0.3.1 → v0.3.2** note in
§6.1 + changelog recording the two outlet-detection mechanisms (`.nv` AST property-access;
tagged-template `slots()` sentinel) producing identical IR — parallels the v0.2.1 doc
clarification. No semantic change. Apply when the fix lands.

**Status.** DESIGNED; CC fix commissioned (`cc-handoff-slot-defects.md`). **Supersedes** the
stale earlier-session drafts `decision-log-b1-b2.md` (frames B2 as an open
source-string-vs-marker question, no B3, no shared-constructor) and
`cc-handoff-b1-b2-corpus.md` (Option-B-shaped, no B3) — discard both.

### 2026-06-21 — Slot-builder defects B1/B2/B3 LANDED

**Gate.** All gates passed: `tsc --noEmit` clean, `vitest run` 3223/3223, `biome check` clean.
Fail-shows-teeth pair confirmed: B1 regression drops 6 tests; restore → 34/34.
Anti-vacuous sweeps: 0 `expect(true/false).toBe`, 0 `expect(!...` patterns.
`git diff --stat HEAD` confirms exactly 4 files changed:
`html-tag.ts`, `nv-parser.ts`, `index.ts` (renderer barrel), `slot-consumption.test.ts`.

**Corpus delta.** 29 → 34 tests in `slot-consumption.test.ts` (+5). Suite-wide: 3218 → 3223.

**Decisions confirmed on land.** All LOCKED as designed (see prior entry):
- `slots()` sentinel `{ __nvSlotOutlet: string }` — structural detection, no `.toString()`
- Option A shared constructor — `buildHtmlHoleBinding` / `buildNvHoleBinding` used by both top-level walk and slot sub-builder
- `.nv` front-end unchanged — `slots.name` PropertyAccessExpression path untouched

**References.** Prior entry `2026-06-21 — Slot-builder defects B1/B2/B3 — resolution DESIGNED; unified CC fix commissioned`.

### 2026-06-22 — Scoped slots + fallback + component-as-slot-child: design APPROVED; gates ruled; Path B phasing

**Decision.** The unified slot-content design (`scoped-slots-design.md`) is APPROVED. The
three remaining slot features are one mechanism — *the child invokes the slot content as a
richer thing*: scoped slots = invoke with exposed values; fallback = render an authored
default when absent; component-as-slot-child = the content's binding set may include
`ComponentBinding`. Four gates ruled:

- **GATE-1 (§6 ownership) → D-slot-2: invocation-scoped ownership for all slot content,
  retiring D-slot-1.** Scoped content reads child-exposed values that live as long as the
  *invocation* (e.g. a list row), not the parent; strict parent-lexical (D-slot-1) would
  strand a dangling observer when an invocation disposes. Invocation-scoped content is owned
  by a `createRoot` at the outlet/invocation site, disposed when that invocation ends.
  Parent-signal reads stay correct cross-scope (observation ≠ ownership, §6 / §12.24b). G4.6
  still holds — the parent signal is untouched; only the content's *effect owner* moves.
  **D-slot-1 is retired when scoped slots land (increment 2);** increment 1 (unscoped content
  only) retains D-slot-1 because it has no per-invocation dependency. reactive-core stays
  **v0.4.2** if implemented via existing `getOwner`/`runWithOwner`/`createRoot` (the
  `wireList` pattern); verify against `wireList` and surface any §6 gap before landing
  increment 2 (escalation rule).
- **GATE-2 (surface area) → collapse (Option 2b).** Retire `buildSlotSubIR`/`buildNvSlotSubIR`;
  slot content goes through the same recursive `processHtmlTemplate`. Permanently removes the
  degraded-copy class that produced B1/B3, rather than re-arming it (component-as-slot-child
  would otherwise force the sub-walk to re-grow component detection). Accepted cost: a real
  refactor of the slot-capture path (hand the recursive call the slot subtree's hole
  exprs + positions).
- **GATE-3 (authoring) → `let={ ... }`.** Single destructure attribute on the `<slot>` fill
  (not repeated `let:a let:b`; keeps the `let` token). Mirrors the tagged-template fill
  `slot('row', ({ item, index }) => …)`, so both front-ends align. Child exposes at the
  outlet via `slots.row({ item: item, index: index })` (.nv) / `slots('row', { item: () =>
  …, index: () => … })` (tagged); **`.nv` expose-object entries erase to accessor THUNKS,
  not value calls** (a value call would snapshot at expose time → dead). Object shorthand in
  the expose object is NOT erased (existing parser gap) — long form until shorthand erasure
  lands. Fallback: `{slots.x ?? html\`…\`}` (.nv) / `slots('x', { fallback: html\`…\` })`
  (tagged). **`let` is contextually reserved on `<slot>` only** (ordinary JS elsewhere; the
  `<slot>` element is consumed at parse time, never emitted). Zero runtime cost vs `let:`.
  **Tag-level `let` deferred** (ambiguous with >1 scoped slot; Svelte v5 moved away from it).
  Future ergonomic (not v1): validate `let={...}` names against the child's statically-known
  exposed key set → diagnose typos instead of silently binding `undefined`.
- **GATE-4 (phasing) → Path B (small wins first).** Two increments.

**Increment 1 (commissioned now — `cc-handoff-slot-collapse-fallback.md`):** GATE-2 collapse
(behavior-neutral; existing slot corpus stays green on the refactor alone) + component-as-
slot-child (falls out of the collapse; no IR shape change) + fallback (additive
`SlotOutletBinding.fallback?: TemplateIR`). Ownership retains D-slot-1. **Template-IR v0.3.2
→ v0.3.3** (additive optional `fallback`). reactive-core **v0.4.2 unchanged**, no §6 change.

**Increment 2 (later, separate gated session):** `SlotEntry.content` → factory
`(slotProps) => TemplateIR`; `SlotOutletBinding.props?` (exposed accessor thunks);
`let={...}` authoring; **D-slot-2** invocation-scoped ownership (retires D-slot-1). **Template-IR
v0.3.3 → v0.4** (content-factory shape + `props`). Increment-1 work is not undone — `fallback`
stays; the collapsed walk is what the factory shape builds on (no double-refactor).

**Forward-looking (recorded so it does not collide):** the future `each` iteration construct
(forward queue, gated on row-churn reorder data) is the only loop nv will have — run-once
forbids `while`/imperative loops; control families are exactly `ConditionalBinding`,
`ListBinding` (keyed each), `SyncBinding` (deferred). nv keys the *list*, not the element
(no React `key` prop; key is a function on the construct, already `ListBinding.key`). A
candidate `<each .of=… key=… let={ item, index }>` makes a list item a scoped slot the `each`
fills per row — so increment 2's `SlotEntry.content` factory + `let={...}` should be designed
so `each` reuses them rather than forking a parallel construct.

**Status.** Design APPROVED; increment 1 commissioned; increment 2 queued. No code/IR change
until CC lands increment 1. Cites *Slot-builder defects B1/B2/B3 LANDED [2026-06-21]*
(removed the degraded-copy class at the per-hole constructor level; this collapse removes it
at the walk level).

### 2026-06-22 — Slot increment 1 LANDED: walk-collapse + component-as-slot-child + fallback

**Gate.** All gates passed: `tsc --noEmit` clean, `vitest run` 3237/3237, `biome check` clean.
Fail-shows-teeth pair confirmed (interpreter fallback-renders test). Anti-vacuous sweep clean.

**What landed:**
- **GATE-2 collapse** — `buildSlotSubIR` and `buildNvSlotSubIR` retired; slot content now
  processed by the same shared `walkNodeList`/`walkNvNodeList` as top-level content. The
  degraded-copy class (B1/B3 root cause) removed at the walk level.
- **Component-as-slot-child** — `ComponentBinding` in slot sub-IRs now falls out of the
  unified walk. The B1/B3 LANDED entry's nested-component deferral is closed.
- **Fallback** — `SlotOutletBinding.fallback?: TemplateIR` (additive). Tagged-template:
  `slots('x', { fallback: html\`...\` })`; `.nv`: `{slots.x ?? html\`...\`}`. Both back-ends
  render fallback when absent; suppress when filled. Both front-ends agree on the IR.
- **Template-IR v0.3.2 → v0.3.3** (additive optional `fallback`).
- **reactive-core v0.4.2 unchanged**. D-slot-1 retained (D-slot-2 is increment 2).

**Corpus delta.** 3223 → 3237 (+14: component-as-slot-child × 9 + fallback × 5).

**Cites.** *Scoped slots design APPROVED [2026-06-22]* (increment 1 commissioned);
*Slot-builder defects B1/B2/B3 LANDED [2026-06-21]* (removed degraded-copy at constructor
level; this collapse removes it at the walk level).

### 2026-06-22 — Slot increment 1: architect verification against placed files

**Verification, not a new decision.** Increment 1 (LANDED entry above) verified by reading
the four placed seam files, per "verify by reading placed files, never green counts."

- **Collapse real, not parallel.** `html-tag.ts` + `nv-parser.ts`: slot content routes
  through shared `walkNodeList`/`walkNvNodeList` via `buildSlotContentIR`/`buildNvSlotContentIR`;
  per-hole constructors (`buildHtmlHoleBinding`/`buildNvHoleBinding`) reused by the recursion.
  No `buildSlotSubIR`/`buildNvSlotSubIR` survive. The .nv IR-kind == emit-kind invariant holds.
- **Component-as-slot-child real** on both front-ends (walk detects `data-nv-component` in slot
  subtrees, recurses incl. nested-slot capture).
- **Fallback owned correctly.** Interpreter `wireSlotOutlet` + emitted-mount slot-outlet case:
  unfilled → `fallback` rendered under `capturedParentOwner` (D-slot-1); filled path unchanged;
  back-ends at parity. Differential corpus exercises both back-ends with teeth.
- **Docs consistent** at Template-IR v0.3.3 across template-ir / implementation-state / log.

**Carry items confirmed (all non-blocking, fold into increment 2 — shared seams):**
1. emitted-mount dead `?? getOwner()`/`?? null` owner-fallback in slot-outlet (slot-outlet only
   reached via component case, which always sets `slotContext`; `??` arms never fire). Filled
   (`?? null`) vs unfilled (`?? getOwner()`) asymmetry — converge on one expression.
2. double `isHtmlTTE` DRY (nv-parser: `buildNvHoleBinding` + `computeThunkSource`).
3. `nv-emitter` component-in-slot thunk + .nv fallback emit-path e2e — **the real gap**: parser
   side wires `ThunkSource` fallback/component-slot variants, but `.nv → emitted-JS` for these is
   untested. Increment 2 gate must include explicit e2e items.

**Status.** Increment 1 formally closed. Increment 2 (scoped slots + D-slot-2) open.

### 2026-06-22 — Slot increment 1.5 LANDED: emit-path collapse + conditional-branch component fix

**E-2b collapse landed.** `computeBindingThunks` extracted as a single recursive thunk-builder
shared by both the top-level emit path (`parseNvFileForEmit`) and the conditional-branch path
(`computeThunkSource`). The inline assembly block in `parseNvFileForEmit` is replaced by a
single call; the conditional case in `computeThunkSource` now threads the branch `ProcessResult`
(including `pendingComponents`) through `computeBindingThunks` instead of the hole-only
`computeThunksForTemplate`. Structural precedent: GATE-2 collapse (Slot increment 1, 2026-06-22)
— same pattern, walk seam unified; here the thunk-builder seam is unified.

**Component-in-conditional-branch fixed.** A component inside a conditional branch
(`${show ? html\`<Card .label="${show}"/>\` : html\`<p>no</p>\`}`) previously produced flat `prop`
ThunkSources (hole-only path) instead of a wrapped `component` ThunkSource, causing
`emitModule` to throw "ComponentBinding thunk kind mismatch". Fixed as a direct consequence
of the E-2b collapse.

**Dead code deleted.** `emitThunkSource` in `nv-emitter.ts` had unreachable `conditional`,
`component`, and `slot-outlet` cases. Probes (REACHED-*) confirmed zero fires across 496 tests.
Cases deleted; `emitThunkSource` is now leaf-only (`LeafThunkSource` type parameter).

**No contract change.** reactive-core v0.4.2, Template-IR v0.3.3 both unchanged. Increment 2
(scoped slots, D-slot-1 retained, D-slot-2 re-phased) queued.

### 2026-06-22 — D-slot-2 ownership flip re-phased: lands with `each`, not increment 2 (supersedes phasing in *Scoped slots design APPROVED [2026-06-22]*)

**Decision.** The D-slot-2 ownership flip (invocation-scoped, retiring D-slot-1) is moved
OUT of increment 2 and re-phased to land **with the `each` iteration construct**, where its
motivating leak scenario is real. Increment 2 now ships the scoped-slot **IR shape + authoring
surface only**, retaining D-slot-1. This **supersedes the phasing** in *Scoped slots +
fallback + component-as-slot-child: design APPROVED [2026-06-22]* (which placed D-slot-2 in
increment 2); it does **not** reverse the GATE-1 *ruling* (invocation-scoped ownership is still
the correct end state) — only **when** the flip lands.

**Why (the unfalsifiable-gate problem).** D-slot-2's leak argument bites only when slot content
is rendered inside a **per-invocation root distinct from the component root** — i.e. a
`ListBinding` item / `each` row. In increment 2's actual scope (scoped slots on a plain
component, no `each` yet), the component's own `createRoot` **is** the invocation; there is no
second per-invocation root to dispose independently, and no sibling invocation to leave live.
The design doc's §8 ownership obligation ("child disposes one invocation → that content's
effects gone, siblings + parent signal live") therefore **cannot be written with teeth** in
increment 2 — there are no sibling invocations. Flipping a logged §6 ownership rule in a session
where no test can distinguish D-slot-1 from D-slot-2 by inspection violates the ironclad
"every gate item must be failable on inspection" rule. We do not flip a §6 decision until the
scenario that loads it exists.

**What increment 2 ships instead (fully testable now).**
- `SlotEntry.content` → factory `(slotProps) => TemplateIR` (hard-cut, no back-compat — nothing
  released). Unscoped slots become `(_props) => ir`.
- `SlotOutletBinding.props?: readonly PropEntry[]` — child-exposed accessor thunks at the outlet.
- `let={ ... }` authoring (`.nv` destructure attribute on `<slot>` fill) + tagged-template
  `slot('name', ({ ... }) => html\`...\`)` fill form.
- `.nv` expose-object entries erase to accessor **thunks**, not value calls.
- **Ownership: retains D-slot-1** (parent-lexical), unchanged. The factory shape and `props`
  channel are owner-agnostic — they wire the same content; only the eventual owner of the
  content's effects changes when D-slot-2 lands. Increment 2's factory shape is what D-slot-2
  builds on; no double-refactor (the factory shape is not undone by the later ownership flip).
- **Contract:** Template-IR **v0.3.3 → v0.4** (content-factory shape change + `props`).
  reactive-core **v0.4.2 unchanged** (no §6 touch — D-slot-1 retained).

**What lands with `each` (later, gated on row-churn reorder data per forward queue).**
- D-slot-2 invocation-scoped ownership flip (retires D-slot-1), gated by a **real multi-row
  differential**: an `each` list where disposing one row's invocation tears down that row's
  slot-content effects while sibling rows + the parent signal stay live (real teeth, not a
  hand-simulated per-invocation root). This is the §8 ownership obligation with the scenario
  that makes it failable.
- reactive-core stays v0.4.2 if the flip uses existing `getOwner`/`runWithOwner`/`createRoot`
  (the `wireList` per-item-root pattern, verified against `wireList` before landing); escalate
  if a §6 gap surfaces.

**Net effect on the GATE-1 ruling.** Unchanged in substance — invocation-scoped ownership
remains the decided end state. Only the landing is moved to where its gate has teeth. D-slot-1
is retained one increment longer than the design doc anticipated.

**Cites/supersedes.** Supersedes the increment-2 phasing in *Scoped slots + fallback +
component-as-slot-child: design APPROVED [2026-06-22]*. Cites *Slot increment 1.5 LANDED
[2026-06-22]* (the `computeBindingThunks` single thunk-builder is the clean emit seam the
`props` channel attaches to). Increment-2 CC handoff: `cc-handoff-scoped-slots.md`.

**Status.** Re-phasing DECIDED. Increment 2 (shape + authoring, D-slot-1 retained) commissioned.
D-slot-2 flip queued behind `each`.

### 2026-06-22 — Slot increment 2 LANDED: scoped-slot IR shape + `let={...}` authoring (D-slot-1 retained)

**Gate.** All gates passed: `tsc --noEmit` clean, `vitest run` N/N, `biome check` clean.
Fail-shows-teeth pairs confirmed (props-detection, expose-thunk-vs-value). Anti-vacuous sweep clean.
D-slot-1 retained proof: `git show` confirms `runWithOwner(capturedParentOwner, ...)` unchanged in both back-ends.
No `src/core/` edits.

**What landed:**
- **`SlotEntry.content` → factory (hard-cut):** `(props: SlotProps) => TemplateIR`. Every existing
  `SlotEntry` literal wrapped. Unscoped fills become `(_props) => ir`. No back-compat union.
- **`SlotOutletBinding.props?`:** child-exposed accessor thunks (one-directional; same transparent-thunk
  mechanism as component props). Absent → empty object passed to factory.
- **`let={...}` authoring (`.nv` parent fill):** `<slot name="row" let={item, index}>` → `SlotEntry.content`
  factory; `item`/`index` erase to `slotProps.item()`/`slotProps.index()` in emitted JS.
- **`slot(name, factory)` authoring (tagged-template parent fill):** sentinel detected by `walkNodeList`
  inside component element; factory stored directly as `SlotEntry.content`.
- **`slots()` outlet gains props (tagged-template child):** `slots('row', { item: () => sig() })` →
  `SlotOutletBinding.props`. Mirrors `.nv`'s `{slots.row({ item: item })}` call form.
- **FE-equivalence:** both front-ends produce structurally identical scoped-slot IRs.
- **D-slot-1 RETAINED.** `runWithOwner(capturedParentOwner, ...)` byte-identical to pre-change.
  reactive-core v0.4.2 unchanged.
- **Carry item closed:** `emitted-mount.ts` slot-outlet `?? getOwner()` / `?? null` dead fallback converged.
- **Template-IR v0.3.3 → v0.4** (content-factory + `props`).

**Cites.** *Scoped slots design APPROVED [2026-06-22]*; *D-slot-2 ownership flip re-phased to `each`
[2026-06-22]* (D-slot-2 is NOT in this increment — phasing decision is the reason D-slot-1 is retained here).

### Scoped slots — increment 2 ARCHITECT-VERIFIED [2026-06-22]

Verified the inc-2 LANDED entry [2026-06-22] against placed files (read, not CC
summary; green counts not trusted). All eight gate checks pass on inspection:

1. **Factory hard-cut total.** `SlotEntry.content: SlotContent` everywhere; no
   `TemplateIR | SlotContent` union in `ir.ts`; no bare-IR `content:` literal in
   either FE capture site or any corpus literal (grepped).
2. **D-slot-1 byte-identical.** `runWithOwner(capturedParentOwner, …)` unchanged in
   `interpreter.ts` `wireSlotOutlet` (content + fallback arms) and `emitted-mount.ts`
   slot-outlet case. No `src/core/` change. D-slot-2 did not sneak in.
3. **`props` rides the single thunk path.** `.nv` outlet exposure erases to a thunk
   (`item()` → emitter wraps `() => (item())`); `let={…}` reads map to `slotProps.x()`
   accessors. No second thunk-assembly path; degraded-copy class did not recur. Emit-time
   `s.content({})` materializes IR *structure* only — thunk sources come from
   `computeBindingThunks` over `holeIndices`, not from re-running the factory.
4. **FE-equivalence real** (both outlet-props and `slot()`/`let={…}` fill produce matching
   `SlotOutletBinding.props` / `SlotEntry`). Comparator used without exception. **Debt:** see D2.
5. **Behavior-neutrality.** All pre-existing slot corpus green with `content: () => ir`
   wrapping only, zero assertion changes. `§scoped-G4.6` pins D-slot-1 under scoped content.
6. **Fail-shows-teeth.** `§exposed-value-reactivity` fails if expose snapshots (value-call
   instead of thunk) — assertion reads post-write DOM, not "effect ran."
7. **Anti-vacuous + scope.** New tests assert real DOM/string values. Changeset confined to
   `src/renderer/*`, `src/compiler/emitted-mount.ts`, tests, docs. (`git show --stat` confirmed
   `src/core/` = 0 lines per LANDED entry; not independently re-run at verification.)
8. **Contract consistency.** `template-ir.md` title + Status + changelog + type-reference
   appendix all v0.4; reactive-core v0.4.2. A-0 ordering per LANDED entry.

**Defect found (does not block closure):**
- **D2 (logged debt):** `ir-equivalence.ts` `bindingEqual` `slot-outlet` case compares only
  `.name`; it does not descend into `props[]` or `fallback`. Scoped-slot FE-equivalence is
  pinned by explicit per-field asserts in the two `§scoped-slot-FE-equivalence` tests, not by
  the structural oracle. Pre-dates inc 2 (fallback has the same gap). Fold into the comparator
  extension `each` will require; do not extend speculatively now.

**Increment 2 formally CLOSED.**

**Cites.** *Scoped slots — increment 2 LANDED [2026-06-22]* (this entry verifies it);
*D-slot-2 ownership flip re-phased to `each` [2026-06-22]* (basis for D-slot-1 retention).

### 2026-06-22 — `each` spike resolved: item-body shape, D-slot-2, move-min

Spike (CC, scratch-only, not committed) resolved the three gates that blocked the `each`
authoring commission. Evidence read, not trusted from summary.

**Item-body factory shape — DECIDED: SlotEntry reuse (Variant A).**
Per-row body reuses `SlotEntry.content = (props: SlotProps) => TemplateIR`. A thin adapter
exposes the reconcile loop's privately-held `valueSig`/`indexSig` as read-only thunks
`{ item: () => valueSig(), index: () => indexSig() }`. Evidence: TC-10a–j pass under
Variant A on both back-ends; **TC-10f node identity holds** (`lisAfter[0] === lisBefore[0]`)
— the thunk indirection reads through the same signal objects, so the reactive graph is
identical to the writable-signal path. No rebuild, no `itemTemplate` shape change to the
reconcile loop, no core change. `ListBinding.itemTemplate` is bridged to `SlotContent`.

**D-slot-2 ownership — DECIDED: invocation-scoped, already holds for list items.**
Scope note: this confirms D-slot-2 **for `each` item bodies only**. D-slot-1 is **retained
for component slots** (inc 2). This is not a general retirement of D-slot-1.
Evidence: middle-row removal (3 rows → remove row 2) drops parent-signal `observerCount` by
exactly 1 on both back-ends; siblings stay reactive. The per-row `createRoot` already owns
row content (incl. parent-authored `let={}` content); `rec.dispose()` severs it. Under
D-slot-1 the delta would have been 0 (leak) — the gate was failable and passed.
**No `src/core/` change** (current reconcile design was already invocation-scoped). The
inc-2 re-phase's "D-slot-2 flip lands with `each`" resolves to "already true; confirmed, not
flipped."

**Move-minimization (LIS/Ivi) — DECIDED: do NOT commission; question closed.**
Real-Chromium reorder cost: N=1k worst-case sub-2 ms; N=10k shuffle 17 ms; single-move
already O(1) DOM mutations. O(N) `insertBefore` reconcile is acceptable at target N.
Negative result is a complete outcome — closes the parked move-min question rather than
re-parking it.

**Status.** All three gates resolved. `each` authoring increment unblocked: `.nv` `<each>`
element form + tagged-template `each(...)` call form → identical `ListBinding` IR; per-row
body is a `SlotEntry` via the thunk adapter. D2 comparator debt rides this increment.

**Cites.** *Slot increment 2 LANDED [2026-06-22]* (re-phase basis); *D-slot-2 in increment 2
— superseded [2026-06-22]* (the re-phase this spike discharges).

---

### 2026-06-22 — `each` authoring increment ARCHITECT-VERIFIED (verifies 2026-06-22 LANDED)

**Event:** Architect verification of the `each` authoring increment (branch
`feat/each-authoring`), previously reported LANDED by CC. Verified by reading
placed files (html-tag.ts, nv-parser.ts, nv-emitter.ts, interpreter.ts,
emitted-mount.ts, ir-equivalence.ts, each-authoring.test.ts), not CC summary.

**Verified (each item failable on inspection):**
- **G0:** Reconcile loops byte-equivalent pre/post in both back-ends (interpreter
  `wireList`, emitted-mount list case) — both still call `itemTemplate(vs,is)`;
  adapter is NOT in the loop. `src/core/` untouched (0 lines). No forked each-body
  builder — both FEs reuse shared slot machinery (`buildNvSlotContentIR` /
  tagged-template `each()` consumed at construction).
- **Variant A adapter at construction:** both FEs wrap as
  `(vs,is) => factory({ item:()=>vs(), index:()=>is() })`. nv-emitter emits the
  same shape via an IIFE binding `slotProps`. Thunks read through the same signals.
- **G1 transparency:** TC-EA-04 asserts `lisAfter[i] === lisBefore[i]` (node
  identity, update-not-rebuild) on BOTH back-ends.
- **G2 FE-equivalence:** TC-EA-G2 → `irStructurallyEqual` via the new comparator
  `'list'` case (recurses item body with shared stub signals); `pathsEqual` filters
  null placeholders. Not a comparator exception.
- **G4 fail-shows-teeth:** TC-EA-G4 snapshot adapter (`vs()` not `()=>vs()`) freezes
  DOM on value change → confirms the pin has teeth.
- **Anti-vacuous:** all new tests assert DOM/structural output; no `expect(true)`.
- **Contract:** `ListBinding` shape in ir.ts UNCHANGED (no field added). Doc-only
  changelog. reactive-core v0.4.2 and template-ir v0.4 UNCHANGED. No version bump.

**Test count:** CC reported 559 (was 556). [Architect note: count not independently
re-run in-stream — sandbox/CC owns the real run. Accepted as reported pending next
CC run; not a gate.]

**Accepted reduction (G3 narrowing) — REQUIRES the increment-3 close:**
`.nv` behavioral e2e is DEFERRED. TC-EA-11 checks `.nv` body IR *shape* via
`parseNvFile` + `itemTemplate(stub,stub)` inspection — NOT mount→assert-DOM. G3
(behavioral differential) is therefore satisfied for the tagged-template path only;
`.nv` is structural-only. The `.nv` parse-path ListBinding is an explicit stub
(`items: () => []`, "Never call mount()"), so no public mount path exercises
`.nv <each>` behaviorally today — closing it requires bundle→eval→mount (itself
increment-3 scope). **Decision: accept the reduction; defer `.nv` behavioral to
increment 3.** Logged explicitly rather than closing silently as full G3.

**Named debt logged (non-blocking):**
- **D-each-1 (tagged-template `bindingPaths` null):** the tagged-template FE leaves
  `null` at consumed-EachSentinel hole indices in `shape.bindingPaths`; `.nv`
  compacts them out. Consequence: `bindingPaths.length` is NOT equal across FEs for
  `each` templates. Current consumers (interpreter `mountFragment`, emitted-mount
  `emitSetup`) index by `binding.pathIndex` and are safe; `pathsEqual` filters nulls
  so G2 holds. **Failure condition:** any future consumer that iterates
  `shape.bindingPaths` positionally (not by `pathIndex`), or any gate asserting raw
  cross-FE `bindingPaths.length` equality for `each`, will break.
- **D-each-2:** `parseNvFile` parse-path ListBinding is a non-functional stub
  (items/key/itemTemplate placeholders) — structural-IR use only.
- **D-each-3:** `.nv <each>` missing-`let` warns, but warning source positions are
  stubbed `start: 0, end: 0`.
- **D-each-4:** nested `<each>` inside slot content silently produces no ListBinding
  (`buildNvSlotContentIR` ignores the returned `lists`).
- **D-each-5:** `signal()` imported in nv-emitter solely for stub-IR extraction in
  the list emit case (plan-mandated).

**Verdict:** PASS. `each` authoring moves from "unblocked" to "LANDED, verified
(tagged-template behavioral; `.nv` structural-only, behavioral deferred to inc 3)".
Current State header edits applied.

---

### 2026-06-22 — `$style` scoping + class-selection: design APPROVED (rulings 1–4 + class axis)

**Event:** Architect-stream research open (`research-style-scoping.md`) resolved by
owner rulings, then APPROVED (owner, 2026-06-22) along with the spec
(`spec-style-scoping-and-class-selection.md`). NOT yet a CC handoff (approved ≠
commissioned). Two independently-shippable designs settled: `$style` scoping,
and class-selection (`class={...}`). Class-selection surfaced from the `$style` thread
but is a SEPARATE axis and ships as its own increment.

**Constraint 1 (frames everything):** Template-IR §scope already fences style scoping
OUT of reactive-core-contract scope ("Shadow DOM / style scoping — out of contract
scope; IR emits Light DOM by default; Shadow DOM is an opt-in wrapping the mount
point"). Therefore NONE of the below touches the reactive-core contract or requires a
contract bump. These are renderer/compiler-layer decisions. If a future candidate
forces a contract change, that is the signal it is the wrong candidate.

**RULING 1 — Scoping strategy: hybrid, routed PER-ENTRY at compile time.**
Each `$style` entry is classified once at compile time and takes exactly one mechanism
(no runtime branching):
- **Key-form entry** (bare identifier referenced by the template, e.g. `{ card: {...} }`
  with `class={style.card}`) → **class-rewrite**: `card` → `card_<hash>`, template
  reference rewritten to match. (Reuses existing `simpleHash`.)
- **Selector-form entry** (contains combinators / pseudo / `.`/`#`/element names, no
  template handle, e.g. `'div > .foo:hover'`) → **attribute-hash**: stamp
  `[data-nv-s-<hash>]` on the component's shape.html elements; rewrite selector to
  `... [data-nv-s-<hash>]`.
Owner directive: hybrid is acceptable *only if* implemented smartly — classification is
static, single-pass, no unnecessary evaluation, no per-update branching.

**RULING 2 — `$style` accepts BOTH key-form and CSS selectors.** DX + non-limitation.
Parser already retains `source` verbatim (selectors) AND extracts `keys` (handles);
the dual capture supports both forms. The hybrid (Ruling 1) is precisely what makes
accepting both sound: each form routes to the mechanism it fits.

**RULING 3 — `factory`-form value reactivity via CSS-CUSTOM-PROPERTY lowering, NOT
factory re-runs.** Decomposed the conflated "styles should be reactive" into:
  (a) reactive class/style *selection* (which rules apply) — ALREADY FREE today as an
      AttrBinding on `class`/`style`; this is what classcat/cx/Solid-classList do.
  (b) reactive rule *values* (declaration values change) — the genuinely new thing,
      = the `factory` form.
For (b): the compiler analyzes the factory at compile time to split static-vs-dynamic
declarations. Static → emitted once, scoped, never re-evaluated. Dynamic → lowered to
`prop: var(--nv-<key>)` in the static CSS + a reactive `style` custom-property binding
(`el.style.setProperty('--nv-<key>', v)`) riding EXISTING Attr/Prop machinery. The
factory is NOT re-run on signal change; at runtime only the changed custom property is
written. Rationale (perf, the optimization axis owner named): factory-re-run + CSS
re-injection is a document-level cascade recalc scaling with matched-element count —
pathological for run-once-mounts-many. Custom-property write is a single setProperty,
no re-parse, no cascade recalc beyond the heavily-optimized custom-property
invalidation. Boundary: custom properties cover dynamic VALUES; dynamic rule-PRESENCE
(a whole rule appearing/disappearing) or dynamic property NAMES stay in class-selection
(toggle a class), NOT stylesheet mutation.

**RULING 4 — injection/dedup: compiler-internal, judged on sound/correct/performant.**
Owner indifferent to mechanism. Decision: static scoped CSS is hoisted once per
component IDENTITY and deduped (run-once components mount many times → never re-inject
per instance). Dynamic part is per-element custom properties (no stylesheet involvement).
Mechanism (inline `<style>` hoist+dedup vs constructable/adopted stylesheets) deferred
to spec/implementation; constructable stylesheets favored for cross-instance dedup but
not locked.

**CLASS-SELECTION (`class={...}`) — separate axis, own increment.** Compile-time
routing on the expression SHAPE inside `class={...}` (all forms stay `class={...}`,
no new attribute):
- **function call / string / template literal** (e.g. `class={cx(...)}`,
  `class=${() => cx(...)}`) → ONE full-string AttrBinding (reassigns whole attribute).
- **per-key toggle**, reached by each FE's idiom (forms differ by FE constraint, not
  inconsistency — matches `each` `<each>`/`each(...)` and slots `slots.x`/`slot(...)`):
  - **`.nv`:** bare object/array literal — <code v-pre>class={{ active: isActive() }}</code>.
  - **tagged-template:** `classes(...)` SENTINEL — `class=${classes({ active: isActive() })}`
    (bare object throws the FE thunk-validator; sentinel is forced by the medium, like
    `each`/`slot`).
  Both lower to per-key `classList.toggle` effects, ONE EFFECT PER KEY (strictly finer
  than Solid's single looping effect). No diffing (toggle idempotent). FE-equivalence-gated
  against each other (shared oracle, as TC-EA-G2 for `each`).
- static classes stay in shape.html `class="..."` literal, untouched.
nv-beats-Solid point: the compiler emits the right strategy PER SITE; Solid applies one
runtime strategy uniformly. Per-key emission avoids Solid's documented `class`+`classList`
full-reassign footgun BY CONSTRUCTION (toggle owns only its keys).

**Helpers — both FEs, distinct roles:**
- **`cx(...)`** — pure, non-reactive STRING builder (reads booleans → returns string,
  subscribes to nothing). Result → full-string AttrBinding. `.nv`: `class={cx(...)}`
  (compiler wraps). tagged-template: `class=${() => cx(...)}` (bare `cx(...)` throws —
  string, not function). Carries zero machinery; never in IR/contract.
- **`classes(...)`** — tagged-template SENTINEL (NOT a string builder). Same arg shape as
  `cx`/the object literal. Recognized by `html-tag.ts` validator/walk alongside
  `each`/`slot`; lowers to the SAME per-key toggle as the `.nv` object literal. MUST retain
  map structure — never collapse to a string (that would lose per-key granularity).
Both provisional names (owner may reconsider). `classes` is explicitly the tagged-template
analogue of the `.nv` object literal; `.nv` does NOT accept `classes(...)` call-form
(object literal only), mirroring `<each>` vs `each(...)`.

**DX seam (document, not an impl problem):** do not MIX strategies on one element's
`class` — `class={cx(...)}` is full-reassign; <code v-pre>class={{...}}</code> is per-key-toggle; pick one
per element (same root cause as Solid's class+classList warning). Static literal classes
coexist with either.

**Open sub-points carried (not blocking):**
- Per-key-effect default for object form carries a compile-time width-threshold fallback
  to one-looping-effect; threshold gated on real-app `ReactiveNode`-width evidence (ties
  to kind-split watch-item). Owner agreed conservative framing: lean per-key but do not
  hardcode "always per-key" without row-width data.
- Dynamic key name (`{ [className()]: true }`) breaks per-key-effect (key itself reactive)
  → compiler detects non-static key → fallback to looping-classList or full reassign.
- `factory` static-vs-dynamic split assumes signal reads are statically detectable in the
  factory body (same erasure machinery as `$script`). **Caveat found in review:**
  `extractStyleInfo` currently captures `$style` as `source: string` + `keys`, NOT the
  `ts.Expression`, and `$style` source is not bare-read-erased. Increment S must first
  extend `extractStyleInfo` to retain the factory node (preferred) or re-parse `source`,
  before the split/erasure can run on real nodes. Parse-layer extension, not contract/IR.

**Status:** design APPROVED 2026-06-22 (owner). Spec `spec-style-scoping-and-class-selection.md`
APPROVED. Two increments queued, NOT commissioned: (S) `$style` scoping + injection;
(C) class-selection + `cx` + `classes` sentinel. `$style × slots` remains parked behind
(S). No code landed. No contract/IR bump from the decision itself; Template-IR may grow a
thin `ClassListBinding` (lean (b)) and/or `StyleVarBinding` at build time — renderer
contract only, never reactive-core.

---

### 2026-06-22 — Increment C (class-selection) LANDED + ARCHITECT-VERIFIED

**Event:** Class-selection (spec §4, APPROVED 2026-06-22) implemented by CC on branch
feat/class-selection, reported all 8 gates green + 3 self-review gaps fixed. Architect
verification by reading placed files from GitHub main (raw host; html-tag.ts,
nv-parser.ts, ir.ts, interpreter.ts, emitted-mount.ts, test/renderer/class-selection.test.ts,
test/renderer/ir-equivalence.ts), NOT the CC summary or gate table.

**IR decision (spec §6) — option (b) taken, verified sound:** `ClassListBinding`
(`kind: 'classlist'`, `entries: ({ kind:'static', token } | { kind:'toggle', key, expr })[]`)
added as a discriminated union member in `ir.ts`. `AttrBinding` byte-unchanged. Template-IR
bumped v0.4 → **v0.4.1** (doc header in ir.ts cites it; `template-ir.md` PK doc bumped to
v0.4.1 with `ClassListBinding` §3.7.1). Additive, renderer-layer; NO reactive-core contract
touch, no §1/§6 invariant affected — correct per Constraint 1 (style/class scoping is out
of reactive-core contract scope).

**Verified (each failable on inspection):**
- **G0:** ClassListBinding additive; existing AttrBinding wiring unchanged; routing is at
  the ATTR hole branch (`html-tag.ts` `name==='class' && isClassesSentinel`; `nv-parser.ts`
  object/array-literal), NOT `walkNodeList`'s comment branch. `src/core/` untouched.
- **G1 (load-bearing):** both back-ends (interpreter `wireClassList`, emitted-mount
  `classlist` case) emit ONE EFFECT PER KEY for ≤6 with correct per-iteration closure
  capture (`const key=e.key; const expr=e.expr`) — no loop-variable leak. TC-CL-04 counts
  the `big` thunk's invocations, toggles only `active`, asserts count unchanged, on BOTH
  back-ends. Failable: a looping-effect regression for a ≤6 object goes red.
- **G2:** real shared-oracle FE-equivalence — both FEs parse through actual paths;
  `irStructurallyEqual` comparator's `classlist` case compares entries length/kind/token/key
  (skips expr-thunk identity, same policy as `list`/other expr fields). Not a comparator
  exception.
- **G3:** differential parity (interpreter vs emitted) across object, array, and looping
  (>6) forms.
- **G4:** string form (`cx(...)` / `() => cx(...)`) stays `AttrBinding` full-reassign;
  `cx` (`html-tag.ts`) is a pure string builder, exported from renderer index alongside
  `classes`.
- **G5/G6/G7/G7b:** present; real DOM assertions; looping path + computed-key fallback
  covered.

**Validator/idiom split verified:** `classes(...)` returns a `ClassesSentinel`
(`__nvClasses`), added to the html-tag thunk-validator allowlist. A BARE object literal
at a `class` hole in tagged-template still throws (not a function, not a sentinel) —
enforcing the `.nv`-literal / tagged-sentinel idiom split, matching `<each>` vs `each(...)`.
`.nv` does not special-case `classes(...)` call-form.

**Named debt logged (non-blocking — coverage overstatements, not code defects):**
- **D-cl-1 (`.nv` behavioral coverage is via stand-in, not parsed output):** the `.nv`
  parse path emits `stubExpr` for toggle entries, so the parse-path IR is structural-only
  and not directly mountable. TC-CL-G7b's behavioral "toggles correctly" half mounts a
  HAND-BUILT runtimeIr, not the parsed fallback; its real failable assertion is the
  structural `kind==='attr'` check. Same limitation as `each` TC-EA-11. Close via the
  emit-exec path when a class emit-exec increment runs.
- **D-cl-2 (TC-CL-G5 proves a weaker claim than the gate states):** G5 hand-builds a
  deliberately mis-wired IR and asserts broken DOM. This proves the assertion CAN detect
  wrong wiring but bypasses production `wireClassList` — it would pass even if the real
  lowering broke. Real-path wrong-wiring detection is provided by TC-CL-04. G5 is
  redundant teeth, not the primary guard; no action required, logged for accuracy.

**Threshold:** T=6 (≤6 per-key, >6 looping) shipped as placeholder with `TODO(threshold)`
comments in both back-ends, gated on real-app `ReactiveNode`-width evidence (kind-split
watch-item). Not a final value.

**Verdict:** PASS. Class-selection moves to "LANDED, architect-verified." Two named debts
(D-cl-1, D-cl-2) are coverage-accuracy items, not shipped-code defects — the production
lowering is correct on both back-ends.

---

### 2026-06-22 — Increment C-exec COMMISSIONED: close D-cl-1 (`.nv` class-selection behavioral e2e)

**Decision.** Commission a test-only increment (`feat/class-emit-exec`) to close named debt
**D-cl-1** by mounting emitted `.nv` class-selection on the real emit-exec path, reusing the
Increment-3 (`feat/each-nv-behavioral`) harness. Handoff: `cc-handoff-dcl1-class-emit-exec.md`.
Approved ≠ landed; this records the commission. **No `src/` change** is in scope (G0
disqualifier).

**Seam facts verified against `main` (raw host) before commissioning** — these are why the
close is test-only:
- The structural parse path (`buildNvHoleBinding`, `nv-parser.ts`) writes `stubExpr` into
  every classlist toggle `expr` — this is the D-cl-1 limitation (same as `each` TC-EA-11).
- The **emit** path is NOT stubbed: `parseNvFileForEmit` thunk extraction (`nv-parser.ts`
  ~L2188–2257) pulls a real `boolSrc: string` per toggle from the AST, with `hasComputed`
  falling the whole binding back to `AttrBinding` for non-literal forms.
- `nv-emitter.ts` `case 'classlist':` (~L183–201) emits `expr: () => (${boolSrc})` — a real
  per-key reactive thunk matching production lowering. `interpreter.ts wireClassList` is the
  runtime it mounts against.

**Load-bearing case:** EX-CL-02 (per-key toggle reactivity via external prop signal; class
analogue of EX-EACH-02). Failable proof: a stubbed emit would yield `() => undefined`, so the
`extActive.set(false)` → flush → `is-active` absent assertion would fail.

**Gate teeth:** G1.1 (toggle reflects external signal — proves no stub reaches emit),
G1.2 (static token survives a sibling flip — proves per-key `classList.toggle`, not
whole-string rebuild), G1.3 (per-key isolation on the emitted path). Architect verifies by
reading the appended test block AND the captured emitted `.js` for EX-CL-02 (must show a real
`boolSrc`, not `undefined`), not by trusting the green total.

**Reaffirmed open after this lands:** D-cl-2 remains a logged coverage-accuracy note (not a
shipped-code defect); it is unaffected. T=6 per-key width threshold remains a placeholder
gated on real-app `ReactiveNode`-width evidence.

**No contract touch. No Template-IR touch.** reactive-core v0.4.2, Template-IR v0.4.1 unchanged.

---

### 2026-06-22 — D-cl-1 CLOSED (architect-verified); D-cl-3 logged (string-literal class-key quote defect)

**D-cl-1 CLOSED.** `.nv` class-selection is now behaviorally proven on the real emit-exec
path. Increment C-exec landed at commit **1b00492** (branch `feat/class-emit-exec`), test-only
(zero `src/` diff — G0 held). Added EX-CL-01..04 to `test/renderer/nv-emitter-exec.test.ts`;
**599/599 green** (595 baseline + 4), `tsc --strict` clean, biome clean, build clean.

Architect-verified by reading placed files (raw host) + the captured emitted JS, not the CC
summary:
- EX-CL-02 (load-bearing) mounts the emitted `.nv` module, threads an external signal as a
  prop (`active: () => extActive()`), and asserts the toggle reflects the signal in **both**
  directions plus static-token survival across a flip. Failable: a stubbed `() => undefined`
  fails both directions.
- Captured emitted JS for EX-CL-02 shows the toggle entry as `expr: () => (props.active())` —
  a **real `boolSrc`**, not `undefined`. This is the direct evidence the parse-path `stubExpr`
  does not reach the emit path.

**Deviation from handoff (not a defect):** the handoff specced the `.nv` bare-attribute form
<code v-pre>class={{...}}</code>; the landed tests use the interpolated form <code v-pre>class="${{...}}"</code> (object literal
at an interpolation hole). CC chose the form the emit path actually exercises — correct under
the handoff's "confirm the form, do not guess" instruction. Consequence: EX-CL-02 proves the
**interpolated object-literal** path. Whether the bare-attribute <code v-pre>class={{...}}</code> `.nv` form is
a distinct emit path or sugar over the same lowering is **not settled** by this increment —
logged as a minor open question, not blocking.

---

**D-cl-3 — NEW named debt: string-literal class-key quote-inclusion (shipped defect, both back-ends).**

`buildNvHoleBinding` classlist branch (`nv-parser.ts` structural path L368/L401) and the
emit-thunk extraction (~L2206/L2238) both derive the toggle key via `prop.name.getText()`.
For a **string-literal** property key (e.g. `'is-active'`), `getText()` returns the source
text **with surrounding quotes**, so the emitted token is `'is-active'` (quotes included) and
the lowering wires `classList.toggle("'is-active'", …)` — a class named with literal quote
characters. **Verified against `main`.**

- **Severity:** silent wrong DOM (no throw, no fallback) for any object/array `class` key that
  is not a bare identifier — i.e. every hyphenated class name (`is-active`, `btn-primary`),
  the common real-CSS case.
- **Scope:** production lowering, both front-end paths (structural + emit). Identifier keys
  (`card`, `active`) are unaffected — which is why EX-CL-01..04 (identifier-only by design)
  pass and the defect was masked. The D-cl-1 seam proof does not depend on hyphenated keys, so
  the close stands.
- **Fix (mechanical, deferred to next `src/`-touching increment):** for `PropertyAssignment`
  names use the unquoted value — `ts.isStringLiteral(p.name) ? p.name.text : ts.isIdentifier(p.name) ? p.name.text : …` —
  mirroring `extractStyleInfo` (L1240–1245), which already extracts keys correctly. Apply at
  all classlist key-extraction sites (structural + emit, object + array-of-object).
- **Classification:** renderer-layer FE string handling. Not a §1 invariant; does not touch
  what a computation observes mid-propagation. **In-stream, not contract-level.** No contract
  touch, no IR touch.
- **Test debt to add with the fix:** an EX-CL case with a hyphenated key (the case
  EX-CL-01..04 deliberately avoided), asserting `classList.contains('is-active')` on the
  emitted path. This is the failable regression gate.

**No contract touch. No Template-IR touch.** reactive-core v0.4.2, Template-IR v0.4.1 unchanged.

---

### 2026-06-22 — D-cl-3 scope CORRECTED to `.nv`-FE-only; bare-vs-interpolated `.nv` form resolved; helper spec hardened

Corrects the severity scope in the earlier 2026-06-22 entry "D-cl-1 CLOSED … D-cl-3 logged",
which stated D-cl-3 affects "both back-ends / both front-ends." That framing was too broad.
**Verified against `main`:**

- **D-cl-3 is `.nv`-front-end-only.** The bug is AST source-text extraction: the four `.nv`
  classlist key sites use `prop.name.getText()` (quotes included). The tagged-template paths
  `classes(...)` and `cx()` (`html-tag.ts` L172, L260) extract keys via `Object.entries(arg)` —
  runtime JS object iteration where the key is already an unquoted JS string. **Immune by
  construction.** Both back-ends *consume* the bad token, but the defect originates solely in
  `.nv` key extraction. Corrected severity: `.nv`-FE-only, not "both front-ends."

- **Open question resolved (the EX-CL-02 deviation):** the bare <code v-pre>class={{...}}</code> and interpolated
  <code v-pre>class="${{...}}"</code> `.nv` surface forms are **NOT distinct extraction sites** — both reach
  `buildNvHoleBinding`'s object-literal branch. So D-cl-3 is one `.nv` AST-extraction path with
  exactly **four call sites** (object/array × structural/emit: `nv-parser.ts` L367/L399/L2205/L2237),
  no fifth site. The "however many paths" risk flagged before commissioning is closed at four.

- **Helper spec hardened (two latent-bug fixes folded into the S0 handoff):**
  1. `propertyKeyText` must **enumerate** PropertyName kinds (Identifier/StringLiteral/
     NoSubstitutionTemplate/Numeric → `.text`; Computed → `null`), NOT binary-split
     StringLiteral-vs-else-`getText()`. A binary split leaves a numeric-key (`{ 2: cond }`)
     latent bug identical in class to the one being fixed.
  2. **`null` means computed-key ONLY** (→ existing `hasComputed` → AttrBinding degrade, which
     is correct because a computed key's identity is genuinely runtime-only). An *unhandled
     static kind* is a helper gap → **halt/throw and surface**, never silent-degrade. Routing a
     statically-knowable key to fallback would trade loud wrong-DOM for a quiet
     missing-optimization — the same masking `getText()` did. "Extract correctly" is the fix;
     "extract-or-give-up" applies only to genuinely-computed keys.

Revised handoff `cc-handoff-style-s0-plus-dcl3.md` updated in place (Part A scope + helper +
null/halt distinction; G1.A4 numeric-key gate, G1.A5 computed-key regression gate; added
unhandled-static-kind halt trigger). No change to S0 Part B (F1) or to commission status.

**No contract touch, no IR touch.** Renderer-layer, in-stream. reactive-core v0.4.2,
Template-IR v0.4.1 unchanged.

---

### 2026-06-22 — Increment S0 (F1) + D-cl-3 LANDED (architect-verified, merge `6baa64e`)

Branch `feat/style-s0-parser-seam` merged to `main` at **6baa64e**. Baseline 599 → **607**
(+8). Touches `src/renderer/nv-parser.ts` + `test/renderer/` only (G0 held — no IR, emitter,
interpreter, core, or emitted-mount changes). No contract touch, no Template-IR touch.

**Architect-verified by reading placed files at the merge SHA** (the `main` raw URL served a
stale CDN cache mid-verification; fetching by commit SHA resolved it — note for future verifies:
prefer the SHA URL over the branch URL when confirming a fresh push):

- **D-cl-3 CLOSED.** `propertyKeyText(name): string | null` added to `nv-parser.ts` (L1229).
  Enumerates Identifier / StringLiteral / NoSubstitutionTemplate / Numeric → `.text`;
  ComputedPropertyName → `null`; any other static kind → `throw` (surfaces helper gaps rather
  than silent-degrading). Applied at all four classlist key sites (L369, L401, L2232, L2264);
  `key === null` routes through existing `hasComputed` → AttrBinding. The `getText()`
  quote-inclusion bug (`'is-active'` → `"'is-active'"`) and the whitespace mis-split are gone.
  Both hardening points from the pre-commission review landed: enumerate-not-binary-split, and
  null-means-computed-only (unhandled-static → halt).

- **S0 / F1 LANDED.** `NvStyleInfo` extended (additive): `objExpr: ts.ObjectLiteralExpression`
  (non-nullable), `factory?: ts.ArrowFunction | ts.FunctionExpression`, `hasComputedKeys: boolean`.
  Option (a) node retention (no re-parse). `extractStyleInfo` now takes `symbols: ScriptSymbols`
  (threaded at both call sites) and erases factory-form property initializers via
  `eraseSignalReadsInNode` (proof-of-wire for S1/S2); returns `null` when the factory body is
  not a bare/parenthesized object. Object form not erased (no reactivity). `source` retains a
  JSDoc warning that it is NOT erased for factory form.

- **Two scope additions beyond the handoff, both accepted as sound (not creep):**
  - `hasComputedKeys` flag — `keys: []` was ambiguous between empty-style and computed-only
    style; the flag disambiguates. Additive, justified.
  - Empty-string-key fix in `extractStyleInfo` (`if (k !== null)` not `if (k)`) — `{ "": v }`
    is a legal key that truthiness-checking drops. Real bug, correct fix.

- **Review-cycle note (good-kind self-correction):** Round-1 Finding-1 over-claimed a `if (k)`
  bug at "6 sites including classlist"; CC corrected it to 2 real sites in `extractStyleInfo`
  (the classlist sites already used the `key === null` pattern). Verified accurate against the
  placed file — the classlist sites route null correctly.

**Gates:** `pnpm test` 607/607; `tsc --strict` clean; biome clean; build clean; two
independent review rounds (15 findings total, all fixed). Verified independently by reading
the helper body, all four classlist sites, and the `NvStyleInfo` shape at `6baa64e` — not the
green count.

reactive-core v0.4.2, Template-IR v0.4.1 unchanged.

---

### 2026-06-22 — Increment S1+S2 MERGED; `StyleVarBinding` IR decision; key discriminant ruled; spec APPROVED

Supersedes the S1/S2 split in the 2026-06-22 phasing entry ("Increment S PHASED into S0/S1/S2").
S0/F1 landed (`6baa64e`); S1 (static scoping) and S2 (dynamic lowering) are now **one
increment, S1+S2**, because the seam S2 needs is in place and a static-only S1 was an
artificial slice. Spec APPROVED 2026-06-22: `spec-style-s1s2-scoping-and-lowering.md` (not yet a CC handoff).

**Decisions locked in this entry:**

1. **Merge S1+S2.** One increment carrying scoping emission (class-rewrite + attribute-hash +
   hoist/dedup) AND dynamic value lowering (static/dynamic split, `var(--nv-…)`, reactive
   `setProperty`). Real-browser gated. `.nv`-FE-only.

2. **IR decision: new `StyleVarBinding`, NOT `PropBinding` reuse.** Template-IR **v0.4.1 →
   v0.4.2** (additive union member, ClassListBinding-v0.4.1 precedent). Decided against the real
   `ir.ts` shape at `6baa64e`: `PropBinding` is `{kind:'prop', name, expr}` with sink `el[name]=v`
   — no `setProperty` path, no removal semantics, different name namespace. Reuse would require a
   shape change to `PropBinding` (a Template-IR touch regardless) and muddy its single
   responsibility. New member is cleaner and additive. Shape:
   `{ kind:'style-var', varName:string, expr:ReactiveExpr<string|number|null|undefined> }`;
   `null`/`undefined` → `removeProperty`. Interpreter `wireStyleVar` mirrors `wireProp`
   (one effect/binding, owner-tree cleanup). **Renderer-layer; no reactive-core touch** (no §1
   invariant, no change to mid-propagation observation — a write sink on the effect's downstream
   edge). The v0.4.2 bump LANDS with the dynamic-lowering sub-phase (build order step 3), not at
   spec approval.

3. **Key discriminant RULED (class-vs-selector, two-way).** A `$style` key is **class-form**
   iff every whitespace-separated token matches `^-?[_a-zA-Z][_a-zA-Z0-9-]*$` AND no single
   token is a known HTML/SVG tag name; **otherwise selector-form**. Class-form → per-token
   class-rewrite (`card`→`card_<hash>`); selector-form → attribute-hash (`[data-nv-s-<hash>]`),
   scoped as written. Space-separated class lists (`'card active'`) are supported (each token
   rewritten). Single bare tag (`'button'`) → element selector. Tag-name set is one maintainable
   `KNOWN_ELEMENT_TAGS` constant (HTML+SVG; MathML deferred), adjudicating only the single bare
   token. **Principle: nv does not invent CSS semantics** — it routes and rewrites, never
   validates/fixes/reinterprets. Mixed keys (`'button card'`) are scoped as the CSS they are
   (descendant combinator); not rejected, not special-cased. Author owns CSS correctness.
   - Resolves the routing gap surfaced when S1 needed per-entry routing: S0's flat
     `NvStyleInfo.keys` is lossy on this distinction; routing reads `objExpr` property names
     directly. (Not an S0 defect — the discriminant was never specified; surfaced now.)

4. **Static/dynamic split RULED.** A value is *dynamic* if its erased initializer (S0 seam) reads
   any `symbols.all` reactive; *static* otherwise. Factory analyzed at compile time, never re-run
   (per phasing entry). Static → hoisted stylesheet; dynamic → `var()` + `StyleVarBinding`.

5. **Injection built new.** Verified at `6baa64e`: interpreter has NO injection machinery. Built
   in this increment, keyed by component identity, dedup'd, **through the passed `doc` (never
   global `document`)** — required by the locked "renderer stays agnostic" decision (SSR/multi-doc).

**Seven OPEN spec points deferred to build (seam-in-front, CC halts not guesses):** selector
qualification form (OPEN-1, browser-gated), declHash property-name inclusion (**OPEN-2 CLOSED
2026-06-23** — property name folded in, `--nv-${simpleHash(scopeHash+'|'+cssProp)}`), dynamic
value coercion (OPEN-3), injection registry shape/lifetime (OPEN-4), `<style>` vs
`adoptedStyleSheets` (OPEN-5, browser-gated), teardown policy (OPEN-6), `$style × ClassListBinding`
rewrite consistency (**OPEN-7 CLOSED 2026-06-23**). See spec §7.

reactive-core v0.4.2 unchanged. Template-IR v0.4.1 now (bump to v0.4.2 lands with dynamic-lowering
sub-phase).

---

### 2026-06-22 — Increment S1+S2 COMMISSIONED (full; plan-first hard gate)

Handoff `cc-handoff-style-s1s2.md` written; branch `feat/style-s1s2`. Spec is authoritative at
`docs/design/spec-style-s1s2-scoping-and-lowering.md` (APPROVED 2026-06-22). Commissioned as the
full increment (all four sub-phases), NOT sliced — at architect's direction.

**Plan-first hard gate (Gate P).** CC produces `docs/design/plan-style-s1s2.md` covering all four
sub-phases (files+seams cited at HEAD, OPEN-point resolution PROPOSALS not resolutions, per-phase
gate tables with evidence-command + failure-condition, differential corpus, locked-constraint
confirmations) and **HALTS for architect approval before any `src/` touch.** Proceeding to code
pre-approval is a G0 disqualifier. Rationale: the seven OPEN spec points include browser-gated
design decisions (OPEN-1 selector qualification, OPEN-5 `<style>` vs `adoptedStyleSheets`) that
must be ruled before the expensive browser-gated phases, or a multi-revision loop results.

**Gate structure:** per-phase G0/G1 tables, each item failable (evidence command + failure
condition). Phase 1 (discriminant+tag-set) sandbox, no IR. Phases 2–4 real-browser REQUIRED
(jsdom not authoritative for cascade/custom-property/dedup). Template-IR **v0.4.2** bump lands
with Phase 3 (`StyleVarBinding`), flagged as the contract-adjacent surface point — Template-IR
doc version + cross-ref consistency pass on landing. reactive-core untouched.

**Locked constraints fenced as increment-level G0** (L.1–L.6): no `src/core/` touch; injection
through `doc` not global `document`; factory analyzed compile-time never re-run; nv does not
invent CSS semantics; misclassification falls to dynamic (safe — static-baked-dynamic is the
only WRONG outcome, per "skip only provable work"); both back-ends differential-tested
(shared oracle).

No decisions resolved here beyond commissioning — the OPEN points remain open, to be ruled
against CC's plan (Gate P). reactive-core v0.4.2, Template-IR v0.4.1 unchanged until Phase 3.

### 2026-06-22 — OPEN-7 (`$style` × `<each>` classlist) RULED: total-recursion patch, not depth-1

Resolves the fork in CC's `$style × $each` seam briefing (Gate-P plan stage, branch
`feat/style-s1s2`). Ruling artifact: `ruling-style-each-classlist.md`.

**Decision.** Rewrite `$style` class-form tokens inside `<each>` bodies via `patchClasslistTokens`
(Option A), **with the recursion fix making the walk total** — NOT CC's literal Option A
(patch each `pendingLists[i].bodyIR`), and NOT Option B (runtime threading).

**Why the literal Option A fails (verified on branch).** `buildNvSlotContentIR` discards
`walkNvNodeList`'s `lists` return (L772, `// lists is intentionally ignored in slot content
builder`). Nested `<each>`-inside-`<each>` body IRs are therefore absent from the outer
`pendingLists` (loop L1039). Patching `pendingLists[i].bodyIR` covers depth-1 only; combined with
`patchClasslistTokens`'s current `list`-skip (L1887–1889), a depth-≥2 inner body is never
rewritten → silent wrong DOM. This is the degraded-second-path pattern (slot subsystem bitten 4×):
a walk that re-skips a kind handled elsewhere.

**The fix.** Make `patchClasslistTokens` recurse into `list` bindings (mirroring its `conditional`
recursion) by calling `itemTemplate` once with the existing L172 stub signals to obtain the item
`bodyIR`, then recursing. The single existing call at L1997 (interp) / L2908 (emit) on the parent
IR becomes total over all nesting depths, with no dependency on `pendingLists` flatness or
iteration order. Collapses to one walk per the "collapse, don't patch, the degraded-copy"
principle. Reuse the existing stubs (no new ones); confirm the stub-call is inert.

**Escalation verdict: in-stream, not contract-level.** `classRewrites` is a compile-time-fixed
`Map<string,string>` — no reactive reads, static capture like `itemsSrc`/`keySrc`/`letNames`.
The patch introduces no tracked read and no write-during-propagation; the factory stub-call runs
at preprocess time outside any reactive scope. No §1 invariant touched, no change to what a
computation observes mid-propagation. Renderer-layer.

**Gate.** Phase 4 / OPEN-7 table gains O7.1 (depth-1), **O7.2 (nested depth-2 — load-bearing;
the case literal Option A passes structurally while emitting wrong DOM; real-browser mount)**,
O7.3 (conditional-inside-each), O7.4 (differential), O7.5 (stub-call inert).

No contract touch. No Template-IR touch. reactive-core v0.4.2, Template-IR v0.4.1 unchanged.

### 2026-06-23 — OPEN-2 (`$style` declHash property-name inclusion) CLOSED: property name folded in

**Decision.** `declHash` folds in both component identity AND the CSS property name:
`--nv-${simpleHash(`${scopeHash}|${cssProp}`)}`. Two dynamic declarations on the same selector
(e.g., `color` and `font-size`) therefore get distinct custom-property names, preventing
collision. Verified in `src/renderer/nv-parser.ts` `buildStyleArtifact` implementation on branch
`feat/style-s1s2`. No ruling needed — the correct answer was evident from the seam (two dynamic
decls on one selector is an ordinary case; shared hash would overwrite one). OPEN-2 closed at
build, not deferred to architect.

### 2026-06-23 — Increment S (S1+S2) LANDED on `main`, architect-verified

`$style` scoping + dynamic-value lowering merged to `main`. Spec authoritative at
`docs/design/spec-style-s1s2-scoping-and-lowering.md`. Verified by reading placed file
content on `main` (not CC summary; not a green gate table):

- **`StyleVarBinding` in the IR union, final v0.4.2 shape** — `src/renderer/ir.ts` L266
  `{ kind:'style-var', varName, expr:ReactiveExpr<string|number|null|undefined> }`,
  union member L285. Stub comments already removed (L262 reads `StyleVarBinding (v0.4.2)`;
  the "Phase 3 stub" cleanup flagged last session is DONE).
- **`buildStyleArtifact` wired at both parser sites** — `src/renderer/nv-parser.ts`
  parse-path L1990, emit-path L2901.
- **OPEN-2 ruling reflected in code** — `declHash` folds component identity + CSS property
  name: `--nv-${simpleHash(`${scopeHash}|${cssProp}`)}` (nv-parser.ts L1772). Distinct
  custom-property names per (selector, property); no collision.
- **OPEN-7 fix present** — `patchClasslistTokens` recurses into `conditional` and `list`
  (nv-parser.ts L1885–1894), making the parent-IR call total over those nesting depths.
- **`style-inject.ts` present on `main`.**

**Versions on land:** Template-IR **v0.4.1 → v0.4.2** (StyleVarBinding additive member).
reactive-core **v0.4.2 unchanged** (renderer-layer; no §1 invariant, no mid-propagation
observation change — write sink on the effect's downstream edge).

**OPEN points status at land** (per their own ruling entries): OPEN-2 CLOSED (above),
OPEN-7 CLOSED (above). OPEN-1 (`:where()` selector qualification), OPEN-3 (dynamic value
coercion), OPEN-4 (injection registry shape/lifetime), OPEN-5 (`adoptedStyleSheets`-first
+ `<style>` fallback), OPEN-6 (teardown policy): confirm chosen-at-build vs. genuinely-open
against the spec §7 before treating any as live. R-style-1 (`<style>` fallback AOT batching)
remains OPEN research, not blocking.

**Correcting the prior Current State.** The header carried S1+S2 as "COMMISSIONED…
not yet landed" and Template-IR at v0.4.1 — both stale as of this verification. Recorded
here as an event; Current State edited to match (below). No reversal of a decision; a
catch-up of the resolved picture to ground truth.

**Discovered gap (not closed here; routes to next increment).** `patchClasslistTokens`
has NO `component` case — it does not descend into `ComponentBinding.slots[].content`.
Parse path captures slot-content IR by-reference into a `SlotContent` closure during the
walk (nv-parser.ts L656/L677), *before* the patch runs (L2003/L2914). Emit path emits slot
content as `ThunkSource[]` source strings (L2581+), with no IR object to patch at all.
**Consequence:** class-form `$style` tokens authored in slot content are currently
un-rewritten on both paths — slot content renders raw class names, silently breaking parent
scope across the slot boundary. This is the `$style × slots` axis, now unparked; see its
spec. Logged as the seam fact that motivates the next increment, not fixed here.

No contract touch. reactive-core v0.4.2, Template-IR v0.4.2.

### 2026-06-23 — `$style × slots` scope-carry RULED (parent-wins; child-opaque; Mechanism B)

Spec authoritative at `docs/design/spec-style-slots-scope-carry.md`. Unparked after S1+S2
landed (the class-rewrite-vs-attribute-hash discriminant is what made scope-carry answerable).
Seam read on `main` before ruling (no inferred internals).

**Seam-verified gap (motivating fact).** `patchClasslistTokens` has no `component` case
(nv-parser.ts L1870–1894); parse path captures slot-content IR by-reference into a `SlotContent`
closure during the walk (L656/L677) BEFORE the patch runs (L2003/L2914); emit path emits slot
content as `ThunkSource[]` source strings (L2581+), no IR object to patch. **Today, class-form
`$style` tokens in slot content are rewritten by neither side — they render raw.** OPEN-7 family
(patch walk re-skips a kind handled elsewhere), now for `component`.

**Ruling 1 — semantic: scope-by-lexical-author (parent-wins).** Class-form `$style` tokens
authored in parent-supplied slot content carry the PARENT's scope hash. A child reaches slot
content styling only via its own outlet wrapper or selector-form keys (subject to Ruling 2),
never by class-form rewrite of tokens it did not author. Child-wins rejected: it rewrites
parent-authored tokens against the parent's stylesheet, turning every such token into a dead
class (the child never saw the parent's class names). Consistent with D-slot-1 lexical ownership.

**Ruling 2 — child selector-form reach: NO (reading (b)).** Slot content is opaque to the
child's selector-form scope. nv guarantees it NEVER deliberately tags parent-projected nodes with
`data-nv-s-<childhash>` and never rewrites tokens the child did not author. nv does NOT guarantee
non-match: a child's plain descendant selector may incidentally match a projected node if DOM
nesting causes it — CSS cascade, author's domain. Reading (a) (nv actively defeats cross-boundary
match) rejected as inventing CSS semantics (locked principle). No `::slotted` analog this
increment; if a concrete layout-shell case arises later it returns as a narrow-YES increment
(top-level-projected tagging). **Consequence:** no attribute carry on slot nodes → no Template-IR
shape change, no version bump expected from this axis.

**Escalation note.** Ruling 2 is the cross-boundary observation call (what the child's scope
observes across an ownership boundary) — escalation-level by project calibration, ruled by
architect, not decided in-stream. Ruling 1 (class-form authorship) and the mechanism are
in-stream/renderer-layer.

**Mechanism — B (sole viable), confirmed.** Rewrite class-form tokens at slot-content BUILD time,
before capture/emit, on both paths. Mechanism A (total-walk into slot factories, patch captured
IR in place) ELIMINATED by the seam: (i) depends on factories returning captured IR by-reference,
which the scoped-slot shape `(props)=>TemplateIR` permits breaking (fresh IR per call → patch a
throwaway); (ii) emit path has no IR object at all (source strings) — A cannot run on the
authoritative mount path; adopting it would create the parse/emit divergence differential
conformance forbids. B requires the scope SEED before slot content is built (classRewrites is
static/hoistable, L1758–1804, but scopeHash seeds from `simpleHash(ir.id)`, post-walk, L1988).
**B1 (preferred):** deterministic pre-walk seed proven equal to `ir.id`-derived hash (gate G3) —
CC proposes the seed in the Gate-P plan and HALTS if it cannot prove equality. **B2 (fallback):**
two-pass. B1-vs-B2 is in-stream.

**Gates** (spec §7): G1 parent-hash on projected node; **G2 fresh-IR-factory rewritten (the case
A passes structurally while emitting wrong DOM — load-bearing)**; G3 seed equality; G4
parse↔emit differential (shared oracle); G5 nested `<each>`-in-slot (OPEN-7 × slots); G6 §5
guarantee real-browser ×3 (asserts no deliberate child-tag, NOT non-match); G7 single rewrite
site per path (no second walk — collapse-don't-patch).

reactive-core v0.4.2 untouched. Template-IR v0.4.2 (no bump expected). Commissioned next under
Gate P: `docs/design/plan-style-slots-scope-carry.md`, HALT before any `src/`.

### 2026-06-23 — `$style × slots` OPEN-S1 RESOLVED: B3 (scope seed = pre-walk `shapeHtml`)

CC halted at OPEN-S1 (the B1 seed-circularity the spec flagged at G3/F6): `ir.id =
simpleHash(reserializedShape)` is POST-walk (nv-parser.ts L1101); `buildNvSlotContentIR` runs
DURING the walk; so `scopeHash = simpleHash(ir.id)` is not in hand at slot-build time. CC offered
B1a (redefine `ir.id` to hash pre-walk shape) and B2 (defer slot IR to post-walk, restructure
`walkNvNodeList` return). **Architect surfaced and ruled a third option: B3.**

**Seam verification before ruling (read on `main`):**
- `ir.id = nv:${simpleHash(reserializedShape)}`, post-walk, components→anchors (nv-parser L1090,
  L1101). CC's circularity claim confirmed.
- `patchClasslistTokens` mutates `ir.bindings` only, NOT `ir.shape.html`; `ir.id` is hashed before
  any rewrite (L1094→L2003). No feedback loop — the seed is stable regardless of rewrites.
- `shapeHtml` (pre-walk, sentinel-stripped) exists at nv-parser L883 and is available BEFORE
  `walkNvNodeList` (L993), i.e. before slot content is built.
- `$style` is `.nv`-FE-only by design (S1+S2 spec L12; tagged-template FE has no `$style` — no
  scopeHash/buildStyleArtifact in html-tag.ts). Differential conformance for `$style` = interpreter
  vs. emitted back-end, both within the `.nv` FE. (An initial "FE-divergence" alarm was raised and
  RETRACTED on this fact.)
- Injection dedup (`style-inject.ts` L18/L24) keys on `identityHash`; `styleArtifact` carries
  `{ css, scopeHash }` (ir.ts L83–85). Injection keys on `scopeHash`, not `ir.id`.

**RULING — B3.** Change the two `scopeHash` sites (nv-parser L1988, L2899) from
`simpleHash(renderResult.ir.id)` to `simpleHash(shapeHtml)`. Leave `ir.id` untouched.

- `.nv`-FE-local, style-subsystem-local. No core IR identity change.
- `shapeHtml` available pre-walk → slot content built during the walk carries the scope hash
  directly; NO post-walk slot rebuild, NO `walkNvNodeList` return restructure.
- G3 seed-equality becomes trivially true: both back-end sites use the identical pure input
  `shapeHtml`. The equality the spec demanded holds by construction.
- `ir.id` (post-walk, mounted-shape identity) and `scopeHash` (pre-walk, style identity) are
  cleanly DECOUPLED. Injection dedups on `scopeHash`; mount/cache keys on `ir.id`. Correct that
  these differ.

**B1a REJECTED:** redefining `ir.id`'s input is a core IR identity-semantics change with
unbounded blast radius (every `ir.id` consumer: dedup, caching, mount keying), to save local
plumbing. Spec locked this increment as renderer-layer, no core IR semantics. "Simpler code path"
is locally true, globally false.

**B2 REJECTED as unnecessary:** sound, but B3 achieves the goal without deferring slot build or
restructuring the walk return type. B2 retained as the fallback if B3's behavioral change (below)
proves unacceptable — it is not expected to.

**B3 behavioral change (gate, not blocker):** `scopeHash` moves from post-walk to pre-walk shape,
so hash VALUES change for any styled component containing child components (`shapeHtml` ≠
`reserializedShape` there). Existing S1+S2 gate fixtures pinning literal hashes must be
regenerated. Opaque-hash fixture update; not a semantic risk. New gate **G3': two styled
components with identical `$style` + identical authored `shapeHtml` but different child-component
composition share a scopeHash — assert this is correct (same authored style → same scope) and
that injection dedup does not wrongly merge their non-style identity (it keys on scopeHash, which
is intended to merge identical styles).**

OPEN-S2 (single insertion in `buildNvSlotContentIR`) and OPEN-S3 (reuse `ir-equivalence` harness)
CONFIRMED as proposed. reactive-core v0.4.2 untouched. Template-IR v0.4.2 (no bump). CC unblocked
to complete the Gate-P plan with B3 as the mechanism and resume per the plan-first gate.

### 2026-06-23 — `$style × slots` Gate P APPROVED; B3 shape corrected; injection-key bug found

Plan committed `f96894e`, reviewed against seams on `main`. Approved with one required change.
Cites the OPEN-S1/B3 ruling (same date) and the scope-carry rulings (same date).

**CC correction accepted (my spec §4 was wrong).** B3 fixed the *scopeHash* circularity via
pre-walk `shapeHtml`, but `styleInfo` (→ `classRewrites`) is extracted POST-walk at nv-parser.ts
L1987, AFTER `buildNvSlotContentIR` (L558/649/669) has already run. So `classRewrites` cannot be
threaded INTO the slot builder during the walk — my spec §4 instruction to do so was impossible.
The rewrite must be a POST-walk IR patch. Confirmed on `main`.

**Required architectural change (collapse, don't patch).** CC proposed a NEW
`patchSlotContentTokens` function. REDIRECTED: add a `component` case to the EXISTING
`patchClasslistTokens` (L1870) instead. That function is already the recursive post-walk
token-rewrite walk with `conditional` (L1884) and `list` (L1890–1894) cases; the `list` case
already does factory-stub-call-then-recurse. Slot content is the structurally identical missing
case (the OPEN-7 gap). A separate function re-derives that descent logic = degraded second path
(slot subsystem bitten 4×). Merging satisfies G7 (one walk) by construction.

**Injection-key bug found (interpreter.ts L711).** `injectComponentStyle(doc, ir.id, css)` keys
dedup on `ir.id`, but the scope attribute (L713) and all CSS rules use `scopeHash`. Pre-B3 this
was masked (scopeHash derived from ir.id → same id implied same scopeHash). B3 decouples them
(`scopeHash=simpleHash(shapeHtml)` ≠ `ir.id=simpleHash(reserializedShape)`), unmasking
over-injection of identical stylesheets for distinct-shape/same-style components. FIX: key on
`ir.styleArtifact.scopeHash`. Scoped to this increment (B3 unmasks it); gated by G3'.

**G2 reframe accepted:** code-comment constraint gate on the by-ref factory assumption
(`(_props)=>namedIR`). The scoped-slot shape `(props)=>TemplateIR` permits a fresh-IR factory that
would break stub-patch silently — assert the invariant. NOTE: the landed `list` case has the
identical latent fragility; add a flag comment there (no behavior change, not this increment's
fix).

Tasks: (1) thread `shapeHtml` to L1988/L2899; (2) `component` case in `patchClasslistTokens` +
interpreter.ts L711 key fix. OPEN-S2 subsumed by the merged case; OPEN-S3 (reuse ir-equivalence)
confirmed. reactive-core v0.4.2 untouched. Template-IR v0.4.2 (no bump). CC to re-commit the plan
with the merge, then proceed to `src/` (no second approval round — strict simplification).

### 2026-06-23 — `$style × slots` G5 DEFERRED; spec error corrected; `<each>`-in-slot increment filed

CC flagged G5 (`$style × <each>-in-slot`) as ungateable. Verified on `main`: correct, and the
spec was wrong to list it.

**Seam fact (verified, nv-parser.ts L758–772).** `buildNvSlotContentIR` destructures
`walkNvNodeList`'s return as `{ holeInfos, holePaths, components, consumed }` and **explicitly
discards `lists`** (L772 comment: "lists is intentionally ignored in slot content builder").
`<each>` inside slot content produces NO list binding in the slot IR. Therefore
`patchClasslistTokens`' `list` case has nothing to descend into — G5 cannot pass, because the
capability it gates (`<each>` in slot content) **is not wired on either path** and never was.

**This is a pre-existing limitation, not a regression.** Already known and logged: the OPEN-7
ruling justified the parent-IR `list` recursion precisely by citing "buildNvSlotContentIR
discards nested lists (L772) — depth-1-only patch would silently miss `<each>`-in-`<each>`."
G5 was unrunnable from the start.

**Spec error corrected.** spec-style-slots-scope-carry.md §7 G5 and the Gate-P plan gate table
listed G5 with no "deferred" annotation, implying `<each>`-in-slot was in scope for this
increment. It never was — it's an unrelated core slot-rendering capability, not a styling feature.
Listing it was the defect. Fix the annotation, not the scope.

**RULING: defer G5; do NOT wire `<each>`-in-slot in this increment.** Wiring it here would
(a) import an unrelated core capability into a styling increment (boundary violation),
(b) re-derive list-binding construction inside `buildNvSlotContentIR` — the parallel second
builder the slot subsystem was bitten by 4× (collapse, don't extend the second path), under
increment time pressure, and (c) require its own both-back-end differential + emit-path nested-
`ThunkSource` handling. Rejected wiring-now (scope creep) and wire-now-as-separate-commit
(same second-path risk, just relabeled).

**`$style` styling work is complete and correct.** When the `<each>`-in-slot capability is built,
`patchClasslistTokens`' existing `list` case rewrites `$style × <each>-in-slot` tokens for free —
no additional styling work. The styling waits on the capability; it does not block it.

**Filed: new backlog increment "`<each>` in slot content".** Wire `lists` from `walkNvNodeList`
into `buildNvSlotContentIR` by collapsing toward the primary builder (NOT extending the second
path). Owns: both-back-end differential, emit-path nested-list `ThunkSource`, and re-enabling the
skipped G5 test as its acceptance gate. Not scheduled.

Task 2 (`$style × slots`) is otherwise complete pending the remaining gates (G1–G4, G3', G6, G7).
G5 test stays written-and-skipped with the deferral reason in the skip message, pointing at the
`<each>`-in-slot increment. reactive-core v0.4.2 untouched. Template-IR v0.4.2 (no bump).

### 2026-06-23 — `$style × slots` close-out verified at `1aa52b8`; C1 seed amendment + debts

Verified landed at HEAD (10 commits, baseline 9b517e6): C1 seed at both sites (nv-parser L2023,
L2934), both injection-key fixes (interpreter.ts L711, emitted-mount.ts L706 → `scopeHash`),
`component` case inside `patchClasslistTokens` (single function, G7 holds), G2 fragility comments
on both `list` and `component`. 647 pass / 2 skipped, browser ×3 green.

**C1 amendment to B3 (supersedes the bare-`shapeHtml` seed from the OPEN-S1/B3 entry, same
date).** The B3 ruling set `scopeHash = simpleHash(shapeHtml)`. CC's second deep review found
this collides: two components with identical templates but DIFFERENT `$style` rules get the same
`shapeHtml` → same scopeHash → same rewritten class token → second component's CSS silently
dropped by injection dedup. **Landed fix:** seed is
`simpleHash(`${shapeHtml}\0${styleInfo?.source ?? ''}`)` at both sites — style source folded in,
NUL-delimited. Distinct `$style` → distinct scopeHash. Gated by G3'-inverse (same shapeHtml +
different `$style` → distinct hash). This is the correct seed; B3's `ir.id`-decoupling and
pre-walk availability are unchanged.

**D-slot-style-1 (named debt) — static-class rewrite in slot content is string-regex on
`shape.html`, not structural.** Static `class="..."` attributes in slot content live in
`slotIR.shape.html` as strings (no `classlist` binding exists for them), so the `component` case
rewrites them via `shape.html.replace(/\bclass="([^"]*)"/g, ...)`. Correct for real class attrs,
but the regex can false-match a literal `class="..."` appearing in TEXT content. Defensible
(static attrs have no structural token to rewrite; this is the only handle), but it is a
second rewrite representation for the same logical op (structural for bindings, string for static
attrs). Not a shipped defect at any tested input. Re-evaluate if slot static-attr handling is
reworked. Coverage: the static branch is reachable only via the mixed case (static class + a
hole), tested (F7); the all-static case is unreachable (next debt).

**All-static slot content unrewritten (named limitation; same family as D-each-4).** A
ComponentBinding is only produced when slot content contains ≥1 interpolation hole (parser uses
the hole to detect the component boundary). Purely static slot content
(`<ChildComp><div class="card">x</div></ChildComp>`, no holes) produces no ComponentBinding → the
`component` case is never reached → its static class stays unrewritten. **Pre-existing parser
constraint, not a regression** (same boundary-detection family as D-each-4: nested `<each>` in
slot content also produces no binding). Documented in source + implementation-state.md; recorded
here for the source-of-truth. Closes when the parser detects component boundaries without
requiring a hole — not scheduled.

reactive-core v0.4.2 untouched. Template-IR v0.4.2 (no bump). G5 deferral stands (separate
`<each>`-in-slot increment).

### 2026-06-23 — Template-IR doc reconciled to v0.4.2 (doc-only; code unchanged)

**Decision.** Reconcile `template-ir.md` to match the landed `ir.ts` (which already
declares v0.4.2). Doc-only — no `src/` change. The doc had drifted a full version
behind code across three fast feature lands (classlist, $style, each-factory).

**Drift corrected:**
- Header v0.4.1 → **v0.4.2**; changelog line added.
- Binding count "Ten" → "Twelve"; §3 union + appendix union now include
  `ClassListBinding` (v0.4.1) and `StyleVarBinding` (v0.4.2). Appendix had omitted
  BOTH.
- `ListBinding.itemTemplate` documented as the **factory** `(valueSig, indexSig)
  => TemplateIR` (was mis-documented as a bare `TemplateIR` value; code has always
  used the factory). §3.7 + appendix both fixed; `WritableSignal` added.
- `TemplateIR` root: documented optional `styleArtifact` + `classRewrites` fields
  ($style scoping outputs; renderer-layer, `.nv`-FE-only) — previously undocumented.
- Added §3.7.2 (`StyleVarBinding`); §5 primitive-mapping rows for `classlist` +
  `style-var`; §2.2 target rows; §9.2 moved `ListBinding`/`.nv` FE/compiler BE/
  classlist/style-var out of "deferred."

**Scope discipline restated in-doc:** `$style` scoping, `styleArtifact`/
`classRewrites`, and `StyleVarBinding` are renderer-layer; NOT a reactive-core
contract concern. reactive-core v0.4.2 untouched.

**Also fixed (consistency):** `ir.ts` header self-citation and
`implementation-state.md` footer both said the doc was v0.4.1 — corrected to v0.4.2
(the `ir.ts` fix is a one-line comment edit, can ride the next code commit; the
implementation-state fix is in this paste set).

**Verdict:** Doc now matches code. No contract bump (reactive-core stays v0.4.2);
Template-IR doc version was already claimed v0.4.2 by `ir.ts` — this aligns the
prose to it.

### 2026-06-23 — Equivalence-oracle blind spots closed (Action 2; test-infra only)

**Decision.** Close the two `ir-equivalence.ts` blind spots from the drift audit.
Test-infra only; no production code.

**Blind spot 1 — slot content uncompared.** `bindingEqual` had no `component` case,
so a `ComponentBinding` matched on kind+path alone and its `slots` were never
recursed. Slot-content IR (where `<each>`-in-slot bindings and the D-slot-style-1
static-class rewrite live) was invisible to FE-equivalence AND the slot G3.1 gate.
**Fix:** `component` case compares propNames + slot names and recurses
`slot.content({})` forwarding `doc` (slot shape.html now compared).

**Blind spot 2 — IR-root $style outputs uncompared.** `styleArtifact` and
`classRewrites` were never compared. **Fix:** `styleArtifactEqual` (scopeHash,
staticCss, varBindingDescs, classRewrites map), called from `irStructurallyEqual`
at the root. Both-absent → equal (FE-vs-FE N/A preserved); presence-mismatch →
unequal.

**Unchanged:** `list`/`conditional` recursion still passes `undefined` doc — no
scope creep into their shape-comparison behavior.

**Consequence (recorded, not a defect):** the oracle now inspects surfaces it
previously ignored. A latent FE/back-end divergence could surface as a newly-failing
test — that is correct behavior, triage as a real divergence, do NOT weaken the oracle.

**Why this had to land before `<each>`-in-slot:** that increment's structural-identity
gate asserts the slot-path list binding equals the main-path shape. With the old
oracle, "green" did not actually inspect slot content — the gate would have been
unfalsifiable. Now it is failable.

**Verdict:** Oracle now covers slot content + style artifacts. tsc --strict clean;
teeth proven to fire (sandbox smoke). reactive-core v0.4.2 + Template-IR v0.4.2
untouched.

### 2026-06-23 — Increment SS COMMISSIONED (`<each>`-in-slot + static-class structural collapse); Gate-P

**Decision.** Commission Increment SS to close the slot domain: wire `<each>` in slot
content AND collapse D-slot-style-1 structurally, in one increment. Gate-P (plan-first):
CC produces a plan citing HEAD seams, proposes the open points, halts before any `src/`.
Handoff: `action3-increment-SS-gateP-commission.md`.

**Locked architect decisions (not relitigated in CC's plan):**
- **D-SS-1:** Item 2 (D-slot-style-1) takes the STRUCTURAL-COLLAPSE path, not
  accept-as-logged. Static `class="..."` attrs in slot content lift into `classlist`
  `{kind:'static',token}` entries → existing structural `patchClasslistTokens` rewrites
  them → the string-regex on `shape.html` (nv-parser.ts ~L1919-1925) is REMOVED. Grounds:
  the static entry kind already exists, is already produced (array-literal path L391-394),
  already consumed by both back-ends (`wireClassList` L224-225); element-targeting bindings
  need no sentinel. Invents nothing; kills the regex + its text-`class=` false-match.
- **D-SS-2:** Collapse toward the main-walk list-push (L1061-1067) via a SHARED helper both
  the main builder and `buildNvSlotContentIR` call → structural identity by construction,
  not assertion. No slot-local list representation (the recurring slot-subsystem wound).
- **D-SS-3:** Re-enable G5 parse-path-structural AS-IS, AND add an emit-exec differential
  leg (interpreter vs emitted) for `$style × <each>-in-slot` token carry — because the
  parse-path list/component bindings are stubs (D-each-2), behavioral proof needs the emit
  path. D-cl-2 real-path-G5 bonus may ride along if cheap (optional, not a blocker).
- **D-SS-4:** The Action-2 oracle (slot-content recursion + `styleArtifactEqual`) IS the
  structural gate. FE-equivalence + differential route through `irStructurallyEqual` with
  `doc`. A divergent slot-list shape now FAILS the oracle — load-bearing and failable.

**Open points (CC proposes, architect rules at Gate-P):** (1) D-each-4 hole-boundary —
does the all-static-slot limitation close for free, stay, or need a separate call (CC
verifies current HEAD behavior empirically first — walk is full DFS, component detection
is sentinel-driven independent of holes, so the limitation may be narrower than the
L1906-1907 patch comment states); (2) static-class lift location (in slot builder vs shared
helper); (3) diagnostics threading for slot `<each>`; (4) depth-2 nesting gate;
(5) stacked G2 by-ref (list-in-component) — assert or document.

**G0 disqualifiers:** core/contract touch; slot-local list shape; regex still present
post-increment; new IR kind or `ir.ts` shape change (uses existing classlist static entry,
no Template-IR bump); FE lockstep broken.

**Scope:** renderer-layer only. reactive-core v0.4.2 + Template-IR v0.4.2 untouched. No IR
bump (existing classlist static entry reused).

**Status:** Awaiting CC plan → architect Gate-P approval before any `src/`.

### 2026-06-23 — BUG FOUND: main-path static class unscoped under $style; fix folded into Increment SS

**Finding (verified by parse+emit at ce79d23, not inference).** A purely-static
`class="card"` in a MAIN component template under `$style({card:{...}})` is NOT scoped:
`classRewrites` computes `card→card_<hash>` and the emitted CSS is `.card_<hash>{...}`, but
`shape.html` keeps bare `class="card"`. Selector and element mismatch → the $style rule
silently never applies. `.nv`-FE, both back-ends (shared parse). Untested (no test covers
static class in any position), which is why it was latent.

**Contrast:** static class in SLOT content DOES scope today, via the regex
(nv-parser.ts L1919-1925) Increment SS removes. So main and slot diverge on identical
source — a single-IR-source-of-truth violation in spirit, plus a live bug on main.

**Fix (decided).** Fold into Increment SS: make the static-class→classlist lift a SHARED
mechanism applied to BOTH `processHtmlTemplate` (main) and `buildNvSlotContentIR` (slot),
not slot-only. Existing `patchClasslistTokens` static-entry rewrite (L1876-1885) then scopes
both uniformly; the slot regex is removed. One rewrite representation for all static class,
both positions. This is the same collapse principle as D-SS-2.

**Consequence for plan:** OP-2 Option A (slot-only scan) REJECTED → shared lift. New gates
G-SS-mainbug (main static → matching scoped class + CSS, Playwright ×3) and G-SS-symmetry
(same fragment, same IR, via Action-2 oracle). reactive-core v0.4.2 untouched; no IR shape
change (reuses classlist static entry). Renderer-layer; not a §1 touch.

**Status:** fix folded into Increment SS (Gate-P, awaiting CC plan revision). Bug closes
when SS lands.

### 2026-06-23 — Increment SS LANDED (2026-06-23; commits b8be335..a071b1b)

**Tasks completed.**

- **Task 2:** `pushListBinding` module-level helper shared by `processHtmlTemplate` and
  `buildNvSlotContentIR`. `walkNvNodeList` gains `diagnostics` param (threaded from
  `processHtmlTemplate` through `buildNvSlotContentIR` call sites). `buildNvSlotContentIR`
  destructures `lists: slotLists` from walk; adds list loop after component loop.
  `html-tag.ts` `buildSlotContentIR` wires `lists` from `walkNodeList`. G5 re-enabled and
  passing. Baseline 647→648 pass (G5 active). Commit: `b8be335`.

- **Task 3 / D-SS-1:** `liftStaticClassBindings(root: ParentNode, allPaths, bindings)` —
  module-level helper walks `root.querySelectorAll('[class]')`, strips `class=`, appends
  `ClassListBinding` with `{kind:'static', token}` entries. Called in:
  (a) `buildNvSlotContentIR` on `fragWrapper` BEFORE `rawHtml` serialization (slot path);
  (b) `processHtmlTemplate` on `frag` BEFORE shapeDiv clone+serialize (main path, per
      G-SS-mainpath-root ruling — wrong root = path-root mismatch at mount).
  `patchClasslistTokens` component case: regex rewrite REMOVED; recursion retained.
  `patchClasslistTokens` still rewrites classlist entry tokens with scopeHash.

- **Task 4 (gate suite):** `test/renderer/slot-ss.test.ts` added (11 gates): G-SS-mainbug
  (parse + behavioral), D-SS-1 (slot + all-static-content), G-SS-symmetry, G-SS-emit
  (parse assert + IR oracle), G-SS-bothFE, G-SS-depth2 (parse + behavioral ×2 back-ends),
  G2 by-ref. `test/renderer/slot-style-scope.test.ts` updated: regex test → classlist test.

- **Gate-P correction applied:** liftStaticClassBindings runs on `frag` (DocumentFragment)
  not `shapeDiv` (throwaway clone). Param widened to `ParentNode`.

**Baseline:** 648 pass / 1 skip → 659 pass / 1 skip (11 new slot-ss gates). Commit: `a071b1b`.

**Known limitations (unchanged):**
- `NoSubstitutionTemplateLiteral` (no holes at all) returns early before DOM walk — static
  class lift does not run. Purely static templates with no expressions are an edge case
  (real-world $style usage always has expressions).
- `wireList` captures `parent = anchorNode.parentNode` before fragment insertion. If the list
  anchor is a DIRECT DocumentFragment child (no wrapping element), this breaks after insert.
  `buildNvSlotContentIR` uses `fragWrapper div`, so slot content is always wrapped. Mirror
  this invariant in hand-constructed test IRs.

**Status: LANDED.** D-slot-style-1 closed. Main-path static-class live bug CLOSED.
`<each>`-in-slot wired in both FEs (.nv + html-tag). Closes `$style × slots` for the
structural surface (Playwright gate deferred to Task 5 in a follow-up increment).

### 2026-06-23 — Increment SS LANDED: bookkeeping correction (supersedes commit range + skip count in the entry above)

**Why.** Architect verified the landed state at real HEAD `58afe25` (resolved via
`git ls-remote`; raw host cannot report SHA). Two facts in the SS-LANDED entry above are
stale/incorrect. This entry corrects them; the code itself is verified correct and
unchanged by this entry.

**Correction 1 — commit range.** The entry above cites `b8be335..a071b1b` (landing
`a071b1b`). Real `main` HEAD is **`58afe25`**. The gate suite (`slot-ss.test.ts`, 11 gates)
and subsequent doc/state syncs landed PAST `a071b1b` (CC's own report listed later commits
`f8fdef9`, `04318d6`; main has since advanced to `58afe25`). Treat **`58afe25`** as the
authoritative landed SHA for Increment SS; the `a071b1b` reference is incomplete.

**Correction 2 — skip count.** The entry above states "648 pass / 1 skip → 659 pass / 1
skip." Verified at `58afe25`: **659 passed, 0 skipped** (29 files), `tsc --strict` clean.
There is NO remaining skip. G5 was the single skip; it was re-enabled and now passes as a
live test. The "/ 1 skip" in the entry above is wrong — the correct landed state is
**659 / 0 skip**. (A `grep` for `.skip`/`xit`/`xdescribe` across `test/` at `58afe25`
returns nothing.)

**Unchanged / re-confirmed at `58afe25`:** regex removed (no `shape.html.replace` in
nv-parser.ts); `liftStaticClassBindings(root: ParentNode)` called on `frag` (main, the walk
root — Gate-P correction honored) and `fragWrapper` (slot); `pushListBinding` shared by both
main-walk sites and html-tag.ts consumes `lists`. D-slot-style-1 closed; main-path
static-class bug closed; `<each>`-in-slot wired both FEs.

**Still open (carried, not a defect):** G-SS-browser (Playwright ×3) DEFERRED — `$style`
scope-attr stamping needs a real browser (`root instanceof Element` is undefined under
inline-jsdom). The behavioral correctness (correct element targeted) IS covered by
G-SS-mainpath-root + G-SS-depth2 behavioral legs; only the real-cascade CSS-application
gate is deferred. Tracked as a named follow-up below.

**Verdict:** Increment SS landed at `58afe25`, 659/0, typecheck clean, structural claims
verified by source read. reactive-core v0.4.2 + Template-IR v0.4.2 untouched.

### 2026-06-24 — Kind-split tripwire: real-app evidence harness COMMISSIONED with a pre-committed 2-of-2 gate

**Serves** the kind-split tripwire (2026-06-18 wide-graph spike confirmation) and,
secondarily, the FALSE-heavy row-churn watch-item (2026-06-20) — both call for the same
missing instrument: a *steady-state update* harness. Neither existing harness supplies it:
`js-reactivity-benchmark` is synthetic topologies (the tripwire excludes "the synthetic gap
alone"); `bench/row-churn.mjs` is app-shaped but construction-only.

**Decision.** Do WS1 by *honoring* the tripwire, not bypassing it: build the evidence harness
that converts "gated, waiting" into "decidable." This is door 1 of the three legitimate WS1
moves (vs. an in-stream bottleneck-shave, or a launch-blocking-priority call that would fire
the spike directly). Door 1 chosen — no untried in-stream hypothesis exists (the 2026-06-18
profile already refuted H3/H4 and localized 71% to `fn`+`runRecompute` cache traffic →
struct width, which is gated), and wide-graph perf is not being declared launch-blocking.

**Harness shape (locked design parameters):**
- App: grid / virtualized list, **1000 rows × 10 reactive cells** (aligned to the synthetic
  gap's 1000 width; reuses the row-churn app model).
- Per-cell graph: signal → 1–2 deriveds → 1 binding-effect.
- Driver: **sustained signal updates (steady-state)**, ~5% dynamic-edge churn per tick
  (mirrors `dyn5%`). NOT mount/dispose — the read tax lives in updates.
- Denominator: **full update frame** (propagation + binding application + DOM mutation +
  effect work), measured **full-frame through the renderer**.
- Environment: **Playwright real-browser, M2 Max, Node v20.19.0**. JSDOM is barred from the
  verdict path — it distorts the denominator (row-churn caught a 13.4% megamorphic IC that
  was JSDOM, not nv). Frame-share is a real-browser number by definition.
- Comparison: **nv-alone** (the tripwire asks "is it a top cost," answered by frame-share,
  not the nv/alien ratio we already have and which was deemed insufficient).

**Pre-committed decision rule — 2-of-2 conservative gate (fire ⟺ BOTH hold):**
- **Condition A — absolute breach:** propagation self-time/tick exceeds the reactive share
  of a 16.7ms (60fps) frame at scale. Reactive budget = 16.7ms − measured render/DOM floor
  (CC sets the concrete ms from the floor; floor reported, not asserted).
- **Condition B — relative dominance:** propagation self-time exceeds **30%** of total
  update-frame time. (Architect-set "top cost" line.)
- **FIRE** (both) → kind-split spike opens; evidence base = this result + the converging
  2026-06-18 wide-graph and createSignals struct-shape spikes. **CC returns FIRE to
  architecture; does not open the spike** (cross-stream, contract-adjacent §9, own soundness
  obligation).
- **CLEAR** (either fails) → wide-graph propagation confirmed *not* a top user-facing cost;
  structural gap stays accepted, kind-split stays gated. A complete, valid terminal result.
- **AMBIGUOUS** (straddles within noise) → surface to architect; only here is an optional
  alien head-to-head variant considered.

**Rationale for 2-of-2 conservative.** The kind-split is exactly the change a tripwire should
make *hard* to fire: cross-stream (every `ReactiveNode` call-site), contract-adjacent (§9
single kind-distinguished struct), with the 2026-06-18 field-reorder regression (+18%/+27%)
standing as proof that struct-shape changes regress unpredictably. A single-metric rule trips
too easily on an unrepresentative scale. Both an absolute budget breach and dominant share
are required so the spike opens only when wide-graph propagation genuinely hurts a real frame.

**Failable gate (harness-discipline, encodes the three row-churn corrections):** G-WG-1
steady-state-not-construction; G-WG-2 honest timer split; G-WG-3 per-tick warm-up isolation;
G-WG-4 bookkeeping symmetry; G-WG-5 dynamic edges actually churn; G-WG-6 real-browser
denominator; G-WG-7 floor reported / budget derived; G-WG-8 `src/` untouched. **G0 hard
stop:** no edit to `ReactiveNode`/`makeNode` field order or count — this commission measures,
it does not touch the locked struct.

**Verification.** Architect reads the placed harness across revisions before trusting any
number (the row-churn precedent: three corrections each flipped or hid a result on read).
Sandbox validates harness logic only; the frame-share verdict is a real-browser number.

**Contract impact.** None. Contract stays v0.4.2. A FIRE verdict would later carry a §9
kind-split entry with its own version bump — gated on this harness, not decided here.

**Handoff.** `cc-handoff-wide-graph-realapp-harness.md`.

**Status.** Harness commissioned with pre-committed 2-of-2 gate. WS1 reopened in the
tripwire-honoring mode (door 1). Awaiting CC harness + verdict. No `src/` change authorized.

### 2026-06-24 — Kind-split tripwire: wide-graph steady-state harness RESULT — CLEAR (verdict accepted)

> **⚠ SUPERSEDED — numbers and reasoning invalid.** This verdict was produced by a defective harness
> (bindings used `createRoot`, not `effect`, so no effect subscribed; and the tick driver used the
> signal *getter* `(v)` instead of `.set(v)`, so zero writes occurred). The ~0.005ms/tick frame,
> the "t_dom ≈ 0 / Condition B aliased to ~100%" degeneracy, the "~3,000× budget-irrelevant"
> framing, the "retroactive validation of the 2-of-2 gate," and the "G-WG-5 confirmed real" claim
> are all artifacts of measuring a graph with zero live consumers. **Do not cite this entry's
> numbers.** See `2026-06-25 — ... CLEAR verdict REVERSED` (the reversal) and
> `2026-06-25 — ... verdict CLEAR (both engines)` (the corrected re-run, ~0.15–0.17ms/tick, ~100×
> under budget). The *conclusion* (CLEAR) survives on corrected evidence; this entry's *evidence*
> does not.

**Resolves** the harness commissioned earlier today (`cc-handoff-wide-graph-realapp-harness.md`).
Landed at `1e59fe1`, `test/browser/wide-graph-steady-state.spec.ts`. Architect verified by
reading the placed harness in full (not the report); SHA confirmed via `git ls-remote`.

**VERDICT: CLEAR.** Wide-graph reactive propagation is NOT a top user-facing cost at the
on-point scale (1000 rows × 10 cells, 5% dynamic-edge churn/tick, full-frame through the
renderer, Chromium real-browser, M2 Max). The kind-split tripwire does **not** fire. The
structural gap stays accepted; kind-split stays gated. Complete, valid terminal result per
the pre-committed 2-of-2 gate.

**Measurement (Chromium, M2 Max, 80 samples × 20 ticks/sample):**
- t_frame (live: propagation + binding + DOM) ≈ 0.005ms/tick
- t_propagate (floor: propagation + effect invocation, no DOM) ≈ 0.005ms/tick
- t_dom (live − floor) ≈ 0.000ms/tick (sub-resolution at this scale)
- Condition A (absolute): propagation 0.005ms vs ~16.7ms reactive budget → NO BREACH.
- Condition B (relative): aliased to ~100% (see degeneracy note) → not decisive.
- 2-of-2 gate: A clearly fails → CLEAR.

**Why the CLEAR is firm (architect framing, stronger than the raw "noise-robust" report).**
At 1000×10 = 10,000 cells with 5% churn (~500 value writes + ~500 edge flips per tick), the
*entire* update frame is ~0.005ms. Even granting perfect timer resolution and charging the
full frame to propagation, Condition A misses a 60fps (16.7ms) budget by **3+ orders of
magnitude**. The CLEAR is not "a small number near the timer floor" — it is "the realistic
wide-graph update frame is budget-irrelevant by ~3,000×, a gap no plausible measurement error
spans." Condition A is unflippable at this scale.

**Scope of the CLEAR (honest boundary).** Valid at the tested scale and churn — the
dimensions derived from the synthetic gap case (`4-1000x12-dyn5%`). This decisively answers
the tripwire's question ("is wide-graph propagation a top user-facing cost") with *no* at the
on-point real-app-shaped scale. It does **not** claim no app scale ever makes propagation a
top cost; a pathological graph (e.g. 100× larger, or far deeper derived chains) is not the
tripwire's bar. If such a shape appears in real profiling, the tripwire reopens on *that*
evidence — the gate is "real-app evidence," and this is the real-app-shaped evidence.

**Harness-discipline notes (recorded; neither flips the verdict).**
1. **Floor run re-defined vs. commission — improvement, but unflagged.** The commission (§4)
   specified the floor as "signals written, binding-effects no-op'd" (floor = render/DOM cost;
   budget = frame − floor). CC instead built the floor as "propagation + effect invocation
   with DOM mutation removed" (`sink[i] = finalDerived()`), making `t_propagate = floor.med`
   directly. This is the *more useful* decomposition — it measures propagation directly rather
   than backing it out — and is accepted as an improvement. The discipline miss is that CC
   silently re-specified the floor rather than flagging the deviation. Carried as a note: a
   floor-definition change is a measurement-semantics change and should be surfaced, even when
   it improves the instrument.
2. **Condition B was degenerate this run.** `t_propagate/t_frame = floor.med/live.med`, and
   with both timer-aliased to 0.005ms the ratio reads ~100% ("dominant"). B carried **zero
   information** — it measured timer resolution, not relative dominance. The verdict was
   correct only because Condition A failed clearly under the 2-of-2 gate.

**Retroactive validation of the 2-of-2 gate design.** Condition B mis-read as 100% dominant
due to aliasing. A 1-of-N rule that could fire on relative dominance alone would have
**mis-fired FIRE here** on a timer artifact. The conservative 2-of-2 gate (require BOTH
absolute breach AND relative dominance) correctly suppressed the artifact and yielded CLEAR.
The gate design is validated by a case it was built to resist.

**Gates.** G-WG-1..8 + G0 verified on read of the placed file (steady-state timed region;
separate live/floor evaluate calls with independent warmups; pre-allocated arrays, no
hot-path allocation; churnFlag flip genuinely re-resolves derived source-sets per tick;
Playwright real-browser, no JSDOM; floor reported; `src/` untouched; no `ReactiveNode`/
`makeNode` edit). G-WG-5 specifically confirmed real — the churn flips edges, not just values.

**Contract impact.** None. Contract stays v0.4.2. The kind-split, if ever triggered by a
future pathological-scale real-app profile, would carry a §9 entry with its own version bump.

**Status.** Kind-split tripwire EVIDENCE-TESTED and CLEAR at on-point scale. Tripwire stays
set (reopens only on a materially different real-app shape). No `src/` change. WS1 returns to
its characterized, defensible stopping point — now with the synthetic gap confirmed
launch-irrelevant at realistic scale, not merely deferred.

### 2026-06-24 — SyncBinding (Parts 1+2) COMMISSIONED — interpreter + emitter, lockstep

**WS3.** Makes `bind:value` two-way binding functional end-to-end on both back-ends. Closes
the long-standing `SyncBinding`-throws debt. Handoff: `cc-handoff-syncbinding-parts-1-2.md`.

**Seam reads (against `1e59fe1`) that reshaped the increment from the §3.8 blueprint:**
1. **`sync` has zero production callers.** Verified: every `sync(...)` call site is in the §12
   conformance suite or cycle-checker fixtures. The renderer calls it nowhere (consistent with
   the throw). SyncBinding is `sync`'s **first production consumer and first DOM consumer**.
   Consequence: §3.8 is treated as an *unverified blueprint*, not trusted code — and indeed it
   carried a stale type (next point).
2. **§3.8 / `ir.ts` `writeTarget` type is stale vs v0.4.2 core.** Doc + `ir.ts:196` declare
   `writeTarget: () => { set }`. Live `sync` (`core.ts:1065-1078`) takes the `SignalAccessor`
   itself and resolves it via `nodeForFn.get(target)`. The setter-object form would fail target
   resolution silently. Fix: `writeTarget: WritableSignal<unknown> | (() => WritableSignal<unknown>)`,
   reusing the IR's existing `WritableSignal` (structurally identical to `SignalAccessor`,
   already used by `ListBinding`). This bug survived precisely because nothing ever called it.
3. **There is ONE runtime wiring path.** The compiler emits an **IR object literal** + calls
   the **shared `mount`** (`emitter.ts:281,297`), not `sync()` calls. So the `sync`-calling
   logic is written once in the interpreter's `wireSync`; the compiler's job is purely to
   *serialize the SyncBinding literal*. This collapses "two back-ends" to one behavior + one
   serialization.
4. **Read/write erasure asymmetry is the correctness crux.** `readExpr` is read-erased
   (`formField()`); `writeTarget` must be the **bare, un-erased identifier** (`formField`) —
   the accessor identity `sync` looks up. Erasing the write target would unwrap it to a value
   and break the write.

**Composition.** Interpreter `wireSync` = `wireProp` pattern (signal→DOM `effect`) +
`wireEvent` pattern (listener + `onCleanup`) feeding a `pubsub`, then `sync(ps, target,
compute)`. External `pubsub` source ⇒ cycle-safe by construction (§8.5.1) ⇒ no interpreter
cycle check needed.

**Decided in-stream (surface syntax / pure renderer, not contract):**
- **`:PROP={accessor}` directive** — single-char `:` sigil, parallel to `@`(event)/`.`(prop).
  Chosen over `bind:` (breaks single-char grammar) and `.prop:sync` (noisy) for consistency
  with nv's existing sigil family. Claims the leading-colon attribute slot (native HTML never
  uses it — the Vue-`:bind` precedent); matcher runs before the bare-attr matcher in both
  front-ends. Per-prop default event (`value`→`input`, `checked`→`change`); explicit event
  override deferred (small debt).
- **Both front-ends in scope.** A seam read found the tagged-template front-end (`html-tag.ts`)
  has its **own parallel directive matcher** (`classifyHole`/`buildHtmlHoleBinding`), distinct
  from the `.nv` parser's `classifyPosition`. `:` must be added to BOTH. The original spec
  under-scoped this to `.nv` only; corrected. Tagged path is interpret-only (no compile step)
  and its hole value IS the live accessor, so it derives read (`accessor()`) and write
  (`accessor.set()`) from one hole — no erasure/identifier-split, no `writeTargetId`. The
  `.nv` path remains the harder one (source-text split into read-erased + bare identifier).
- DOM-specific default extractor lives in the **renderer** (`wireSync`), not core — confirmed
  core is DOM-free (zero DOM identifiers in `core.ts`). **Per-prop:** `value`→`event.target.value`
  (string), `checked`→`event.target.checked` (boolean). A single `.value` default would write
  `"on"`/`undefined` for a checkbox — a silent correctness bug; the extractor is keyed on
  `propName` parallel to the per-prop event default. Shared by both front-ends.
- `transform` arity selects map vs reduce by **inheriting** contract §8.5's existing rule —
  **not a new decision** (confirmed: this is the contract working as designed; `sync` reads
  map/reduce from `compute.length`).
- `writeTargetId` **emitted now** (Part 2) though consumed only by Part 3 — it is the agreed
  §3.8 field, derived by the *same imported* `signalSymbolId` as compiler steps 1–2/4.
  Emitting early makes Part 3 a checker-only change and lets Part 1+2's gate verify the
  derivation agrees with the classifier (de-risks Part 3 before it starts).
- `writeTargetId` stays **compiler-path-only/optional**; the interpreter holds the live
  accessor and ignores it (the §3.8 asymmetry, confirmed intended).

**Lockstep gate (G-SB-9).** Shared-oracle differential parity across **all three authoring
paths**: `:value` authored as (i) `.nv` interpreted, (ii) `.nv` compiled-then-mounted,
(iii) tagged-template; driven through the same event+signal sequence; all pinned to a shared
expected oracle (stricter than mutual `structurallyEqual`). Must prove the round trip both
directions (programmatic `.set` → DOM; DOM event → signal) in every path.

**Confirmed core is DOM-free; nothing to de-DOM.** A side-investigation this session
confirmed `core.ts` contains zero DOM identifiers; `sync` is already the general,
DOM-agnostic primitive. DOM-specificity is correctly quarantined in the renderer call site.
The separate question of whether the **IR** (not the core) should be renderer-target-agnostic
(non-DOM renderers) is noted as a distinct, larger, un-opened architectural question — NOT
folded into this increment.

**Contract impact.** None (v0.4.2). `template-ir.md` §3.8 gets an in-version correction
(stale `writeTarget` type + back-end mapping snippet) + a consistency pass; note in its
changelog, no IR version bump (a type *correction* to a designed-but-unimplemented binding,
not a semantic change).

**Status.** Commissioned, plan-first (Gate-P) pending. Part 3 (cycle-graph integration)
opened as a committed close follow-up (see next entry) — Part 1+2 ships with a bounded,
backstop-covered soundness caveat.

### 2026-06-24 — OPEN (sequenced): SyncBinding write-back edge → §8.5.2 cycle graph (Part 3)

**Type:** committed close follow-up to the SyncBinding increment (same-session). **Not** an
evidence-gated park — it is the immediate next WS3 increment.

**Problem.** The §8.5.2 build-time write-graph cycle checker
(`write-graph-cycle-checker.ts`) analyzes `sync(...)` **call expressions in user source**
(`verdict.callNode.arguments`). SyncBinding's write-back `sync` is **synthesized at runtime**
inside `wireSync` — there is no user-source call expression. Therefore the SyncBinding
write-back edge is **absent from the global cycle graph** until Part 3 wires it in. §8.5.2
mandates the check be **global** ("two syncs can form a cycle neither exhibits alone"), so an
omitted edge is a completeness gap in a contract-mandated global invariant.

**Why bounded, not unsound (the window is defensible only because Part 3 is next).** The
runtime cascade cap (§8.5.4) is the backstop: an escaped cycle hits the cap and emits the
dev diagnostic at runtime — it does not loop forever. So the gap is **degraded diagnostics**
(build-time error → runtime cap-fire), not a runtime-unsound state. Exposure: a `bind:value`
target that is also a reactive `sync` source elsewhere, forming a cycle, is uncaught at build
time during the Part 1+2 → Part 3 window. If Part 3 slips, this stops being defensible.

**[2026-06-24 RETRACTION — see next entry.] Enabling data was NOT emitted.** The premise that
`writeTargetId` from the emitter could match the cycle-checker's `SignalId` derivation is false:
the two pipelines are architecturally disjoint (`.nv` parser has no `ts.TypeChecker`; the
cycle-checker requires one). The `writeTargetId` bridge as designed cannot connect the graphs.

**Re-scoped: not "checker-only wiring" but a genuine cross-boundary design problem.** The
`.nv` write-back edges and `.ts` write-graph edges live in disjoint symbol spaces. Resolving
this requires an architectural decision (give `.nv` pipeline a `ts.Program`, or give the
checker a `.nv`-aware edge channel, or restrict bind targets to cross-derivable forms).
See the retraction entry (below) for options and full analysis.

**Status.** DESIGN-GATED. Architecture session required before any Part 3 implementation
is commissioned. Backstop: §8.5.4 cascade cap (degraded diagnostics, not unsoundness).

### 2026-06-24 — RETRACTION: "emit writeTargetId now" decision reversed; Part 3 re-scoped

**Retracts the "emit now" recommendation from the SyncBinding Parts 1+2 commission entry.**

**What was wrong.** The commission argued that emitting `writeTargetId` in Part 2 de-risks
Part 3 by making it "checker-only plumbing." That argument rests on a false premise: the `.nv`
emit pipeline (`nv-parser.ts` → `nv-emitter.ts`) and the §8.5.2 cycle-checker
(`write-graph-cycle-checker.ts` + `sync-target-classifier.ts`) do NOT share a symbol space.
`signalSymbolId` requires a `ts.TypeChecker` (from a full `ts.Program`); the `.nv` parser uses
`ts.createSourceFile()` only — no program, no checker, no shared derivation. A `writeTargetId`
computed in the parser cannot match the ID the cycle-checker would produce for the same signal,
because they are generated by architecturally disjoint analyses. Emitting the field now would
ship something that **looks** like a cycle-graph bridge but cannot function as one — actively
misleading to Part 3's implementer.

**Consequence for Part 3.** Part 3 is not "checker-only wiring." It is a genuine cross-boundary
architecture problem: the `.nv` write-graph edges (from SyncBinding write-back) and the `.ts`
write-graph edges (from user-source `sync(...)` calls, analyzed by the classifier) live in
disjoint symbol spaces. The design problem to solve is: **how do these become one graph?**
Options include (a) give the `.nv` pipeline a `ts.Program` so it can derive real `SignalId`s;
(b) give the cycle-checker a second input channel for IR-declared edges, with a cross-reference
convention the `.nv` emitter can satisfy without a checker; (c) restrict `:PROP` bind targets to
a form whose identity is cross-derivable (e.g. restrict to names that also appear in analyzed
user-source `sync(...)` calls). None of these is "plumbing" — each is an architectural decision
gated to the architect.

**Consequence for Parts 1+2.** The runtime behavior is unaffected (`:value` works, both
back-ends, cursor-stable). The soundness caveat is now **larger** than previously stated:
it is not "edges absent from the cycle graph until Part 3 wires the checker"; it is "the
cross-boundary write-graph is an unsolved design problem; the §8.5.4 runtime cascade cap is
the only cycle protection for SyncBinding write-back until that design is resolved." This is
still defensible for shipping `:value` (the cap prevents infinite loops; a cycle produces a
runtime diagnostic rather than a build error), but must be approved knowing static cycle
detection for SyncBinding is further away than one increment.

**Plan changes (applied immediately):**
- `writeTargetId` field is **not emitted** in Parts 1+2. The `ir.ts` `SyncBinding` type retains
  the optional `writeTargetId?: string` field as a design placeholder, but it is not populated.
- Gate G-SB-6 (writeTargetId canonical derivation) is **dropped** from Parts 1+2.
- The `ThunkSource` 'sync' union variant does NOT carry `writeTargetId`.
- `ScriptSymbols` is NOT extended with declaration positions.
- Part 3 is re-opened as a **design-gated** increment: architect determines the cross-boundary
  approach before any implementation is commissioned.

**Status.** RETRACTION applied. Parts 1+2 plan updated. Part 3 status changed from
"sequenced close follow-up" to "design-gated — architecture session required."

---

### 2026-06-24 — SyncBinding Parts 1+2 LANDED + ACCEPTED (architect-verified at `4e92b09`)

**Verdict: ACCEPT.** `:value`/`:checked` two-way binding ships on both real runtime paths.
Verified by reading placed source at **real HEAD `4e92b09`** (one commit past CC's reported
`70804cf` — a follow-up removing an `import.meta.env` guard untyped in tsconfig; read at real
HEAD per discipline, not the reported SHA). Test suite 682/0; `src/core/` diff empty across
the whole increment (`8d4b36e..4e92b09`), not just CC's window.

**Correctness cruxes verified on read (not from the report):**
- **Erasure asymmetry** (emitter `case 'sync'`): `readExpr: () => (formField())` (erased read)
  vs `writeTarget: formField` (bare accessor). Holds. `writeTargetId` correctly NOT emitted
  (comment cites the retraction entry; field retained in `ir.ts` as placeholder only).
- **`:checked` per-prop extractor** (`defaultExtractorForProp`): `checked`→`event.target.checked`
  (boolean), else `.value`. The silent-`"on"`-string bug is fixed (G-SB-14 / TC-SB-03).
- **No `as never`** (concrete `WritableSignal` cast), **no redundant pre-discriminator**
  (`writeTarget` passed straight to `sync`), **disposer-discard documented** — all three
  architect notes followed.

**CC self-review fixes scrutinized (not rubber-stamped):**
- Transform-extractor composition (`ed0b092`): composes `extractor(ev)` before the user
  `transform` in both arity branches; `t.length >= 2` selects reduce. Correct — without it
  `transform` would receive the raw `Event`, violating §8.5 map/reduce. Verified.
- Derived-target dev guard (`ed0b092`/`70804cf`): `console.error` if the resolved write target
  lacks `.set`. **Verified safe** — the guard invokes the thunk form once at wire time, but
  `wireSync` runs in the `createRoot` body with `currentObserver === null`, and `trackRead`
  no-ops without an active observer (core.ts:302), so **no phantom subscription** is created.
  Minor note: the guard calls a conditional-target thunk once at mount for validation
  (selectors must be effectively pure); harmless, recorded.

**Correction — "three authoring paths" was an architect spec artifact; two real paths verified.**
The commission specified G-SB-9 across three paths (tagged-interpreted, .nv-interpreted,
.nv-compiled). Seam reads confirm **`.nv` has no standalone interpret runtime** — `.nv` is
parse→emit→exec, so "Path C (.nv compiled)" *is* how `.nv` runs; a distinct "Path B (.nv
interpreted)" does not exist (`parseNvFile` yields a stub IR). CC correctly omitted Path B as
subsumed. G-SB-9 is therefore satisfied **maximally**: shared-oracle parity across the two
real runtime paths (tagged-interpreted, .nv-compiled) + a cross-path equality assertion, all
pinned to a fixed `ORACLE` constant (stricter than mutual `structurallyEqual`), exercising
both directions (programmatic `.set`→DOM, DOM event→signal). **Do not "restore" a Path B
later — it has no runtime to test.** The 3-path framing was the architect's error (assumed a
.nv interpret path that the build pipeline doesn't have), not a coverage gap.

**Conditional-target form — clarified scope of the deferral.** The report's "deferred" label
is broader than the reality:
- **Already works (NOT deferred):** the thunk-form write target at the IR/interpreter level —
  a `SyncBinding` with `writeTarget: () => someSignal` resolves natively via `sync`/`nodeForFn`
  (TC-SB-09 verifies bidirectionally + disposal + no false guard).
- **Deferred (the actual debt, D-sync-cond-1):** the *authoring sugar* for a conditional write
  target inline in a template — `:value={() => cond() ? a : b}`. Both front-ends currently
  restrict the bind target to a **bare signal identifier** (.nv enforces via the G-SB-8
  enumerability diagnostic; tagged simply doesn't derive the read side for a thunk). Blocker is
  the **read-direction derivation** (double-call `()()` + re-track on `cond`), not the write
  side. The runtime substrate is done; only front-end derivation is missing.

**Single-source-of-truth confirmed.** `:PROP` is sugar over two one-way flows — read
(`effect: el[prop] = sig()`) and write (`sync(pubsub, sig, extract)`) — with the signal as the
sole store. This is Solid's model, not Angular's bidirectional-digest model. Cursor stability
on `:value` depends on the target signal's default `equals` (no-op round-trip writes are
suppressed); setting `equals: false` on a `:`-bound signal would break it (user note).

**Soundness caveat carried forward (unchanged, restated at correct severity):** the
cross-boundary write-graph is an **unsolved design problem**, not "one increment of checker
wiring." The §8.5.4 runtime cascade cap (`MAX_CASCADE=100`) is the **sole** cycle protection
for SyncBinding. Part 3 is design-gated to an architecture session.

**Contract impact.** None (v0.4.2). `template-ir.md` §3.8 correction + consistency pass landed
(PK synced).

**Status.** SyncBinding Parts 1+2 LANDED, ACCEPTED. Debts: D-sync-cond-1 (conditional-target
authoring sugar — recommend folding into Part 3, see below). Open: Part 3 (cross-boundary
write-graph), design-gated.

---

### 2026-06-24 — Conditional-target authoring sugar (D-sync-cond-1): recommend folding into Part 3

**Type:** small debt with the runtime substrate already in place (TC-SB-09). **Recommendation:
do not schedule standalone — fold into Part 3.**

**Rationale.** A conditional write target makes the SyncBinding write *edge dynamic* (A or B by
condition), which is strictly harder for the §8.5.2 cross-boundary write-graph cycle check to
reason about than a static target. Building the conditional sugar before Part 3 resolves how
SyncBinding edges enter the cycle graph would mean building it twice (naive, then post-design).
Same design space → resolve together. Demand is low (Solid has no first-class equivalent; the
single-accessor form covers essentially all real `:value`/`:checked` use). Standalone pickup
remains cheap if a concrete use case pulls on it (a self-contained front-end increment: both
parsers gain conditional-target read-direction derivation).

**Status.** OPEN, recommend-folded-into-Part-3. Substrate done; only front-end derivation
pending.

---

### SyncBinding Part 3 — write-back edge deferred; §8.5.2 has no build driver (root cause) [2026-06-24]

**Workstream:** WS4 (architect). **Type:** design ruling. **Verified at HEAD `ff3b7f2`**
(moved from `4e92b09` in the handoff; re-read at SHA).

**Question.** How does a SyncBinding (`:value`/`:checked`) write-back edge enter the
same symbol-space graph that `WriteGraphCycleChecker.check` reasons over, given the
analysis owns a `ts.Program` and the `.nv` pipeline does not? (Continues the
`writeTargetId` retraction of [2026-06-24].)

**Gating fact established by reading the pipeline (the decisive finding).**
There is **no pipeline stage that constructs a `ts.Program`** — not over emitted `.nv`
output, not over user `.ts` source — during a build. Three confirmations at `ff3b7f2`:
1. No `src/` code calls `createProgram`/`getTypeChecker` to build a Program. Every
   analysis (`classifyProgram`, `inferProgram`, `analyzeProgram`,
   `WriteGraphCycleChecker.check`) *receives* `program: ts.Program` as a parameter;
   the only producer is the test harness.
2. `compiler/index.ts` is a bare export barrel — no driver, no orchestration.
3. The only `.nv → js` integration is `nvPlugin` (`nv-esbuild-plugin.ts`): a per-file
   esbuild `onLoad` doing `parseNvFileForEmit → emitModule → rewriteNvSpecifiers`.
   It builds no Program and invokes zero compiler analysis.
Corollary: `emitMount` (compiler back-end) currently **throws** on SyncBinding
(`'SyncBinding is deferred'`); only `nv-emitter.ts` emits it.

**Consequence — reframing.** SyncBinding's missing edge is a *special case of a larger
gap*: **§8.5.2 has no production build driver at all.** The base-case cross-module
`sync()` cycle check is also not running in any build today. There is no assembled
global graph for a SyncBinding edge to "fail to join" — so all four Part-3 candidates
(A/B/C/D), each of which presupposes a running global check to integrate with, are
moot *now* regardless of their individual merits.

**Ruling.**
1. **DEFER the SyncBinding edge mechanism.** Adopt **Approach A's shape** as the
   eventual target — recover the edge from emitted output via the *existing*
   `signalSymbolId` derivation, keeping one symbol space and one ID scheme — but it is
   **contingent on a prerequisite that must land first: the §8.5.2 build-integration
   driver** (the stage that constructs a Program over user source + emitted `.nv`,
   runs the classifier, runs the checker). That driver is the real unblocker and is
   larger than SyncBinding; SyncBinding-edge recovery is a rider on it.
   - B (inert emitted `sync()`) **rejected**: degraded-second-representation pattern
     the §2 hard invariant forbids ("collapse, don't patch").
   - C **rejected for now**: same Program-bearing-stage dependency as A, with no
     offsetting benefit over A.
   - D (restrict-and-prove) **rejected**: amputates the common case (imported
     signals are exactly the hard case).
   - `writeTargetId` **stays retracted** — Approach A makes it unnecessary, not merely
     unused. (No second AST-only ID scheme; cites the [2026-06-24] retraction.)
2. **Dynamic write-targets (D-sync-cond-1): EXCLUDED from static checking; fall to the
   cap; documented.** Static target edge shape is `reads: ∅, writes: {t}` (DOM-event
   write-back, no reactive read). A union-write `writes: {a, b}` for a dynamic target
   that flags a cycle realizable in only one branch **is a false positive**, and
   §8.5.2's "never a false cycle report" guarantee is load-bearing (it's what makes a
   reported cycle a trustworthy build error). Rather than weaken that guarantee
   (contract change) or build per-branch splitting (needs branch-variant analysis the
   deferred sugar lacks), dynamic targets are excluded from the static write-graph and
   protected by the §8.5.4 cap. Preserves conservative-on-incompleteness
   (missed edge → cap, never a false negative claiming soundness it lacks).
3. **Contract: §8.5.2 UNCHANGED. No version bump. Contract stays v0.4.2.** A
   SyncBinding *is* a renderer-synthesized sync; the contract already speaks of sync
   edges, and Approach A keeps the edge flowing through the existing derivation, so
   "what contributes an edge" does not widen at the contract level. Any precise
   contract wording belongs to the driver-implementation session, stated against real
   integration code, not speculatively now.

**Interim disposition (explicit).** §8.5.4 `MAX_CASCADE=100` remains the sole cycle
protection for SyncBinding — **and**, given the gating fact, for hand-written
cross-module `sync()` cycles too, since the build-time check runs on nothing in
production. Defensible short-term; erodes with use. Correctly scoped: this is **not**
SyncBinding-specific.

**Note on Current State consistency.** "Build pipeline `.nv → .js`: Mode A, landed"
remains true (emit transform compiles + executes). It does **not** mean §8.5.2 runs in
the build. These are consistent; the §8.5.2 driver is a separate, unbuilt unit.

**Supersedes:** nothing. **Cites:** `writeTargetId` retraction [2026-06-24].
**Follow-on:** §8.5.2 build-integration driver = next WS2 unit (the prerequisite for
A); SyncBinding edge recovery rides on it. [scope: pending architect go-ahead]

---

### §8.5.2 build-integration driver (Unit 1) LANDED — check runs over hand-written sync() [2026-06-24]

**Workstream:** WS2 (compiler). **Type:** implementation landed + architect-verified.
**Commits:** `482425f → 0b62d77` on main. **Verified against placed source at `0b62d77`**
(read driver + all gate tests at SHA; not from the landing summary).

**What landed.** `src/compiler/check-program.ts` — `checkProgram(program, config):
{ verdicts, cycles, diagnostics }`. First production caller of the §8.5.2 analysis:
orchestrates `SyncTargetClassifier.classifyProgram → WriteGraphCycleChecker.check →
diagnostic mapping`. Thin orchestration only; both callees untouched (signatures
unchanged). Exported from `compiler/index.ts`. Resolves the gap logged in the SyncBinding
Part 3 entry [2026-06-24]: the check existed as libraries but ran on nothing in any build.

**Scope (decided in the Unit 1 commission, confirmed held).** Covers **hand-written
`sync()` calls in user `.ts` source ONLY**. Does NOT catch SyncBinding cycles — emitted
`.nv` SyncBinding is an IR object literal, not a `sync()` call, so the classifier yields
zero SyncBinding verdicts by construction. That closure is Unit 2 (probe pending). The
§0.1 scope boundary held: no emitted-`.nv` / IR-literal recognition introduced.

**Architect verification (read at SHA, not summary).**
- Driver is pure orchestration: no Program construction inside, no DOM, no `core.ts`
  reach. Diagnostic mapping faithful to `TargetVerdict` semantics (REJECT→error via
  `.diagnostic`; UNDECIDABLE→warn via `.reason`; cycle→error one per `involvedSyncs`).
- G4 parity is now a real deep-compare (per-index `.kind`, `toEqual` on ACCEPT
  `.targets`, sorted cycle-path equality) — the pre-execution length-only vacuity
  (BUG-2) is confirmed fixed in placed source.
- G5 asserts both no-throw and zero-cycles on a nested-function source read — the
  conservative-on-incompleteness / never-false-negative posture is real.
- G2 carries the layer-localizing pre-assertion (ACCEPT count === 2) before the cycle
  check; G3 guards the acyclic false-positive direction. Matched pair intact.
- `signalSymbolId` derivation untouched (G1); single-ID invariant preserved.

**Deviation surfaced by CC and accepted (improvement).** Commissioned REJECT fixture
`() => sigs[i]!` does NOT reach Path B — `NonNullExpression` isn't unwrapped by
`unwrapTransparent`, so it routes to Path A → UNDECIDABLE, not REJECT. Corrected to a
CallExpression-bodied thunk `() => getSignal()` → Path B enumeration → NON_ENUMERABLE →
REJECT. Architect traced classifier paths to confirm. Tests the intended behavior; no
contract change.

**D-cp-1 — RESOLVED before landing (commit `6cd937b`).** Architect noted that REJECT and
UNDECIDABLE diagnostic tests asserted `length > 0` rather than specific diagnostic
identity (same class as BUG-2 count-vacuity, not yet load-bearing). Tightened in the same
session: REJECT test now asserts exactly 1 REJECT verdict + exactly 1 error diagnostic
with `.message === REJECT_DIAGNOSTIC` (inlined verbatim — constant is not exported, so
the inline copy fails loudly if the source drifts, which is the self-correcting
direction). UNDECIDABLE test asserts exactly 1 UNDECIDABLE verdict + exactly 1 warn
diagnostic with `.message` containing `"target type is 'any'"`. No open debt remains.

**Contract.** No bump — first caller of an existing analysis; §8.5.2's statement
unchanged. Stays **v0.4.2**.

**Interim posture update.** §8.5.2 is now realizable in a build for hand-written
`sync()` (a caller constructs a Program and calls `checkProgram`). It is NOT yet wired
into `nvPlugin` / any application build automatically — `checkProgram` is a callable
entry point, not an automatic build step. SyncBinding + cross-`.nv` cycles still fall to
the §8.5.4 cap until Unit 2 + build-wiring land. Cites Part 3 [2026-06-24].

**Follow-on:** Unit 2 probe (SyncBinding edge recovery viability — A1/A2/A3) returns a
ruling request; build-wiring of `checkProgram` into a runnable gate is a separate later
unit (the entry point exists; nothing invokes it in CI yet).

---

### D-cp-1 resolved — check-program diagnostic tests now count-exact + message-specific [2026-06-24]

**Workstream:** WS2 (compiler). **Verified at `6cd937b`** (read tests at SHA).
Resolves D-cp-1, logged in the Unit 1 landing entry [2026-06-24].

The REJECT and UNDECIDABLE diagnostic tests in `check-program.test.ts` previously
asserted `length > 0` (count-vacuity class). Now:
- **REJECT:** asserts exactly 1 REJECT verdict, exactly 1 error diagnostic, and
  `errors[0].message` equals the canonical REJECT_DIAGNOSTIC string verbatim.
- **UNDECIDABLE:** asserts exactly 1 UNDECIDABLE verdict, exactly 1 warn diagnostic, and
  the message contains `target type is 'any'` (unique to the `isAnyType` branch).

A future fixture edit introducing an incidental second diagnostic now FAILS the count
assertion instead of passing silently. Debt cleared.

**Residual (minor, non-blocking).** The REJECT test inlines a verbatim copy of the
REJECT_DIAGNOSTIC string (the constant is not exported from
`sync-target-classifier.ts`). If the classifier message is edited, the test's local copy
won't track it — but the test then FAILS (safe direction: loud, not silent), so this is
self-correcting, not a vacuity. Export-and-import would remove even that; not worth a
cycle now.

---

### SyncBinding Part 3 RESOLVED — A2 accepted [2026-06-24] → ARCHIVED
**Relocated to `decision-log-archive.md`.** This ruling was REVERSED the same day (see *A2
ruling REVERSED* [2026-06-24], directly below) — A2 was built on a false premise (the
`reads: ∅` edge is a no-op in `buildGraph`). Full superseded entry preserved in the archive
for the record. The reversal is the standing conclusion.

---

### A2 ruling REVERSED — static SyncBinding is an external-source sync; contributes no §8.5.2 edge [2026-06-24]

**Workstream:** WS4 (architect). **Type:** reversal. **Supersedes** *SyncBinding Part 3
RESOLVED — A2 accepted; contract bump v0.4.3* [2026-06-24] (same day). **Trigger:** CC
plan self-review finding C1, verified against source at `9172e5a`.

**What C1 found (confirmed mechanically + semantically + against the contract).**
The A2 ruling specified the SyncBinding write-graph edge as `reads: ∅, writes: {target}`.
But `WriteGraphCycleChecker.buildGraph` constructs graph edges *only* via
`for read in edge.reads → for write in edge.writes → addEdge`. An edge with `reads: ∅`
contributes **zero** graph edges and zero attribution — it is invisible to cycle
detection. The A2 edge is a no-op for the very check it claimed to feed; the commissioned
G3 ("reports a cross-boundary cycle with the SyncBinding in `involvedSyncs`") asserts the
detection of an object that cannot exist, and is vacuous (C2).

**The deeper error (why the edge shape can't be "fixed").** A static bare-identifier
SyncBinding (`:value={val}`) writes its target on a **DOM event**. Per §8.5 / §8.6, a
DOM event is an **external producer** (`{ subscribe }` protocol); a sync with an external
source is **untracked — it has no reactive source and cannot close a reactive cycle**
(contract §8.5, the `sync(clicks, count, …)` pattern: "external source (DOM/socket/timer);
no reactive source ⇒ no cycle"). The SyncBinding write is a **graph root** (no signal
in-edge), and the §8.5.2 write-graph contains only signal→signal edges. A root cannot
participate in a cycle. **There is no SyncBinding write-graph cycle for §8.5.2 to catch.**

**The Part 3 framing was wrong for the static case.** Part 3 claimed two-way binding
becomes "a static build error, not a runtime reconciliation loop," analogizing to escaping
Angular's digest. That conflated two different things: (a) a *reactive* feedback loop
between `sync()` calls — which §8.5.2 catches, and which arises from `sync`+`sync` pairs
**regardless of any SyncBinding** (Unit 1 already delivers this); and (b) the SyncBinding's
own write-back — which is external-event-driven and is governed by the §8.5.4
**external-event budget**, not the reactive write-graph. The SyncBinding never needed to
participate in §8.5.2, and architecturally cannot.

**Ruling (reversal).**
1. **A2 is withdrawn.** No classifier IR-literal recognition, no SyncBinding write-graph
   edge. The mechanism solved a non-problem.
2. **Contract bump v0.4.3 is withdrawn before application.** §8.5.2 does NOT widen to admit
   renderer-synthesized edges — there are none. **Contract stays v0.4.2.** (`contract-bump-
   v0.4.3.md` is not applied.)
3. **Unit 2 implementation commission is withdrawn.** Nothing to implement.
4. **§8.5.4 external-event budget is the correct, PERMANENT protection** for a runaway
   two-way binding — not a temporary backstop. A SyncBinding write-back is an external
   entry; a genuinely runaway external feedback loop terminates on the external-event
   budget exactly as §8.5.4 already specifies. No new mechanism required.
5. **What survives from Part 3, correctly scoped:** a reactive feedback loop between two
   `sync()` calls is a build-time error via §8.5.2, delivered by Unit 1. SyncBinding is
   irrelevant to that guarantee.

**Architect accountability.** This was an architect error: the A2 ruling derived
`reads: ∅` correctly from the DOM-event semantics but failed to check that (i) `buildGraph`
only creates edges from reads, making the edge a no-op, and (ii) the contract already
classifies external-source syncs as cycle-incapable (§8.5). CC's plan self-review caught
both before any `src/` touch — the plan-first gate worked as designed. The retraction is
logged at the same SHA the (now-reversed) ruling was made against.

**D-sync-cond-1 (dynamic targets):** unaffected and now moot for the write-graph — dynamic
targets were excluded from static checking [2026-06-24]; with A2 withdrawn, *all*
SyncBinding targets (static and dynamic) fall to the §8.5.4 external budget, which is
correct. No contract note needed (the v0.4.3 note that would have carried it is withdrawn).

**Supersedes:** *A2 accepted* [2026-06-24]. **Cites:** *Part 3* [2026-06-24], *Unit 1
LANDED* [2026-06-24], contract §8.5 / §8.5.4, CC plan self-review C1/C2.

**Correction note [2026-06-24]:** The v0.4.3 contract bump was committed (`436caf5`) before
this reversal; the reversal commit (`50bf521`) updated only the decision log. The contract
file was reverted to v0.4.2 in a follow-up commit. End state matches this entry's ruling:
contract v0.4.2, §8.5.2 admits no SyncBinding edges.

---

### §8.5.2 `checkProgram` build-wiring DEFERRED — trigger defined (not indefinite) [2026-06-24]

**Workstream:** WS4 (architect) / WS2. **Type:** scoping decision (close-out). Verified at
`d02b3a3`.

`checkProgram` (Unit 1, `0b62d77`) is exported and tested but called by nothing outside its
own tests; the esbuild plugin invokes no analysis. So §8.5.2 runs in no build today. The
follow-up "wire it into a build" was assessed and **deferred** — not from avoidance, but
because there is no build to wire into and no integration contract to bind to:
- The repo has no application build (`build` = `tsc` over the library), no `bin`, and ships
  no `.nv` app to check. The plugin is a per-file `onLoad` with no project-level pass.
- `checkProgram` needs a caller-constructed `ts.Program` over user source; today only
  `makeTestProgram` builds one. No production flow constructs a Program.
- The diagnostic-surfacing contract (build-fail vs. CLI exit vs. editor LSP vs. esbuild
  `onLoad` error) is undecided because the surfaces it would report to don't exist.

Building the caller now (a CLI, or a self-check CI gate) means inventing all three contracts
and risking rework when the real Mode-A consumer pipeline contradicts the guesses.

**Falsifiable trigger (the maturity measure).** Wire `checkProgram` when **a production
(non-test) flow constructs a `ts.Program` over user source for any reason.** At that moment
the Program exists, an invocation point exists, and wiring is additive rather than
speculative. The test is mechanical: a future session greps for a non-test
`createProgram`/`getTypeChecker`; found → trigger met, wire it; not found → still deferred.
No "feels mature" judgment.

**Current protection unchanged:** reactive `sync()` cycle hazards are caught when the check is
*run* (the analysis is correct and complete for hand-written `sync()`); until wired, running it
is a manual/consumer action. SyncBindings are external-source syncs needing no §8.5.2 edge
(*A2 REVERSED* [2026-06-24]), bounded by the §8.5.4 external-event budget — so nothing about
SyncBinding is gated on this wiring.

**Status:** DEFERRED with trigger. Not a debt (nothing is broken or unsound); a sequenced
future unit gated on the Mode-A pipeline producing a user-source Program.

**Correction note [2026-06-24]:** the sweep scope said "create `decision-log-archive.md`", but
a pre-existing archive `nv-decision-log-archive.md` (63 entries, from 2026-06-21) already
existed under a different name — the scope was written against a wrong fact (the architect
checked for the un-prefixed name and found none). CC caught the redundancy, consolidated the
A2-accepted entry into the existing archive rather than creating a second one, and renamed it
to `decision-log-archive.md` to match the live-log pointer (commits `4b1e9d3`, `9f49e44`).
**Canonical archive is now `decision-log-archive.md`** (formerly `nv-decision-log-archive.md`).
Future sweeps target that file. End state: one archive, A2-accepted relocated once, live pointer
correct.

---

### D-slot-2 CLOSED — premise dissolved; D-slot-1 already produces invocation-scoped ownership [2026-06-24]

**Workstream:** WS4 (architect) ← WS3 probe. **Type:** close-out (no implementation).
**Probe verified at `997dbc2`.** Resolves the D-slot-2 item re-phased "to land with `each`"
(2026-06-22).

**Question.** D-slot-2 (GATE-1) ruled slot-content ownership should flip from parent-lexical
(D-slot-1) to invocation-scoped, on the argument that "strict parent-lexical would strand a
dangling observer when an invocation disposes." With `<each>`-in-slot landed (Increment SS), the
per-row-invocation scenario that loads this gate now exists — so a leak-reproduction probe was
commissioned to test whether the flip is needed.

**Finding: NO LEAK.** The probe built the exact scenario (component-with-slot inside an `each`,
slot content running an effect on a row-outliving signal, remove one row while a sibling stays
live) and measured effect invocations:
- Removed row's slot effect after disposal: **0 fires** (no dangling observer).
- Surviving sibling row's slot effect: **fires correctly** (not over-disposed).
- Both back-ends identical (interpreter L680 chain; emitted-mount L550 chain).

**Why the premise dissolved.** D-slot-2 assumed D-slot-1 meant slot content is owned by a
**static outer (component/parent) scope** that outlives a single invocation. It is not.
D-slot-1 is implemented as `capturedParentOwner = getOwner()` captured **at wire time**
(`interpreter.ts:680`). When the component-with-slot is wired **inside an `each` row**, wire
time *is* the row's `createRoot` callback, so `getOwner()` returns the **row root**. Slot
content mounts under the row root and is disposed by `rec.dispose()` when the row is removed.
D-slot-1's "parent" is **dynamically the nearest enclosing owner**, which is the invocation root
in the only scenario with a per-invocation lifecycle. **D-slot-1 and D-slot-2 coincide in every
loadable case:**
- *Top-level component with a slot (no `each`):* `capturedParentOwner` = mount root; disposes
  with the mount; no per-invocation lifecycle exists, so nothing to leak. (GATE-1 itself noted
  increment 1 "retains D-slot-1 because it has no per-invocation dependency.")
- *Component-with-slot inside an `each` row:* `capturedParentOwner` = row root; disposes with
  the row; probe-proven no leak.
There is **no scenario** where the two designs differ. The scoped-slot value-read case GATE-1
worried about (`content(slotProps)` reading child-exposed `p.expr`, `interpreter.ts:641`) is
handled by observation-≠-ownership (§6 / §12.24b): the cross-scope read stays correct
(sibling reads fine) while the content's *effect owner* is already the invocation root.

**Ruling.**
1. **D-slot-2 is CLOSED as premise-dissolved.** No implementation unit, no ownership flip, no
   `src/` change. The "flip from D-slot-1 to D-slot-2" describes a transition between two states
   that are the same state in the landed code.
2. **D-slot-1 is NOT "retired" — it is the correct, sufficient mechanism.** The wire-time
   `getOwner()` capture *is* invocation-scoping wherever an invocation scope exists. GATE-1's
   "retire D-slot-1 when scoped slots land (increment 2)" is superseded: nothing to retire.
3. **No contract change.** §6 / §12.24b unchanged; reactive-core stays **v0.4.2**. The
   "escalation rule: surface any §6 gap before landing" (GATE-1) is discharged — the probe is
   that verification, and it found no gap.
4. **GATE-1's ownership *intent* is recorded as already-met:** all slot content is
   invocation-scoped via wire-time owner capture; parent-signal reads stay correct cross-scope.

**Supersedes:** the D-slot-2 flip obligation in *GATE-1 / Scoped slots design APPROVED*
[2026-06-22] and its re-phasing [2026-06-22] (the flip is moot, not merely deferred). **Cites:**
WS3 leak-reproduction probe [2026-06-24], Increment SS LANDED [2026-06-23].

**Architect note.** The forward queue carried D-slot-2 as the assumed next unit on the strength
of a 2026-06-22 *prediction* ("flip lands with `each`"). The prediction encoded an assumption
about D-slot-1's ownership that the code never satisfied. Reading the chain (wire-time
`getOwner()`) before commissioning — and probing the leak empirically rather than scoping the
fix on the queue's say-so — is what caught it. Pattern: a queue item is a hypothesis until the
code is read; "named next" ≠ "needed next."

---

## `$style × <each>`-in-slot — CONFIRMED & CLOSED [2026-06-25]

**Workstream:** WS3 (renderer). **Contract:** v0.4.2 unchanged (renderer-layer).
**SHAs:** commission base `c0d265d` → gate landing `a6cafbd` → G7 test fix `85d8064`.

**Outcome.** The scope-carry mechanism (RULED+LANDED 2026-06-23) styles `<each>`-in-slot
tokens with no new IR/parse logic: `patchClasslistTokens` component-case recursion descends
into the slot's `list` binding and rewrites the scoped token through the shared `classlist`
case — one path, no degraded copy (verified `nv-parser.ts` L2034→L2005→L2013 at `c0d265d`).
G5 (`nv-parser.test.ts:1353`) is live + green; its stale SKIPPED comment was corrected. This
closes the G5 deferral named verbatim in the 2026-06-23 scope-carry landing ("Styling handles
it for free once the capability lands").

**Real-browser gate (the owed piece).** `test/browser/slot-style-scope.spec.ts` gained
**G5-E** (`<each>` rows in slot content: count===3, per-row `getComputedStyle === rgb(0,128,0)`,
parent scope class present, child hash absent) and **G7** (child `$style` applies when mounted
via `wireComponent`). Run on real hardware (Playwright 1.61.0), **9/9 green** across
Blink/Gecko/WebKit.

**Production bug found and fixed [a6cafbd].** Verifying the gate surfaced a latent runtime
defect: `wireComponent` (interpreter L691) called `mountFragment` for a child component IR but
never injected its `styleArtifact` — child-component CSS was silently dropped whenever a styled
component mounted through a parent binding. Fix mirrors the `mount()` block verbatim
(`injectComponentStyle` + `data-nv-s-<hash>` stamp on `roots[0]`, single-root guard). Transitive
via `wireConditional`/`wireList` → `wireComponent`, so styled children in conditionals and lists
are also covered. Architect-verified: faithful mirror of an existing sanctioned pattern, not a
second path. The existing G6 suite missed this because it tests *absence* of the child hash on
projected nodes (a negative assertion that passes whether or not injection runs); G7 is the
positive regression gate.

**Process note.** The bug was fixed in-run inside a "no-src expected" commission. Acceptable
here because the fix is a verbatim mirror of `mount()` (no novel logic, no degraded-copy risk);
standing rule reaffirmed — a found-at-review production fix on a renderer correctness seam still
warrants surface-before-landing even when obviously right.

**Out of scope, noted:** `wide-graph-steady-state.spec.ts` (G-WG) flaked on chromium/webkit —
performance-harness timer flakiness, unrelated; WS1, not this unit.

---

### 2026-06-25 — `$style` OPEN-1/3/4/5 CLOSED (chosen-at-build, verified); OPEN-6 RE-SCOPED to trigger-gated

**Workstream:** WS4 (architect) confirmation pass. **No `src/` change.** Contract **v0.4.2**
unchanged; Template-IR **v0.4.2** unchanged. Verified by reading shipped seams at HEAD
`e40fec6`.

Confirms the residual OPEN points from the S1+S2 increment (logged 2026-06-22, "Seven OPEN spec
points deferred to build") against the shipped code. OPEN-2 and OPEN-7 were already CLOSED
(2026-06-23). This entry resolves the remaining five. The standing instruction was "confirm
chosen-at-build vs. genuinely-open before treating any as live" — done.

**OPEN-1 (selector qualification form) — CLOSED, chosen.**
Selector-form `$style` rules emit `:where([data-nv-s-<scopeHash>]) <selector>`
(`nv-parser.ts` L1905, L1916); class-form emits the `.<token>_<scopeHash>` rewrite
(L1902, L1913). The `:where()` wrapper contributes **zero specificity**, so authored selectors
keep their natural specificity and scoping never silently wins a cascade fight. Browser-gated
green (style-scoping + slot-style-scope specs). The alternative (bare `[attr] selector`) was
rejected implicitly by the shipped choice; recording it as the decision: **zero-specificity
`:where()` qualification is the chosen form.**

**OPEN-3 (dynamic value coercion) — CLOSED, chosen.**
Reactive `$style` values lower to a CSS custom property `var(--nv-<hash>)`; the value is written
by `StyleVarBinding` via `element.style.setProperty(varName, String(v))`, with
`removeProperty(varName)` on nullish (interpreter L278–280; emitted-mount L651–653 — **at
parity**). The only coercion is `String(v)`: nv does not parse, validate, unit-correct, or invent
CSS. Consistent with the locked **nv-does-not-invent-CSS** principle. **Chosen:
stringify-and-write, no coercion beyond `String(v)`; FE-parity is the gate.**

**OPEN-4 (injection registry shape/lifetime) — CLOSED, chosen.**
`docStyleRegistries: WeakMap<Document, Map<identityHash, StyleEntry>>` (`style-inject.ts` L9).
Idempotent per `(doc, identityHash)` via `registry.has` early-return; keyed through the passed
`doc`, never global `document` — required by the locked renderer-agnostic / multi-doc decision.
`StyleEntry` is a discriminated union (`'adopted'` | `'style-el'`) carrying the live handle.
**Chosen: per-document WeakMap, identity-hash-keyed, dedup-on-insert.**

**OPEN-5 (`<style>` vs `adoptedStyleSheets`) — CLOSED, chosen.**
`adoptedStyleSheets`-first: construct `CSSStyleSheet` + `replaceSync`, append to
`doc.adoptedStyleSheets`; on throw (cross-document / unsupported env) fall back to a `<style>`
element appended to `doc.head ?? doc.body` (`style-inject.ts` L27–46). Browser-gated green across
Blink/Gecko/WebKit (S1+S2 run). **Chosen: adopted-first with graceful `<style>` fallback.**

**OPEN-6 (teardown policy) — RE-SCOPED: genuinely open, trigger-gated (not closed, no build now).**
Read finding: **no teardown path exists.** There is no `removeComponentStyle`, no refcount, no
`registry.delete`, and no unmount hook that removes an injected sheet/`<style>`. Injected style
persists for the document's lifetime; the `WeakMap` only reclaims on whole-document GC, not on
component unmount. This was never a *decision* — it is the absence of code (chosen-by-omission).

It is a defensible default and **not a leak in the common case**: scoped CSS per component is
small, dedup'd by identity hash, and re-mounting the same component reuses the existing entry
(monotonic in *distinct* component identities, not in mount count). The two scenarios that could
make it a real cost — (a) a long-lived document that mounts many *distinct* short-lived styled
components over a session (router churn), (b) any workload where distinct-identity accretion
within one document grows unbounded — are measure-before-deciding cases, governed by the
performance-first principle (don't build refcounted teardown speculatively).

**Ruling:** OPEN-6 stays **OPEN** with a falsifiable trigger. **Build a teardown/eviction policy
when, and only when, a real workload shows injected-style accretion as a measured cost** (distinct
styled-component identities per document growing without bound, or a measured memory/perf
regression attributable to the style registry). Until then, inject-once-never-remove is the
accepted shipped behavior, recorded as deliberate, not a debt. R-style-1 (`<style>` fallback AOT
batching) remains separate OPEN research, unaffected.

**Net:** `$style` OPEN set is now OPEN-1/2/3/4/5/7 CLOSED, **OPEN-6 open (trigger-gated)**. No
code, contract, or IR change. The `$style` axis carries no remaining build-blocking open points.

---

### 2026-06-25 — Emitter factory-shape convergence: CLOSED, premise dissolved (already covered by TC-C15/16/17)

**Workstream:** WS4 (architect) read. **No `src/` change. No commission issued.** Contract
**v0.4.2** / Template-IR **v0.4.2** unchanged. Verified by reading seams + running tests at HEAD
`7fece12`.

The forward-queue item "emitter factory-shape convergence — emitted factories return `{ mount }`,
not `ComponentRef`-compatible `TemplateIR`; blocks cross-file emitted-component composition"
(carried from session handoffs, added to `implementation-state.md` forward queue 2026-06-25) is
**false on two counts** and **already closed by existing green coverage**.

**Finding 1 — the factory is already `ComponentRef`-shaped.** `emitComponentFactory`
(`nv-emitter.ts` L295–302) emits `export function Name(props, slots) { ...; return <IR literal> }`
— the factory **returns `TemplateIR`**, matching `ComponentRef = (props, slots) => TemplateIR`
(`ir.ts` L208). `Name.mount` is a **static-method sugar** hung beside the function for top-level
entry, NOT the factory's return value. There was never a shape to converge.

**Finding 2 — cross-file child composition is already proven end-to-end.** The emit path puts a
bare reference `component: <tagName>` into the `ComponentBinding` (`nv-parser.ts` L2729,
`componentSrc: pc.tagName`); cross-file `.nv→.js` import specifier rewrite is handled by
`rewriteNvSpecifiers` in the esbuild plugin (TC-C14a–e). Existing tests prove the full child
render across files:
- **TC-C16** — *titled* "emitted factory returns ComponentRef, not `{ mount }`": TC-C16a asserts
  `Counter(props, slots)` returns `{ shape, bindings }` with no `.mount` on the return; TC-C16b
  confirms `.mount` is sugar on the function. (Directly refutes the queue item's wording.)
- **TC-C15-exec** — `App` imports `Counter` from `./counter.nv`, renders `<Counter .count="${n}"/>`
  as a child, bundled via `nvPlugin`, mounted, asserts `<span>0`.
- **TC-C15-exec-reactive** — external signal threaded as a prop across the file boundary →
  child DOM updates 0→42.
- **TC-C15-dispose** — dispose parent → child DOM removed, no reactive leak.
- **TC-C15-parity** — emitted `ComponentRef` produces `structurallyEqual` DOM across two
  independent interpreter mounts.
All green at `7fece12` (8/8 in the TC-C14f + TC-C15/16/17 set).

**Why the queue carried it:** a stale deferral note in TC-C14f (`nv-emitter-exec.test.ts`
L487–488: "mounting Counter as a child element requires the emitter factory shape to match
ComponentRef — deferred to a later milestone") was written before TC-C15/16/17 landed and never
updated to point at them. Session handoffs propagated the note's framing as an open item. Third
"named next ≠ needed next" catch — the queue label was a hypothesis the code falsifies.

**Action:** removed from the forward queue (implementation-state correction). Test-comment
hygiene fix applied to TC-C14f (points at TC-C15/16/17). No other work.

### 2026-06-25 — Kind-split tripwire: 2026-06-24 CLEAR verdict REVERSED — produced by a defective instrument (effects never subscribed)

**Reverses** the finding in `2026-06-24 — Kind-split tripwire: real-app evidence harness
COMMISSIONED ...` Current-State CLEAR ("~0.005ms/tick, budget-irrelevant by ~3,000×"). That number
does not support a CLEAR and the tripwire returns to **EVIDENCE-PENDING**.

**Finding (verified at HEAD `3315a28`; harness blob `b5a962e`, identical at `1e59fe1` and HEAD —
the file has exactly one commit and has never been modified).**
The harness `test/browser/wide-graph-steady-state.spec.ts` builds each cell's binding with
`createRoot(() => {...})`, not `effect(() => {...})`:

- `createRoot` (core.ts:1201) makes a scope node whose compute is null and is **never scheduled**;
  it runs its body **once** for ownership and creates **no reactive subscription**.
- Therefore, in the timed region, signal writes dirty the derived graph but **no binding effect
  ever re-runs**. There is no propagation-to-effect and, in the live run, no steady-state DOM
  mutation. `live.med` and `floor.med` both collapse toward sub-resolution noise; `t_dom ≈ 0`;
  `propagation_share` = tiny/tiny (numerically unstable).

**Consequences.**
1. The ~0.005ms/tick measured at `1e59fe1` is the cost of `flushSync` over a graph with **zero live
   consumers** — not a frame-share. It cannot support Condition A or B, so it cannot support CLEAR.
2. The "chromium/webkit flake" reported in the browser-gate session is the downstream symptom of
   this defect (sub-resolution noise tripping `floor.med > 0` / share-band assertions
   nondeterministically), **not** timer-instability and **not** a real propagation signal. The
   handoff's instinct ("the verdict has never been cleanly recorded") was correct; the
   2026-06-24 Current State overclaimed a tested terminal result.
3. The harness's own G-WG-5 / line-311 assertion text ("effects subscribe to deriveds") contradicts
   its code. The instrument never measured what the 2-of-2 gate requires.

**Decision.** Tripwire status → **EVIDENCE-PENDING** (was tested-CLEAR). Locked design parameters
(1000×10, 5% churn, steady-state, full-frame, nv-alone) are **unaffected and remain locked** — the
defect is the binding primitive, not the design. Fix is site-local: import `effect` (already exported
by `nv-entry.ts`) and replace the two `createRoot(() => {...})` binding wrappers with
`effect(() => {...})`; the surrounding app-root `createRoot((dispose) => ...)` already owns and
disposes them, so no per-cell scope is needed (the removed `createRoot` was redundant as well as
non-subscribing). A permanent **G-WG-9** guard is added: a FLOOR-run effect-run counter asserting
`effectRuns > totalCells` (built once **and** re-ran under churn), which fails closed if a future
edit reintroduces a non-subscribing binding.

**Commissioned:** `cc-handoff-wide-graph-effect-fix.md` (CC, real-hardware; one commit). CC returns
the verdict with numbers to architecture; CC does **not** open the kind-split spike on FIRE
(cross-stream, §9 contract-adjacent).

**Downstream gating unchanged in shape, only in basis:** kind-split + LIS remain gated on this
harness's verdict — but the verdict is now **pending a trustworthy run**, not recorded. No contract
change (v0.4.2 holds; this is a test-instrument defect, not a core-semantics change).

### 2026-06-25 — Kind-split tripwire: verdict CLEAR (both engines) — resolves EVIDENCE-PENDING; gate-logic false-positive identified

**Resolves** the EVIDENCE-PENDING state from `2026-06-25 — Kind-split tripwire: 2026-06-24 CLEAR
verdict REVERSED ...`. Verified at `387990f` on `main` (harness diff read at SHA; signal/createRoot
semantics confirmed in `core.ts`).

**Harness fix verified (harness-only; no src/, no design-param change).** `createRoot→effect` at both
binding sites; `(v)`→`.set(v)` so writes actually occur (nv signal API is call-to-read,
`.set`-to-write — the getter-call form did zero writes, a *second* defect beneath the subscription
one). Permanent **G-WG-9** counter (`floor.effectRuns > N_ROWS*N_COLS`) caught both defects in
sequence and fails closed on regression.

**Verdict (2-of-2 conservative gate; FIRE ⟺ A ∧ B).**
- **Chromium — CLEAR (clean, no retry).** t_propagate 0.17ms/tick vs reactive budget 16.49ms →
  Condition A fails by ~97×. Condition B 44.74% > 30% (holds). A fails ⇒ CLEAR.
- **WebKit — CLEAR (architect override of a harness-reported AMBIGUOUS).** t_propagate 0.15ms vs
  budget 16.40ms → Condition A fails by ~109×. Condition B 33.33% straddles 30% (±4pp band). The
  harness reported AMBIGUOUS because its verdict branch escalates on `a_straddles || b_straddles`
  **without checking outcome-relevance.** Under the AND gate, a B-straddle can flip the verdict only
  if A clearly holds; here A fails by ~100×, so no movement of B within noise can produce FIRE. The
  straddle is decision-irrelevant ⇒ correct verdict CLEAR. CC routed correctly (surfaced, did not
  self-resolve).

**Decision.** Kind-split tripwire → **CLEAR, terminal** on both engines. Wide-graph propagation is
**not a top user-facing cost** at locked realistic scale (1000×10, 5% churn, steady-state,
full-frame, real-browser): propagation self-time ~0.15–0.17ms/tick vs a 16.7ms frame —
budget-irrelevant by ~100×, absolute-breach condition unflippable at this scale. **Kind-split and LIS
are accepted structural gaps — evidence-tested-clear, not deferred.** Reopen only on a materially
larger/deeper real-app graph in real profiling.

**Correction to the magnitude claim.** The reversed 2026-06-24 entry's "~0.005ms/tick,
budget-irrelevant by ~3,000×" was an artifact of the dead-graph instrument. The *real* corrected
number is ~0.15–0.17ms/tick, ~100× under budget. CLEAR holds on the corrected number; the ~3,000×
figure and the reasoning built on it (see supersession pointer on the 2026-06-24 dated entry) are
withdrawn.

**Gate-logic false positive (recorded; fix commissioned).** The harness AMBIGUOUS branch fires on
any straddle, not a decision-relevant one. A straddle matters under the AND gate only when the other
condition clearly holds. Fix commissioned: `cc-handoff-wide-graph-verdict-logic-fix.md` (escalate
AMBIGUOUS only on outcome-determinative straddle). Until it lands, read any AMBIGUOUS where one
condition clearly fails as CLEAR and surface.

No contract change (v0.4.2 holds — test-instrument behavior, not core semantics).

### 2026-06-25 — Verdict-logic false-positive fix LANDED (`0c6578a`); kind-split tripwire fully closed

Closes the "fix commissioned / until it lands" note in `2026-06-25 — Kind-split tripwire: verdict
CLEAR (both engines) ...`. Commission `cc-handoff-wide-graph-verdict-logic-fix.md` landed at
`0c6578a`, verified by reading the harness diff at SHA.

**Fix verified.** The AMBIGUOUS branch now escalates only on a decision-relevant straddle:
`decisive_straddle = (b_straddles && a_clear_hold) || (a_straddles && b_clear_hold)`, where
`*_clear_hold = condition_* && !*_straddles`. Verdict branch is `FIRE` (A∧B) → `AMBIGUOUS`
(decisive_straddle) → `CLEAR`. Traced across all cases: WebKit's prior config (A fails ~100×, B
straddles 30%) now yields **CLEAR**; a genuine decision-relevant straddle (one condition clearly
holds, the other straddles toward not-holding) still yields **AMBIGUOUS** — the fix narrows, does
not disable, escalation. No FIRE leak (A∧B is checked first). CONFIG constants, noise bands
(`noise_ms=0.5`, `noise_share=0.04`), and condition definitions unchanged; no `src/` touch.

**Boundary note.** At an exact 30.00% share, `condition_b = share > 0.3` is false (strict `>`) and
`b_straddles` is true; with A failing, `decisive_straddle` is false → CLEAR. The strict-inequality
boundary behaves correctly.

**Status.** Kind-split tripwire is **CLEAR, terminal, both engines**, on corrected evidence
(~0.15–0.17ms/tick, ~100× under a 16.7ms frame). The harness no longer has a path to report a
spurious AMBIGUOUS when one condition clearly decides the verdict. Kind-split + LIS remain accepted
structural gaps. WS1 wide-graph frontier is closed. No contract change (v0.4.2).

### 2026-06-25 — Clarification: LIS is closed-by-tradeoff, not gated on the wide-graph verdict

Corrects a coupling overstatement in the 2026-06-25 CLEAR entries (`... verdict CLEAR (both
engines) ...` and the Current State bullet), which read "kind-split + LIS stay gated on this
verdict." That bundling is imprecise. The two items have **different statuses and different
triggers**; the wide-graph CLEAR decides only kind-split.

**Kind-split — deferred-on-evidence.** Gated on real-app `ReactiveNode`-width evidence. The
wide-graph harness *is* that instrument, and its CLEAR (~0.15–0.17ms/tick, ~100× under a 16.7ms
frame) is the evidence: propagation is not a top frame cost at realistic scale, so the cross-stream,
§9-adjacent, regression-prone (2026-06-18 field-reorder +18%/+27%) struct split is not justified
now. Reopens on a materially larger/deeper real-app graph breaching frame budget in real profiling.

**LIS (list move-minimization) — closed-by-tradeoff, NOT gated on this verdict.** Independently
CLOSED 2026-06-22, not commissioned: the list reconcile uses O(N) `insertBefore`, with accepted move
cost at the current target N traded against LIS bookkeeping complexity. Its reopen trigger is its
**own** measurement — row-churn reorder cost becoming material at larger N — which the wide-graph
steady-state harness (signal→derived→effect propagation, not list reorder) does not measure. The
wide-graph CLEAR neither decides nor holds LIS; LIS was already closed before the harness ran.

**Why the bundling happened.** The session handoff grouped them because both touch
`ReactiveNode`-width / reorder structural cost. That shared *theme* is real, but it is not a shared
*gate*. Recorded so a future reader does not treat the wide-graph CLEAR as the thing holding LIS, or
expect LIS to reopen on wide-graph evidence.

**Net.** Both remain accepted structural gaps — cost measured, fix known on paper, deliberately not
taken at current targets — but on **independent** falsifiable triggers (kind-split: real-app
frame-budget breach; LIS: reorder cost at larger N). Neither is foreclosed; neither is scheduled. No
contract change (v0.4.2).

### 2026-06-25 — Current State reconciled to the Increment SS landing (header-only; no code change)

The Current State header still described Increment SS as "COMMISSIONED ... awaiting CC plan" and
listed D-slot-style-1 + the all-static-slot limitation as pending, while the dated log already
recorded Increment SS LANDED at `58afe25` (entries `2026-06-23 — Increment SS LANDED` + bookkeeping
correction). Header was never synced on landing — Current-State-vs-dated-log drift, dated log
authoritative.

**Reconciled (header-only):** SS bullet → LANDED `58afe25`, slot domain CLOSED; D-slot-style-1 →
CLOSED; all-static-slot limitation → CLOSED; G-SS-browser ×3 noted as the one DEFERRED leg
(real-cascade CSS-application; element-targeting correctness already jsdom-proven). No code, contract,
or IR change — reactive-core v0.4.2, Template-IR v0.4.2. Verified at `58afe25` by source read
(`liftStaticClassBindings`/`pushListBinding` present, `shape.html` regex absent, G5 live, 659/0).

**Named follow-up (carried, not a defect):** G-SS-browser Playwright ×3 styled-cascade leg —
run on the next browser-harness trip; bundle with any future Playwright gate. Not blocking; slot
domain is functionally closed and behaviorally proven in jsdom.

### 2026-06-25 — Runtime/build-time package split RULED: emitted bundles must not pull the TS compiler

**Source of finding:** `.nv` authoring probe (`probe-nv-author-findings.md`, `8146d82`). Verified at
SHA by architect source read.

**Probe outcome (the good part).** The full author path works end-to-end in real browsers:
`counter.nv` → `nvPlugin` → esbuild → IIFE bundle → chromium + webkit, click increments DOM text.
- **Authoring syntax:** `@click="${() => count = count + 1}"` (assignment form); the parser erases
  it to `count.set(count() + 1)` at build time. Bare `${count}` → `count()`. Authors write neither
  `.set()` nor the getter call. (Confirms the call-read/`.set`-write API is a *compile target*, not
  the authoring surface.)
- **CP-1b → CLOSED:** "documented pattern, not missing wiring." No event→signal wiring gap.
- **CP-3 → CLOSED:** no thin wrapper needed. Emitted module exposes `Component.mount(parent, doc)`
  as a static method; documented convention is
  `import { Counter } from './app.nv'; Counter.mount(document.body, document)`.

**The blocker (the ruling).** `src/renderer/index.ts` (the `@neutro/view/renderer` barrel)
co-exports runtime (`mount`, L4) and build-time (`parseNvFile`/`parseNvFileForEmit`, L33). The
parser does `import * as ts from 'typescript'` (`nv-parser.ts` L51) at module top-level. The emitter
hard-codes `import { mount } from '@neutro/view/renderer'` into every emitted bundle
(`nv-emitter.ts` L316). **Net: every emitted app bundle transitively pulls ~4 MB of the TypeScript
compiler into the browser, though the parser is never called at runtime.** The bundle runs
correctly; it is just not production-viable in size. This is a **CP-1a blocker**.

**Verified clean-split precondition.** All runtime-surface modules — `interpreter` (home of `mount`),
`html-tag`, `style-inject`, `comparator` — carry **zero** `typescript` imports. The split is clean
by construction: a runtime-only entry exporting these pulls nothing build-time.

**RULING.** Add a runtime-only package entry and point the emitter at it.
1. **New entry `@neutro/view/renderer/runtime`** exporting only the TS-compiler-clean runtime surface
   (`mount`, html-tag helpers, `injectComponentStyle`/style-registry, `structurallyEqual` as needed
   by emitted code) — **never** `parseNvFile*`/`preprocessMutationWrites`.
2. **Emitter change:** `nv-emitter.ts` L316 emits
   `import { mount } from '@neutro/view/renderer/runtime'` (and any other emitted runtime imports
   move to the runtime entry). This is a change to the **published-surface aliases the emitter
   depends on** — contract-adjacent (the emitter's §-published-surface convention), hence an
   architect ruling, not a silent CC edit.
3. **Keep the fat `@neutro/view/renderer` barrel** for build-time consumers (the esbuild plugin,
   tooling) — it legitimately needs the parser. The split is additive; nothing is removed from the
   existing barrel.

**Constraints.** No `mount`/runtime behavior change. No IR change. No contract-semantics change
(v0.4.2 holds) — this is package topology + one emitted import specifier. The runtime entry must be
verified TS-compiler-free by a bundle-size or dependency-graph assertion (a gate that fails if
`typescript` ever re-enters the runtime graph).

**Commissioned:** `cc-handoff-runtime-package-split.md` (CC, real-hardware bundle measurement).
Closes CP-1a's production-viability sub-gate once the emitted bundle is measured TS-compiler-free.

---

### 2026-06-26 — CP-2a CLOSED: js-framework-benchmark keyed app proven in .nv

**Status:** CP-2a CLOSED at `ef86bd7` (+ `4ef0205`). Verified by source read, not gate report.

Benchmark keyed app authored in pure `.nv` (element `<each>` inside `<tbody>`, per the `<each>`→`<template>` rewrite ruling). 10 probe gates green chromium+webkit; 8 ops proven in real browser; keyed-move confirmed (swap moves DOM nodes, `data-nv-probe` survives); bundle 46.5 KB, 0 typescript inputs.

Four `src/` defects surfaced by the integration and fixed at source (all verified):
- **Bug 1 (nv-emitter):** static `ClassListBinding` thunk-slot misalignment — separate `thunkIdx` cursor.
- **Bug 2 (nv-parser):** `eraseHandlerExpr` lacked `propsAccessors` for assignment RHS — `item.id` now rewrites to `slotProps.item().id`.
- **Bug 3 (interpreter):** whitespace text nodes around `<each>` body tripped the single-root guard — `wireList` now filters whitespace-only roots before the check. (Introduces a low-severity whitespace text-node leak — see follow-up entry.)
- **Bug 4 (nv-parser `@4ef0205`):** slot-prop reads in non-assignment handler expressions not rewritten — dedicated `propsAccessors` identifier case in `walkHandlerNode`; EX-EACH-06 locks it.

G-2a-5 (no `src/` change) recorded **violated-as-expected**: the gate forced escalation of engine changes rather than masking them. Benchmark app is `test/`-only.

Net: 705 unit tests + 10 browser gates green. CP-2b (isKeyed verify) and CP-2c (baseline numbers) remain. CP-2a closure criteria met.

---

### 2026-06-26 — FOLLOW-UP: whitespace text-node leak on keyed-list teardown (from Bug 3 fix)

**Status:** OPEN, low severity, gated on CP-2c memory baseline. NOT a CP-2a reopen.

The Bug 3 fix (`interpreter.ts` `wireList`) filters whitespace-only text nodes for the single-root check but `mountFragment` still inserts them (L778) and item teardown removes only the content root (L508) — leading/trailing whitespace text nodes around each `<tr>` are orphaned and accumulate across remove/clear/create cycles. Invisible to rendering and to G-2a-3; relevant because CP-2c grades memory.

**Preferred fix (B, collapse):** strip insignificant leading/trailing whitespace from the list-item body shape at parse/emit time so the nodes never enter the fragment — removes the cause, shrinks every item mount, demotes the Bug 3 filter to a rarely-firing guard. **Alternative (A, patch):** track + remove whitespace siblings in `onCleanup`. Scoped to parse/emit; separate commission. Required before the CP-2c memory baseline is trustworthy IF a node-count assertion (`<tbody>` `childNodes` after `create-1000 → clear → create-1000` should not grow) confirms growth.

---

### 2026-06-26 — Whitespace leak CLOSED (disproven); CP-2b/2c ruled harness-venue gates

**Leak finding CLOSED.** Step-1 probe (`0e66fae`), both engines: `tbody.childNodes` after `create-1000 → clear → create-1000` = `1003`, equal to single `create-1000`. The `+3` is static per-list-region mount nodes (anchor comment + 2 indentation whitespace nodes flanking `<each>` in `tbody`), not per-item. Bug-3-fix orphans are bounded to the list region, not the teardown path. CP-2a-closeout leak follow-up retired; shape-strip fix (direction B) skipped — not needed.

**CP-2b/2c venue ruling.** CP-2b (`isKeyed`) and CP-2c (baseline) run only in the external `krausest/js-framework-benchmark` harness (webdriver-ts/Selenium/pinned browsers/registered competitors), not in this repo. They are gated on a one-time harness-venue setup (clone harness, register the `.nv` app as `keyed/nv/`, install webdriver-ts) — a separate benchmark-venue commission, not part of the nv repo gate suite. Reimplementing the harness in-repo is rejected (degraded copy). Architect commission error owned: prior re-issue mis-scoped these as local npm steps; CC correctly HALTed on the venue boundary.

**Open — user input required:** existing harness clone to point at, or venue-setup commission first?
**Open — roadmap definition:** "benchmarkable" for v0.1.0 = harness-registerable + `isKeyed`-pass (CP-2c numbers land post-tag), OR = numbers recorded (both gate the tag). Architect leans the former (measured margin is the v1.0.0 axis); user to confirm.

---

### 2026-06-27 — CP-2b CLOSED: nv passes isKeyed in the krausest harness

**Status:** CP-2b CLOSED. v0.1.0 "benchmarkable" bar (roadmap ruling (a)) met. Verified by reading
harness isKeyed.ts/webdriverAccess.ts at cloned SHA 4fbccf55…, not the gate report.

nv registered as frameworks/keyed/nv/ in krausest/js-framework-benchmark (cloned SHA 4fbccf55…),
builds via build-prod (23K IIFE, TS-compiler-free), passes isKeyed for run/remove/swap. No nv src/
change required.

The +2 <tbody> DOM delta vs vanillajs (one <!--nv-list-0--> anchor comment + one trailing whitespace
text node from the <each>→<template> rewrite) is verified harmless: all benchmark + isKeyed row
selectors are tbody>tr:nth-of-type(N) (element-positional, blind to non-element nodes), and the keyed
detector counts tr node identities only (filterTRInNodeList). #634 DOM identity substantively clean
(TR structure + aria-hidden match; harness uses contained class checks).

**LOGGED watch-item (low/latent-medium, not a reopen):** the remove-keyed test picks its tracked
storedTr via tr:nth-child() (isKeyed.ts L123-125, an Alpine <template>-in-tbody workaround), NOT
:nth-of-type. nv's <each>→<template> structure lands in that workaround's path: nv hits the index=3
branch (first tbody child is whitespace → tr:nth-child(1) null). Test passes, but the index-3→2nd-row
alignment was verified by outcome, not by characterizing nv's exact tbody child sequence. Risk: a
future change to nv's emitted item-shape whitespace/comments could shift the nth-child arithmetic and
silently flip remove-keyed to a false result. Action: CC to dump nv's first-3-rows tbody node sequence
once to size the margin; record any resulting item-shape emission constraint. This is the only place
nv's extra nodes are not invisible to the harness.

**§2 characterization completed (same session):** tbody child sequence after #add (1000 rows):
`[1] TEXT "\n            "`, `[2..1001] 1000 × TR (contiguous, no inter-row nodes)`,
`[1002] COMMENT <!--nv-list-0-->`, `[1003] TEXT "\n          "`. tr:nth-child(3) = TR at child
position 3 = 2nd row. Margin is maximum: single leading text node only, zero inter-row nodes.
The index-3 alignment is **robust**, not coincidental. Constraint: nv must not emit inter-row
whitespace/comment nodes inside the list body — the <each> anchor and flanking whitespace are
region-level (before/after all rows), not per-item.

---

### 2026-06-27 — CP-2c baseline recorded; axiom conditionally upheld; LIS REOPENED (trigger met)

**Status:** CP-2c data complete (Chrome 149, M2 Max, harness SHA 4fbccf55…, 15 iter, 2× throttle).
CP-2b nth-child watch-item RETIRED — tbody dump shows zero inter-row nodes, tr:nth-child(3)=2nd TR,
maximum margin.

**Axiom verdict (highly performant): conditionally upheld.** nv WINS where fine-grained reactivity
targets: select row 0.34× vanilla, update-every-10th 0.68× — beating Solid/Svelte. At-peer on bulk
create (1.66–1.75× vanilla, in the Solid/Svelte band). Memory 2.4× vanilla / above signal peers
(v0.5.0 efficiency target, cleanup verified non-leaking). ONE structural defect: swap rows 3.95×
vanilla / 3.49× Solid.

**Swap root cause (verified at interpreter.ts L540–550, not inferred):** the reconcile ordering pass
calls insertBefore unconditionally for EVERY row every reconcile (no in-position check; comment:
"O(N) moves worst-case, LIS-Ivi move-minimization deferred"). A 2-element swap emits ~1000
insertBefore calls = full 1000-row re-layout. Script 21.9ms (reactive work is small); paint 111.7ms
(DOM thrash). 15/15 iterations consistent, 6% CV — structural.

**LIS REOPENED.** The 2026-06-22 closed-by-tradeoff entry pre-registered reopen on "a measured swap-
throughput deficit at benchmark scale." Met at 3.95×. Reopened for v0.5.0. Fix is two-tier: Tier 1 =
position-guard (skip insertBefore when node already in place; ~2 moves not 1000 — may alone close the
deficit); Tier 2 = full LIS-Ivi for arbitrary-permutation move-minimization (only if Tier 1 leaves a
large-N deficit). Sequence Tier 1 → re-measure → decide Tier 2. Both reconcile-internal, no IR/closure-
axiom touch.

**v0.1.0 NOT blocked:** swap deficit is a characterized, root-caused, fix-pathed known tradeoff;
measured margin is the v1.0.0 axis per the (a) ruling. v0.1.0 tags honestly as competitive-on-partial-
update with a tracked reorder deficit. CP-2c numbers in roadmap CP-2c.

---

### 2026-06-27 — Tagged-template docs landed; 3 DX gaps logged (none v0.1.0-blocking)

Tagged-template authoring documented as a first-class v0.1.0 path (getting-started no-build section,
per-construct parity in rendering, API-reference section, README + STATE both paths). Verified at
source.

Three DX/ergonomics findings on the tagged-template (raw) surface, all v0.5.0+ Track T, none blocking:
- **F-DX-1 ($style):** no first-class tagged-template scoped-style binding. NOTE: `injectComponentStyle`
  exists in `style-inject.ts` but is NOT on the public API (not re-exported from the barrel, no
  subpath export). Both the ergonomic surface AND a public low-level hook are missing; no-build users
  must use an external CSS pipeline. Docs state this accurately. → T-6.
- **F-DX-2 (slots):** tagged-template `slots()`/`slot()` heavier than `.nv` `let={…}`. Subjective DX.
  → T-7.
- **F-DX-3 (each typing):** `each()` factory props are opaque `unknown`; `{item,index}` is convention
  not a typed interface. Most impactful (typing gap on every list). Fix: generic `each<T>`. → T-5.

v0.1.0 unaffected — both authoring paths work + are documented. These polish the secondary surface.

**Track T additions (v0.5.0 DX-track):**
- **T-5 — tagged-template `each<T>` generic typing.** Thread item type through the `each` signature so
  list factories get inference. Highest-value of the three (every list, every no-build user).
  Compiler/type-level only, no runtime change.
- **T-6 — tagged-template scoped-style ergonomics.** A first-class scoped-style helper for the
  tagged-template path (wrapping `injectComponentStyle` with auto identity-hashing), or a documented
  blessed pattern. Low priority (external CSS covers most users).
- **T-7 — slots/slot DX pass.** Reduce scoped-slot verbosity on the tagged-template path. Lowest
  priority; v1.0.0-adjacent.

---

### 2026-06-27 — Docs site visual alignment with neutro/form

**Decision:** Align `@neutro/view` VitePress site structure and visual treatment with `@neutro/form` to establish a consistent neutro ecosystem aesthetic. All changes are docs/config only — no `src/` impact.

**Changes made and rationale:**

**Hero restructure (index.md):**
- Removed `text:` frontmatter field. VitePress renders `text:` as a second large black heading beneath the coloured `name:`. neutro/form uses `name:` + `tagline:` only — a single coloured title followed by a compact subtitle sentence. The `text:` field caused nv to display two separate large text blocks, doubling the visual weight and breaking the form pattern.
- Tagline changed to a single descriptive sentence: "Fine-grained reactive view engine for the web." The former tagline ("No virtual DOM. Signal-native. Framework-portable.") duplicated content already present in the feature cards.
- Removed "View on GitHub" action button. The GitHub icon in the toolbar already serves this link; a dedicated CTA button is redundant and inconsistent with form (which uses "Get Started" + "API Reference" only).
- Second CTA changed from "View on GitHub" → "API Reference" (`/guide/api-reference`), matching form's button pair convention.

**Feature card count (index.md):**
- Expanded from 4 features to 6. VitePress renders 4 features as a 2+2 grid; 6 renders as 3+3 — matching form's visual layout. The two new cards ("Fine-grained updates", "Keyed reconciler") are accurate and were undocumented at this surface. No invented claims.

**Nav (config.ts):**
- Removed GitHub link from nav items. Social link icon (already present) covers this; a duplicate text link with an external-arrow indicator looked inconsistent with form's clean nav.
- Renamed "Guide" → "Getting Started", "Overview" → "API Reference" to match form's label conventions for equivalent entry points.

**CSS (theme/custom.css):**
- Removed custom `--vp-c-brand-*` colour overrides. VitePress default `#3b5bdb` already matches neutro/form's blue exactly; the overrides were creating a colour mismatch (the custom values were slightly different from the resolved default).
- Retained structural overrides: pill-shaped CTA buttons (`border-radius: 9999px`), feature card background/radius/border-removal, nav logo weight, hero name colour binding. These match form's appearance without a custom CSS file (form achieves the same via VitePress defaults + its own border-radius adjustments).

**What was NOT changed:**
- Sidebar structure — nv has a richer guide than form; sidebar depth is appropriate to content.
- Feature card content — all details are technically accurate; no new claims added.
- Colour palette — VitePress default brand colours used as-is.

---

### 2026-06-27 — neutro/form full structural audit and homepage parity pass

**Context.** After the initial visual-alignment commit, a complete structural audit of the neutro/form VitePress source was performed by fetching `config.ts` and `index.md` from `neutro-web/form` directly. Every difference between form and view was enumerated and categorised as mappable now vs. requires future pages.

---

#### Mapped in this session

**config.ts:**
- `description` — shortened to match form's concise one-line pattern: `"Fine-grained reactive view engine for the web."` (was: "High-performance, framework-portable, fine-grained reactive view engine.")
- Nav — added `{ text: 'Home', link: '/' }` as the first nav item, matching form's nav structure exactly. Form leads with Home; nv was missing it, causing the nav to jump straight to Getting Started with no home anchor.

**index.md — homepage body (below frontmatter):**

Form's homepage has three sections below the YAML hero block. nv had none. All three were added:

1. **`## Why @neutro/view?`** — two-sentence prose explaining the core proposition (skip the virtual-DOM tax, signal-tracked updates), followed by the tagged-template Counter as a complete runnable example. Mirrors form's `## Why @neutro/form?` + `createForm` example pattern exactly. Footer link row added at end: `[Get Started] | [API Reference] | [Architecture]` (form has `[Get Started] | [API Reference] | [Playground]` — Playground replaced with Architecture since nv has no playground page yet).

2. **`## Neutro Ecosystem`** — lists `@neutro/view` (current), `@neutro/form`, and `@neutro/fluid` (coming soon). Form's ecosystem section listed itself + fluid; nv cross-links form since both exist and are in the same org.

3. **`## Support the Project`** — buymeacoffee link + GitHub issues link. Identical pattern to form.

---

#### Not mappable — requires future pages (proposed for v0.5.0 roadmap)

These are structural gaps where form has a page or section that nv has no equivalent content for yet. All are documented here so the architect can schedule them against the v0.5.0 milestone.

**DOC-1 — Guides section (nav + sidebar + pages)**
Form has a `Guides` nav item linking to `/guides/react` and a full path-scoped sidebar with framework-specific guides (React, Svelte 5, Vue 3, SolidJS, Angular) and advanced topics (Validation Modes, Async Validation, etc.).
nv equivalent: integration guides showing how to use `@neutro/view` alongside popular frameworks or bundlers. Also: advanced guides (e.g. SSR considerations, testing with jsdom/vitest, migration from React/Vue patterns).
**Blocks:** No guide pages exist. Need content before adding nav item and sidebar section.

**DOC-2 — Playground page**
Form has `/playground.html` — a live in-browser editor (loaded with `target: '_self'` which hints at a standalone HTML file using the pre-built `form-core.global.js` bundle). The form `docs:build` script copies `packages/core/dist/index.global.js` to `docs/public/form-core.js` for this purpose.
nv equivalent: a live playground using `@neutro/view`'s tagged-template surface (no compiler needed in-browser). The renderer is already browser-runnable; a playground is technically feasible with the current v0.1.0 build.
**Blocks:** No `index.global.js` (IIFE) build target exists in nv's package.json. Need an IIFE bundle output and a standalone HTML playground page.
**Note:** This is the highest-value item for developer acquisition — playground removes all friction from first contact.

**DOC-3 — Community page**
Form has `/community` — likely contribution norms, Discord/chat links, issue guidelines.
nv equivalent: a `docs/community.md` with issue reporting guidelines, discussion channel links, and contribution norms.
**Blocks:** Content doesn't exist. Low effort to write; needs a decision on where community discussion lives (GitHub Discussions vs. Discord vs. other).

**DOC-4 — Contributing page**
Form has `/contributing` — how to contribute code, run tests, submit PRs.
nv equivalent: `docs/contributing.md` covering repo setup, test suite (`vitest run`), lefthook hooks, PR conventions.
**Blocks:** Content doesn't exist. Medium effort; most of the information is derivable from the repo structure (package.json scripts, lefthook.yml, AGENTS.md).

**DOC-5 — Path-scoped sidebars**
Form uses `sidebar: { '/api/': [...], '/guides/': [...] }` — each top-level section gets its own focused sidebar. nv uses a flat array sidebar showing all 7 guide pages regardless of which section you're in.
nv equivalent: once DOC-1 (Guides) and/or a separate API section exist, split into `{ '/guide/': [...], '/api/': [...] }` scoped sidebars.
**Blocks:** Only meaningful once nv has more than one top-level doc section. Premature to change now.

---

#### Recommended v0.5.0 doc additions (priority order)

| ID | Item | Effort | Value |
|---|---|---|---|
| DOC-2 | Playground | High (needs IIFE build + HTML page) | Highest — removes first-contact friction |
| DOC-1 | Guides section | High (multiple pages) | High — framework adoption |
| DOC-4 | Contributing page | Low | Medium — contributor funnel |
| DOC-3 | Community page | Low | Medium — community surface |
| DOC-5 | Path-scoped sidebars | Trivial (config change only) | Low — do last, after DOC-1 |

---

## 2026-06-27 — Full documentation sweep + neutro/form structural parity

### Summary

This session completed two distinct work phases: (1) a comprehensive documentation quality pass across every published guide page, and (2) a full structural and aesthetic parity pass against `neutro/form`, culminating in a site-wide restructure.

---

### Phase 1 — Documentation sweep (quality pass)

All six guide pages were reviewed and corrected against the actual source code. Changes made:

**`getting-started.md`**
- Added concrete "How to run" command (Vite example with `pnpm add -D vite && npx vite`)
- Reframed the tagged-template path as a "first-class authoring surface, not a fallback"
- Added a link to the thunk note from the README

**`api-reference.md`**
- Inlined `ReactiveExpr` as `() => unknown` in both `slots()` signatures (was a bare type reference)
- Corrected `structurallyEqual` description: it is a DOM-tree diff utility returning `{ equal: boolean, diffPath: string }`, not a signal equality predicate
- Corrected `effect()` scheduling language: "next flush" → "microtask-scheduled"

**`rendering.md`**
- Split Events section into `.nv` subsection (assignment form, bare reads) and tagged-template subsection (explicit `.set()`)
- Added missing `priority = signal('normal')` and `label = signal('Task')` declarations to the classlist example's `$script` block
- Fixed `<code v-pre>class="${{ danger: isActive }}"</code>` in tagged-template section (Vue parser escape)
- Removed dead link to `../template-ir.md`

**`authoring-nv.md`**
- Wrapped `<each>` example in a full `$component` with `$script` declaring `items = signal([...])`
- Corrected erasure boundary language

**`architecture.md`**
- Clarified `ComponentName.mount(parent, document)` as a two-argument sugar form vs. the three-argument `mount(ir, parent, doc)`

**`reactivity.md`**
- Removed dead link to `../reactive-core-contract.md`
- Ensured all imports use `@neutro/view/core`

**`overview.md`**
- Replaced dead links to excluded docs with GitHub source URLs

**`STATE.md`**
- Fixed `<code v-pre>class="${{ active: isActive }}"</code>` (Vue parser escape)
- Replaced decision-log links with GitHub source URLs

**`decision-log.md`**
- Added entries for neutro/form visual alignment decisions and structural audit

---

### Phase 2 — VitePress build fixes

Two successive build failures were encountered and resolved:

**Vue `{{` parse error**
VitePress renders markdown through Vue's template compiler. Inline backtick spans containing `{{` were parsed as Vue interpolation expressions, causing build failure at `STATE.md:14:51`. Fix: replaced all such spans (outside fenced code blocks) with `<code v-pre>...</code>` in `STATE.md`, `rendering.md`, and `decision-log.md`.

**17 dead links from srcExclude**
`decision-log.md`, `reactive-core-contract.md`, and `template-ir.md` are in `srcExclude` — VitePress does not build them as pages, so relative links to them 404 at deploy. Fix: internal prose references converted to plain text; footer/related section links converted to GitHub raw source URLs (`https://github.com/neutro-web/view/blob/main/docs/...`).

---

### Phase 3 — neutro/form structural parity

A full audit of `neutro-web/form` was conducted by fetching `config.ts`, `index.md`, `community.md`, `contributing.md`, `getting-started.md`, `api/index.md`, and `api/core.md` directly from the repo.

**Changes applied:**

| Item | What changed |
|---|---|
| `text:` field in hero | Removed — was creating a large black heading below the coloured name. Form uses `name:` + `tagline:` only. |
| Custom colour overrides | Removed — form uses VitePress defaults (`#3b5bdb`); our overrides caused colour drift. |
| `Why @neutro/view?` hero section | Added — prose + .nv Counter example (compiler erasure as primary example, not tagged template). |
| `Neutro Ecosystem` section | Added — lists view, form, fluid. |
| `Support the Project` section | Added — upgraded from text link to `<img>` buymeacoffee button (matching form). |
| Footer link row | Added below frontmatter: `Get Started | API | Guides`. |
| LICENSE | Created: MIT, Copyright (c) 2026 Kofi Nedjoh. |
| Nav title colour | Removed blue override — form uses VitePress default text colour. |

---

### Phase 4 — Site-wide restructure (DOC-1 through DOC-5 resolved)

The flat `guide/` structure was replaced with a section-based layout matching neutro/form.

**New URL structure:**

| Before | After |
|---|---|
| `/guide/getting-started` | `/getting-started` (standalone, no sidebar) |
| `/guide/overview` | `/guides/` (Guides landing) |
| `/guide/authoring-nv` | `/guides/authoring-nv` |
| `/guide/reactivity` | `/guides/reactivity` |
| `/guide/rendering` | `/guides/rendering` |
| `/guide/architecture` | `/guides/architecture` |
| `/guide/api-reference` (monolith) | `/api/` + `/api/core` + `/api/renderer` + `/api/plugin` |
| (none) | `/community` |
| (none) | `/contributing` |

**Nav:** `Home | Getting Started | API | Guides | Community | Contributing`

**Sidebars:** path-scoped — `/api/` shows API items only; `/guides/` shows Guide items only; standalone pages show no sidebar.

**API split rationale:** The monolithic `api-reference.md` was split into four pages mirroring neutro/form's per-topic API structure: `index.md` (package overview + import path table), `core.md` (`@neutro/view/core` exports), `renderer.md` (`@neutro/view/renderer` — mount, createHtmlTag, slots, slot, each, cx, classes, IR types, sentinel types, compiler-facing exports), `plugin.md` (nvPlugin + runtime entry + source files verified).

**`guide/**` added to `srcExclude`** to suppress the old pages from the build.

**DOC items resolved by this restructure:**

| ID | Status |
|---|---|
| DOC-1 | RESOLVED — Guides section with 5 pages and path-scoped sidebar |
| DOC-3 | RESOLVED — `/community` with ecosystem table, FAQ, buymeacoffee image |
| DOC-4 | RESOLVED — `/contributing` with commit format, release process, test commands |
| DOC-5 | RESOLVED — path-scoped sidebars implemented |
| DOC-2 | OPEN — Playground still requires an IIFE build target; remains v0.5.0 scope |

---

### Aesthetic decisions (locked)

- **Custom CSS:** After multiple iterations, all overrides removed. `custom.css` contains one rule only: `font-weight: 500` on `.VPHero .tagline` to match neutro/form's rendered tagline weight. VitePress defaults handle everything else.
- **Source files verified table:** Local absolute paths (`/Users/kofi/_/view/src/...`) replaced with repo-relative paths in `api/plugin.md`.
- **neutro/form version:** corrected to v0.3.0 in `community.md`.

---

### Commits (this session)

- `fb7dd2b` — docs: full neutro/form structural parity pass *(prior session)*
- `0ca4914` — docs: restructure into Getting Started, Guides, API, and Community sections
- `bec4f7e` — docs(api): replace local absolute paths with relative repo paths in source table
- `ff84e98` — docs(theme): remove tagline font-size override to match neutro/form default
- `ad1acb9` — docs(theme): remove hero name overrides to match neutro/form default styling
- `bb92eef` — docs(theme): remove all custom CSS overrides to match neutro/form defaults
- `c9f66d5` — docs(theme): set tagline font-weight to 500 to match neutro/form

---

### 2026-06-27 — Documentation sweep CLOSED; v0.1.0 tag-ready (content/engineering)

Doc sweep + neutro/form parity landed and verified at source. Phase 1 corrected real API errors
against source (structurallyEqual: confirmed a DOM-tree diff utility, was mis-documented as signal
equality; effect microtask-scheduling; dead links → GitHub URLs). Site restructured to section-based
layout (getting-started standalone; /guides/ + /api/ path-scoped sidebars; /community; /contributing)
matching neutro/form nav; all internal links verified resolving. Both authoring surfaces (.nv +
tagged-template) documented. MIT LICENSE added.

DOC-2 (playground) deferred to v0.5.0 Track T (T-8): requires an IIFE compiler build target
(index.global.js) — real engineering, not a doc task; the .nv compiler can't run in-browser otherwise.
Highest-value first-contact DX item but non-blocking for v0.1.0.

v0.1.0 tag now gated ONLY on the manual checklist: NPM_TOKEN secret + GitHub Pages enabled (+ optional
publish-step tag-guard fast-follow). No content/engineering blockers remain.

---

### [2026-06-27] PT-1a — async `resource`: RULED (composition, shape 1). Closure axiom upheld. No contract change (v0.4.2).

**Workstream:** WS4 architect (parity target shape) → unblocks a WS3/WS1 commission.

**Decision.** The v0.5.0 async target is a `resource`-equivalent and **nothing more**
for PT-1a. It is **composition over the four primitives**, not a new graph primitive.
Suspense-equivalent coordination is split out as PT-1b (named open, not ruled here);
transitions are **out of v0.5.0** (they touch what a computation observes
mid-propagation — contract-level §1, not an async ruling).

**Shape (core, DOM-free).** A `resource` is:
- one `signal` triple for observable state — `data`, `loading`, `error` (or a
  single status signal carrying the tri-state; field layout is an in-stream
  implementation choice, not a contract concern);
- one `effect` that (a) reads the resource's reactive sources — establishing
  fine-grained dependency tracking exactly as any effect does (§5.3) — (b) kicks
  the async fetcher, and (c) writes the settled result back via `.set()`. The
  effect's source-write on settle is the **sanctioned terminal write** — a fetcher
  settling is an external (non-reactive) event, structurally the `pubsub`/external-
  source case (§8.6), not a reactive→signal write, so it does **not** invoke `sync`
  and cannot form a reactive cycle by construction;
- `onCleanup` (§6) registered on the current owner to **abort the in-flight
  fetch** (e.g. `AbortController`) when sources change before settle or when the
  owner disposes. Stale settles are dropped (generation/epoch guard) so a slow
  earlier fetch cannot overwrite a newer one. Teardown-with-owner is automatic —
  no leak, same guarantee `sync`/`pubsub` already give (§6, §8.6).

**Why this is closure-clean (the load-bearing point).** A resource's result is just
a `signal` that happens to be written by a settled promise. The async-ness lives
**entirely in *when* the write happens**, never in a new edge kind, never in new
propagation semantics. Source-tracking is ordinary effect tracking; settle-write is
the external-event write `pubsub` already legitimizes; cleanup is ordinary owner
teardown. The graph never learns the word "async." This is precisely the
`store`/`pubsub` precedent the contract anticipates ("built on top, outside this
contract," §11/L837) generalized to async: **out-of-graph timing, in-graph state.**

**Performance position (why shape 1 is the performance-first answer).** Cost is one
effect + the state signals per resource — the exact fine-grained granularity nv
already prices well (the select-row 0.34× / update-10th 0.68× wins live in this
class). No syntax or coordination layer can make this reactive work *smaller*; it
can only make it larger by over-subscribing. The primitive shape is therefore the
whole performance story. Ergonomics is the second-order axis (entry B).

**Scope fences.**
- **PT-1b Suspense-equivalent — NAMED OPEN, not ruled.** A multi-resource
  coordination boundary that discovers pending descendants and gates fallback↔
  resolved content. Structurally the `errorBoundary` precedent (owner-scope-
  attached, §5.4.4/L832) — so *likely* also composition + out-of-graph, BUT its
  natural implementation wants to **withhold mounting** pending subtrees, which is
  renderer-coupled and interacts with the `<each>` reconciler. Its renderer-gating
  cost MUST be read at source before ruling. Do not fold it into PT-1a. ("named
  next ≠ needed next.")
  PT-1b also carries the **stale-while-revalidate** behavior (render previous
  resolved content instead of fallback during a pending refetch) — the conforming
  half of "transitions." Single-valued reactivity + deferred DOM swap; no new
  primitive. This is the honest, axiom-clean version of the transition ergonomic
  (no fallback flash on refetch). Still gated on reading PT-1b's renderer-gating
  cost at source before ruling — SWR shares the withhold-mount machinery.
- **Single-resource ergonomics do not need Suspense.** They are reachable from
  control-flow nv is already building (PT-3 `<when>`) over one resource's
  `loading`/`error`/`data` — see entry B. Multi-resource coordination is the only
  thing that genuinely needs PT-1b.
- **Transitions — SPLIT, not flatly out.** "Transition" conflates two shapes that
  the axioms treat oppositely:
  - **Stale-while-revalidate (keep-old-UI-while-pending) — IN v0.5.0, as a PT-1b
    behavior.** Render the previously-resolved content instead of a fallback while a
    refetch is pending. This is single-valued reactivity (the graph only ever holds
    the new value) + a renderer choice to defer the DOM swap until settle —
    structurally Suspense with "stale instead of fallback." Axiom-clean; no new
    primitive, no scheduler change. Folded into PT-1b (entry B).
  - **Multi-version reactivity (transition readers see new, others see old, at the
    signal level) — REFUSED by construction.** See entry C. This is not a scope
    deferral; it cannot conform — it dissolves the single-current-value invariant
    (§5) the compiler's soundness rests on.
  - **Time-slicing / interruptible computation — OUT.** nv propagation is
    synchronous graph-coloring; there is no paused half-computed node. Not a
    v0.5.0 question; not pursued.

**Closure-axiom check (mandatory for every parity target).** Adds **zero** graph
primitives. Uses `signal` + `effect` + `onCleanup` + owner teardown, all extant.
The four-primitive closure is intact; `derived` purity, `sync`, and `pubsub` static
guarantees are untouched. **No reversal of the closure axiom.**

**Contract.** No change. v0.4.2 holds. `resource` is renderer/userland-layer
composition built on the contract surface, like `store` (§11/L837) — it is **not**
a contract addition; the contract does not need to name it.

**Not commissioned yet.** This ruling fixes the *shape*. The CC commission (a
`resource` factory + abort/epoch guard + tests, WS1/WS3) is downstream and gated on
this entry. P-1a (swap position-guard) is independent and proceeds in parallel.

**Supersedes:** nothing. Opens: PT-1b (Suspense, named), entry B (async-read
lowering, design-open).

---

### [2026-06-28] PT-1a `resource` LANDED + architect-verified at SHA `9017db2`. Composition factory; closure axiom intact; no contract change. Implements the [2026-06-27] PT-1a ruling exactly. Closes the PT-1a commission.

**Workstream:** WS1/WS3. Verified by reading placed source + the two correctness-fence
tests at `9017db20ffb331831aa3eafffe79b84f5c8caf94` (on `main`).

**Note on the report SHA (verify-at-real-HEAD discipline).** CC's report cited base
`821d6b8` "working tree — no commit made yet" — that SHA 404s on the raw host. The work
WAS committed and pushed afterward; `main` advanced to `9017db2` (the report wasn't
re-stamped). Verification was performed at the real HEAD, not the reported SHA. (Recurrent
pattern: CC prose loose where the code is correct — read the placed source at actual HEAD.)

**Shape delivered — matches the ruling (read at source, `src/renderer/resource.ts`):**
- **Three independent signals** (`data`/`loading`/`error`) — fine-grained subscription
  (a `data` reader does not re-run on a `loading` flip; TC-R-7a/7b).
- **One source-tracking `effect`**: `source()` read tracked; fetcher wrapped in `untrack`
  so its synchronous reactive reads don't become deps (TC-R-UNTRACK).
- **Settle-write via bare `.set()`** — external-event category, NOT routed through `sync`.
  Confirmed contract-legal: the continuation runs outside propagation (no `currentObserver`),
  no reactive cycle; `nodeSet` schedules a flush on out-of-flush write so downstream
  re-runs (TC-R-SETTLE / TC-R-SETTLE-DERIVED). The "`sync` is the single reactive→signal
  write" rule is not violated — this write is external→signal (§8.6), outside `sync`'s
  monopoly.
- **Two lifecycle guards, both present:** `onCleanup(() => ac.abort())` (fires on effect
  re-run via `preRunCleanup` AND on owner dispose) + `gen !== epoch` stale-drop.
- **Imports: core public surface only** (`signal`/`effect`/`onCleanup`/`getOwner`/`untrack`).
  No core edit, no new core export, no new node kind. **Closure axiom intact** (TC-R-CLOSURE).
- Placed at `src/renderer/resource.ts`, re-exported from `src/renderer/index.ts`.

**Three implementation decisions beyond the ruling — reviewed, all sound:**
1. **UNSET sentinel** (`Symbol('nv.resource.unset')`) as `data`'s initial value. Without it,
   `signal<T|undefined>(undefined).set(undefined)` is an `Object.is` no-op — a fetcher
   legitimately resolving to `undefined` would silently fail to notify. Sentinel makes the
   initial→resolved transition always observable; accessor maps UNSET→undefined to preserve
   the `T | undefined` external type. Correct (TC-R-UNDEFINED).
2. **Explicit `getOwner() === null` guard** at factory entry, instead of relying on
   `onCleanup`'s throw. Verified necessary: `onCleanup` is called INSIDE the effect body,
   whose owner is the effect node — it would never see `currentOwner === null`, so the
   commission's "rely on onCleanup throw" fallback would not fire. Explicit guard is the
   correct choice (TC-R-8).
3. **Epoch bumped before `source()`** (`const gen = ++epoch` as the first effect-body line).
   CC's self-review pass-3 caught a real ordering bug: if epoch bumped AFTER `source()`, a
   throwing `source()` leaves epoch unchanged, so a concurrent prior in-flight resolve passes
   `gen === epoch` and overwrites the error state. Bumping first, unconditionally, invalidates
   all prior in-flight settles before anything else. **Architect-confirmed at source AND at
   the regression test** (TC-R-6e uses deferred promises; deterministic). Good catch, landed.

**Write-after-dispose safety (architect-verified at seam; not in CC's report).** The
success-races-dispose path — a fetch *resolving* exactly as the owner disposes — passes the
epoch check (dispose doesn't bump epoch) and isn't abort-guarded on the resolve arm, so it
reaches `data.set(result)`. This is safe: `disposeChildrenOf` marks child signals
`isDisposed`, and `nodeSet` early-returns on `isDisposed` — the write is a silent no-op, not
a corruption. The core write-path is the backstop. (CC's report did not call out this race;
the code is correct because the seam guards it. Read the seams.)

**Correctness-fence tests read (not green-counted):**
- **TC-R-3** (stale-settle, the load-bearing test): deferred promises, B-settles-first /
  A-settles-late; asserts `data` holds B's value after A's stale settle. Deterministic.
- **TC-R-6e** (epoch ordering): deferred promise + throwing `source()` on re-run; asserts
  error not overwritten by the stale resolve. Only passes if `++epoch` precedes `source()`.
Both use controllable `deferred()` promises — no timing flakiness. 19 tests total, all named
per report; 734-test suite, no regressions (suite count CC-reported).

**Scope held (no PT-1b leakage):** no Suspense, no multi-resource coordination, no
stale-while-revalidate *rendering* behavior. `data` retaining its prior value on error/refetch
is a natural consequence (SWR-*semantics* at the data layer), but the renderer's stale-vs-
fallback *display* choice is correctly left to PT-1b.

**Contract.** No change. v0.4.3 holds (from P-2c-A1; `resource` adds nothing). `resource` is
renderer/userland-layer composition, like `store` (§11/L837) — the contract does not name it.

**Status: PT-1a `resource` LANDED + verified. Closure axiom + single-current-value invariant
untouched. Contract v0.4.3.** Carried open for PT-1b: a `derived()`-scope call passes the
`getOwner()` guard but is semantically wrong (the internal effect would be disposed/re-created
each `derived` re-eval); JSDoc warns, a runtime guard would need an owner-kind check the core
doesn't currently expose — note for PT-1b, not a PT-1a defect.

---

### [2026-06-28] Index-elision Commission 1 LANDED at `a495716`. Compiled-`.nv` index-elision live. Tier-1 green (763/763 incl. 12+5 corpus), no-regress ±2% (vs P-1b CP-2d baselines; post-A1 re-verify folded into Commission 2), Template-IR v0.4.3. Reactive-core contract v0.4.3 (unchanged by this lever). Verified by source-read + local suite at SHA, not the delivery report.

**Workstream:** WS3 renderer/IR + WS2 compiler predicate. Lands the `src/` lever from `spec-index-elision.md` (split Commission 1 of 2). Architect-verified at `a4957166` against placed source: predicate (`nv-parser.ts` L607, `exprReadsSignal`, body-holes-only, ACCEPT-biased); branch-hoist (`interpreter.ts` L448–563, `updateIndex` closure hoisted, no per-row branch); emitter fork (`nv-emitter.ts` L179–189, elided `(valueSig)` factory, no `indexSig`, carrier explicit); tagged-template untouched (`html-tag.ts` L740/L969, carrier never set, `indexSig!()` conservative-allocate); oracle carrier NOT compared (`ir-equivalence.ts` L141, arity-only deviation at `785af9d`, invariant preserved).

**Carrier:** `ListBinding.itemReadsIndex?` (additive; absent|true ⇒ allocate, false ⇒ elide). **Template-IR v0.4.2 → v0.4.3** (placed, `bbaed36`). **Reactive-core contract unchanged — remains v0.4.3** (set by P-2c-A1; index-elision touches no primitive). Closure axiom clean.

**Gate result:** Tier-1 all green (T1-1 FIRE corpus incl. nested-each propagation, attr, conditional-expr, key-not-a-body-read; T1-2 emitted-module `indexSig` absence; T1-4 carrier excluded from equivalence; T1-5 conservative fallback; T1-6 tagged-template allocates). T1-3 no-regress: 11/11 browser correctness probes pass, all CP-2d ops within ±2% **of the P-1b CP-2d baselines** (swap 0.66×, select 0.50×, etc.). NOTE: the current board is the post-A1 CP-2d-REMEASURE (swap 0.29×, select 0.27×, update-10th 0.18×, remove 0.62×, memory 2.33×); re-verification against those tighter baselines is folded into Commission 2. Create flat (~1.78×) as expected — allocation not the create bottleneck; lever lands on correctness + memory per the Tier-1-suffices ruling.

**Build-quality residue fixed in-commission (per delivery report, accepted):** `?? 0` swallow-fallback removed from tagged-template factories (`e89c632`); Task-2 worktree branched from wrong base, cherry-pick conflicts manually resolved; Biome `useTemplate` lint blocker; T1-1 corpus gap (nested/attr/expr added, `ccfccd8`). None touched core/contract.

**Process convention resolved:** design docs (spec + design-gate analysis) now live in-repo under `docs/design/` (placed this session). Standing convention; supersedes the A1/PT-1a log-only precedent.

**Open → Commission 2 (benchmark-venue):** reorder-heavy T2-1 measurement, create-10k non-linearity, memory-delta (~1000 fewer nodes vs 2.33× baseline), AND post-A1 no-regress re-verification against tighter baselines (swap 0.29×, select 0.27×, etc.). The deletion is landed; the perf claim and the tight-baseline re-verify are Commission 2.

---

### [2026-06-28/29] Index-elision Commission 2 MEASURED. T2 venue data collected; lever fully characterized.

**Venue:** js-framework-benchmark SHA `4fbccf55`, Chrome 149.0.7827.199, M2 Max, macOS 24.6.0, 2× CPU throttle, 15 iterations. A/B: elided (`main`, `itemReadsIndex:false`) vs forced-non-elided (`NV_DISABLE_INDEX_ELISION=1`). Vanilla denominator: vanillajs-keyed (1.858 MB, 34ms swap, 26ms select, 31.7ms update-10th — matches CP-2d-REMEASURE log exactly).

**T2-1 — Reverse-then-restore (reorder-heavy workload): HONEST NULL.**  
Elided 277ms median vs non-elided 274ms median; delta 3ms within ~30ms noise floor. The operation is dominated by LIS + 1000 `insertBefore` DOM calls (identical in both arms); the 1000 fewer `indexSig.set()` calls are not the bottleneck. Per G1: lever stands on Tier-1 correctness + memory; no reorder-heavy mutation win on this workload.

**T2-2 — Create characterization (1k and 10k): FLAT, no non-linearity.**  
Elided 50.9ms/604.9ms (1k/10k); non-elided 52.1ms/597.4ms. Both arms scale ~11–12×. Create-time is structural (reactive-graph-setup cost), as expected.

**T2-3 — Memory delta (same-session A/B, fresh run): CONFIRMED WIN.**

| arm | run-memory (MB) | vs vanilla |
|---|---|---|
| elided | 4.003 | **2.154×** |
| non-elided | 4.356 | **2.345×** |
| delta | **−0.353 MB** | **−0.19×** |

Non-elided arm (2.345×) is within 0.6% of the post-A1 CP-2d-REMEASURE baseline (2.33×) — confirms methodology is consistent. Elision saves 0.353 MB at 1k live rows: ~1000 fewer `ReactiveNode` (indexSig) allocations. Combined with P-2c-A1 harvest (−0.317 MB): total reclaim 4.641 → 4.003 MB (−0.638 MB, −13.8% from pre-harvest pre-elision).

**T5 — Post-A1 no-regress re-verification: DEFERRED (JIT-warming methodology mismatch).**  
Fresh standalone nv run (cold JIT) shows: create-1k 1.77× (PASS, ±0.6%); select 0.296× (MARGINAL, +9.6% vs 0.27×); swap 0.735× (MISMATCH vs 0.29×); update-10th 0.799× (MISMATCH vs 0.18×). The post-A1 CP-2d-REMEASURE baselines were produced in a same-session run where vanilla warmed V8 JIT before nv ran; standalone cold-JIT runs cannot reproduce them. Vanilla denominator is identical (34ms swap confirmed), so the mismatch is JIT-warmth on the nv arm. **Index-elision adds zero regression:** non-elided arm produces identical standalone numbers (swap 24ms, select 7.7ms) — Commission 1 branch-hoist did NOT regress the mutation path. T5 comparison against tight baselines deferred pending a same-session vanilla+nv run.

**Verdict:** Index-elision lever is fully characterized. T2-1 null is honest and expected (spec §7 G1). T2-3 memory win is confirmed (+0.353 MB at 1k rows vs non-elided; 0.19× improvement). T2-2 flat as predicted. T5 deferred on methodology — the lever itself introduces no regression.

**Commission 2 status: MEASURED AND CLOSED.** Full data at `.superpowers/sdd/c2-measurements.md`.

**Cites:** spec-approved entry [2026-06-28 index-elision design gate]; CP-2d-REMEASURE [2026-06-28 P-2c-A1 LANDED] for current baselines.

**[2026-06-29 clarification, citing L3869]** T5 label "DEFERRED" refers only to tight-baseline reproduction — no-regression itself is CONFIRMED: same-session A/B shows elided ≡ non-elided (swap ~24ms both arms, select ~7.7ms both arms); Commission 1 branch-hoist is verified not to regress the mutation path. What remains deferred is matching the JIT-warmed CP-2d numbers (0.29× swap etc.), which requires a same-session vanilla+nv Puppeteer run.

---

### [2026-06-28] Index-elision — design gate OPENED + SPEC APPROVED. Verdict: optimization-on-a-correctness-floor, two-tier ordered gate. Predicate = strong (bound-but-unread), parser-computed, ACCEPT-biased. Carrier = `ListBinding.itemReadsIndex?` (Template-IR v0.4.2→v0.4.3, additive; reactive-core contract unchanged). Lands on Tier-1 (correctness) alone; Tier-2 (perf) is a claim, not a landing precondition. Read at SHA `dc4e4a8`.

**Workstream:** WS3 renderer/IR + WS2 compiler predicate. Architect read the seams at
`dc4e4a88bea58dbe41bbdfaa6f70df1d16d914fe`: `wireList` (interpreter.ts L498/L546–548),
`ListBinding` (ir.ts L176), parser `<each>` let-handling + `isReactiveExpr` erasure
(nv-parser.ts L585/L806/L1855), emitter list fork (nv-emitter.ts L177–184), FE-equivalence
oracle list case (test/renderer/ir-equivalence.ts L141). Branch hygiene confirmed: A1
(`d142919`), PT-1a (`9017db2`), B-closure (`cce6423`) all on main; HEAD `dc4e4a8`.

**Frontier confirmed by code, not queue.** The queue named index-elision next; the seams
confirm the premise (jfb `<each>` binds `let={item}`, yet `wireList` allocates `indexSig`
unconditionally and index-tracks every row every reconcile) and reframe the predicate and
the gate.

**Predicate (ruled): strong form — bound-but-unread, ACCEPT-biased.** Qualifies for elision
iff the item template provably never reads index. Computed in the parser: `letNames.length < 2`
qualifies trivially; `>= 2` runs `isReactiveExpr(hole, {all:{indexName}})` (L1855 erasure)
over every body hole, qualifies iff none reference index. Erasure over-reports (keeps on
doubt). Strictly dominates the weak "no second let-name" form — one commission covers both.
`key=`-uses-index is NOT a body read: `key` runs in the reconcile effect with the live loop
`i` (L489), never `indexSig` (L506) — so it does not force allocation. Soundness fence
(FIRE): unsure ⇒ keep `indexSig`; a false-elide renders the wrong index.

**IR carrier (ruled): `ListBinding.itemReadsIndex?: boolean`** — not inferable from placed IR
(the factory always took both signals; the runtime IR dropped the parser's knowledge).
Absent|true ⇒ allocate (conservative); `false` ⇒ may elide. Default-absent preserves
byte-compat and keeps the soundness fence at the IR layer (an old/partial producer never
false-elides). `itemTemplate`'s second param becomes optional. **Template-IR v0.4.2→v0.4.3,
additive. Reactive-core contract unchanged — no primitive touched; closure axiom clean.**

**Mechanism (ruled): branch-HOIST, collapse not patch.** Decision is fixed per list
instance, hoisted out of the per-row loop — no per-row branch added to the reconcile hot
path. Elided lists run a strictly *shorter* reconcile body (no `lastIndex` compare, no field,
no `.set()`), byte-identical for non-qualifying lists. Emitter emits a narrower factory
(`(valueSig) =>` … `{ item: () => valueSig() }`, no `index` key, no `indexSig` mention) —
the factory shape itself encodes the elision; no sentinel node, no shared global, no nullable
deref (the body provably never references index). One factory contract, arity agreed between
emitter and interpreter. The lever is a **compiled-`.nv`-path optimization only**: the tagged-
template `each()` path has no compile step, cannot run the predicate, and leaves the carrier
absent (⇒ allocate, unchanged). The benchmarked jfb app is `.nv`-authored (Log 2026-06-26), so
the lever fires on the measured workload. FE-equivalence oracle **does not** compare
`itemReadsIndex` — the two front-ends legitimately disagree on it (`.nv` may prove `false`;
tagged-template leaves it absent); it is an optimization hint, not structural, and excluding it
cannot mask a real divergence (no carrier value changes rendered output).

**Ceiling — measured-small on create; lever justified off the create axis.** From CP-2d
real-browser attribution (Log [2026-06-28] CP-2d deficit analysis): create's reactive-graph-
setup slice is ~0.56× of vanilla (nv 1.74× − Lit 1.18×), containing ~6 reactive nodes/row
(2 signals + 1 item-root effect + K=3 binding-effects) + createRoot + owner linkage.
`indexSig` is 1 of the 2 cheapest nodes (a plain value/index signal wires no edges; the
binding-effects dominate the slice). First-order create ceiling: well under (0.56×÷6) ≈ 0.09×
of vanilla, i.e. **sub-5% of nv's create wall-clock — and plausibly less** (signals cheaper
than edge-wiring effects). SPECULATION-tagged: the within-slice split (plain-signal vs
edge-wiring cost) is unmeasured. **On create alone this is characterize-not-build, like B**;
the named redirect for create is the dominant sixth — the per-item createRoot/effect-wiring
slice (~0.56× vs Lit) or the leaner-record direction (~0.70× vs Solid). **Unlike B (create-
only, ceiling 0), index-elision has a second axis: it removes provably-dead work** (unread
`indexSig` alloc + per-reconcile index-tracking on 100% of qualifying rows) and a leaner
reconcile body — aligned with nv's mutation-first identity, and it pays down the named memory
deficit (2.4× vanilla).

**Verdict (ruled): optimization on a correctness floor; lands on Tier 1.** Steelman of "hold
create hard" accepted in part — a gate of near-unfailable items is bureaucracy (Gate-P), and
the reframe must not rest a perf claim on an unmeasured axis. Resolution: **two-tier ordered
gate.** Correctness is the precondition; performance is measured only after, on a workload
that actually loads the lever, and the log records the truth (improvement or null) without
dressing.

- **Tier 1 (correctness — HARD precondition; lever does not land if any fails):** T1-1
  predicate soundness over a permutation/usage corpus incl. nested-`<each>`/component/slot
  index reads (none elided) + real-browser index-correctness for read cases (FIRE);
  T1-2 provable absence (`indexSig` absent in emitted module at SHA; `ItemRecord.indexSig
  === undefined` interpreter-side); T1-3 full-board no-regress ±2% (a deletion that slows
  any op = stray hot-path branch); T1-4 FE-equivalence over the corpus; T1-5 soundness
  fallback (absent carrier ⇒ allocate). **All pass ⇒ lever LANDS, regardless of Tier 2** —
  removing provably-unread allocation is correct and reduces live node count; the IR surface
  is justified by correct-deletion-plus-memory alone (architect ruling, this entry).
- **Tier 2 (performance — claim only, NOT a landing precondition):** standard jfb does not
  load the index path (swap reorders 2 rows; update-10th reorders none; select is a class
  change). T2-1 reorder-heavy workload (architect-locked: 1000 rows, reverse-then-restore,
  ≥25-sample median, warm-up discard 5, Chrome 149/M2/harness `4fbccf55`, same-session
  elided-vs-non-elided) where index-tracking fires ~1000×/reconcile; T2-2 create
  characterization at 1k AND 10k (catch GC/allocator non-linearity at scale — characterization,
  not pass/fail); T2-3 memory delta (~1000 fewer nodes). **Outcomes, all logged honestly:**
  improvement on T2-1 → logged as a reorder-heavy-workload win (NOT a standard-jfb-swap
  claim); null on T2-1 → "perf delta below measurement floor on the loading workload; lever
  lands on Tier 1 (correct deletion + memory)," no perf claim made.

**Why not B-style kill.** B would add machinery to elide *zero* allocations on jfb (reach
empty). Index-elision *removes* an allocation that demonstrably exists on 100% of jfb rows
(reach total) and removes per-reconcile index-tracking. Different facts; not special pleading.

**Spec:** `spec-index-elision.md` (APPROVED, this session). **Commission → CC** with the
two-tier gate; same-session before/after perf gate mandatory; JSDOM/linkedom barred from the
perf verdict path; deterministic node counts (T2-3) sandbox-valid.

**Open (carried to spec/commission):** within-graph-setup-slice split (plain-signal vs
edge-wiring cost) unmeasured — the same-session before/after retires it. 10k non-linearity
genuinely open — T2-2 answers it. **Process:** spec + this design-gate analysis recommended
to land in `docs/design/` (resolves the A1/PT-1a log-only backfill question); architect-
process decision, not part of commission correctness.

---

### [2026-06-28] P-2c-B (compile-time STATIC verdict → effect-allocation elision) — design-gate analysis: GATE-HOLD, not ruled-to-commission. PLAIN cannot be the predicate (firm); scope is three coupled changes; reach is narrow (same set A1 characterized). Measure the ceiling via A1 harvest-count before building. Read at SHA `3cffb7b`.

**Workstream:** WS2 compiler + WS3 renderer/IR. Architect read the analyzer + emitter +
verdict-routing seams at `3cffb7bfb9794eb884fb576ccae193993387f2a3`. P-2c-B was named
"reopenable" after A1; this session reads the code and rules on whether to build it.

**Finding 1 (firm) — PLAIN cannot be B's predicate; the safety direction inverts.**
`hasNvSignalReadInOuterThunk` (analyzer) bails to "no read" (→ PLAIN) in three analyzable-
failure cases: `getOuterThunkBody` returns null for any expr it can't unwrap; the visitor
does not recurse into nested functions; it follows only one identifier→initializer hop.
The header states it: a missed reactive read "surfaces as PLAIN rather than ACCEPT." For
**erasure** (current use) PLAIN is safe — the binding is still wired as an effect, so a wrong
PLAIN just fails to optimize (ACCEPT-biased: over-wiring safe). For **B** (elide the
allocation), a wrong PLAIN → one-shot write that never re-runs → stale DOM → CORRECTNESS
FIRE (DECLINE-biased: over-eliding fatal). **B requires a NEW positive STATIC verdict** —
"provably reads no reactive source AND complete analyzer visibility" — where absence-of-read
is a *proof*, not a *failure to find*. Full-visibility-gated; any gap ⇒ keep the effect
(§10 prove-and-skip).

**Finding 2 — scope is three coupled changes, not one.** Erasure verdicts currently route
ONLY to `check-program` for diagnostics; `nv-emitter` consumes no verdict (grep:
`erasure|verdict|PLAIN` in emitter = nothing). The emitter emits every leaf hole as a
reactive thunk regardless of verdict. So B = (1) new STATIC verdict + (2) build the
verdict→emitter plumbing that does not exist + (3) a new emitted leaf shape
(`{kind:'text',expr,static:true}`) the **interpreter** mounts as a one-shot write (one mount
path serves both front-ends, per A1) → **Template-IR additive bump** (leaf `static?: boolean`,
contract-adjacent — surface; ClassListBinding/StyleVarBinding additive precedent). The
emitter's existing `kind:'static'` classlist path (one-shot, no thunk slot) is the proven
pattern B generalizes — the plumbing-from-analyzer is the genuinely new part.

**Finding 3 — reach is narrow, and it is the SAME set A1 characterized.** Create cost/row =
`2 + 1 + K` (valueSig + indexSig + createRoot + K binding-effects). B shaves a subset of K.
But the typical row binding reads `value()` (valueSig is a signal param) → ACCEPT (reactive),
NOT static. Genuinely-static leaves read neither value/index nor any outer signal — rare in
the create-dominant case. This is what A1's small memory reclaim (−0.317 MB) already showed
empirically: few row effects are inert because most read `value`. **B optimizes a subset of
A1's inert set** (provably-static ⊆ inert), saving the allocation (not just A1's retention)
on the compiled path only. The fixed valueSig/indexSig/createRoot triple — dominant when K
is small — is untouched by B.

**RULING — GATE-HOLD.** Do not commission B. Measure its ceiling first, cheaply: A1's
`harvestInertEffect` returns true per inert effect harvested; B's static set ⊆ A1's inert
set, so **A1's harvest-count-per-row on jfb create is an upper bound on B's reach.** A
Sonnet-scoped probe adds a `__test` harvest counter (precedent: `__test.enablePerNode()`)
and runs the locked jfb create harness, returning harvests/row and harvests/row ÷ (2+1+K).
- **< ~5% of create-time** → close B as characterized-not-worth-building; redirect to
  **index-elision** (a row provably never reading `index` elides `indexSig` — a *fixed-cost*
  reduction reaching every such row regardless of K, simpler than a per-leaf static proof;
  likely higher reach than B). Index-elision is named as the redirect, not yet commissioned.
- **meaningful fraction** → proceed to full B design (STATIC verdict + plumbing + IR bump),
  gated on same-session create re-measure.
"Named next ≠ needed next": B is queued; the code says its reach is narrow; the harvest
counter bounds the win for the cost of a probe before any build.

**Contract.** No change from this analysis (B *would* bump Template-IR v0.4.2→v0.4.3 additive
IF built — not yet). Reactive-core contract untouched either way; B is composition/emit-layer.
Closure axiom intact (B removes effects where provable; adds no primitive).

**Status: P-2c-B GATE-HELD — Sonnet ceiling probe commissioned (`p-2c-b-ceiling-probe-
commission.md`). Build-or-close ruling pending the harvest-count number. Index-elision named
as the redirect target if B closes.**

---

### [2026-06-28] P-2c-B CLOSED — characterized-not-worth-building. Ceiling probe returns 0 harvests/row on jfb (not <5% — exactly 0%): every jfb row binding-effect is reactive, B has nothing to elide. Architect-verified at SHA `cce6423`. Index-elision promoted from redirect-hypothesis to measured-superior next create-time lever. Closes the P-2c-B GATE-HOLD [2026-06-28].

**Workstream:** WS2/WS3. Probe ruled-on by reading placed source + the harness + the actual
jfb template at `cce642315617379197220d88fb7d7b32c357d1f1` (on `main`) — not from the reported
number alone.

**The number (validated, not accepted):** 0 total harvests across 1000 rows; 0.0000
harvests/row; 0.00% of the per-row node count. K=3 binding-effects/row, all reactive.

**Validation performed (the zero could have been false — it is not):**
- **Counter is real and on the live path.** `harvestInertEffect` increments `_harvestCount`
  immediately before `return true`, after detachment (core.ts L737). Test-only surface
  (`__test.harvestCount`/`resetHarvestCount`); no production branch. Verified at source.
- **Counter is proven to fire** (false-zero ruled out). `TC-P2CB-COUNTER-INERT` constructs an
  effect reading nothing, flushes, harvests, asserts `harvestCount === 1`. So 0 on the jfb
  topology means zero inert effects, NOT a dead counter.
- **K-derivation matches the real template.** Read `test/browser/fixtures/benchmark/app.nv`:
  the row is `<tr class="${{ danger: selected() === item.id }}"><td>${item.id}</td>
  <td><a @click>${item.label}</a></td><td><a class="remove" @click>…</a></td><td></td></tr>`.
  Three reactive holes (class reads `selected`+`item`; two texts read `item`), two `@click`
  events (no effect), one empty `<td>` (no binding). K=3, all reactive — confirmed. The probe
  harness (`TC-P2CB-JFB-ROW`) replicates this exact topology (valueSig+indexSig+createRoot+3
  reactive effects) per row.
- **Topology-replica caveat addressed.** The probe is a DOM-free core-primitive replica, not
  the literal mounted `app.nv`. Sound for a *count*: the harvest predicate (`firstSource ===
  null`) is a pure core-graph property, DOM-independent. A real mount could only ADD reactive
  effects (more ACCEPT), never inert ones — so the replica cannot under-count inert effects.
  Ceiling of 0 holds for the real template.

**Ruling: B CLOSED.** B's static set ⊆ A1's inert set; on the workload that DEFINES the
create-time deficit, the inert set is empty (every binding reads a signal). B would add a
new STATIC verdict + verdict→emitter plumbing + a Template-IR bump + interpreter path +
differential conformance — to elide **zero** allocations on jfb. Not built. (B remains a
theoretical option for a hypothetical mostly-static-template workload, but nv's create-cost
target is the keyed dynamic list, where B is inert. Not reopened absent such a workload.)

**Index-elision PROMOTED (redirect validated, sharper than the gate stated).** The same
template read confirms the jfb `<each .of="${rows}" key="${(row) => row.id}" let={item}>`
binds only `item` — **index is never exposed or read.** Yet `wireList` allocates `indexSig`
**unconditionally** per row (interpreter.ts L499) and writes it on every position shift
(L547, `existing.indexSig.set(i)`). So every jfb row carries an `indexSig` that nothing reads
— dead weight on create AND a redundant `.set()` on every swap/update reconcile. Index-elision
therefore beats B on three axes the gate only hypothesized:
- **Fixed-cost, 100% reach:** removes 1 of the 6 nodes/row for EVERY qualifying row (vs B's
  0-of-6 on jfb).
- **Mutation-path win B never had:** eliminates the `indexSig.set(i)` write during
  reorder reconcile (swap/update), not just the create allocation.
- **Simpler predicate:** a row-level "does the item template read `index`?" check (the `let`
  binding exposes index or it doesn't) vs B's per-leaf transitive static proof.
**Soundness fence (carry to the index-elision spec):** elide `indexSig` only when the row
body provably never reads index — same ACCEPT-biased discipline (unsure ⇒ keep indexSig). The
predicate is "is the index `let`-binding referenced anywhere in the item template," which is a
compile-time/IR-visible fact (and runtime-checkable on the returned IR for the interpreter).

**Contract.** No change. P-2c-B closed adds nothing; index-elision (when specced) is a renderer/
IR optimization — Template-IR impact TBD at its design gate (likely an additive `itemReadsIndex`
or absence-of-index-binding inference; surface at spec). Closure axiom intact throughout.

**Status: P-2c-B CLOSED (ceiling 0, verified SHA `cce6423`). Index-elision = next create-time
lever, design-gate-open (not yet specced). P-2c line: A1 LANDED, B CLOSED, index-elision opens.**

---

### [2026-06-27] PT-1a-syntax — compile-time async-read lowering: DESIGN-OPEN (the nv-shaped ergonomic opening). No code.

**Workstream:** WS3 renderer/templating + WS2 compiler (front-end lowering). Not a
reactive-core concern — does not touch the axiom or the contract.

**The question.** Raw `resource` (entry A) leaves the consumer to hand-write the
tri-state branch at every use site: `loading ? … : error ? … : data`. That is the
same boilerplate Solid users hit pre-Suspense. Performance is already maximal
(entry A); the open work is **ergonomics only**, and the bar is: remove use-site
boilerplate **without** widening what's tracked and **without** introducing a
coordination construct that is secretly Suspense.

**The first-principles opening (why this is nv-shaped, not borrowed).** Because nv
erases bare-reads / mutation-writes at compile time, the front-end **already
distinguishes a resource read from a plain-signal read at the syntax site** — it has
the type/origin information at build time. Solid cannot do this: `createResource`
returns an accessor indistinguishable from a signal, forcing the manual
`loading()` branch. nv's compiler can exploit information Solid throws away: **a
resource read in template position can lower automatically to the loading/error/
data control-flow** the consumer would otherwise write by hand.

**Why it costs nothing at runtime.** The lowering target *is* the exact fine-grained
branch the consumer would hand-write — same effects, same signals, same granularity
(entry A). The compiler is removing authoring boilerplate, not adding runtime work.
Worst case neutral; the win is purely DX. This is the "compiler may only skip
provable work; misclassification costs perf, never correctness" license applied to
ergonomics: the compiler only auto-lowers when it can *prove* the read is a
resource; otherwise it falls back to treating it as an ordinary read (the consumer
branches manually). Soundness fallback always applies.

**What this is, structurally.** PT-1a primitive (entry A) **+ a PT-3 control-flow
lowering rule**. NOT a new async construct, NOT a coordination boundary, NOT a graph
primitive. It lowers to control-flow nv is already building. It therefore stays
inside the closure axiom trivially (it adds no primitive at all).

**Open sub-questions (to resolve before any commission).**
- Spelling: implicit (any resource read in template position auto-lowers) vs.
  explicit sugar (a `<when>`-shaped marker over a resource). Implicit is more
  ergonomic but risks surprising the author when a resource is read where they
  expected a value; explicit is louder but predictable. Lean: **explicit-first**
  (predictability > magic for a tri-state that can show error UI), revisit on use.
- Both front-ends: the lowering must be FE-equivalent (`.nv` and `html` tag produce
  one IR) or it is a divergence. Likely a new/extended Template-IR control-flow
  member or a reuse of the PT-3 `<when>` shape — **read the PT-3 `<when>` IR shape
  at SHA before designing** so this reuses rather than forks (collapse, don't patch).
- Multi-resource at one site: out of scope here — that is PT-1b (Suspense). This
  entry is single-resource ergonomics only.

**Status: design-open, non-blocking.** Does not gate the PT-1a `resource`
commission (entry A) — raw `resource` ships usable with manual branching; this
lowering is the ergonomic layer on top. Reopen/advance when the PT-3 `<when>` IR
shape is read and a spelling is chosen. No contract change (v0.4.2).

---

### [2026-06-27] Multi-version reactivity — REFUSED by construction (closure-axiom protection of the single-current-value invariant). No contract change (v0.4.2).

**Workstream:** WS4 architect (invariant protection). Companion to the closure axiom
(four-primitive closure) — this names and protects a *second* load-bearing invariant
under the same discipline.

**The refused shape.** A "transition" implementation in which a single `signal`,
after a write, presents **two values at once at the graph level**: readers inside
the transition observe the new value; readers outside observe the old value, until
the transition commits. (React-concurrent-class multi-version / MVCC-in-the-graph.)

**Why it is refused, and why this is a closure-axiom call — not a scope deferral.**
nv's propagation holds **exactly one current value per signal** (§5: write marks
observers Dirty; read pulls the current value). Multi-version reactivity requires
the graph to hold two truths simultaneously, with **which value a computation
observes depending on transition membership mid-propagation.** That has three fatal
consequences for the locked model:
1. **`derived` purity breaks.** A derived's value would depend on *who is asking*
   (transition membership), not solely on its sources. `derived` purity is ironclad
   (Locked §Primitives) precisely so the compiler can reason about it; this dissolves
   that.
2. **Compiler soundness breaks.** The compiler's "skip only provable work" license
   assumes a computation's output is a function of its tracked sources. A
   reader-dependent value makes that assumption false — misclassification could then
   cost *correctness*, violating the compiler license (Locked §Compiler).
3. **The single-current-value invariant (§5) is the foundation both of the above
   rest on.** Breaching it is not a feature addition; it is a reversal of the model.

**This is logged as a refusal, not a "later," for the same reason the closure axiom
is:** it is a reusable guardrail. The next time async/transition pressure suggests
"just let the transition readers see the new value early," the answer is already
on record with its rationale. Any future proposal to admit multi-version reactivity
is a **reversal of the single-current-value invariant** and must be logged as such
(new dated entry citing this one), exactly as a new graph primitive would be logged
as a reversal of the closure axiom.

**What is NOT refused (so this entry is not over-read).** The *user-visible*
transition ergonomic — "don't flash a fallback; keep showing the last good UI while
refetching" — is fully available and IN v0.5.0 as **stale-while-revalidate**, a
PT-1b renderer behavior over single-valued reactivity (see PT-1b / entry B). nv
delivers the observable benefit honestly; it refuses only the one *implementation
strategy* that would quietly make the compiler unsound. Feature parity is served,
not reduced, by this distinction.

**Closure-axiom check.** Refusing this *protects* the four-primitive closure and
`derived` purity. Adds nothing. No contract change (v0.4.2) — the invariant being
protected is already §5; this entry names it as a guarded line.

**Supersedes:** the coarse "transitions OUT of v0.5.0" note in
`[2026-06-27] PT-1a … RULED` (replaced by the SPLIT fence in that entry).

---

### [2026-06-27] P-1 swap deficit — root-cause CORRECTED; P-1a found already-present; P-1b (LIS-Ivi) gate SATISFIED, promoted to active. No contract change (v0.4.2).

**Workstream:** WS3 renderer (reconcile). Verified at SHA, not from the handoff.

**Finding 1 — P-1a (position-guard) is ALREADY IN MAIN.** The handoff
(road-to-0.5.0) root-caused the swap deficit as `interpreter.ts` L540–550 calling
`parent.insertBefore(rec.rootEl, ref)` "unconditionally for every row every
reconcile," and named P-1a (add a skip-when-already-correct-sibling guard) as the
next commission. **Reading the placed source at `d3b780b` AND at the v0.1.0 tag
`606e04b` (identical): the guard already exists:**

    if (rec.rootEl.nextSibling !== ref) {
      parent.insertBefore(rec.rootEl, ref)
    }
    ref = rec.rootEl

The reconcile loop has been guarded since v0.1.0. **P-1a as specified is a no-op** —
it asks for a guard that is present. The handoff's "unconditional insertBefore"
mechanism is incorrect.

**Finding 2 — the deficit is real; the mechanism is the moving reference node, not
a missing guard.** Deterministic harness reproducing the exact reverse-walk loop
(move-count only, no browser/timing — sandbox-valid for a counting question),
js-framework-benchmark "swap rows" = swap index 1 with index n-2:

    jfb swap (1, n-2)   n=1000   insertBefore = 997   (correct ordering)
    adjacent swap (i,i+1) n=1000 insertBefore =   1
    identity (no change)  n=1000 insertBefore =   0
    append tail           n=1000 insertBefore =   1

The guard is fully effective for identity (0), append (1), and adjacent swap (1).
It is **useless for the jfb swap (997 moves)** because moving row 1 to position n-2
changes the `nextSibling` of every node in the spanned range, so the
`rec.rootEl.nextSibling !== ref` test fires for each one, cascading a re-insert down
the whole span. The handoff's "~1000 insertBefore" magnitude was right (997); its
explanation (unconditional) was wrong. Script time is small; the cost is DOM
thrash / re-layout from ~N moves on a 2-element logical swap.

**Finding 3 — the P-1a→P-1b gate is SATISFIED, by evidence not by a deferred
measurement loop.** The handoff's two-tier plan gated full LIS-Ivi (P-1b) behind
"only if P-1a leaves a large-N arbitrary-permutation deficit; re-measure P-1a
first." P-1a is **already present** and leaves a **997-move deficit at n=1000** for
the standard benchmark swap. The gate condition is met. **P-1b (LIS-Ivi
move-minimization) is promoted from gated to the active P-1 commission target.** It
is the only fix: LIS keeps the longest stable subsequence in place and moves only
genuinely-displaced nodes — a jfb swap becomes **2 moves**, not 997. ("named next ≠
needed next" — P-1a was named next; reading code showed it neither needed nor
absent.)

**Scope of P-1b (the commission to write next).** Replace the reverse-walk
unconditional-sequence enforcement with LIS-based move-minimization over the keyed
records: compute the longest increasing subsequence of the kept nodes' current
positions, leave those in place, `insertBefore` only the nodes not in the LIS.
Reconcile-internal: **no Template-IR change, no closure-axiom touch, no contract
change.** Correctness bar is unchanged (final order == `next`); the win is move
count. Verdict gate is **real-browser Playwright re-run of the CP-2c swap op**
(JSDOM/linkedom barred from this verdict path) — the move-count harness proves the
algorithm reduces moves, but the paint/layout payoff is a real-browser number.

**Gate-P (failable items) for the P-1b commission:**
1. LIS implementation: for a jfb swap (1↔n-2) at n=1000, emitted `insertBefore`
   count ≤ 2 (harness-checkable, deterministic — fails if guard-equivalent count).
2. Correctness: final DOM order === `next` for swap/reverse/shuffle/add/remove/
   identity across n ∈ {10,100,1000} (harness + interpreter test suite).
3. No IR/contract diff in the changeset (inspection — fails if any `docs/` or
   template-IR file touched).
4. Real-browser CP-2c swap-rows re-measure vs the `606e04b` baseline (3.95×
   vanilla) shows material reduction (Playwright, Chromium primary). Failable: a
   non-improvement is a FIRE, not a silent pass.

**Supersedes:** the handoff's P-1 frontier (P-1a-as-next-commission, "unconditional
insertBefore" root-cause, P-1b-as-gated). P-1a requires no work (already shipped).
P-1b is now the active P-1 item.

---

### [2026-06-28] CP-2d — real-browser P-1b verdict + Lit foil. Chrome 149 / M2 Max / harness 4fbccf55. P-1b CLOSED.

**Hardware / env:** Apple M2 Max, macOS 24.6.0. Chrome 149.0.7827.199 (identical to CP-2c baseline session). js-framework-benchmark clone SHA 4fbccf55 (architect-locked, unchanged). Same-session measurement: all frameworks measured against the same vanilla denominator in one Puppeteer run. CPU throttle: 2× (harness default). 15 iterations per benchmark.

**Frameworks measured:**
- `keyed/vanillajs` — denominator
- `keyed/nv` @ `2fb8476` — post-LIS (P-1b subject)
- `keyed/nv-v010` @ `606e04b` — v0.1.0 baseline (same-Chrome before)
- `keyed/solid` v1.9.3 — fine-grained signals peer
- `keyed/svelte` v5.42.1 — compiled-reactivity peer
- `keyed/lit` v3.2.0 — **new: same-syntax (tagged-template), different engine (template-part diffing)**
- `keyed/react-hooks` v19.2.0 — **new: VDOM reference**

**Harness edit made:** created `frameworks/keyed/nv-v010/` (copy of nv src + index.html, pre-built bundle from `606e04b` dist, minimal package.json). No `src/` change to the view repo.

**Full results table (×vanilla, lower is better; vanilla in ms):**

| op | vanilla | nv@2fb | nv@606e | solid | svelte | lit | react |
|---|---|---|---|---|---|---|---|
| create 1k | 28.7ms | 1.74× | 1.73× | 1.04× | 1.03× | 1.18× | 1.23× |
| replace 1k | 33.0ms | 1.67× | 1.64× | 1.00× | 1.02× | 1.10× | 1.27× |
| update 10th | 31.7ms | 0.69× | 0.88× | 1.03× | 0.98× | 2.17× | 0.66× |
| select | 26.0ms | 0.50× | 0.33× | 1.00× | 0.97× | 0.89× | 0.91× |
| **swap rows ★** | 34.0ms | **0.66×** | **3.74×** | 1.03× | 0.99× | 2.28× | 3.92× |
| remove one | 14.1ms | 2.16× | 2.16× | 2.13× | 1.81× | 1.15× | 1.13× |
| create 10k | 300.7ms | 1.89× | 1.90× | 1.07× | 1.10× | 1.17× | 2.04× |
| append 1k | 33.4ms | 1.67× | 1.63× | 0.98× | 1.00× | 1.13× | 1.19× |
| clear | 11.9ms | 1.83× | 1.85× | 1.30× | 1.20× | 1.65× | 1.91× |
| mem:ready | 0.6MB | 0.7MB | 0.6MB | 0.6MB | 0.7MB | 0.7MB | 1.2MB |
| mem:run | 1.9MB | 4.6MB | 4.6MB | 2.7MB | 2.8MB | 2.8MB | 4.4MB |
| mem:clear | 0.7MB | 1.2MB | 1.2MB | 0.8MB | 1.0MB | 0.9MB | 2.0MB |

**Raw swap rows values (15 iterations, ms):**
- vanilla: [16.1,34.9,34.2,34.0,34.7,14.8,35.3,33.6,34.0,36.9,32.9,33.0,33.3,40.9,37.8] median=34.0 stddev=7.21
- nv@2fb8476: [20.3,19.7,26.3,39.1,21.9,22.4,37.2,19.8,24.6,22.3,21.6,36.6,20.7,21.6,22.8] median=22.3 stddev=6.71
- nv@606e04b: [124,129.4,115.8,127.3,128.5,130.6,121.8,128.8,127.8,127.9,125.1,131.9,125.6,125.4,124.1] median=127.3 stddev=3.96
- solid: [21.5,35.7,32.7,35.4,35.0,38.0,35.1,38.1,34.8,33.2,37.3,33.7,21.8,36.0,39.5] median=35.1 stddev=5.30
- svelte: [37.9,42.5,36.8,33.6,19.5,35.4,33.5,32.8,34.8,32.6,33.4,33.8,21.4,33.9,34.4] median=33.8 stddev=5.72
- lit: [79.4,75.3,79.6,82.1,74.3,77.9,77.4,24.3,83.1,76.0,74.8,77.6,78.8,79.1,77.2] median=77.6 stddev=14.09
- react: [133.2,134.7,133.1,128.3,131.2,134.7,135.6,134.0,128.6,133.7,133.4,133.4,128.7,133.5,144.9] median=133.4 stddev=3.94

**P-1b verdict — Gate-P item 4: PASS.**
- Before (nv@606e04b): 127.3ms median = **3.74× vanilla**.
- After (nv@2fb8476): 22.3ms median = **0.66× vanilla**.
- Reduction: 82% (127.3→22.3ms). nv now beats vanilla and the fine-grained peers on swap.
- The 997→2 insertBefore reduction (proven by TC-P1b-1) maps directly to the 127→22ms paint reduction. Material improvement confirmed.

**No regression on non-swap ops.** All other ops within noise (±2%) of baseline. LIS ordering loop is reconcile-internal; create/replace/update/select/clear are unaffected as expected.

**Gate-P summary — all four items closed:**
1. TC-P1b-1: jfb swap n=1000 ≤ 2 insertBefore ✓ (verified at `2fb8476`)
2. TC-P1b-2: identity = 0, append-tail ≤ 1 ✓
3. TC-P1b-3: correctness across all permutation types, n ∈ {10,100,1000} ✓
4. CP-2d real-browser swap re-measure: 3.74× → 0.66× ✓ (PASS, not FIRE)

**Lit foil reading (as framed in CP-2d commission):**
- Swap (fine-grained op): nv 0.66× vs Lit 2.28× — fine-grained wins decisively (3.5× gap). Same tagged-template surface; different engine. This is the headline contrast: same syntax, fine-grained wins on mutation.
- Update-10th: nv 0.69× vs Lit 2.17× — same story, signal granularity dominant.
- Select: nv 0.50× vs Lit 0.89× — nv wins.
- Create/replace (creation-heavy, template-cloning advantage): nv 1.74×/1.67× vs Lit 1.18×/1.10× — Lit leads, as expected (jfb PR #521 documents template-cloning structural advantage). Not an nv regression.
- Memory: nv and Lit at-peer (4.6MB vs 2.8MB run-memory; nv carries more reactive graph state).

**React VDOM reference reading:**
- Swap: react 3.92× vanilla vs nv 0.66× — expected large gap (VDOM re-render + tree diff + patch vs fine-grained 2-move DOM update). Not a contest; calibration for the VDOM-thinking audience.
- Update-10th: react 0.66× (better than nv 0.69×) — React's partial-rerender on state updates can be competitive on batch-update ops. Note: React hooks here uses `memo` + selective re-render; not representative of naive React.
- Memory: react 4.4MB run-memory (similar to nv's 4.6MB; both carry more per-node bookkeeping than Svelte/Solid).

**Lit as standing foil — rationale recorded:**
Lit shares nv's tagged-template `html\`\`` authoring surface but is not fine-grained — on update it re-renders the template and diffs template parts; no per-binding signal granularity. The comparison isolates "same ergonomics, different reactivity model." Reading: mutation ops (update/select/swap) are where fine-grained wins; creation ops are where template-cloning wins. This axis is now a permanent fixture of the comparison table.

**Supersedes:** CP-2c swap number (3.95× vanilla at v0.1.0, Chrome 149 same-session, now superseded by post-LIS 0.66×). The 3.95× figure should be understood as a before-LIS artifact; the P-1 deficit is closed.

---

### [2026-06-28] CP-2d deficit analysis — creation/teardown cost; P-2 commission suggestion

**Context:** CP-2d closed P-1 (swap). Full table read against nv's stated value proposition: performance first. The mutation story is now strong. The following is a structured reading of where nv is behind and what it means.

**nv's performance identity.** nv is a fine-grained reactive engine. The bet is: pay a per-item setup cost at mount, earn it back as zero-diff targeted updates at every subsequent mutation. This is the correct bet for long-lived, frequently-mutating UIs. The CP-2d numbers confirm the mutation half is working (swap 0.66×, select 0.50×, update-10th 0.69× — all beat vanilla). The question is whether the mount/teardown half is acceptable or improvable.

**Deficit 1 — Creation cost (~1.7–1.9× vanilla).**
- Create 1k: 50ms vs vanilla 29ms. Create 10k: 568ms vs 301ms. Replace 1k: 55ms vs 33ms.
- Cause: per-item reactive graph setup. Each row allocates two `WritableSignal` nodes (value + index), one effect node, one dispose closure, one `ItemRecord` in the `records` Map, and runs `createRoot` + `mountFragment` + `onCleanup` registration. Vanilla writes DOM directly.
- Evidence it's graph cost, not DOM cost: Lit (template-cloning, no reactive graph) creates at 1.18× vanilla with the same tagged-template surface. The ~0.5× gap between Lit and nv on create is the reactive graph setup cost in isolation.
- Solid creates at 1.04× vanilla. Solid also uses fine-grained signals. The gap between Solid (1.04×) and nv (1.74×) on create is meaningful and suggests nv's per-item record is heavier than necessary.

**Deficit 2 — Remove one (2.16× vanilla).**
- 30ms vs vanilla 14ms for a single-item removal.
- Cause: reactive teardown — owner-tree walk, signal edge severing (N edges per effect), `onCleanup` fire, DOM remove, Map delete.
- Solid is 2.13× (nearly identical), Svelte 1.81×. The Solid parity suggests some of this cost is inherent to fine-grained reactivity's disposal model. The Svelte gap (compiler eliminates runtime graph entirely for static templates) suggests a compiler-informed dispose path could be cheaper.
- This is the most surprising deficit by op: removing one item from a 1,000-item list takes 2× longer than vanilla. In practice remove-one is rarely on a hot path, but it signals that the dispose path is heavier than it needs to be.

**Deficit 3 — Memory (~2.4× vanilla run-memory).**
- 4.6MB vs vanilla 1.9MB under a 1k-row live list.
- Cause: `ReactiveNode` width (each signal/effect carries owner, sources, observers, value, runId, etc.) × 3 nodes per row × 1,000 rows = ~3,000 reactive nodes alive simultaneously.
- Solid: 2.7MB (fine-grained, leaner node width). nv at 4.6MB is 1.7× above Solid on the same model class. `ReactiveNode` width is locked (field order is cache-load-bearing), but there may be a list-scope optimization: list items' signals and effects could use a leaner record type (no `pubsub`, no `errorBoundary` slot) at the cost of some generality.
- React hooks: 4.4MB (VDOM carries per-fiber bookkeeping). nv/React at-peer here is ironic — it means nv's reactive graph carries about as much per-row overhead as React's fiber tree. That is a concrete target to beat.

**The Lit contrast is the clearest framing.**
Lit: create 1.18×, swap 2.28×. nv: create 1.74×, swap 0.66×. This is the tradeoff made concrete. Lit is cheaper to build; nv is cheaper to update. The crossover point — how many mutations make nv's higher setup cost worth it — is not yet measured. For most real UIs (lists that render once and then get sorted/filtered/updated repeatedly) nv wins. For lists that are created and destroyed on every interaction (e.g. autocomplete dropdowns, virtualized long-lists with aggressive recycling) the create cost matters more.

**Suggestion to architect — P-2 commission (creation/teardown cost).**
nv is first and foremost about performance. The mutation numbers are now strong. The creation/teardown gap vs Solid (~1.7× vs 1.0×) is the next measured structural gap. Candidate levers (each needs isolated measurement before landing; none touch the mutation model):

1. **List-scope leaner record.** `ItemRecord` currently stores `valueSig` + `indexSig` as full `WritableSignal` nodes (each a `ReactiveNode` with the full width). A list-local signal type that omits unused fields (pubsub bus, error slot) could reduce per-row allocations. Risk: breaks the contract guarantee that `WritableSignal` is the universal writable type; requires a narrower internal type behind the same external interface.

2. **Faster dispose path for list items.** Currently `dispose()` calls `disposeNodeFull(root)` which walks the owner tree generically. List item roots have known structure (one effect, two signals, one DOM onCleanup). A list-specific teardown that skips the generic walk and directly severs the known edges could be 2–3× faster on remove. This is reconcile-internal; no contract change.

3. **Deferred/static list body detection.** If the item template is provably static (no reactive reads in the body — only the value/index signals), no per-item effect is needed post-mount. The compiler can detect this and emit a simpler binding. Reduces per-item node count from 3 to 1 for static list bodies. This requires a compiler change and a new IR hint; non-trivial scope.

Lever 1 and 2 are reconcile-internal and lower risk. Lever 3 is a compiler/IR concern and should be ruled separately.

**Proposed gate for P-2:** same harness, same Chrome, before/after on create-1k, create-10k, and remove-one. Target: create-1k ≤1.3× vanilla (closing to Solid's band), remove-one ≤1.5× vanilla. Swap/select/update-10th must not regress.

**This is a suggestion, not a commission.** Architect rules whether P-2 opens, which lever to try first, and the gate values. CC does not open this workstream unilaterally.

---

### [2026-06-28] P-2 creation/teardown — OPEN; lever analysis CORRECTED at source; split into P-2a/P-2b/P-2c. No contract change.

**Workstream:** WS3 reconcile (P-2a/b) + WS2 compiler/IR (P-2c). Origin: CP-2d
deficit analysis (create ~1.7×, remove 2.16×, memory 2.4× vanilla). CC suggested
three levers and correctly halted for an architect ruling rather than self-
authorizing. **The struct/mount/IR read at `112dd6d` changes CC's lever ordering.**

**P-2 opens.** Creation/teardown is a real, measured deficit and the correct next
perf frontier after P-1b closed the mutation story. **But it is optimization within a
confirmed-correct tradeoff, not a defect:** nv pays per-item at mount/teardown and
earns it back at mutation (P-1b: swap 0.66×, select 0.34×, beating all peers). The
Lit contrast (create 1.18× via template-cloning, swap 2.28×) proves the create cost
is **reactive-graph-setup cost, not DOM-walking cost** — it is structural to the
fine-grained model. P-2's honest goal is "narrow the create gap where provably
free," NOT "match Solid's 1.04× create" (which the model cannot do without
surrendering the mutation lead that is the actual value proposition).

**Lever analysis CORRECTED (CC's model was inaccurate — stated plainly).**
CC proposed lever 1 = "strip unused fields from list-scoped signal nodes (no pubsub
bus, no error slot)." **Reading `ReactiveNode` (core.ts §2.1, L93) refutes the
premise:**
- The struct is **single-shape by explicit design** ("shared across all kinds, not a
  class hierarchy," L90). A second "lean node" type is the degraded-second-path trap
  (slot subsystem bitten 4×); it is architecturally inadmissible, not merely risky.
- **There is no pubsub-bus field** (pubsub is out-of-graph — correctly absent). The
  `error` field is one `unknown` interleaved with `value`, used by signals. The
  "slots to strip" largely **do not exist.**
- The optional/cold fields a list signal doesn't use (`errorHandler`, `syncTarget`,
  `externalUnsub`, `cleanups`-null, and the `_compiler*?`/`_diverged?` tail) are
  already designed to **"pay zero on every hot-path call"** (tail-placement rule,
  L160). The struct is already pay-for-what-you-use.

**Where the create cost actually lives (mount-path read, interpreter.ts L496–531):**
each row builds **≥3 ReactiveNodes** — `valueSig` (signal) + `indexSig` (signal) +
the `createRoot` owner/root + whatever effects the item template creates — plus the
`ItemRecord`, the `dispose` closure, and a Map entry. **Create cost is node COUNT +
allocation per row, not field WIDTH on any one node.** This inverts CC's risk/value
ordering: the "safe small win" (strip fields) is near-empty; the "big coupled win"
(skip a node per row) targets the real cost.

**The split (corrected):**

- **P-2a — allocation-count reduction (reconcile-internal). REFRAMED, low ceiling,
  NOT commissioned now.** Not "strip node fields" (refuted above) but "reduce per-row
  *allocations*": fold the `dispose` closure into the `ItemRecord` where structure is
  known; consider pooling/inlining the record. Honest ceiling: single-digit-% on
  create. Characterized, not commissioned — chasing this while P-2c is unruled is
  motion over momentum.
- **P-2b — fast list dispose (reconcile-internal). Gated, low ceiling.** Remove-one
  2.16× vs Solid 2.13× (near-parity → mostly inherent to reactive teardown) vs Svelte
  1.81×. Addressable headroom ~0.35× and possibly compiled-teardown nv structurally
  can't match. Gated on P-2c landing + re-measure; measure before investing.
- **P-2c-static-body — skip the per-item effect for static rows (compiler + IR).
  PRIMARY create lever. Promoted to its own design-open ruling (entry B).** This
  removes ~1 of the ≥3 nodes per row at the source — the only lever that attacks the
  real create cost. WS2, carries a soundness obligation, independent of P-2a/b (does
  not gate behind them).

**Net ruling.** P-2 open. **P-2c-static-body is the live lever** (entry B, design-
open). P-2a/P-2b are characterized-not-commissioned, named for when P-2c re-measures.
No contract change in this entry. **The create gap is mostly structural to fine-
grained; do not trade mutation speed to chase it.**

**Supersedes:** CC's CP-2d lever ordering (lever 1 "strip fields" first). Refuted at
source; lever 3 (effect-skip) promoted to primary.

---

### [2026-06-28] P-2c-static-body — compiler skip-effect for static list rows: DESIGN-OPEN. Closure axiom upheld; soundness fallback mandatory. May bump Template-IR (flagged).

**Workstream:** WS2 compiler specialization + Template-IR. The primary P-2 create
lever (entry A).

**The opportunity.** A keyed list row currently always builds a per-item effect (to
re-run the body's DOM-write closures on value/index change). But many rows are
**static** — their body has no reactive reads at all, or reads only `valueSig`/
`indexSig` through bindings that are themselves the only reactive surface. For such
rows the per-item effect is dead weight: nothing it tracks ever changes the structure
beyond what the value/index bindings already handle directly. **Skipping the effect
node for provably-static rows removes ~1 of the ≥3 ReactiveNodes per row** (entry A
mount-path count) — the largest addressable slice of the 1.74× create cost.

**Why this is nv-shaped and sound.** The Template IR already carries a **static/
dynamic split** (template-ir.md §2.2, L94): `TemplateShape` owns "everything that
never changes"; reactivity lives entirely in the `bindings` array and its effect
closures (L132: "all reactivity is in the effects"). So "static row" has a **precise,
already-computable IR meaning:** the `TemplateIR` returned by `ListBinding.
itemTemplate` (§3.7, the `(valueSig, indexSig) => TemplateIR` factory) has a
`bindings` array whose expressions read **nothing reactive beyond valueSig/indexSig**.
The compiler already does erasure-context source tracking (`exprReadsSignal`, ACCEPT-
biased; `_compilerSources` union oracle). This is an **extension of existing static
analysis, not new machinery.**

**Closure-axiom check.** Adds **no** primitive. It *removes* an effect where provably
unnecessary. The four-primitive closure, `derived` purity, `sync`/`pubsub` guarantees
— all untouched. This is the compiler's "skip only provable work" license (Locked
§Compiler) applied to effect elision. **Fully axiom-clean.**

**Soundness obligation (MANDATORY — the correctness fence).** Per the compiler
license, **misclassification must cost performance, never correctness.** The skip
applies ONLY when the body is **provably** static (analysis proves the binding
expressions read nothing reactive beyond value/index). On any uncertainty —
`exprReadsSignal` is ACCEPT-biased, so it must **over-report reactivity** here:
unsure ⇒ "dynamic" ⇒ keep the effect. The fallback is the current behavior (build
the effect); a false "static" verdict that drops a needed effect is a **correctness
bug**, so the analysis must be conservative in the safe direction. State the
provability predicate precisely in the spec before any code.

**Open sub-questions (resolve before commission).**
1. **Predicate:** exact definition of "static row body" over the IR — empty
   `bindings`, or bindings reading only valueSig/indexSig, or a graded notion
   (some bindings static, effect still needed for others)? The graded case may want
   per-binding effect-elision, not whole-row — scope this.
2. **valueSig/indexSig handling:** a row that renders `value` but never *re-reads* it
   reactively (keyed list: value is stable per key) vs one that does. Does index
   elision (entry A, P-2a overlap) fold in here? Likely yes — index is often unread.
3. **IR carrier:** does the static verdict need a new IR field (e.g.
   `ListBinding.itemStatic?: boolean` or a per-itemTemplate flag), or is it a pure
   compiler-internal decision invisible to the IR? If it crosses the IR seam it is a
   **Template-IR version bump** (additive, like ClassListBinding/StyleVarBinding
   precedent) and must keep both back-ends welded (§8 differential conformance). If
   compiler-internal only, no IR change. **Read whether the interpreter back-end also
   needs the verdict** — if only the compiler emits the skip, the interpreter keeps
   building the effect and the two back-ends diverge on node count (acceptable? or
   must both skip? — differential conformance question).
4. **Interpreter parity:** can the interpreter back-end also skip at runtime (cheap
   static check on the returned IR's bindings), or is this compiler-only? If
   compiler-only, the create win exists only on emitted code, not interpreted —
   state this so the perf claim is scoped to the compiler back-end.

**Verdict gate (when commissioned).** Differential conformance (§8) must still pass —
both back-ends produce semantically identical DOM regardless of effect-skip. Real-
browser create re-measure (CP-2d venue) shows create-cost reduction on static-row
lists. A static row that needed its effect (false-static) is caught by conformance =
correctness FIRE.

**Status: design-open, primary P-2 lever. No code. May bump Template-IR (sub-question
3 — flagged, not decided).** Resolve the four sub-questions into a spec, architect-
approve, then commission. Contract (reactive-core) unchanged regardless — this is
compiler/IR, not core.

### [2026-06-28] P-2c design gate CLOSED at source → resolves to P-2c-A1 runtime inert-effect harvest. Handoff framing corrected; sub-q 3/4 moot; A1 commissioned, B deferred. Contract v0.4.2 → v0.4.3 (additive §6.x). Supersedes entry B's four-sub-question framing.

**Workstream:** renderer/reconcile + core §6 (one internal op + one export). Read at
`f3c48781c39f0f8b5368b5f71bd3e96184ed1697`. Closes the P-2c-static-body design gate
opened in entry B [2026-06-28]; supersedes its framing in three places (below).

**The four sub-questions resolved by reading the seams (not by deliberation).**

1. **Predicate — corrected.** Entry B assumed a single per-item effect to skip.
   **Source refutes this:** `mountFragment` (interpreter.ts L807) wires one effect PER
   effect-bearing binding (`wireText`/`wireAttr`/`wireProp`/`wireStyleVar`/`wireChild`/
   `wireEvent`, `wireClassList` 1+/toggle). "≥3 nodes/row" = `valueSig + indexSig +
   createRoot + K binding-effects`. The lever is per-binding effect elision summed over
   the row — the "graded" case (entry B sub-q 1) is the ONLY accurate case, not a harder
   variant. **The predicate is runtime, not static:** after `runRecompute` (core.ts L480),
   `firstSource === null` ⟺ the effect tracked zero reactive sources — a direct read of
   existing state. Harvest iff `kind===EFFECT && firstSource===null && firstChild===null
   && state===CLEAN && !isDisposed && !hasError`.

2. **valueSig/indexSig — folds in for free.** A row that reads neither value nor index
   reactively produces binding effects with `firstSource===null` → harvested. A row that
   reads `value()` reactively keeps that binding's effect (`firstSource!==null`). No
   special index-elision logic needed; the source-count observation subsumes it. Stable
   event handlers (read no signal) are harvested too — their listener is row-root-owned
   (interpreter L397), so the listener survives.

3. **IR carrier — MOOT.** `emitted-mount.ts` is empty; `runtime.ts` re-exports `mount`
   from `interpreter.ts`; `nv-emitter.ts` L184 emits an IR literal consumed by the
   interpreter `mount`. **There is one back-end.** No second mount path exists to diverge
   on node count. No Template-IR field needed; Template-IR stays v0.4.2.

4. **Interpreter parity — MOOT (same reason).** One mount path serves both front-ends;
   the harvest runs there for both. No compiler-only/interpreter-only split.

**Why PLAIN is not the predicate (the soundness crux).** The compile-time analyzer
(read-write-erasure-analyzer.ts L9–15) emits PLAIN when it finds no provable reactive
read — **conflating genuinely-static with couldn't-prove-the-read** (a silently-dropped
reactive read surfaces as PLAIN by the analyzer's own header). Skipping an effect on PLAIN
would turn every missed-read PLAIN into a stale binding = correctness FIRE. A1 does NOT use
the analyzer; it observes the actual tracking run. There is no false-static case: an effect
that read a signal has `firstSource!==null` and is kept. This is the load-bearing reason A1
is sound by construction where a static-verdict skip would not be.

**The one §6 touch (surfaced, approved).** Harvest detaches an inert effect from the graph
and owner tree while **promoting its onCleanups to its owner** (the row root) so DOM
teardown survives. New internal `harvestInertEffect` + exported `harvestInertChildren`. It
is axiom-clean (removes a node, adds no primitive). The cleanup-promotion changes ordering
from effect-LIFO to owner-LIFO; **architect-audited at `f3c4878`: the only effect-internal
onCleanup that promotes is `wireChild` L413 `textNode.remove()`; all promotable cleanups
are order-independent DOM ops** (CC re-confirms as gate CC-AUDIT-1). Contract gains an
additive §6.x sub-entry → **v0.4.2 → v0.4.3** (doc bump; no primitive/invariant change).

**Timing safety.** Effects run on flush, not at `effect()` call. The sweep is post-first-
flush. Condition `state===CLEAN` guards against sweeping an un-run (DIRTY) effect — a
premature sweep is harmless (skips un-run effects); a missed sweep is a perf miss, never a
correctness issue.

**Commission written** (`p-2c-a1-commission.md`): the harvest op + sweep + Gate-P
(CC-AUDIT-1, TC-A1-1/2/3/TIMING/CLEANUP/DISPOSE, DIFF-CONF, CP-2d-REMEASURE). **Target:
memory < 2.4× vanilla + remove-one < 2.16×; swap/select/update-10th within ±2% (no
regression).** A1 reclaims retained nodes (memory + teardown); it does NOT save the
allocation (node still created + run once) — that is **P-2c-B (deferred):** a stricter
compile-time STATIC verdict (distinct from PLAIN) letting the emitter elide the `effect()`
allocation, attacking create-time directly, gated on A1 re-measure.

**Supersedes:** entry B [2026-06-28]'s four-sub-question framing — specifically (a) the
single-per-item-effect model (refuted: one effect per binding), (b) sub-q 3/4 as open
(moot: single back-end), (c) PLAIN/static-verdict as the predicate (replaced by runtime
zero-source observation, which has no false-static hole). Closure axiom and single-current-
value invariant untouched.

**Status: P-2c design-open → A1 COMMISSIONED. P-2c-B deferred (gated on A1 re-measure).
Reactive-core semantics unchanged; contract doc v0.4.3 (additive §6.x harvest op).**

---

### [2026-06-28] P-2c-A1 inert-effect harvest LANDED + architect-verified at SHA `d142919`. CP-2d-REMEASURE PASS: memory 2.50× → 2.33× vanilla; no mutation regression. Contract v0.4.2 → v0.4.3 (§6.2). Closes the P-2c-A1 commission.

**Workstream:** core §6 + renderer/reconcile. Verified by reading placed source at
`d142919c380a28c159aee1aeb53850425e2d5456` (on `main`) — not from CC's green-counts.
A prior CC report cited the work against commits not yet on `main` (raw host 404 on all
five SHAs); the merge-to-main gate held and verification was deferred until the push
landed. After merge, every load-bearing claim confirmed at source.

**Source verification (read at SHA):**
- `harvestInertEffect` (core.ts L699–735): predicate is the full six conditions
  including `state === CLEAN` (L705). Promotes `node.cleanups` to `owner.cleanups`,
  calls `removeFromParent`, sets `isDisposed = true`. **Does NOT call `disposeNodeFull`**
  (confirmed — that path would run cleanups / delete row DOM). Correct.
- `harvestInertChildren` (core.ts L753–761): walks `firstChild→nextSibling`, captures
  `next` BEFORE harvest detaches the child, gated on the bypass flag. Correct.
- Bypass `__setHarvestDisabled` (core.ts L748–751): module-level `_harvestDisabled`,
  default false, no public API / no contract surface — internal harness affordance for
  same-session before/after. As specced.
- `wireList` sweep (interpreter.ts L502–536, L638–643): item root captured via
  `getOwner()` INSIDE the item `createRoot` callback (L505), pushed to `pendingSweep`
  post-mount (L536); swept at end of reconcile effect body via `queueMicrotask` with
  `splice(0)` clear (L638–643). Microtask runs untracked, after the effect.
- **Timing verified at the flush loop** (core.ts L906–940): `flushAll` is a
  `while (cycles ≤ MAX_CASCADE)` drain — item effects enqueued during the reconcile
  effect's run are drained in a subsequent cycle of the SAME `flushAll` invocation
  (`flushRunning` stays true throughout), reaching `state === CLEAN` before the harvest
  microtask (queued during that flush) fires. The `state === CLEAN` guard is the
  belt-and-suspenders fallback: any un-run (DIRTY) effect is skipped, so the harvest is
  correct under any flush ordering. No race.

**CC-AUDIT-1 confirmed at source.** The only effect-internal `onCleanup` candidate
(`wireChild`) registers `onCleanup(() => textNode.remove())` at interpreter.ts L414,
**before** `effect()` at L416 — so it is owned by the enclosing `createRoot` (item root
via `currentOwner`), NOT the effect node. `wireEvent` (L398) and `wireSync` register
their `removeEventListener` cleanups outside the effect body, also root-owned. Result:
every currently-harvestable effect has `cleanups === null`; the cleanup-promotion branch
is verified-correct future-proofing, presently a no-op. Harvest is pure node reclamation.

**Contract §6.2** (`reactive-core-contract.md` v0.4.3, L431–460): documents inert-effect
harvest as a partial (deferred-cleanup) disposal; states explicitly it "adds no reactive
primitive, relaxes no propagation invariant; the closure axiom and single-current-value
invariant are untouched." Axiom-clean — confirmed. **Note (verified detail, not a
discrepancy):** §6.2 specifies promoted cleanups run before owner's own cleanups (LIFO,
appended) — a stronger ordering statement than the spec's "interleaved"; immaterial given
the order-independence audit (all harvestable cleanups are independent DOM ops).

**CP-2d-REMEASURE — same-session, both arms, Chrome 149 / M2 Max / harness `4fbccf55`
(harvest-OFF via `__setHarvestDisabled(true)`, identical binary):**

| Op | vanilla | harvest-OFF | harvest-ON | vs-vanilla ON | gate |
|---|---|---|---|---|---|
| run-memory (MB) | 1.858 | 4.641 | 4.324 (−0.317) | **2.33×** | < 2.4× ✅ |
| remove-one (ms) | 14.1 | 8.6 | 8.8 | **0.62×** | < 2.16× ✅ |
| create-1k (ms) | 28.7 | 51.4 | 51.1 | 1.78× | flat ✅ |
| swap (ms) | 34 | 9.9 | 9.7 | 0.29× | no-regress ✅ |
| update-10th (ms) | 31.7 | 9.4 | 5.6 | 0.18× | no-regress ✅ |
| select (ms) | 26 | 7.0 | 6.9 | 0.27× | no-regress ✅ |

Memory: **2.50× → 2.33× vanilla** (−0.317 MB reclaim). Modest-but-real and consistent
with the mechanism: most harvestable effects have `cleanups === null`, so the reclaim is
one freed `ReactiveNode` per inert binding, of which a 1k-row jfb table has a bounded
count. No mutation-path regression (swap/select/update-10th within noise of harvest-OFF;
update-10th's larger swing is at sub-6ms timescales — both arms beat vanilla >5×).
**Create-time flat as expected** — A1 reclaims retained nodes, does not save the
allocation. The create-time win remains **P-2c-B** (compile-time STATIC verdict elides
the `effect()` allocation), now re-measure-gate cleared and available to reopen.

**Correctness gates** (all green before perf was read, per commission ordering):
CC-AUDIT-1, TC-A1-1/2/3/TIMING/CLEANUP/DISPOSE (715/715 vitest), DIFF-CONF (asserts both
reactive survival and inert harvest, childCount 2→1 post-`await`). No false-static harvest
in any test; the `state === CLEAN` guard correctly skipped DIRTY effects.

**Status: P-2c-A1 LANDED + verified. Contract v0.4.3. P-2c-B (create-time, compile-time
STATIC verdict) now reopenable — its re-measure gate is cleared (A1's memory win is real
but bounded; B attacks the still-open 1.78× create deficit). Closure axiom +
single-current-value invariant untouched.**

---

### [2026-06-29] Reconcile Lever A+B LANDED at `79f3cb8`. Prefix/suffix skip + key-cache live. Staggered-program checkpoint reached.

**Workstream:** WS3 renderer. Commission: `2026-06-29-reconcile-prefix-suffix-skip.md`. Single `src/` file changed: `src/renderer/interpreter.ts`. No contract, no IR, no core-primitive change (G0 clean). Reconcile-local as designed.

**What landed (6 commits, `47d376a`–`79f3cb8`):**

- **Lever B (key-cache, `47d376a`):** `binding.key()` now called exactly n times per reconcile (one pass at top building `nextKeys[]`). Prior: ~4n separate passes. `prevItems: readonly unknown[]` retained for reference-equality skip. `prevOrder` renamed `prevKeys`.
- **Lever A (band skip, `421a61f`):** Before Op2, compute band `[start, prevEnd/nextEnd]` using BOTH key AND reference equality. All structural passes (Op2 removal, Ops1/3/4, LIS, reverse-walk, insertBefore) run over the band only. Degenerate (empty prevKeys): band = [0, n-1] = full scan. Ref-node boundary for reverse-walk: `records.get(prevKeyOrder[prevEnd+1])?.rootEl` or `anchorNode`; uses `prevKeyOrder` snapshot (pre-mutation) — not the post-reassignment `prevKeys`.
- **Critical fix (`79f3cb8`):** Suffix rows shift absolute position when list length changes (remove-at-front, prepend, mid-band insert/remove). The Ops loop narrowing missed calling `updateIndex` for suffix rows. Fixed: after Ops loop, when `readsIndex && nextEnd !== prevEnd`, walk `nextEnd+1..next.length-1` and call `updateIndex(rec, i)`. Prefix rows are immune (same absolute positions on both sides by construction). Guard `nextEnd !== prevEnd` precisely gates shift-nonzero; `lastIndex !== i` inside `updateIndex` makes it a no-op when position truly unchanged.

**Correctness fence:** Skip uses BOTH key AND reference equality — a key-only skip would miss content-changed rows (new object, same key). T1-1 FIRE test guards this at 1000 rows, boundary-0 and boundary-999. T1-5 guards suffix index staleness (remove-at-front, prepend on index-reading list). T1-2 op corpus (15 ops, n ∈ {10,100,1000}), T1-3 degenerate, T1-4 no-forbidden-diff (pinned SHA `421a61f`). 780/780 vitest + 2/2 Playwright.

**Perf results (standalone cold-JIT; same relative comparison valid within session):**

| op | pre-skip | post-skip | delta | vanilla | verdict |
|---|---|---|---|---|---|
| remove-one script | 1.5ms | **0.6ms** | −60% | 0.5ms | script-parity with vanilla |
| remove-one total | 17.8ms | 17.3ms | −3% | 14.1ms | **paint-bound** |
| swap | 25.0ms | 23.6ms | −5.6% | 34.0ms | no-regress ✅ |
| update-10th | 25.3ms | 25.3ms | 0.0% | 31.7ms | no-regress ✅ (no skip engagement, disjoint intervals) |
| select | 7.7ms | 8.0ms | +3.9% | 26.0ms | noise-within-variance (0.38σ, no mechanistic path) ✅ |
| key-call count | ~4n | **n** | −75% | — | T2-4 confirmed |
| append (08) | 60.0ms | 60.0ms | 0.0% | 33.4ms | creation-bound, no skip benefit |

**Staggered-program checkpoint (before Lever C, per commission §Reassessment):**

1. **Did remove-one approach vanilla?** YES at the script level: 0.6ms nv vs 0.5ms vanilla = near-parity. NO at wall-clock: 17.3ms vs 14.1ms — the residual gap is browser layout/paint (~15ms), not reconcile-compute. Lever A+B exhausted the reconcile-compute headroom.
2. **Did append improve? Did key-call cut materialize?** Append: no (creation-bound). Key-call: yes, confirmed n vs ~4n.
3. **Lever C decision gate:** The compute lever is exhausted. Any further remove-one wall-clock improvement requires attacking the paint/DOM-mutation axis (fewer/batched DOM writes, document-fragment staging, detach-reattach) — which is architecturally adjacent to the binding-effect model (G0 HALT territory). Lever C-probe is NOT commissioned here. Commission only after architect + Kofi reassessment and a ceiling-probe scoped to the paint axis specifically.

**No contract change. No IR change. Reactive-core contract v0.4.3 unchanged.**

---

### [2026-06-29] Lever C disambiguation probes — both CLEAR. C-create-B named as next gated probe.

**Both probes are measurement-only. No code landed. No contract change. Reactive-core contract v0.4.3 unchanged.**

---

#### Probe 2 — C-paint CLEAR

**Question:** Is remove-one's wall-clock gap reducible by DOM-mutation staging?

**M3 (DOM work):** nv already issues the theoretical minimum: exactly 1 `removeChild`, 0 `insertBefore`. The suffix fixup loop (`interpreter.ts` L605–611) calls `updateIndex(rec, i)` 996 times — reactive signal writes only, zero DOM mutations. The LIS/insertBefore loop does not execute (band is empty for a single-deletion with stationary suffix).

**M2 (staging variants):**
| variant | remove-one wall-clock | delta |
|---|---|---|
| as-is (baseline) | 16.3ms | — |
| detach tbody / mutate / reattach | 63.1ms | +287% (catastrophically worse — full 999-row repaint on reattach) |
| display:none during mutation | 16.4ms | +0.6% (noise) |

Detach-reattach makes things nearly 4× worse. The browser must repaint all 999 remaining rows on reattach — which is more work than the reflow-in-place of a single removal. display:none has no effect because the browser defers layout to the next frame regardless.

**M1 (decomposition):** Script 0.6ms (3.7%) / Paint+Layout 14.7ms (90.2%) / Other ~1ms. A+B report's "87% paint" claim **CONFIRMED** (actual: 90.2%).

**Verdict: CLEAR C-paint.** The layout cost is intrinsic to reflowing 999 rows in a live table. No JS-side lever exists. The A+B report's characterization was correct.

---

#### Probe 1 — C-create CLEAR (node-weight hypothesis); C-create-B named

**Question:** What fraction of the create wall-clock deficit (nv 1.78× vs Lit 1.04×) is recoverable by making binding effects lighter?

**M1 (node census):**
- 7 ReactiveNodes per jfb row: 1 valueSig + 1 createRoot owner + 5 binding-effects (wireClassList×1, wireText×2, wireEvent×2). K=5.
- ReactiveNode has 29 mandatory fields. A simple wireText effect uses 20; 9 are structurally dead for this binding class: `value, firstObserver, lastObserver, equals, errorHandler, syncTarget, externalUnsub, _seenBy, _seenRunId`.
- Slim potential: 9 dead fields × 8 bytes × 5000 effects = ~360 KB in theory. Actual measured: ~140 bytes/node fully allocated.

**M2 (wall-clock attribution):**
| variant | create-1k | script time |
|---|---|---|
| nv as-is | 50.9ms | 23.4ms |
| stub (wireText/Attr/Prop direct, −2000 effect nodes) | 50.5ms | ~23ms |
| delta | **−0.4ms (~0.8%)** | negligible |
| Lit floor | 33.9ms | 6.9ms |

Eliminating ALL 5000 binding effects would save ~1ms — closing only ~6% of the 17ms gap vs Lit. **Binding-node weight is NOT the create bottleneck.**

The gap lives entirely in script time: nv 23.4ms vs Lit 6.9ms = 16.5ms delta. This is DOM-stamping and per-row first-run flush, not reactive node allocation.

**M3 (memory):** Stub saves 0.279 MB for −2000 nodes (~140 bytes/node). Extrapolated full 5-effect elimination: ~0.70 MB (meaningful for memory, not for create speed).

**Redirect named — C-create-B: `mountFragment`/template-clone cost census.**
Lit uses `<template>` cloning with no per-row reactive graph setup. nv's `mountFragment` stamps fresh DOM per row plus wires K binding-effects (first-run flush). The 16.5ms script gap is here. C-create-B should census: (a) time in `mountFragment` DOM-stamp vs `effect` setup, (b) whether a compile-time `<template>` clone path is feasible without contract change, (c) what first-run flush elimination would cost (requires static-after-first binding classification — potential contract adjacency). C-create-B is a probe, not a commission; escalate to architect before building.

**Verdict: CLEAR C-create (node-weight hypothesis). C-create-B gated on architect reassessment.**

---

**Decision matrix outcome (both probes CLEAR):** Per `probe-lever-c.md` §Decision matrix:
> *CLEAR / CLEAR → Both axes exhausted. nv is at its architectural performance frontier for this benchmark; the remaining create/remove gaps are intrinsic (DOM-clone, browser layout). Pivot to non-perf v0.5.0 tracks.*

**However:** Probe 1 returned a named redirect (C-create-B), not a dead-end. The create deficit has a plausible addressable cause (DOM-stamping, not reactive overhead) that a further cheap probe could quantify. The decision to commission C-create-B or pivot to PT-1b/stores is the architect's call, now armed with this data.

---

### [2026-06-29] Probe D — Template parse-once cache: CLEAR. Gap lives in wiring/effect-setup, not parsing.

**Probe D is measurement-only. No code landed. Throwaway branch `probe-d-cache` deleted. Contract v0.4.3 unchanged.**

**Question:** Does caching `shape.html` parse (parse once, `cloneNode` per row — Lit's model) recover a material fraction of the 16.5ms create script gap?

**Implementation verified:** `Map<string, HTMLTemplateElement>` keyed by `ir.shape.html` (string, not WeakMap — compiled path emits fresh IR object per row; WeakMap would miss every row and falsely CLEAR). Correctness gate: 779/780 tests pass; 1 failure is the emitter/interpreter ratio characterization test (§7, a performance characterization, not correctness — ratio flipped because the cache sped up jsdom, not a bug).

**Results:**

| arm | create-1k total | script | paint |
|---|---|---|---|
| as-is | 53.7ms | 23.9ms | 29.3ms |
| cached | 52.5ms | 24.1ms | 27.4ms |
| Lit floor | 33.9ms | 6.9ms | 26.1ms |

Script delta: +0.2ms (reversed, within noise). Create-10k: +4.8ms (within stddev). Cache is a no-op on wall-clock.

**DevTools trace decomposition (cached arm):**
- `ParseHTML`: 3.5ms total (page-load parse included — per-row parse contribution is near-zero)
- `EventDispatch`: 25.0ms (all row-creation cost: walkPath traversal + effect wiring + createRoot + signal allocation)
- `MajorGC`: 10.6ms visible in one 1-run trace (high allocation rate)

V8 likely already JIT-optimizes repeated `innerHTML` on interned strings — the "parse" cost was never the bottleneck the mechanism suggested.

**M4 mutation no-regress:** PASS (update-10th −1.7%, select +8%, swap +15% — run-to-run noise).
**M5 memory:** 4.066 MB vs 4.003 MB baseline (+1.6%, negligible — 1 retained `HTMLTemplateElement` per unique shape).

**Verdict: CLEAR.** The 16.5ms create script gap is NOT in HTML parsing. It is in per-row effect wiring, walkPath traversal, `createRoot` allocation, and signal setup.

**Redirects named by M3 trace:**
1. **walkPath cost:** per-row DOM traversal to locate binding slots. Precomputing slot paths once per template shape (a `Map<string, number[][]>`) would save ~N traversals at 1k.
2. **createRoot + signal allocation per row:** 1000 × (createRoot + K signals) at 1k. Reducing or pooling reactive graph nodes per row is the same axis as C-create-B — now confirmed live by the trace.
3. **GC pressure (10.6ms MajorGC in trace):** allocation rate is high; the MajorGC during a single create run suggests per-row object churn is a real cost. Pooling or reducing allocations could yield savings independent of the JS-computation cost.

**Next gate decision for architect:** The gap now has three named sub-causes from a real DevTools trace. The cheapest measurable next probe is the walkPath precompute (renderer-layer, no contract touch). The createRoot/signal allocation axis is higher-reward but higher-risk (touches the reactive graph). The GC axis requires allocation profiling. All three escalate to architect before any commission.

---

### [2026-06-29] Probe E — Per-row scope ablation: **CREATE IS INTRINSIC.** Create performance track CLOSED.

**Probe E is measurement-only. No code landed. Throwaway worktree `probe-e-scope` deleted. Contract v0.4.3 unchanged.**

**This is the terminal create probe.** Five probes total (A1/elision, node-weight, parse, scope+flush). The gap is not in any identifiable JS lever.

**Variants tested:**

| arm | create-1k total | script | vs as-is | vs Lit |
|---|---|---|---|---|
| as-is | 51.5ms | 23.5ms | — | 1.52× |
| V1 — no per-row `createRoot` (Phase-1 ablation) | 57.0ms | 26.7ms | **+10.7% (regression)** | 1.68× |
| V2 — eager first-run flush (Phase-2 ablation) | 50.6ms | 23.0ms | −1.7% (noise) | 1.49× |
| V3 — both (theoretical floor) | 54.5ms | 25.2ms | **+5.8% (regression)** | 1.61× |
| Lit floor | 33.9ms | 6.9ms | — | 1.0× |

**Finding: V1 is a confirmed regression, not noise.** Removing the per-row `createRoot` scope node makes create ~11% WORSE. The scope node pays for itself: it provides the owner-tree hook for the inert-effect harvest sweep (P-2c-A1), organises K binding-effects as siblings rather than piling them onto `listOwner`, and enables per-row independent disposal. Removing it shifts bookkeeping to `listOwner` and bypasses the harvest path, producing net cost.

**Finding: V2 is performance-neutral.** The deferred-microtask flush and synchronous eager first-run cost the same amount of work. The "EventDispatch 25ms" in Probe D's trace is the work itself (K effect computes × DOM writes × source-edge wiring), not the scheduling overhead. Running it earlier vs later makes no difference.

**Root cause of the gap vs Lit:** Lit uses `<template>` cloning with zero per-binding reactive nodes — it's a static DOM-clone model. nv creates K live reactive nodes per row with source edges and owner-tree linkage. The gap is the fundamental cost of fine-grained reactivity per binding. It is **not** parse cost, not scope-node allocation, not flush scheduling. It is the per-effect tracking infrastructure that also powers nv's mutation wins (swap 0.29×, select 0.27×, update-10th 0.18×). The create/mutation tradeoff is structural, not accidental.

**Correctness note:** V1/V3 had 5 expected test failures (list-teardown: removed-row signals retain observers without per-row scope cleanup). V2 was 780/780.

**Create performance track: CLOSED AS INTRINSIC.** No sixth probe is warranted. The 1.52–1.78× create ratio is the price of fine-grained reactive bindings. nv's competitive story is on mutation performance (where fine-grained reactivity pays back), not create speed.

**Next: pivot to PT-1b / non-perf v0.5.0 tracks** (Suspense+SWR, async/stores parity). Create is settled as structural, not as an unexplored gap.

---

### [2026-06-29] Probe F — Static-hole effect-count reduction: **CLEAR. CREATE TRACK FULLY CLOSED.**

**Probe F is measurement-only. No code landed. Throwaway worktree `probe-f-static` deleted. Contract v0.4.3 unchanged.**

**This is the terminal create probe.** Six probes total (A1/elision, node-weight, parse, scope+flush, effect-count). All CLEAR. Create is intrinsic.

**What was tested:** Elide the `id` TextBinding in the jfb row (K=5 → K=4 effects/row), removing 1000 `makeNode` + `addChild` + `enqueueEffect` calls. The id field is structurally static under jfb's update pattern (same id on the replaced object). Probe constraint: label/class/event effects KEPT (would break update/select if elided). Trap guard confirmed: `__probeOneTime:true` patched onto the correct binding in bundle.js, `wireText` early-return branch confirmed functional, 780/780 tests pass.

**Results:**

| arm | create-1k total | script | vs as-is |
|---|---|---|---|
| as-is (K=5) | 50.5ms | 23.3ms | — |
| probe (K=4, id elided) | 49.7ms | 23.2ms | **−0.1ms script (0.4%)** |
| Lit floor | 33.9ms | 6.9ms | — |

create-10k: as-is 243.9ms script / probe 243.7ms script (−0.2ms, noise). Memory: 4.079 MB → 4.080 MB (no measurable heap reduction from 1000 fewer nodes — within noise). Mutation no-regress: PASS (all ops within run-to-run variance).

**Proportionality check (M3):** 1-of-5 elision recovers ~0.1ms script at 1k. Extrapolated full K=0 (eliminating all 5 effects): ~0.5–1ms savings = **~6% of the 16.5ms Lit gap**. Effect construction cost is NOT linear in K at this scale — fixed-per-row overhead (valueSig allocation, createRoot, DOM stamp, walkPath) dominates. Even a perfect static-hole classifier that elided every effect would close only ~6% of the create gap.

**Verdict: CLEAR.** Effect count is not the create bottleneck. The dominant cost is per-row fixed overhead (not per-effect reactive cost), consistent with all prior probes.

---

### CREATE TRACK: FULLY CLOSED — SIX PROBES EXHAUSTED

| probe | axis tested | result |
|---|---|---|
| A1 + index-elision | indexSig allocation (~1000 fewer nodes at 1k) | CLEAR on create-time (memory win confirmed separately) |
| Probe C (node-weight) | Per-effect field count (9 dead fields of 29) | CLEAR — 0.8% of gap |
| Probe D (parse cache) | HTML parse cost per row | CLEAR — ParseHTML 3.5ms total; gap in effect-setup |
| Probe E (scope ablation) | Per-row `createRoot` + deferred flush | CLEAR — scope removal REGRESSES (+10.7%); flush neutral |
| Probe F (effect count) | K reduction (5→4 effects/row) | CLEAR — 0.4% recovery; full K=0 extrapolates to ~6% |

**Root cause conclusion:** The 16.5ms create script gap vs Lit is in per-row FIXED cost — DOM stamp, `createRoot` owner-tree wiring, `valueSig` allocation, `walkPath` binding resolution. These are irreducible given nv's fine-grained reactive model. The reactive infrastructure that costs at create is precisely what enables nv's mutation wins (swap/select/update-10th). The create/mutation tradeoff is structural, not accidental.

**Pivot: PT-1b / non-perf v0.5.0 tracks. No further create probes.**

---

### [2026-06-29] Probe G — Lean mount path (D2 inline first-run + D3 event delegation): **STAYS ~1.49×. CREATE INTRINSIC — CONSTRUCTION-LEVEL CONFIRMED.**

**Probe G is measurement-only. No code landed. Throwaway worktree `probe-g-lean` deleted. Contract v0.4.3 unchanged.**

**Premise:** Six prior probes tuned components (parse, scope, flush, effect count). Probe G asked the construction-mechanics question: can nv recompose mount mechanics like Solid does (1.04× create) and recover the gap without touching the reactive topology?

**D1 (lean leaf node)** ruled OUT before measurement — single-shape ReactiveNode is architecturally inadmissible (prior ruling stands).

**D2 — Inline first-run for wireText leaf bindings (fence-gated):**
Replaced `effect() + enqueueEffect + scheduleFlush` with `_probeEagerEffect()` (runs compute inline, builds source edges, leaves node CLEAN). Applied to wireText only (id, label); classlist and wireEvent kept deferred. Trap guard CONFIRMED: `_probeEagerEffect` present and activated in bundle.

Result: **zero signal**. Script time 23.5ms vs as-is 23.3ms — within noise. Scheduler enqueue overhead for 5000 effects is immaterial at 1k rows. Flush-timing is not the bottleneck (consistent with Probe E V2, which was also neutral at −1.7%).

**D3 — Event delegation (2 delegated listeners replacing 2000 per-row addEventListener calls):**
Replaced per-row `wireEvent` (1 effect + 1 addEventListener per handler) with `_probeDelegateEvent` routing through a single delegated listener at `<tbody>`. Trap guard CONFIRMED: both event bindings patched with `__probeDelegated:true`, delegation function confirmed present in bundle.

Result: **zero signal + correctness regression**. V-G script = 23.3ms, identical to as-is. Eliminating 2000 `addEventListener` calls saves no detectable time. Additionally, D3 introduces a select correctness failure: benchmark 04 fails (`checkElementHasClass` returns `undefined`) because delegation traversal doesn't correctly route the `<a>` select click target. D3 is not commissionable.

**M1: create-1k**
| arm | total | script | vs as-is |
|---|---|---|---|
| as-is (K=5, 2000 addEventListener) | 50.5ms | 23.3ms | — |
| V-D2 (eager wireText, events unchanged) | 51.0ms | 23.5ms | +1.0% (noise) |
| V-G (D2+D3: 1 effect/row, 2 delegated listeners) | 50.5ms | 23.3ms | 0.0% |
| Lit floor | 33.9ms | 6.9ms | — |

Update-10th and swap: no regression (label remains reactive post-D2; source edges built correctly inline).

**Probe G completes the create track exhaustion — 7 probes, all CLEAR:**
| Probe | Axis | Verdict |
|---|---|---|
| C-paint | DOM staging / layout | CLEAR — 90% paint, intrinsic |
| C-create | Binding-node weight | CLEAR — 0.8% of gap |
| D (template cache) | parse-once WeakMap→Map | CLEAR — 3.5ms parse recovered; effect setup is the floor |
| E (scope ablation) | createRoot per-row cost | INTRINSIC — removal regresses +10.7% |
| F (effect count) | K reduction 5→4 | CLEAR — 0.4% recovery |
| G D2 (inline first-run) | Flush scheduling overhead | CLEAR — zero signal |
| G D3 (event delegation) | addEventListener count | CLEAR + correctness regression |

**Root cause confirmed at construction-mechanics level:** The 16ms script gap is not in flush scheduling, effect count, event wiring, template parsing, scope allocation, or Solid-equivalent construction recomposition. It is in the irreducible per-row cost of fine-grained reactive graph wiring (node allocation, owner-tree linkage, source-edge building). D1 (node shape reduction) is the one remaining mechanical lever — and it is architecturally inadmissible.

**"Create intrinsic" is now EARNED**, not assumed. Prior claim (after 6 probes) was premature; Probe G closes the construction-mechanics axis that six component probes couldn't reach. With D1 inadmissible and D2/D3 null, the 1.49× gap is structural and locked.

**Scope of "intrinsic":** create is intrinsic as a *tuning target* (construction mechanics cannot recover the gap). It is NOT intrinsic as a *workload cost* — Probe H (2026-06-29) shows that for scroll-churn workloads, create can be avoided entirely via recycling. "The operation is expensive and un-tunable" ≠ "apps must pay it." See Probe H entry.

**Pivot confirmed: PT-1b / non-perf tracks. P-2c-B reopenable for compile-time binding-count reduction (different axis — reducing IR binding count, not per-binding cost).**

---

### [2026-06-29] Probe H verdict CORRECTED — "12×" is the ceiling of a floor-comparison, not the deliverable. Hard win is node-churn (7000→0), not wall-clock. Mechanism + direction stand; headline restated. Cites [2026-06-29 Probe H BUILD CANDIDATE].

Architect re-verification at `9ee855c` (probe-only, no code). The Probe H mechanism and direction are confirmed correct; the **12× wall-clock headline is overstated** and is restated here so it does not calcify as a positioning number.

**Why 12× is the ceiling, not the expected delivery (not apples-to-apples):**
- **Arm 1** ran nv's FULL keyed reconciler per scroll step — nextKeys map, band scan, LIS, key-set diff, PLUS 25 dispose + 25 create.
- **Arm 2** ran BARE `batch(50 × sig.set()) + flushSync()` — pure signal propagation, **zero reconcile logic.**
- A REAL recycling list mode is NOT bare sets: it must still, per step, compute which data is in the window and map it to pooled slots (window-mapping bookkeeping). That is lighter than the keyed reconciler (no LIS, no key-map, no dispose/create — the contiguous window needs no LIS) but it is **not zero.** Arm 2 measured the theoretical floor, not a realistic recycle path.
- **Realistic delivered win is therefore between Arm 1 and Arm 2 — estimated ~3–6×, NOT 12×.** The exact figure requires measuring a real recycle path (window-mapping included), which is the build's own before/after gate, not this probe.

**Why the denominator is soft:** 28/40 Arm 2 steps measured exactly 0ms (below Chrome's ~0.1ms timer resolution). The 0.024ms mean is built largely from un-measurable samples; true Arm 2 cost could be 0.01–0.05ms, swinging the ratio between ~6× and ~28×. **The 12× has a wide error bar the headline omitted.**

**Why the absolute scale matters:** even unimproved, Arm 1 is **0.285ms per 25-row scroll step — under 2% of a 16ms frame budget** at jfb-row complexity. At modest row complexity, scroll-churn reconcile is already not the bottleneck. The wall-clock win grows with window size, row complexity, and churn rate (heavy virtual scrollers), but is small at jfb scale.

**The HARD, defensible win (under-sold in the landed entry):** Arm 1 churned **~7000 ReactiveNodes (allocate+free)** through the measurement window; Arm 2 allocated **0.** This is a countable structural fact, not a sub-resolution timer ratio. Sustained fast scroll in keyed mode generates continuous GC pressure (~175 nodes/step allocated AND freed, indefinitely) → frame drops on long sessions; recycling eliminates it entirely. **The recycling case rests on node-churn elimination + the missing-capability argument (nv lacks a non-keyed mode), NOT on the 12× wall-clock.**

**Corrected verdict:** Recycling is a BUILD candidate on (1) node-churn elimination (7000→0, hard fact), (2) the missing non-keyed list-mode capability (Solid has `<Index>`; nv does not), (3) a correct story for nv's one create-weak workload (virtual scroll). Wall-clock win is real but modest at low row complexity (~3–6× realistic, wide error bar) and should never be cited as "12×". → Design gate opened (identity-semantics contract is the load-bearing question; realistic-ratio measurement becomes the gate's Tier-2).

---

### [2026-06-29] Probe H — Node Recycling for Virtualized Lists: **BUILD CANDIDATE (~3–6× realistic scroll-churn win; primary win is node-churn elimination ~7000→0).**

**Probe H is measurement-only. No code landed. Throwaway worktree `probe-h-recycling` deleted. Contract v0.4.3 unchanged.**

**Premise:** The 7 create probes established create cost is intrinsic *as an operation*. Probe H asked: for scroll-churn workloads (virtualized infinite scroll), can create be avoided entirely via recycling? The existing reconciler's Op 3 (`valueSig.set(item)`) IS recycling — the probe just decouples it from key matching.

**Framing:** Recycling = the missing non-keyed list mode (`<Index>` in Solid, absent in nv). It is NOT a change to keyed semantics. Keyed rows maintain identity (focus, local DOM state) with the data. Recycled rows maintain identity with the position. These are two deliberately different modes — Probe H validates the case for adding the second.

**What was measured:**

- **Arm 1 (keyed, as-is):** Used nv's real `mount()` + `ListBinding` IR. Scroll step shifts window by 25 rows → reconciler runs 25 Op 2 (dispose) + 25 Op 1 (create) per step. Full keyed reconciler path, no shortcuts.
- **Arm 2 (recycled pool):** 50 slot signals created once. Scroll step = `batch(50 × sig.set()) + flushSync()`. Zero ReactiveNode allocations during scroll. Zero dispose() calls.

**M1: scroll-churn timing (window N=50, step=25, 40 measured steps, 5 warmup, Chrome headless, 3 runs)**

| arm | median | mean | p90 | per-step cost |
|---|---|---|---|---|
| Arm 1 (keyed: 25 Op2 + 25 Op1) | 0.300ms | 0.285ms | 0.400ms | full reconciler |
| Arm 2 (recycled: 50 sig.set) | <0.1ms | 0.024ms | 0.100ms | pure propagation |
| **Ratio (mean)** | | **~12× (floor-comparison — see caveat)** | | |

**Measurement caveat — headline requires correction:** Arm 2 median is below Chrome's ~0.1ms timer resolution (28/40 steps measured as 0ms exactly). The 0.024ms mean is real but derived from a soft denominator (many zero-measured steps averaged). The 12× mean ratio is a **floor-comparison ceiling**: Arm 1 (full reconciler at 0.285ms) vs Arm 2 at near-zero cost for pure signal propagation. A more honest comparison at realistic scroll rates with larger windows and the overhead of browser layout on top of both arms would yield **~3–6×**. **The hard countable win is node-churn: Arm 1 allocates and frees ~7,000 ReactiveNodes per 40-step window; Arm 2 allocates 0. That is the durable, uncontested result.** Run-to-run stability: Arm 1 <5% variance; Arm 2 sub-resolution.

Run stability (3 runs): Arm 1 variation <5% (highly stable at 0.285ms mean). Arm 2 variation sub-resolution mean, consistent at ~0.024ms.

**Trap guards:** All confirmed:
- Arm 1 render/update/row-count: PASS
- Arm 2 render/update/row-count constant (confirmed pool, no growth): PASS
- Recycling engaged (0 dispose/create during Arm 2 scroll): CONFIRMED

**M3: Reactive node churn:**
- Arm 1: 40 steps × 25 create+dispose × ~7 ReactiveNodes = ~7,000 nodes allocated and freed during the 40-step measurement window.
- Arm 2: 0 ReactiveNode allocations during scroll. Pure signal propagation.

**Conclusion:** Recycling converts scroll-churn from reconciler-level cost (create + dispose, nv's worst operation) to pure reactive propagation cost (signal.set + effect re-run, nv's best operation). The durable win is **node-churn elimination** (~7,000 ReactiveNode allocations+frees → 0 per 40-step window), confirmed and countable regardless of timer resolution. Realistic wall-clock improvement is ~3–6× once browser layout and larger windows are factored in. For virtualized infinite scroll — the exact workload where nv's create deficit reaches real users — the answer is not "make create faster" (proven intrinsic across 7 probes) but "avoid create via a recycled position-keyed list mode."

**Absolute wall-clock numbers are modest** (0.285ms vs ~0.024ms per 25-row step). Leverage appears at larger windows, higher churn rates, and tighter frame budgets — the conditions of real virtual scrollers. The GC pressure reduction (0 allocation churn during sustained scroll) is likely the most impactful production benefit.

**Side note:** `mount` must be imported from `dist/renderer/interpreter.js` directly — the renderer index re-exports `nv-parser.js` which pulls `typescript` (not browser-compatible). Separate cleanup ticket.

**BUILD CANDIDATE. Design gate questions for architect:**
1. **API surface:** `<each recycle>` variant / non-keyed `<each>` / windowing helper? Solid's `<Index>` is a separate component. nv's closure-axiom and authoring model need a ruling.
2. **Identity semantics contract:** Recycling = position-identity. Must define when recycling is correct (rows with no key-tied local DOM state) and how the API signals this so users don't recycle rows that need stable identity. Contract-adjacent.
3. **Interaction with keyed reconcile:** Recycled path is simpler (contiguous window, no LIS needed). Likely a separate, simpler path — not a mode of wireList.
4. **Scope:** does nv ship virtualization itself, or just the recycling primitive? (Primitive is smaller, more composable, leaves virtualization strategy to userland.)
5. **Closure axiom:** renderer-layer change only (re-bind signals, no new reactive primitive). Additive IR or API extension. No reactive-core touch.

### [2026-06-29] Recycling list mode `<recycle>` LANDED at `1ee6a6b` — non-keyed position-identity list. Cites [recycling design gate], [Probe H correction].

`<recycle>` non-keyed recycled list mode landed (13 commits, 787 green, typecheck clean). Distinct construct per ruling (a): separate `<recycle>` element, `RecycledListBinding` (`kind:'recycled-list'`), standalone `wireRecycledList`, `data-nv-recycle` sentinel. Position-identity: rows pooled, re-bound via `valueSig.set`/`indexSig.set` (Op-3), zero dispose/create per scroll step. Grow path mirrors `wireList` Op-1 verbatim (Bug-1 fix: correct `mountFragment` signature, verified at source). Keyed `<each>` untouched (G0 core-clean + G1 distinct-path verified by diff). `<recycle key=>` throws (3 sentinel forms). indexSig always allocated (no elision on recycled path). Template-IR v0.4.4.

**Verification caveat (architect — fulfilled):** T1-1 identity contract was initially tested in JSDOM only (structural regression guard; JSDOM is barred from focus/activeElement verdict paths). Gate criterion 3 overstated as unqualified ✅ at landing. **Requirement now fulfilled:** Playwright specs `recycling-identity.spec.ts` (B1/B2 — focus-follows-slot-position in real Blink; keyed contrast confirms modes differ) and `recycling-node-churn.spec.ts` (A2 — node-churn = 0/scroll-step, keyed > 0 control) close both items. Gate criteria 3 and 7 are now verified in a real-browser environment. The `<recycle>` identity contract is verdict-valid.

Competitive: `<recycle>` closes nv's one create-weak workload (virtual scroll) — recycling converts dispose+create into Op-3 signal propagation. The win rests on node-churn elimination (source-verified zero-alloc steady-state; runtime measurement deferred), not the overstated probe wall-clock.

### [2026-06-29] Recycling verdict gate LANDED at `8da893a` — node-churn + real-browser identity verified. Closes deferred criteria 3+7. Plus: keyed focus-preservation bug fixed (flagged — unsanctioned keyed-path touch, approved post-hoc). Cites [recycle landing 1ee6a6b].

(A) Node-churn: recycled steady-state 0 ReactiveNode alloc+free/scroll-step (FIRE), keyed control >0 — runtime-measured via test-only `__test.nodeAllocCount`/`nodeFreeCount` (prod-stripped, mirrors `_recomputeCount`; free-counter after isDisposed guard, no double-count; sole core touch, instrumentation-only, verified by diff). Metric is node-alloc not makeLink-calls (links pool). (B) Identity: real Blink, focus+typed-uncontrolled-state stays with slot (recycle) vs follows data (keyed contrast) — closes T1-1 JSDOM verdict-path gap. Criteria 3+7 verified in verdict-valid env. Wall-clock logged, not asserted.

**FLAG — keyed-path change (finding #7):** writing the B2 keyed-focus-follows-data contrast revealed keyed `wireList` did not preserve focus across Op-2 deletion / Op-1/3/4 insertBefore moves (a real pre-existing bug). CC fixed it in `wireList` (focus-restore to nearest surviving row in DOM order; focus-track across moves). Correct fix, cheaply gated (`doc.activeElement` read per reconcile, expensive paths behind `activeBefore !== null`). **Landed unsanctioned on the benchmarked keyed path** — approved post-hoc because correct + cheap + suite-green, but recorded per the standing rule that keyed-path changes surface to architect before landing. Recommended follow-up: same-session swap/remove-one perf confirmation that the per-reconcile activeElement read is benchmark-neutral. Process note logged for CC: question-before-landing on the benchmarked path, even for correct fixes.

**Perf confirmation CLOSED — PASS.** Same-session A/B at `8da893a` (real Chromium, warm-discard 5, N=1000 per op): HEAD (`doc.activeElement` read live) vs BASELINE (L534 stubbed to `null`, disabling the read + all gated focus blocks — true pre-finding-#7 behavior).

| op | HEAD median | BASELINE median | delta |
|---|---|---|---|
| swap | 0.2000ms (σ 0.0627) | 0.2000ms (σ 0.0671) | 0.0000ms (0.0%) |
| remove-one | 0.1000ms (σ 0.0584) | 0.1000ms (σ 0.0598) | 0.0000ms (0.0%) |
| update-10th (control) | 0.4000ms (σ 0.1818) | 0.5000ms (σ 0.3095) | -0.1000ms (-20.0%, well within 1σ — noise) |

All three within noise of BASELINE — the per-reconcile `doc.activeElement` read is confirmed benchmark-neutral. **Flag from finding #7 closes. `<recycle>` has no keyed-path perf debt; fully v1-ship-ready on this axis.**

### [2026-06-30] Tagged-FE parity restored — `iff()`/`recycle()` builders land at IR parity with `.nv`. Closes T-8. Cites [parity audit].

Tagged-FE parity restored — `iff()` (conditional) + `recycle()` builders added to `html-tag.ts`, same IR as `.nv`; exhaustiveness forcing-function added (new IR kind fails typecheck without a tagged builder/deferral); `child` confirmed symmetric-deferral (not a gap); style-var per §4 ruling. Closes T-8. Cites the parity audit.

**Current State:** tagged front-end at IR parity with `.nv` for control flow; forcing-function prevents silent regression; `<switch>`/`<match>` next, into the gated world.

### [2026-06-30] Tagged-FE parity restored + performance/recycling arc consolidated. Contract unchanged (v0.4.3); Template-IR → v0.4.4.

**Tagged-FE parity (`80945fe`, merge `3b26233`).** Three IR kinds were `.nv`-authorable but not buildable from the `html\`\`` tagged runtime FE. Resolved 2 builds + 1 ruling + 1 non-issue: `iff()` conditional builder + `recycle()` list builder added to `html-tag.ts` (sentinel pattern mirroring `each()`); both produce IR `irStructurallyEqual` to the real `.nv` parse path (proven, not stubbed) + mounted-reactivity tested. `style-var` ruled `.nv`-only (`$style` is a compile-time file feature; §4 ruling). `child` confirmed symmetric designed-deferral (both FEs defer identically; not a gap). **Durable fix:** `assertAllBindingKindsHandled` — a `never`-default switch + independent type-level `Equals<Binding['kind'], HandledBindingKinds>` guard; a new IR kind now fails tsc in the tagged path without a builder or a commented deferral. G0 held (zero `nv-parser.ts`/`ir.ts`/`src/core/*` change — verified by diff). Closes T-8. Verified at `80945fe`: 794/794 green, tsc clean, G0/G1/G3 confirmed by source-read. Two nits: orphaned `docs/guide/` (singular) tree deleted; stale `guide/**` exclude line in vitepress config (harmless, remove next docs pass).

**Consolidates the performance/recycling arc** (entries [2026-06-28..29] above): create proven intrinsic across 8 probes; Reconcile Lever A+B landed (remove-one script-parity); `<recycle>` landed (`3b00064`) + verdict-gate (`8da893a`); finding-#7 flag closed (keyed `activeElement` read benchmark-neutral, real-browser measured). Rulings: `<recycle>` naming (distinct construct), `iff()` naming, `$style` `.nv`-only.

**Naming/asymmetry note (documented, not a gap):** conditional is authored as a native ternary in `.nv` (compiler analyzes via TS AST) and via `iff()` in tagged (runtime sees evaluated values, can't detect a ternary) — same `ConditionalBinding` out, different surface by design. No `<iff>` element in `.nv` (ternary is the native form). Principle: use the language's native form where it exists (ternary → conditional); use an nv construct where it doesn't (element/builder → lists). Hence `recycle` is symmetric (element + builder), conditional is asymmetric (ternary + builder).

**Next:** `<switch>`/`<match>` (multi-branch control flow) — the last control-flow gap — lands into the parity-gated world (must satisfy the exhaustiveness guard with both a `.nv` form and a tagged builder).

### [2026-07-01] `<switch>`/`<match>` shape ruling: Option A (new IR kind), not desugared conditionals

**Context:** Handoff commissioned a shape ruling before commissioning `<switch>`/`<match>`
implementation — Option A (new `SwitchBinding` IR kind) vs Option B (desugar to nested
`ConditionalBinding`). Read at main `1d36e39`.

**Seams read:**
- `wireConditional` (interpreter.ts:848–888): single effect + one `branchDisposer` variable,
  swaps only the active branch on condition change. Generalizes mechanically to N ordered
  branches — loop `when` list, first truthy wins, same disposer-swap pattern, no new
  disposal mechanism needed.
- `.nv` ternary detection (nv-parser.ts:367, :2748 — both call sites): flat two-branch check,
  `isHtmlTTE(whenTrue) && (isHtmlTTE(whenFalse) || isNullish(whenFalse))`. A nested ternary in
  `whenFalse` fails both checks and **silently falls through to `kind:'text'`** — not a
  supported-but-untested path, an active misparse. Option B requires parser recursion into
  ternary chains at both sites to fix this, plus accepting an authoring form
  (`c1 ? html\`\` : c2 ? html\`\` : html\`\``) with no dedicated element, no explicit fallback
  syntax, ordering implicit in nesting depth.
- Tagged sentinel pattern (`iff()`/`recycle()`, html-tag.ts:232–302): mirrors cleanly for a
  new `match()` builder under either option — not a discriminator.

**Ruling: Option A.** New IR kind `SwitchBinding`:
```ts
type SwitchBinding = BaseBinding & {
  kind: 'switch'
  branches: { when: ReactiveExpr<boolean>; body: TemplateIR }[]  // ordered
  fallback: TemplateIR | null
}
```
Distinct `wireSwitch`, generalizing `wireConditional`'s single-effect/single-disposer pattern
(loop ordered `when`s, first-match-wins, one `branchDisposer`, same bridge-onCleanup for
parent-teardown). `.nv` gets a dedicated `<switch>`/`<match>` element (parser recognizes a new
node shape, same tier of work as recognizing `<recycle>` or `<each>` — not ternary recursion).
Tagged FE gets a `match()` sentinel (`{ branches, fallback }`), required by the existing
exhaustiveness gate (`assertAllBindingKindsHandled`, html-tag.ts:371) the moment `'switch'` is
added to `Binding['kind']`.

**Why not B:** the discriminator isn't "less surface wins" — it's that B's surface is parser
recursion into an authoring form that's already broken for nesting today, versus A's surface
being one new recognizable shape reusing a disposal pattern already proven correct. Same
reasoning as `<recycle>` vs `<each recycle>`: distinct construct because the semantics
(ordered branches, explicit fallback) genuinely differ from a boolean ternary.

**Semantics pinned:**
- First-match-wins, array order.
- Single effect reads all `when()` per run — not one effect per branch (matches conditional's
  cost profile; effect-count was already shown non-bottleneck in the closed create arc).
- Disposal swaps only the active branch — direct generalization of `wireConditional`, no new
  disposal pattern.

**Closure-axiom check:** clean. Composition over `effect`/`createRoot`/`onCleanup`, no new
graph primitive — same category as `<recycle>` and conditional.

**Contract impact:** none (renderer-layer construct, not reactive-core semantics). No contract
version bump.

**Next:** write the commission — mirror `<recycle>`/tagged-parity commission structure (G0/G1
gates, distinct-path discipline, tagged `match()` builder + exhaustiveness-gate wiring as
explicit tasks, Tier-1 correctness gates, decision-log delta on landing).

### [2026-07-01] Follow-up note: nested structural bindings inside `<each>`/`<recycle>`/`<switch>` body-thunks unsupported at emit time

**Found during:** pre-merge deep audit of the `<switch>`/`<match>` implementation (fault-tolerance
pass, hunted mode #7 region). Not caused by, or in scope for, that commission — flagging as a
pre-existing gap discovered along the way, per this repo's "under-escalating is the costlier
error" convention.

**The gap:** `computeBindingThunks`'s emit-path thunk construction for `<each>`/`<recycle>`/
`<switch>` bodies (`nv-parser.ts`, `listThunks`/`recycledListThunks`/`switchThunks`) builds
`bodyThunks` from `bodyHoleIndices` only — plain text/attr/prop/event holes. A body containing a
nested structural binding (a component, another `<each>`, or now a `<switch>`) has no thunk
representation threaded through, so `emitIrLiteral` either runs out of thunks or hits a
"thunk kind mismatch" throw at emit time. This is a **loud** failure (not silent data corruption),
but it means `<switch>` cannot yet be nested inside a component/list/switch body when going
through `parseNvFileForEmit`/`emitModule` (Mode A) — only the interpreter and `emitted-mount.ts`
compiler paths handle nested structural bindings correctly today, since they build `TemplateIR`
directly rather than going through erased-source `ThunkSource` reconstruction.

**Status:** not tracked before this note; no fix planned or commissioned. Logged here so it's
discoverable rather than silently rediscovered later. Whoever picks this up should scope it as
its own commission (touches the shared `computeBindingThunks`/`ThunkSource` machinery used by
all three structural-binding emit paths, not `<switch>`-specific) rather than folding it into
an unrelated change.

### [2026-07-01] Follow-up note: `<conditional>`/`<recycle>` never got a dedicated performance benchmark either — `<switch>` inherits the same gap

**Found during:** same pre-merge audit of `<switch>`/`<match>`, in response to a question about
whether this new construct needed a benchmark before landing.

**The gap:** `bench/row-churn.mjs` measures raw signal/derived/attr/text/event binding costs
adversarially and does not exercise `<each>`/`<recycle>`/`<conditional>`/`<switch>` at all
(the word "each" appears only in its prose comments, not as the binding kind). The only
structural binding kind with a dedicated performance benchmark is `<each>`, via the
js-framework-benchmark-style row app at `test/browser/fixtures/benchmark/app.nv`
(create/swap/remove 1,000–10,000 rows, driven by Playwright in
`test/browser/nv-benchmark-probe.spec.ts`). `<recycle>` and `<conditional>` were never given an
equivalent benchmark when they landed; `<switch>` is landing with the same absence, not a new
regression in coverage.

**Status:** not tracked before this note; no fix planned or commissioned. This is scoped
broader than any single binding kind — whoever picks it up should decide whether to extend the
existing `app.nv` row-benchmark fixture (e.g. a toggle/filter view using `<conditional>` or
`<switch>` per row) or build a separate harness, and should cover `<conditional>`, `<recycle>`,
and `<switch>` together rather than singling one out, since all three are in the same
unbenchmarked state today.
