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

_Last updated: 2026-07-02. Template-IR **v0.4.5**, reactive-core contract **v0.4.3**.
Control-flow completion (PT-3) DONE. Mode-A nested structural: all 4 directions closed
(A `b0409cf`, A′ `3a3cdbe`). Follow-up B LANDED (`209c33b`) — `<recycle>` churn gated
across scroll/replace/append/prepend; grow/shrink advisory → B′ open (design)._
_Active frontier: v0.5.0 API-parity. Control-flow completion (PT-3) DONE. Performance arc CLOSED._

> History before `Component API spec APPROVED [2026-06-20]` is in
> `decision-log-archive.md` (moved 2026-06-21).

### Status at a glance
- **Nomenclature (LOCKED [2026-07-02]):** angle brackets = real `.nv` element. Elements:
  `<each>` (`'list'`), `<recycle>` (`'recycled-list'`), `<switch>`/`<match>` (`'switch'`).
  **conditional is NOT an element** — IR kind `'conditional'`, authored as `.nv` ternary
  or tagged `iff()`. Write bare "conditional" for the construct, `'conditional'` for the
  IR kind. Never `<conditional>`.
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
- **Renderer:** interpreter + compiler back-ends at parity for all **16** binding kinds
  (`text attr prop event sync classlist toggle static list component slot-outlet
  conditional recycled-list style-var child switch`). Both front-ends (tagged-template + `.nv`)
  produce one IR, FE-equivalence-gated. **Tagged-FE parity CLOSED 2026-06-30** — `iff()`
  (conditional) + `recycle()` builders added; `child`/`style-var` are typechecked
  documented deferrals; a `Binding['kind']` exhaustiveness forcing-function (`never`-default
  + type-level `Equals`) now fails tsc if a new IR kind lacks a tagged builder or logged
  deferral. Template-IR doc at **v0.4.5**.
- **Control-flow constructs — COMPLETE (PT-3 DONE).** `<each>` (keyed list), `<recycle>`
  (non-keyed positional list — `3b00064`), conditional (`.nv` ternary / tagged `iff()`),
  **`<switch>`/`<match>` (multi-branch — LANDED `61d5987`, verified at SHA).** New IR kind
  `SwitchBinding` (`kind:'switch'`), ordered first-match-wins + `fallback`. Dedicated `.nv`
  `<switch>`/`<match>` element + tagged `match()` sentinel, identical IR (FE-equivalence-
  gated). `wireSwitch` = structural generalization of `wireConditional` (single-effect,
  single-disposer, createRoot-per-branch, onCleanup bridge — N branches via for/break).
  All three back-ends at parity (interpreter, `emitted-mount.ts` compiler, Mode-A emitter —
  the 3rd was a halt-checkpoint scope addition, approved mid-plan). Two footgun guards
  added (stray `<match>` outside `<switch>`; non-`<match>` children of `<switch>`). Closure-
  clean (no `src/core/` diff). Template-IR **v0.4.5**; contract unchanged v0.4.3. The last
  open control-flow gap is closed.
- **Tracked-open follow-ups (surfaced by the switch/match audit, neither on the roadmap —
  general misses, now logged not silent):**
  - **Follow-up A — nested structural bindings on the Mode-A emit path — LANDED
    `b0409cf` (3 of 4 nesting directions).** Recursive `ThunkSource` reconstruction
    (Option 1; Option 2 dead — `bodyIR` is stub-accessor-built, emit needs source
    strings). component/each/switch nest freely inside each/recycle/switch bodies on
    all three back-ends, real-browser-gated. Two in-branch bug fixes (phantom
    hole-thunk `7f00ae4`; bare-anchor multi-root `156a1ef`). Closure-clean (empty
    `src/core/` diff). **One direction deferred → Follow-up A′.** See [2026-07-01]
    log entry.
  - **Follow-up A′ — `<recycle>`-in-`<each>` emit support — LANDED `3a3cdbe`.** 4th/4
    Mode-A nesting direction closed. Two-line collapse (removed parse throw +
    `!isEachBody` gate; `pushRecycledListBinding` now unconditional). Ruling (a) proven
    empirically (real-browser parity fixture passed with no other fix). Positional-
    pairing invariant made structural — the invariant-by-guard hazard flagged at A
    landing is closed. Two-back-end parity (compiler `recycled-list` is a pre-existing
    stub, not on v1 path — `<recycle>` parity bounded by its own back-end coverage;
    three-back-end was a commission overreach, accepted). Closure-clean (empty
    core/interpreter/emitted-mount diff). See [2026-07-02] log entry.
  - **Follow-up B — perf harness for conditional / `<recycle>` / `<switch>` — LANDED
    `209c33b`.** `<recycle>` churn now failable-gated across replace/append/prepend (+
    pre-existing scroll-window `8da893a`), keyed-contrast-validated, real-browser ×3.
    Two scope corrections: (#1) no in-repo foil venue exists — CP-2d was external/manual,
    never committed; Deliverables 2/3 built nv-only advisory (commission's foil premise
    was an architect error). (#2) `<recycle>` has no zero-churn guarantee across window
    grow/shrink — `wireRecycledList` has no free-list retention (`alloc=10000 free=6000`);
    previously-undocumented gap, not a regression; tracked advisory → Follow-up B′.
    conditional/switch have floor baselines (binding-free, don't generalize). Test-infra
    only (zero `src/` diff).
  - **Follow-up B′ — high-water-mark pooling for `<recycle>` window resize — OPEN
    (design, unprioritized).** Grow/shrink churns because `wireRecycledList` sizes the
    pool to exact length, no free-list retention. Churn-vs-memory tradeoff, not a bug.
    Advisory grow/shrink logs are the evidence base. Decide worth-building before
    commissioning. See [2026-07-02] log entry.
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

> [2026-06-22] `$style` scoping + class-selection: design APPROVED (rulings 1-4 + class axis). -> archived.

---

> [2026-06-23] Increment S (S1+S2) LANDED on `main`, architect-verified. -> archived.

---

> [2026-06-23] Increment SS LANDED `58afe25` (commits b8be335..a071b1b) + bookkeeping correction (659/0, no skip). -> archived.

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

> [2026-06-24] D-slot-2 CLOSED - premise dissolved; D-slot-1 already produces invocation-scoped ownership. -> archived.

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

> [2026-06-28] P-2c-A1 inert-effect harvest LANDED d142919; contract v0.4.2→v0.4.3 (§6.2). → archived.

---

> [2026-06-29] <recycle> landed 1ee6a6b + verdict gate 8da893a (node-churn/identity). → archived.

---

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

### [2026-07-01] `<switch>`/`<match>` LANDED `61d5987` — PT-3 control-flow complete

**Commission:** SwitchBinding (Option A, per [2026-07-01] shape ruling), symmetric across
`.nv` `<switch>`/`<match>` + tagged `match()`, interpreted + compiled at parity.

**Landed (`61d5987`, verified at SHA — placed source read, not report-trusted):** IR kind
`SwitchBinding` (ir.ts:169) added to the `Binding` union; `wireSwitch` (interpreter.ts:897)
single-effect/single-`branchDisposer`/for-break-first-match/createRoot-per-branch/onCleanup-
bridge — structural generalization of `wireConditional`, audited as genuinely identical
observable behavior, not a drifting copy; compiler case in `emitted-mount.ts`; **third
back-end** (Mode-A emitter, `86ed084`/`6d6e622`) added as a halt-checkpoint scope expansion
(real end-user surface, approved mid-plan). Tagged `match()` sentinel (`__nvMatch`,
html-tag.ts:308) + exhaustiveness-gate case + independent `HandledBindingKinds` union entry.
`.nv` on the dedicated element-recognition tier; ternary-detection path confirmed untouched.
FE-equivalence gated against the shared IR oracle. **No `src/core/` diff** (closure-clean, no
new primitive). tsc-strict clean; 813/813 tests reported (not re-run in verification sandbox).

**Deviations from commission text, all flagged/approved:** (1) 3rd back-end (above). (2) two
footgun guards beyond spec — stray `<match>` outside `<switch>` renders nothing (caught
pre-execution); non-`<match>` children of `<switch>` silently dropped (caught in deep audit);
both fixed. (3) compiler shares one read-only empty `ReadonlyMap` across branches vs the plan's
one-per-branch — audited safe (read-only), plan text corrected to match reality.

**Verification:** implementer→independent-review→independent-test-rerun per task (7); whole-branch
Opus review vs literal G0/G1 text; then 3 parallel Opus audits (coherence/axioms; fault-tolerance
adversarial; efficiency/docs/gate-re-derivation), each re-running tsc/tests independently. Zero
Critical, zero Important; six Minor, all fixed + re-verified.

**Two pre-existing gaps surfaced by the audit, logged as separate [2026-07-01] follow-up entries
(neither on the roadmap — general misses, not tracked debt):** (A) nested structural bindings
unsupported on Mode-A emit path — pre-existing in `<each>`/`<recycle>`, back-end asymmetry,
recommended as priority standalone commission; (B) no dedicated perf benchmark for `<conditional>`/
`<recycle>`/`<switch>` — recommended as one combined harness, value is regression-guarding
`<recycle>`'s node-churn claim.

**Contract impact:** none (renderer-layer). Template-IR **v0.4.4 → v0.4.5**. reactive-core
contract unchanged (v0.4.3).

**Result:** PT-3 (control-flow completion) DONE. `<switch>`/`<match>` was the last open
control-flow construct.

### [2026-07-01] Follow-up A LANDED `b0409cf` — nested structural bindings on the Mode-A emit path (3 of 4 nesting directions); recycle-in-each spun to A′

**Commission:** `commission-nested-structural-emit.md` (Follow-up A from the
[2026-07-01] `<switch>`/`<match>` audit). Close the Mode-A emit-path asymmetry:
component / `<each>` / `<recycle>` / `<switch>` nested inside an each/recycle/switch
body threw a "thunk kind mismatch" at emit time, because body reconstruction from
erased source was flat (`bodyHoleIndices`-only), while the interpreter and
`emitted-mount.ts` compiler handled nesting correctly by building `TemplateIR`
directly.

**Design fork ruled — Option 1 (recursive `ThunkSource` extension); Option 2 dead.**
Confirmed at source: the pending-infos' `bodyIR` is built with **stub accessors**
(`(() => undefined)`-style), so there is no path from an evaluated stub closure back
to source text — and emit needs erased *source strings* to produce a re-executable
module. Option 2 (emit from `bodyIR` directly) is therefore impossible, not merely
inferior. Evidence in `docs/design/design-nested-structural-emit.md` (authored +
committed before any `src/` change, per Gate-P). Verified against placed source:
`NestedStructuralPending` (nv-parser.ts:533) threaded through
`NvWalkedEach`/`NvWalkedRecycle`/`NvWalkedMatchBranch` + `PendingNv*Info`; four new
`ThunkSource` body channels (`bodyComponentThunks`/`bodyListThunks`/
`bodyRecycledListThunks`/`bodySwitchThunks`, nv-parser.ts:136–139); single recursive
`computeBodyThunks` (nv-parser.ts:3538) shared across all four body sites, distinct
from `computeBindingThunks` (:3633) — no duplicated per-kind logic (collapse
discipline held). Emitter concatenates the five channels in the exact push order
hole → component → list → recycledList → switch (nv-emitter.ts:178–184) — the
correctness-critical ordering invariant.

**Two bugs found via the real-browser gate (not unit tests) and fixed in-branch:**
- **Phantom hole-thunk (`7f00ae4`):** `bodyHoleIndices` is the union of real leaf
  holes AND holes consumed by nested structural children's own prop/`.of`/`key`/`when`;
  mapping over the union produced a spurious thunk that desynced positional pairing —
  the same "thunk kind mismatch" one layer deeper. Fixed by threading a separate
  leaf-only field (`bodyLeafHoleIndices`, nv-parser.ts:547/550) used solely for
  `bodyThunks`; the union field is untouched elsewhere. Added `emitModule`-level
  regression tests across the matrix (the unit suite only exercised
  `parseNvFileForEmit`).
- **Bare-anchor multi-root (`156a1ef`):** an each/recycle body whose only content is a
  single nested structural child with no wrapping element collapsed to a bare anchor,
  inserting the child's DOM as a *sibling* → >1 top-level node → list runtime's
  one-root-per-item invariant thrown, silently dropping all but the first item. Fixed
  with a `needsSyntheticRoot` guard (nv-parser.ts:1293) auto-wrapping such bodies,
  scoped narrowly to `<each>`/`<recycle>` bodies (not switch branches, not slot
  content); provably no-op for the common single-root case, regression-tested.

**G1 nesting matrix, real-browser gated** (Playwright, Chromium+WebKit+Firefox; JSDOM
barred): component-in-each, each-in-each, switch-in-each, each-in-switch-branch,
component-in-switch-fallback, switch-in-each-in-switch (3-level, proves recursion
terminates), each-in-recycle. Three-back-end parity (interpreter / `emitted-mount.ts`
/ Mode-A, same fixture), reactivity-through-nesting, disposal-through-nesting all
gated.

**One nesting direction NOT closed — `<recycle>` nested inside `<each>` — spun to
Follow-up A′.** This throws a loud parse-time error (`[nv] <recycle> cannot be nested
inside an <each> body`, nv-parser.ts:1329). Stated rationale in-code is capability,
not semantics: "the emitter cannot handle it" (:1327). The throw additionally
**props up the fix's own positional-pairing invariant** — the `bodyRecycledListThunks`
assembly at :3603 is only safe today because `pending.recycles` is guaranteed empty in
an each-body by this guard (:3597 comment); lifting the guard without updating the
binding-push logic in lockstep would desync. So this is **nv-specific emit-path debt
with a latent invariant hazard**, not an intrinsic limitation.

**Verified against the foil set — this limitation exists in no comparable engine:**
- **Solid** (fine-grained, no-VDOM — nv's architectural foil): `<For>`/`<Index>`
  nest freely in all directions; control-flow constructs are runtime components whose
  JSX-returning callback *is* the body, composing recursively by construction. No
  emit-reconstruction path exists to desync. No such restriction.
- **Svelte 5** (compiler-driven, `.svelte` → JS — nv's compile-model foil): nested
  `{#each}` (keyed and unkeyed) is first-class and explicitly tested
  (`transition-js-nested-each-keyed-move`). Keyed vs unkeyed is a per-block choice,
  freely nestable. No such restriction.

Both the fine-grained foil and the compile-model foil support arbitrary control-flow
nesting; nv shipping 3-of-4 directions is a visible gap against both. Closing it is
tracked as Follow-up A′ (below).

**Deviations from commission (all in-spirit, none touching `src/core/`):** two
in-branch bug fixes (above); one fixture (each-in-recycle) added post-matrix to close
a coverage gap; `docs/gates/nested-structural-emit.md` authored retroactively (an
AGENTS.md process deviation — gate file is required *before* CC starts — corrected
before landing, deviation noted in the gate file). Two rounds of post-"done"
adversarial review (CC-run) surfaced: a pre-existing component-slot-content nesting
gap (out of scope, restored to landing report + `implementation-state.md`); the
ordering-invariant + leaf/union split being convention-enforced not type-enforced
(flagged as design debt, not a defect); and the missing gate file (fixed).

**Also logged by CC as out-of-scope, not fixed (pre-existing, not regressions):**
component slot-content nesting has the same hole-only limitation (never fixed
anywhere); self-closing custom-element tags drop trailing siblings (HTML-parser
quirk); all-static `$render` templates skip component-element detection. All three in
`docs/design/nested-structural-emit-landing-report.md`; #1 also in
`docs/implementation-state.md`.

**Contract impact:** none (renderer/emit-path only). The `ThunkSource` body-shape
change is an internal emit type, not a public IR kind — **no Template-IR version bump**
(Template-IR stays v0.4.5; the change doesn't alter the public IR surface documented
there). reactive-core contract unchanged (v0.4.3).

**Result:** Follow-up A closed for 3 of 4 nesting directions. recycle-in-each →
Follow-up A′.

### [2026-07-01] Follow-up A′ opened — `<recycle>`-in-`<each>` emit support (close the 4th nesting direction)

**Opened by:** Follow-up A landing ([2026-07-01], `b0409cf`), which closed 3 of 4
Mode-A nesting directions. Verified against Solid + Svelte 5 that all-directions
nesting is the foil-set norm; the remaining nv restriction is emit-path debt, not
intrinsic.

**Scope:** make `<recycle>` nested inside an `<each>` body emit correctly on the
Mode-A path, reaching full four-direction parity, and remove the double-duty guard at
nv-parser.ts:1329/:3597 (currently both a capability gate and an invariant prop) —
replacing invariant-by-guard with invariant-by-construction or type. Commission:
`commission-recycle-in-each-emit.md`.

**Status:** OPEN. Held behind nothing (Follow-up A is done). Gate-P-first: the
implementer confirms whether the existing recursive `computeBodyThunks` machinery
extends cleanly to `pending.recycles` in an each-body, or whether the positional-
pairing invariant needs restructuring, and submits a plan before any `src/` touch.

---

### [2026-07-02] Follow-up A′ LANDED `3a3cdbe` — `<recycle>`-in-`<each>` emit support; 4th nesting direction closed; invariant made structural

**Commission:** `commission-recycle-in-each-emit.md`. Closes the one nesting direction
Follow-up A ([2026-07-01], `b0409cf`) left open.

**Fork ruling — (a) stale-guard, empirically proven.** The commission required an
(a)/(b) ruling before `src/`, and required the runtime axis be proven by a rendering
fixture, not structural inference alone (the gap flagged in architect review of CC's
pre-implementation ruling). Confirmed both ways: (1) structural — the top-level
`pushRecycledListBinding` call, `toPendingBundle`, and `computeBodyThunks`'s
`computeRecycledListThunks` call were already unconditional/uniform; only the
binding-push gate + parse throw singled out each-bodies; (2) empirical — the two-line
collapse (remove throw, remove `!isEachBody` gate) applied with **no other fix**, and
the real-browser parity fixture (interpreter `mount()` vs. real Mode-A `.nv → esbuild →
bundle`, fixed-value oracle) passed first run on Chromium/WebKit/Firefox. No latent (b)
surfaced.

**Change (nv-parser.ts only, +9/−19; verified empty core/interpreter/emitted-mount
diff):** removed the parse throw + `!isEachBody` binding-push gate — `pushRecycledListBinding`
now unconditional, symmetric with `pushListBinding`/`pushSwitchBinding` (one path, not a
fourth — collapse discipline). Removed the now-dead `isEachBody` parameter from
`buildNvSlotContentIR` outright (deviation beyond the plan's comment-only wording; a
zero-read param would be a dead-code finding). Replaced the two stale "each-body can't
handle `<recycle>`" comments — notably `computeBodyThunks`'s, which admitted its
positional pairing was "safe TODAY only because" the throw kept `pending.recycles` empty;
it now states the pairing holds by construction. **This closes the invariant-by-guard
hazard flagged at the A landing** — correctness no longer depends on a parse throw
staying in place.

**Tests:** `P2C-NEST-03` rewritten (throw-assertion → correct nested-`ThunkSource`
emission); new `P2C-NEST-03b` — invariant-by-construction proof (each-body `bodyIR` has
exactly 1 `recycled-list` binding; `bodyRecycledListThunks.length` equals that count).
Six new real-browser tests (×3 browsers = 18): DOM mount, two-back-end parity,
reactivity-through-nesting, per-item recycling with cross-scope isolation, outer keyed
identity across reorder, disposal-through-nesting (owner-tree deficit). Red→green proven
via `git stash` round-trip to `7d94e0d`.

**Deviations (both flagged, accepted):** (1) **two-back-end parity, not three** —
`emitted-mount.ts`'s `recycled-list` case is a pre-existing unconditional stub
(`RecycledListBinding not yet implemented in compiler back-end`, emitted-mount.ts:808–812),
not on the v1 build-pipeline path, covering top-level `<recycle>` too. `<recycle>` can't
be more parity-complete than the compiler back-end supports; the `each-in-recycle`
precedent (Follow-up A) already established Mode-A-only parity for this. **The
commission's three-back-end requirement was an architect overreach** — recycle-in-each
parity is bounded by `<recycle>`'s own back-end coverage. Accepted. (2) `isEachBody`
removed outright vs. comment-only — dead-code avoidance, in-spirit.

**`ThunkSource`/pending shape:** unchanged, no new fields — reachability gap only.
**Contract impact:** none. Template-IR unchanged (v0.4.5). reactive-core contract
unchanged (v0.4.3).

**Result:** all four Mode-A nesting directions (component/each/switch/recycle inside
each/recycle/switch bodies) now closed. Follow-up A′ done. Follow-up B (combined perf
harness) promoted from held → next.

---

### [2026-07-02] Nomenclature LOCKED — "conditional" is an IR kind, not an element; `<conditional>` is wrong everywhere

**Problem:** `<conditional>` (angle-bracketed) leaked into prose starting with the
[2026-07-01] follow-up notes and propagated through the Follow-up B commission, its
plan, spec comments, and Current State. **There is no `<conditional>` element.**
Verified at source (`209c33b`):

**Authoring surface — what is and isn't an element (nv-parser.ts):**
- `<each>` — element (`data-nv-each`, :628). IR kind `'list'` (ir.ts:194).
- `<recycle>` — element (`data-nv-recycle`, :729). IR kind `'recycled-list'` (ir.ts:226).
- `<switch>`/`<match>` — elements (`data-nv-switch`/`data-nv-match`, :824-919). IR kind
  `'switch'` (ir.ts:170).
- **conditional — NOT an element.** IR kind `'conditional'` (ir.ts:153). Authored as a
  `.nv` ternary (`${cond ? html`` : html``}`, nv-parser.ts:391) or the tagged `iff()`
  builder. nv has no `<if>`/`<iff>`/`<conditional>` element by design — ternary is native
  (this was settled at the `<switch>`/`<match>` shape ruling, [2026-07-01]).

**Ruling — locked vocabulary:**
| Construct | Correct prose | IR kind | Authoring surface |
|-----------|---------------|---------|-------------------|
| 2-branch conditional | **conditional** (no brackets) | `'conditional'` | `.nv` ternary / tagged `iff()` |
| multi-branch | **`<switch>`/`<match>`** | `'switch'` | `.nv` element / tagged `match()` |
| keyed list | **`<each>`** | `'list'` | `.nv` element / tagged `each()` |
| positional list | **`<recycle>`** | `'recycled-list'` | `.nv` element / tagged `recycle()` |

- Angle brackets denote a real `.nv` element. Never write `<conditional>` — it implies a
  tag that does not exist. Write **conditional** (bare) for the construct, or
  **`'conditional'`** (quoted) when referring specifically to the IR kind.
- Do not conflate a construct with its IR-kind name. `'list'` is the IR kind; `<each>`
  is the construct/element. They are not interchangeable in prose.

**Scope of correction:** the Follow-up B closure delta is corrected before paste (bare
"conditional"). 16 committed occurrences of `<conditional>` remain in source
(`nv-benchmark-conditional.spec.ts` header comments, the B plan doc, and the
[2026-07-01] follow-up-note + [2026-07-02] B entries in this log). **These are prose/
comment-only — no code or filename is affected** (`benchmark-conditional` as a fixture/
spec *name* is accurate and stays). CC to grep-and-fix the angle-bracketed prose in the
two committed files (`test/browser/nv-benchmark-conditional.spec.ts`,
`docs/superpowers/plans/2026-07-02-followup-b-perf-harness.md`) in a docs-only pass. The
prior dated Log entries are **not** rewritten (append-only) — this entry supersedes their
vocabulary by citation.

**Contract impact:** none. Naming convention only.

---

### [2026-07-02] Follow-up B LANDED `209c33b` — perf harness for conditional / `<recycle>` / `<switch>`; two scope corrections

**Commission:** `commission-followup-b-perf-harness.md`. Extend the existing `<recycle>`
node-churn gate to a scenario matrix (failable), add conditional/switch advisory
baselines, integrate the jfb foil venue.

**Premise correction (carried from the commission, now recorded permanently).** The
[2026-07-01] Follow-up B note claimed `<recycle>`'s node-churn→0 rested on "a one-shot
verdict probe (`8da893a`), not a standing benchmark." **False.** Verified at `ce81714`:
`recycling-node-churn.spec.ts` (`8da893a`) was already a standing, failable,
real-browser gate (asserts `nodeAllocCount===0 && nodeFreeCount===0`, keyed contrast,
default `pnpm test:browser`, no skip). B extended its scenario coverage; it did not
create a gate. The original three tests (`A2 recycled`, `A2 keyed control`, `A3
wall-clock`) are byte-unmodified across the branch (verified: no `-` removals in the
diff).

**Landed (test/benchmark infra only, zero `src/` diff, verified):**
- **Deliverable 1 — churn matrix, failable, real-browser (Chromium+WebKit+Firefox).**
  `recycling-node-churn.spec.ts` extended with a parametrized matrix — one shared
  `runChurnScenario` helper over a `SCENARIOS` table, not forked specs (collapse
  discipline held, verified at spec:254-280). **Failable** (recycled `alloc===0 &&
  free===0`, keyed-contrast `toBeGreaterThan(0)` proving churn is detectable):
  **replace, append, prepend** — all pass; keyed arm shows scenario-proportional churn
  (~4 ReactiveNodes/newly-keyed row). **Advisory** (logged, never asserted): grow,
  shrink (see scope correction #2).
- **Deliverable 2 — nv-only wall-clock venue** (`nv-benchmark-recycle.spec.ts`, 10
  scenario×arm tests, sentinel-only, timing never asserted) — see scope correction #1.
- **Deliverable 3 — conditional/switch advisory baseline** (`nv-benchmark-conditional.spec.ts`
  + `fixtures/benchmark-conditional/`, none existed before). Records wall-clock +
  alloc/free per branch swap. **Caveat recorded in-file:** the measured 1-node-alloc/
  1-free-per-swap reflects deliberately *binding-free static* branch content; it does
  not generalize to branches containing real bindings. This is a floor baseline, not a
  representative one.

**Scope correction #1 — the in-repo jfb foil venue does not exist.** The commission's
Deliverables 2/3 assumed an in-repo, CI-runnable Solid/Svelte/Lit/React/Vanilla harness.
Verified false: no foil deps in `package.json`; the real 5-framework comparison (CP-2d)
was a one-off external manual Puppeteer run against a cloned `js-framework-benchmark`,
never committed here. **The commission's foil-venue premise was an architect error.**
Resolution: Deliverables 2/3 built as nv-only advisory venue (same esbuild+Playwright
pattern as `nv-benchmark-probe.spec.ts`), real numbers logged, no live foil comparison.
A foil comparison remains the external CP-2d-style manual process — a separately-scoped
workstream (vendoring 4 frameworks + a non-Playwright driver), not buildable inside this
deliverable.

**Scope correction #2 — `<recycle>` has no zero-churn guarantee across a window-size
resize.** Verified at source (`wireRecycledList`, interpreter.ts:777-849): the pool
re-binds slots `[0, min(N,P))` with zero churn (the constant-window fast path
`8da893a` covers), but **grows** by allocating fresh records `[P,N)` (createRoot +
pool.push) and **shrinks** by disposing `[N,P)` + truncating `pool.length=N` — **no
free-list retention across a resize.** Reproduced: `alloc=10000 free=6000` for grow and
shrink over the 40-step window. **This is a previously-undocumented gap, not a
regression** — `8da893a`'s claim only ever covered a fixed-size sliding window; source
confirms resize was never zero-churn. Resolution (Kofi-confirmed): grow/shrink tracked
**advisory** (logged every run, standing evidence trail), not dropped. Opens a follow-up
candidate (below).

**Deviations (all flagged, none touching `src/`):** `replaceAll` fixture preserved row
ids (keyed contrast couldn't detect churn) — fixed to assign new ids; single-body
10-combo wall-clock test timed out on Firefox — split per scenario×arm; shared `dist/`
bundle path between two specs (benign byte-identical race) — tidied; two measurement-audit
caveats added (IPC-timing note, fixture-specific-figure note).

**Contract/Template-IR:** unchanged (v0.4.3 / v0.4.5) — benchmark/test infra only.

**Result:** Follow-up B done. `<recycle>` churn now gated across replace/append/prepend
(plus the pre-existing scroll-window); grow/shrink advisory with a standing evidence
trail; conditional/switch have floor baselines. Follow-up A/A′/B all closed — the
control-flow arc's tracked debt is clear except the new grow/shrink candidate.

---

### [2026-07-02] Follow-up B′ opened — high-water-mark pooling for `<recycle>` window resize (churn-vs-memory tradeoff)

**Opened by:** Follow-up B scope-correction #2 ([2026-07-02], `209c33b`). Grow/shrink
window resize churns (`alloc=10000 free=6000` measured) because `wireRecycledList`
(interpreter.ts:777-849) sizes the pool to exact current length with no free-list
retention.

**Question (design-open, not a bug):** should `wireRecycledList` retain a high-water-mark
pool — keep disposed slots on a free-list across shrink, reuse them on regrow — to make
resize zero-churn, at the cost of holding memory for the largest window ever seen? This
is a **churn-vs-memory tradeoff**, not a correctness fix. The advisory grow/shrink logs
(Deliverable 1) are the standing evidence base for deciding whether it pays.

**Escalation note:** likely in-stream (renderer pool-management data structure, no §1
invariant, doesn't change what a computation observes) — but the free-list retention
touches `wireRecycledList`'s disposal timing, so read the seam and confirm it doesn't
alter observable disposal semantics before ruling. If it does, escalate.

**Status:** OPEN, unprioritized. Not blocking. Decide worth-building from the logged
numbers before commissioning.
