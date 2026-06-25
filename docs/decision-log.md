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

_Last updated: 2026-06-24. Contract **v0.4.2** · Template-IR **v0.4.2**._

> History before `Component API spec APPROVED [2026-06-20]` is in
> `decision-log-archive.md` (moved 2026-06-21). This snapshot is the resolved
> picture; the Log below holds the active arc (Component API → slot consumption).

### Status at a glance
- **Reactive core:** Contract **v0.4.2**, 40/40 conformance. DOM-free. Field order
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
- **Renderer:** interpreter + compiler back-ends at parity for all binding kinds.
  Both front-ends (tagged-template + `.nv`) produce one IR, FE-equivalence-gated.
  Template-IR doc reconciled to v0.4.2 (2026-06-23) — now matches `ir.ts`
  (12-member union incl. `ClassListBinding`, `StyleVarBinding`; `ListBinding`
  factory `itemTemplate`; root `styleArtifact`/`classRewrites`).
  Equivalence oracle extended (2026-06-23, Action 2): `bindingEqual` now recurses
  component slots (forwarding doc → slot shape.html compared); `styleArtifactEqual`
  compares root `styleArtifact`/`classRewrites`. Slot content + style outputs are
  no longer FE/back-end-equivalence blind spots.
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

### Open design decisions (chosen later; not blocking)
- Compile-time vs. runtime split beyond the read/write transform (scheduling,
  encapsulation) — narrowed, not closed.
- Effect-flush timing primitive (microtask vs. custom scheduler).
- Compile-time DOM encapsulation — still open (Shadow-DOM opt-in path unspecced).
  STYLE encapsulation APPROVED 2026-06-22 (see Log) — Light-DOM scoping via hybrid
  routing; not a contract concern.
- **`$style` scoping + dynamic lowering — LANDED 2026-06-23 (Template-IR v0.4.2).**
  Two-way class/selector routing; `StyleVarBinding` IR member; declHash folds property
  name (OPEN-2); classlist recursion total over conditional/list (OPEN-7). nv-does-not-
  invent-CSS. Renderer-layer; not a contract concern. Confirm residual OPEN-1/3/4/5/6
  chosen-at-build vs. open against spec §7.

### Genuine research / deferred-on-evidence
- Beating the alien-signals-class baseline: nv wins/ties 5 of 7 cases; two wide-graph
  cases (~1.5x/~1.7x) and createSignals (~5–7x) are proven **structural**, both trace to
  `ReactiveNode` width, both gated behind the **kind-split tripwire** (real-app evidence
  only — noted, not approved). **[2026-06-24] Tripwire EVIDENCE-TESTED → CLEAR.** The
  commissioned wide-graph steady-state harness (`1e59fe1`, full-frame, Chromium real-browser,
  1000×10, 5% churn) showed the realistic update frame at ~0.005ms/tick — budget-irrelevant
  by ~3,000× against a 60fps frame. Condition A (absolute breach) unflippable at this scale;
  2-of-2 gate → CLEAR. The synthetic gap is confirmed **launch-irrelevant at realistic
  scale**, not merely deferred. Tripwire stays set — reopens only on a materially different
  real-app shape (far larger/deeper graph) in real profiling.
- **FALSE-heavy row-churn** watch-item (reopen on real-app evidence with a
  steady-state-update harness). **[2026-06-24] The commissioned wide-graph steady-state
  harness is that instrument** — it can serve the FALSE-heavy read-tax measurement as a
  secondary read if FALSE density is varied; not the harness's primary verdict.
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
  the **interpolated** object-literal form (`class="${{...}}"`); bare-attribute `class={{...}}`
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
- **Increment SS — COMMISSIONED 2026-06-23, Gate-P (awaiting CC plan).** Joint
  `<each>`-in-slot wiring + D-slot-style-1 structural collapse (static class → classlist
  static entry, regex removed). Collapse toward main-walk list-push via shared helper
  (D-SS-2). Re-enables G5 + adds emit-exec differential (D-SS-3). Gated by the Action-2
  oracle (D-SS-4). No IR bump. Closes the slot domain. See Log 2026-06-23 + handoff.
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
  entry, remove regex) inside Increment SS. Closes on SS land, not before.
- **Slot static-class all-static limitation:** purely static slot content (no holes) yields no
  ComponentBinding → static class unrewritten. Pre-existing parser constraint (D-each-4 family).
  [2026-06-23]
  Re-examination commissioned in Increment SS (open-point-1): may close for free given
  the walk is full-DFS + component detection is sentinel-driven. CC verifies at HEAD.
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
- **D-slot-2 in increment 2** — superseded 2026-06-22; flip re-phased to land with `each` (see log entry).

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
