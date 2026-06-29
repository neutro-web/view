# Spec — Index-Elision (`spec-index-elision.md`)

**Status:** APPROVED for commission — **audited against placed source at SHA `dc4e4a8` (mechanics corrected post-audit; see change note below).** Architect-locked.
**Verified against SHA `dc4e4a8` (HEAD).**
**Workstream:** (3) renderer/templating + (2) compiler predicate.
**Closure axiom:** clean — removes a `signal` where provably unused; adds no primitive.
**Contract impact:** reactive-core contract **unchanged**. **Template-IR v0.4.2 → v0.4.3** (additive carrier).
**Gate structure:** two-tier, ordered. **Tier 1 (correctness) is a hard precondition; the lever does not land if any Tier-1 item fails. Tier 2 (performance) is a claim made only after Tier 1 passes, and is NOT a precondition for landing** (correct removal of provably-unread allocation lands on Tier 1 alone; it pays down the named memory deficit regardless of swap delta).

> **Post-audit change note (vs the first-pass spec).** A seam audit at SHA `dc4e4a8` corrected four mechanical errors and one scoping fact, none of which change the ruling or the gate: (1) predicate uses `exprReadsSignal` (L1024, over-reports/ACCEPT-biased), not `isReactiveExpr`/erasure (under-reports — would FIRE); (2) predicate computed at the `<each>` site (~L592, where `holeExprs` is in scope), not in `pushListBinding`; (3) carrier threads through BOTH `NvWalkedEach` and `PendingNvEachInfo` (L1239), one computation; (4) **the lever is a compiled-`.nv`-path optimization only** — the tagged-template `each()` path has no compile step, cannot run the predicate, and leaves the carrier absent (⇒ allocate, unchanged) — verified at html-tag.ts L740/L968; the benchmarked jfb app is authored in `.nv` (Log 2026-06-26) so the lever fires on the measured workload; (5) the FE-equivalence oracle must NOT compare `itemReadsIndex` (the two front-ends legitimately disagree — it's an optimization hint, not structural). See §2, §3, §4a, §6.

---

## 1. Premise (verified at SHA)

`wireList` (`interpreter.ts` L498–499) allocates **both** `valueSig` and `indexSig` per row, unconditionally. The reorder write (`existing.indexSig.set(i)`, L547) fires per kept row whose index changed; the guarding compare `existing.lastIndex !== i` (L546) runs on **every** kept row, every reconcile. jfb `<each>` binds `let={item}` only — so `indexSig` is allocated, threaded into the body factory, index-tracked, and written, with **zero readers**.

Index-elision removes, for qualifying lists: the `indexSig` allocation + its `ReactiveNode` (per row), the `lastIndex` field + its per-row compare (per reconcile), and the reorder `.set()`.

---

## 2. Predicate (compile-time, ACCEPT-biased)

**Definition.** A list **qualifies for elision** iff its item template provably never reads the index binding.

**Computed in the parser at the `<each>` detection site (`nv-parser.ts` ~L592), where `holeExprs` is in scope** — NOT in `pushListBinding` (which has only `bodyHoleIndices`, not the raw exprs). Reuses the ACCEPT-biased identifier walker `exprReadsSignal` (L1024), NOT `isReactiveExpr`/erasure (see note).
- `letNames` (`nv-parser.ts` L585) is the ordered `let={...}` binding list: `[itemName, indexName?]`. The index name is `letNames[1]`.
- **If `letNames.length < 2`** (no index name bound): qualifies trivially — the name is not in scope, so no body hole can reference it. (`slotSignals`, L863, only adds bound names to the reactive set.)
- **If `letNames.length >= 2`** (index name bound): run `exprReadsSignal(holeExprs[idx], new Set([indexName]))` over **every** `idx ∈ bodyHoleIndices`. Qualifies iff **no** body hole references `indexName`.

```ts
// at L592, immediately after buildNvSlotContentIR returns bodyHoleIndices:
const indexName = letNames[1]  // undefined if no index bound
const itemReadsIndex =
  indexName === undefined
    ? false  // index not bound → provably not read → qualifies for elision
    : bodyHoleIndices.some((idx) => {
        const e = holeExprs[idx]
        return e !== undefined && exprReadsSignal(e, new Set([indexName]))
      })
// store on NvWalkedEach; push at L609
```

> **Detector choice (load-bearing).** Use `exprReadsSignal` (L1024), a bare identifier walk that sets `found = true` on ANY `ts.isIdentifier && signals.has(name)` — it **over-reports** (matches the name even in shadowed or property position). That over-report is the ACCEPT-bias the soundness fence requires. Do **NOT** use `isReactiveExpr`/`eraseSignalReadsInNode` (L1855/L1814): its shadowing and parent-context skips are correct for *erasure* but **under-report** for a soundness predicate (a shadowed `index` would read as "not referenced" → false-elide → FIRE). The variable name `itemReadsIndex` is honest: `true` = reads (or unsure) = keep; `false` = provably does not read = elide.

**Reference scope — what counts as a read (all resolve to the SAFE direction = keep on doubt):**
- Index in any body hole expression → read → keep.
- Index inside a nested `<each>` body, component prop, or slot in the body → read → keep. Erasure recurses via the `slotSignals` threading already in place; **if recursion is ever uncertain for a construct, the predicate must return "reads" (keep).**
- **Index in the `key=` expression is NOT a body read.** `key` runs in the reconcile effect and receives the live loop index `i` directly (`binding.key(item, i)`, L489), never `indexSig`. A `key="${(row, i) => …i…}"` does **not** force `indexSig` allocation. Confirmed L489 vs L506. The predicate considers body holes only.

**Soundness fence (FIRE-class).** Unsure ⇒ qualifies = false ⇒ keep `indexSig`. A false-elide where index IS read renders the wrong index → correctness fire. This is the single most important property; Tier-1 Item 1 tests it directly.

---

## 3. IR carrier (Template-IR v0.4.3, additive)

`ListBinding` (`ir.ts` L176) gains one optional field:

```ts
export type ListBinding = BaseBinding & {
  kind: 'list'
  items: ReactiveExpr<readonly unknown[]>
  key: (item: unknown, index: number) => string | number
  itemTemplate: (valueSig: WritableSignal<unknown>, indexSig?: WritableSignal<number>) => TemplateIR
  /**
   * v0.4.3 — index-elision. true|absent ⇒ item template may read index;
   * renderer MUST allocate indexSig (conservative default). false ⇒ parser
   * proved the body never reads index; renderer MAY elide indexSig.
   * Absent defaults to the conservative (allocate) branch — preserves byte-compat
   * for any producer that does not set it, and keeps the soundness fence at the IR layer.
   */
  itemReadsIndex?: boolean
}
```

- `itemTemplate`'s second param becomes optional (`indexSig?`) — the factory is called with one arg when elided (§4, §5).
- **Default semantics are conservative-true**: `itemReadsIndex === false` is the *only* value that licenses elision. `true` and `undefined` both ⇒ allocate. An old or partial IR producer therefore never triggers a false-elide.
- **Template-IR doc**: bump §3.7 to v0.4.3, document the carrier and the optional second factory param, note `AttrBinding`/`ClassListBinding` byte-unchanged, reactive-core contract unchanged.

**Parser sets it.** Computed once at the `<each>` site (§2). Threaded through **both** intermediate carriers (one computation, no drift):
- `NvWalkedEach` (`nv-parser.ts` L499) gains `itemReadsIndex: boolean` → `pushListBinding` (L806) reads `wl.itemReadsIndex` and sets it on the interpreter-path `ListBinding`.
- `PendingNvEachInfo` (L1051) gains `itemReadsIndex: boolean`, copied from `wl` at L1239 → the emitter's `ThunkSource` list builder (L2836) reads it.
- `ThunkSource` list variant (parser L130–134) gains `itemReadsIndex: boolean`, carried from `PendingNvEachInfo` (NOT recomputed).

---

## 4. Interpreter mechanism (branch-HOIST, not per-row guard)

The decision is fixed per list instance (`binding.itemReadsIndex`), so it is hoisted **out of the per-row loop**. No per-row branch is added to the reconcile hot path.

**`ItemRecord`** (`interpreter.ts` L430) — index fields become optional:
```ts
type ItemRecord = {
  valueSig: WritableSignal<unknown>
  indexSig?: WritableSignal<number>   // absent when elided
  lastValue: unknown
  lastIndex?: number                  // absent when elided — no index tracking at all
  rootEl: Node
  dispose: () => void
}
```
Every row in a given list shares the same `itemReadsIndex`, so the Map stays **monomorphic within a list instance** (no per-row shape polymorphism on the hot path).

**`wireList`** reads `const readsIndex = binding.itemReadsIndex !== false` once, at the top.

**Op 1 (create, L498–512):**
```ts
const valueSig = signal<unknown>(item)
const indexSig = readsIndex ? signal<number>(i) : undefined
// factory called with one arg when elided:
const itemIR = readsIndex
  ? binding.itemTemplate(valueSig, indexSig)
  : binding.itemTemplate(valueSig)
```
Record stores `indexSig` (or omits), and `lastIndex: readsIndex ? i : undefined`.

**Op 4 (index update, L546–548) — collapsed, not guarded:**
The index-update block is emitted into the reconcile body **only when `readsIndex`**. The mechanism is a hoisted closure selected once per wire, not a per-row `if`:
```ts
// chosen once at wire time:
const updateIndex = readsIndex
  ? (rec: ItemRecord, i: number) => {
      if (rec.lastIndex !== i) { rec.indexSig!.set(i); rec.lastIndex = i }
    }
  : (_rec: ItemRecord, _i: number) => {}   // elided lists: no compare, no field, no set
```
For elided lists the entire Op-4 index path (the `lastIndex !== i` compare, the field write, the `.set()`) is **dead** — the reconcile body for a qualifying list is strictly *shorter*, not the same body with a guard. Byte-identical for non-qualifying lists.

> **Collapse, not patch.** No sentinel `indexSig`, no shared mutable global, no nullable-deref in the body (the body provably never references index — that is what the predicate proved). One factory contract, called with the arity the emitter/interpreter agree on.

### 4a. The two back-ends differ — and only the compiled `.nv` path can elide (verified at SHA)

This is the architectural fact that scopes the lever. There are **two** ways a `ListBinding.itemTemplate` is constructed, and they consume `indexSig` differently:

- **Compiled `.nv` path (emit).** Parser → `bodyThunks` → emitted `itemTemplate: (valueSig, indexSig) => ((slotProps) => bodyLiteral)({ item: () => valueSig(), index: () => indexSig() })` (nv-emitter L177–184). The static predicate runs over `.nv` source. **Elision fires here.** This is the benchmarked path: the jfb keyed app is authored in pure `.nv` (Log 2026-06-26, CP-2a CLOSED, `ef86bd7`) — so Tier-2 measurement is valid; the lever engages on the measured workload.
- **Tagged-template path (`html\`...\``).** `each(items, key, factory)` (html-tag.ts L220) where `factory` is the author's opaque `({item, index}) => html\`...\`` closure. Both construction sites (L740–741, L968–969) build `itemTemplate: (valueSig, indexSig) => factory({ item: () => valueSig(), index: () => indexSig() })`. **There is no compile step and no `holeExprs`** — the static predicate cannot run. `factory` is opaque; whether it reads `index` is not statically knowable at parse time.

**Ruling for the tagged-template path: never elide — `itemReadsIndex` defaults to absent (⇒ conservative-true ⇒ allocate).** The tagged-template `ListBinding` construction does NOT set `itemReadsIndex`, so the carrier is absent, so `wireList` allocates `indexSig` as today. **No regression, no behavior change on the tagged-template path.** The lever is a compiled-`.nv`-path optimization. This is consistent with nv's "the boundary is whether there's a compile step" invariant (Locked) — elision is a *provable-skip* that requires the compile step's static visibility, which the tagged-template runtime path structurally lacks.

> **Interpreter consumes the IR carrier, not the factory arity.** `wireList` (interpreter L498–506) decides allocation from `binding.itemReadsIndex`, independent of how the factory was built. For a compiled-`.nv` `ListBinding` with `itemReadsIndex === false`, the emitted factory has no `indexSig` param and the body never reads index — `wireList` skips the alloc and calls `itemTemplate(valueSig)`. For any tagged-template `ListBinding` (carrier absent), `wireList` allocates and calls `itemTemplate(valueSig, indexSig)` as today. One interpreter, one carrier check, both factory shapes honored.

---

## 5. Emitter fork (compiled back-end)

`nv-emitter.ts` L177–184 currently always emits both the `index` slot-prop and the `indexSig` factory param. When `thunk.itemReadsIndex === false`, emit the **narrower factory**:

```ts
const [itemName = 'item', indexName = 'index'] = thunk.letNames
const readsIndex = thunk.itemReadsIndex !== false

const slotPropsBody = readsIndex
  ? `{ ${itemName}: () => valueSig(), ${indexName}: () => indexSig() }`
  : `{ ${itemName}: () => valueSig() }`                       // no index key

const factorySig = readsIndex ? '(valueSig, indexSig)' : '(valueSig)'   // narrower param list

return [
  `{ kind: 'list', ${pathEntry},`,
  `${i2}items: () => (${thunk.itemsSrc}),`,
  `${i2}key: ${thunk.keySrc},`,
  `${i2}itemReadsIndex: ${readsIndex},`,                      // carrier emitted explicitly
  `${i2}itemTemplate: ${factorySig} => ((slotProps) => (${bodyLiteral}))(${slotPropsBody}) }`,
].join('\n')
```

The emitted factory shape itself encodes the elision: when elided, `indexSig` is mentioned nowhere in the emitted module. The body literal provably contains no `slotProps.index` reference (predicate guarantee), so the narrower `slotPropsBody` is sound.

**Emit the `itemReadsIndex` carrier explicitly** (always, both branches) so the placed module is self-describing and the interpreter-vs-compiled parity is checkable by source-read.

---

## 6. FE-equivalence (carrier is an optimization hint, NOT compared)

`test/renderer/ir-equivalence.ts` `bindingEqual` list case (L141–151) recurses item bodies via stub-call. **The `itemReadsIndex` carrier must NOT be added to the equivalence comparison.** Here is why (this reverses the design-gate analysis's §6 suggestion — corrected after reading the tagged-template path):

The oracle asserts that the **same logical template authored both ways** (`.nv` vs tagged-template) produces structurally identical IR. But:
- The `.nv` path computes `itemReadsIndex` statically (may be `false`).
- The tagged-template path **cannot** compute it (no compile step) and leaves it **absent** (⇒ conservative-true).

For the same logical template, the two front-ends will therefore legitimately **disagree** on the carrier (`.nv`: `false`; tagged-template: absent/true). This disagreement is **correct and expected** — it's an optimization annotation, not semantic structure. The rendered DOM is identical either way (elision is behavior-preserving by the soundness fence). **If the oracle compared `itemReadsIndex`, it would fail valid equivalence.**

**Ruling: leave `bindingEqual`'s list case unchanged.** Do NOT compare `itemReadsIndex`. The carrier is a back-end optimization hint outside the structural-equivalence contract — like a cache flag, not like a binding's `kind` or `pathIndex`.

> **Implementation note (post-landing correction):** The body recursion was updated to mirror the interpreter: `readsIndex ? itemTemplate(stubVs, stubIs) : itemTemplate(stubVs)`. This is stricter than the original "leave it unchanged / extra arg harmlessly ignored" guidance. Both approaches are semantically equivalent at runtime (JS silently drops extra args), but the conditional-arity form makes the TypeScript contract explicit and consistent with the interpreter. The spec's original "no oracle change needed" note remains directionally correct but the implementation chose the more explicit form. SHA `785af9d`.

**Soundness of NOT comparing it:** the carrier only ever licenses *removing provably-dead work*. A false value is only set when static analysis proves no index read; an absent value is the safe default. There is no carrier value that changes rendered output, so excluding it from structural equivalence cannot mask a real divergence.

---

## 7. Gate

### Tier 1 — Correctness (HARD precondition; lever does not land if any fails)

Each item is failable on inspection or test. Verified by **source-read at the landed SHA**, not green counts.

- **T1-1 — Predicate soundness (FIRE).** A permutation/usage corpus of `<each>` templates where index IS read (directly; via nested `<each>`; via component prop; via slot) — **none** may be elided. And templates where index is bound-but-unread, or never bound — **all** must elide. Test asserts `itemReadsIndex` per case AND asserts rendered index correctness in a real browser for the read cases (wrong index = visible failure). Corpus must include the `key=`-uses-index-but-body-does-not case → must elide.
- **T1-2 — Provable absence (compiled `.nv` path).** For a qualifying `.nv` list, the **emitted module contains no `indexSig`** (read placed emit output at SHA). Interpreter-side, `ItemRecord.indexSig === undefined` for qualifying rows. (Tagged-template lists never qualify — carrier absent — so `indexSig` is present there as today; that is correct, not a failure.)
- **T1-3 — Full-board no-regress.** Every CP-2d op (create-1k/10k, swap, select, update-10th, remove) within **±2%** of its CP-2d baseline. A deletion that slows any op means a stray hot-path branch — implementation-correctness failure. Real-browser Playwright, same-session before/after, harness `4fbccf55`, Chrome/M2.
- **T1-4 — FE-equivalence preserved.** The §6 oracle still passes across the corpus **without** comparing `itemReadsIndex`. Specifically: a logical template authored both as `.nv` (carrier may be `false`) and tagged-template (carrier absent) must remain structurally equivalent — proving the carrier is correctly excluded from the equivalence contract and that adding it broke nothing structural.
- **T1-5 — Soundness fallback honored.** Absent `itemReadsIndex` ⇒ allocate (both back-ends). Test a hand-constructed IR with the field absent renders index correctly.
- **T1-6 — Tagged-template no-elide.** A tagged-template `each()` list renders index correctly and allocates `indexSig` (carrier absent ⇒ conservative-allocate). Confirms the lever is scoped to the compiled path and the tagged-template path is untouched.

**If T1-1…T1-6 all pass, the lever LANDS** — regardless of Tier 2. Rationale (architect-ruled): removing provably-unread allocation is correct and reduces live node count (memory deficit 2.4× vanilla is named); the IR surface (`itemReadsIndex`, optional `ItemRecord` fields, forked emit) is justified by correct-deletion-plus-memory alone.

### Tier 2 — Performance (claimed only after Tier 1; NOT a landing precondition)

The standard jfb board does **not** load the index path (swap reorders 2 rows; update-10th reorders none; select is a class change). A performance *claim* therefore requires a workload that loads the lever. Tier 2 measures, then the log records the truth — improvement or null.

- **T2-1 — Reorder-heavy workload (architect-locked params).** A jfb-style benchmark variant that reorders ~all rows (reverse or full shuffle) over 1000 rows, so `lastIndex !== i` fires on ~1000 rows and the elided `.set()`/compare/field-track is ~1000× per reconcile, not 2×. **Locked params:** 1000 rows, reverse-then-restore reorder, ≥25 samples median, warm-up discard 5, Chrome 149 / M2 Max / harness `4fbccf55`, same-session elided-vs-non-elided (use the `__setHarvestDisabled`-style before/after toggle pattern if a runtime switch is cheaper than two builds; otherwise two builds same session).
- **T2-2 — Create characterization at 1k AND 10k.** Same-session before/after on `#run` and `#runlots`. This is **characterization, not pass/fail** — its purpose is to catch non-linearity (GC/allocator relief from 10000 fewer live nodes at scale). Record both points and the per-row fraction; a divergence at 10k is a finding.
- **T2-3 — Memory delta.** Run-memory under the 1k live list, elided vs non-elided. Expected: ~1000 fewer `ReactiveNode`s. Record the delta against the 2.4×-vanilla baseline.

**Tier-2 outcomes, all honest, all logged:**
- **Improvement on T2-1** → log it as a measured mutation win on the reorder-heavy workload, named as such (not as a standard-jfb-swap claim).
- **Null on T2-1** → log "perf delta below measurement floor on the loading workload; lever lands on Tier 1 (correct deletion + memory)." A true sentence, not a dressed-up null. **No performance claim is made.**
- Either way, T2-2/T2-3 are recorded as characterization.

---

## 8. Commission scope (for CC plan → `docs/superpowers/plans/`)

1. Parser: §2 predicate computed at the `<each>` site (~L592) using `exprReadsSignal`; thread `itemReadsIndex` through `NvWalkedEach` (L499) → `pushListBinding`, AND through `PendingNvEachInfo` (L1051, copied at L1239) → `ThunkSource.list` (L130–134) → emitter. One computation, both carriers.
2. IR: §3 carrier on `ListBinding`; optional second factory param (`indexSig?`). Template-IR doc → v0.4.3.
3. Interpreter: §4 branch-hoist in `wireList` (allocate from `binding.itemReadsIndex`); optional `ItemRecord` fields. Tagged-template lists (carrier absent) unchanged.
4. Emitter: §5 narrower-factory fork for compiled `.nv`; emit carrier explicitly.
5. Oracle: §6 — do NOT compare `itemReadsIndex` in `bindingEqual` (leave list case unchanged); add a corpus test proving `.nv`(false)/tagged-template(absent) equivalence still holds.
6. Tier-1 tests T1-1…T1-6 (incl. T1-6 tagged-template no-elide).
7. Tier-2 harness T2-1 (new reorder-heavy workload, locked params) + T2-2/T2-3 measurement; same-session before/after.

**Same-session before/after perf gate is mandatory** (Tier-1 T1-3 no-regress + Tier-2 measurement in one session). JSDOM/linkedom barred from the perf verdict path; deterministic alloc/node counts (T2-3 node count) may use the sandbox.

---

## 9. Deferred / not-in-scope (noted, not folded)

- **Bundle-size impact**: cumulative across v0.5.0 additions (resource, A1, index-elision); legible only in aggregate. v0.5.0-wide size pass, not a per-lever rider.
- **The dominant create sixth** (the redirect named in the design-gate analysis): the per-item `createRoot`/effect-wiring slice (~0.56× vs Lit) and the leaner-record direction (~0.70× vs Solid). Index-elision is the *available* create sixth, not the dominant one — those remain the larger create levers and are untouched here.
- **Process**: this spec + the design-gate analysis should land in `docs/design/` to resolve the A1/PT-1a log-only backfill question. Recommended; architect-process decision, not part of this commission's correctness.
