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

_Last updated: 2026-06-22. Contract **v0.4.2** · Template-IR **v0.4.1**._

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
- **Slot consumption — increments 1 + 1.5 + 2 LANDED (2026-06-22):** inc 2 = scoped-slot
  IR shape (`SlotEntry.content` → factory; `SlotOutletBinding.props?`); `let={...}` authoring
  both FEs; D-slot-1 RETAINED. Template-IR → v0.4. reactive-core v0.4.2 unchanged. D-slot-2
  re-phased to `each`.
- **Real-browser gate:** PASSED across Blink/Gecko/WebKit (36/36). Phase 0 closed.
- **Perf-validation phase:** COMPLETE. All three tripwires resolved (createSignals
  cleared structural-accepted; FALSE-heavy characterized watch-item; cross-engine
  closed). No redesign triggered.
- **Tests:** 607 green (S0/F1 + D-cl-3, merge `6baa64e`, 2026-06-22). `tsc --strict` + DOM
  lib, biome, build all clean.

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
- Compile-time DOM encapsulation — still open (Shadow-DOM opt-in path unspecced).
  STYLE encapsulation APPROVED 2026-06-22 (see Log) — Light-DOM scoping via hybrid
  routing; not a contract concern.
- **`$style` key discriminant + StyleVarBinding APPROVED (spec 2026-06-22).**
  Two-way class/selector routing; new `StyleVarBinding` IR member (Template-IR v0.4.2 on land).
  nv-does-not-invent-CSS principle. Renderer-layer; not a contract concern.

### Genuine research / deferred-on-evidence
- Beating the alien-signals-class baseline: nv wins/ties 5 of 7 cases; two wide-graph
  cases (~1.5x/~1.7x) and createSignals (~5–7x) are proven **structural**, both trace to
  `ReactiveNode` width, both gated behind the **kind-split tripwire** (real-app
  evidence only — noted, not approved).
- **FALSE-heavy row-churn** watch-item (reopen on real-app evidence with a
  steady-state-update harness).
- **Per-key class-toggle node-width** — object-form `class={{...}}` emits one effect per
  key (fine-grained). For wide objects this trades N graph nodes against 1 looping effect.
  Same `ReactiveNode`-width structural cost as the kind-split tripwire; per-key default
  carries a compile-time width-threshold fallback, threshold gated on real-app evidence.

### Forward queue (named, not blocking)
- **Slots — design APPROVED (2026-06-22), Path B phasing:** Increments 1 + 1.5 LANDED
  (2026-06-22). Increment 2 (queued, `cc-handoff-scoped-slots.md`) = scoped-slot IR shape
  (`SlotEntry.content` → factory + `SlotOutletBinding.props?`) + `let={...}` authoring;
  **retains D-slot-1**; Template-IR → v0.4. **D-slot-2 invocation-scoped ownership flip
  re-phased (2026-06-22) to land WITH `each`** — its leak gate requires real per-row
  invocations to be failable; flipping it earlier is an unfalsifiable §6 gate.
- **`$style` scoping — design APPROVED 2026-06-22, spec APPROVED (`spec-style-scoping-and-class-selection.md`).**
  Hybrid per-entry routing (key→class-rewrite, selector→attribute-hash);
  `factory` form → CSS-custom-property lowering (values reactive, factory NOT re-run);
  injection = hoist-once-per-component-identity + dedup. Renderer/compiler-layer only —
  NOT a reactive-core contract concern (Template-IR §scope already fences this).
  - **S0 (F1 + D-cl-3): LANDED 2026-06-22 (`6baa64e`).** Parser seam in place.
  - **S1+S2 — COMMISSIONED 2026-06-22 (`feat/style-s1s2`, plan-first hard gate; not yet landed).**
    Spec authoritative at `docs/design/spec-style-s1s2-scoping-and-lowering.md`. Handoff
    `cc-handoff-style-s1s2.md`. CC must produce `docs/design/plan-style-s1s2.md` and halt for
    architect approval before any `src/` touch (Gate P). Four phases: (1) discriminant+tag-set
    [sandbox, no IR]; (2) static scoping+injection [browser]; (3) StyleVarBinding+dynamic
    [browser, **Template-IR v0.4.2**]; (4) ×classlist [browser, OPEN-7]. Seven OPEN points ruled
    against the plan, not pre-decided. Locked constraints L.1–L.6 fenced as G0.
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
  the **interpolated** object-literal form (`class="${{...}}"`); bare-attribute `class={{...}}`
  form distinctness is a minor open question, not blocking.
- `$style × slots` — STILL parked behind `$style` scoping *implementation* (design tractable
  now that axis-a is chosen, but specced after `$style` lands). The slot-boundary scope-carry
  question is now determined by the S1+S2 discriminant (class-rewrite vs attribute-hash):
  tractable to spec once S1+S2 lands. `$style × classlist` is OPEN-7 inside S1+S2 (sub-phase 4).
- SyncBinding (throws at both back-ends today).
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
  - **`.nv`:** bare object/array literal — `class={{ active: isActive() }}`.
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
`class` — `class={cx(...)}` is full-reassign; `class={{...}}` is per-key-toggle; pick one
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
`class={{...}}`; the landed tests use the interpolated form `class="${{...}}"` (object literal
at an interpolation hole). CC chose the form the emit path actually exercises — correct under
the handoff's "confirm the form, do not guess" instruction. Consequence: EX-CL-02 proves the
**interpolated object-literal** path. Whether the bare-attribute `class={{...}}` `.nv` form is
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

- **Open question resolved (the EX-CL-02 deviation):** the bare `class={{...}}` and interpolated
  `class="${{...}}"` `.nv` surface forms are **NOT distinct extraction sites** — both reach
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
qualification form (OPEN-1, browser-gated), declHash property-name inclusion (OPEN-2), dynamic
value coercion (OPEN-3), injection registry shape/lifetime (OPEN-4), `<style>` vs
`adoptedStyleSheets` (OPEN-5, browser-gated), teardown policy (OPEN-6), `$style × ClassListBinding`
rewrite consistency (OPEN-7). See spec §7.

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
