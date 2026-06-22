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

_Last updated: 2026-06-22. Contract **v0.4.2** · Template-IR **v0.3.3**._

> History before `Component API spec APPROVED [2026-06-20]` is in
> `nv-decision-log-archive.md` (moved 2026-06-21). This snapshot is the resolved
> picture; the Log below holds the active arc (Component API → slot consumption).

### Status at a glance
- **Reactive core:** Contract **v0.4.2**, 40/40 conformance. DOM-free. Field order
  locked (cache-load-bearing). `getOwner`/`runWithOwner` in §6.1/§11/§12.24.
- **Compiler specialization (steps 1–4):** all wired + gated + measured. Step 3
  (`_compilerEquals`) kept for correctness; step 4 (`_compilerSources`) SHELVED
  (no benefit path). Steps 1–2 (sync classify + cycle check) are the correctness layer.
- **Renderer:** interpreter + compiler back-ends at parity for all binding kinds.
  Both front-ends (tagged-template + `.nv`) produce one IR, FE-equivalence-gated.
- **Build pipeline `.nv → .js`:** Mode A, landed. Executable-module gate closed.
- **Component API v1:** LANDED. Composition works end-to-end through the compiled
  path (A2 factory-shape convergence).
- **Slot consumption — increment 1 LANDED (2026-06-22):** GATE-2 walk-collapse (retired
  `buildSlotSubIR`/`buildNvSlotSubIR`); component-as-slot-child (nested-component deferral
  closed); fallback (`SlotOutletBinding.fallback?`). Template-IR → v0.3.3. D-slot-1
  retained. Increment 2 (scoped slots + D-slot-1 retained, D-slot-2 re-phased to `each`) queued.
- **Real-browser gate:** PASSED across Blink/Gecko/WebKit (36/36). Phase 0 closed.
- **Perf-validation phase:** COMPLETE. All three tripwires resolved (createSignals
  cleared structural-accepted; FALSE-heavy characterized watch-item; cross-engine
  closed). No redesign triggered.
- **Tests:** 3237 green at last report (slot increment 1, 2026-06-22). `tsc --strict`
  + DOM lib, biome, build all clean.

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

### Open design decisions (chosen later; not blocking)
- Compile-time vs. runtime split beyond the read/write transform (scheduling,
  encapsulation) — narrowed, not closed.
- Effect-flush timing primitive (microtask vs. custom scheduler).
- Compile-time full encapsulation (DOM + style) — genuine research.

### Genuine research / deferred-on-evidence
- Beating the alien-signals-class baseline: nv wins/ties 5 of 7 cases; two wide-graph
  cases (~1.5x/~1.7x) and createSignals (~5–7x) are proven **structural**, both trace to
  `ReactiveNode` width, both gated behind the **kind-split tripwire** (real-app
  evidence only — noted, not approved).
- **FALSE-heavy row-churn** watch-item (reopen on real-app evidence with a
  steady-state-update harness).

### Forward queue (named, not blocking)
- **Slots — design APPROVED (2026-06-22), Path B phasing:** Increment 1 (LANDED 2026-06-22) =
  GATE-2 walk-collapse + component-as-slot-child + fallback (`SlotOutletBinding.fallback?`);
  Template-IR → v0.3.3. Increment 2 (queued) = scoped slots (`SlotEntry.content` factory +
  `SlotOutletBinding.props` + `let={...}` authoring); **D-slot-1 retained**; Template-IR →
  v0.4. **D-slot-2 re-phased** to land with `each` (2026-06-22 re-phasing entry).
- `$style` scoping/injection (parsed, not emitted); `$style × slots` (parked behind
  `$style` scoping).
- SyncBinding (throws at both back-ends today).
- LIS list move-minimization (parked, gated on row-churn reorder cost).
- Multi-root list items (single-root guard today; close before promoting multi-root).
- `roots[0] as Node` biome-laundering cleanup (cosmetic).
- kind-split (parked behind real-app wide-graph evidence).

### Naming
- `neutro/view` / `nv` working name; package under `@neutro` (view engine is
  *portable/interoperable*, not strong-agnostic like the pure-logic packages).

### Superseded
- **D-slot-2 in increment 2** — superseded 2026-06-22; flip re-phased to land with `each` (see log entry).

---

## Log (append-only, oldest → newest)

> Entries before "Component API spec APPROVED" (2026-06-20) moved to nv-decision-log-archive.md [2026-06-21].

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
