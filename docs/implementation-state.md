# nv — Implementation State Map

**What this is.** A one-page orientation digest of *what exists in the code right now* —
file inventory, real-vs-stub status, the load-bearing seams, and known gaps. It exists
because the decision log records **decisions** and the contract records **semantics**, but
neither records **code facts** (e.g. "the `.nv` parser emits stub thunks"). Re-deriving
those each session is what caused churn; this file holds them.

**What this is NOT.** Not a decision record (those go in `decision-log.md`), not a semantics
spec (that is `reactive-core-contract.md`), and **not authoritative** — **GitHub is
authoritative for code.** This is a navigational summary, regenerated when reality moves. If
it disagrees with the source, the source wins and this file is stale → fix it.

**Maintenance.** Update in the same pass that lands code, as a ready-to-commit edit (same
discipline as log entries). Keep it to roughly this length; detail belongs in the code.

Last verified against source: **2026-06-29 (RecycledListBinding).** Contract **v0.4.3**, Template IR **v0.4.4**.

---

## File inventory (status per file)

Legend: **REAL** = production-complete & verified · **PARTIAL** = works for a subset ·
**STUB** = placeholder/not-runnable · **DEFERRED** = designed, not built.

### `src/core/` → `@neutro/view/core`
| File | Status | Notes |
|---|---|---|
| `core.ts` | REAL | Reactive runtime. 36/36 conformance. `tsc --strict` + DOM-lib clean. Contract v0.4.2. Exports incl. `signal`, `derived`, `effect`, `sync`, `createRoot`, `onCleanup`, `getOwner`, `runWithOwner`. Field order locked (cache-load-bearing). |

### `src/compiler/` → `@neutro/view/compiler`
| File | Status | Notes |
|---|---|---|
| `sync` classifier + write-graph cycle checker | REAL | Steps 1–2. 41/41. SignalId seam test-locked. |
| equality-policy inferencer (step 3) | REAL (inert) | Maps node value-type → `OBJECT_IS`/`false`/DECLINE. `_compilerEquals?` hook is an **inert stub** in core; not benchmarkable until wired. |
| branch-variant analyzer (step 4) | REAL (shelved) | Union oracle. Measured **net-negative**; SHELVED behind a reconcile-cost consumer (E2). |
| `emitted-mount.ts` | REAL | Compiler back-end. Consumes a **real-thunk** IR → specialized mount. Handles text/attr/prop/event/child/conditional/list/component/**slot-outlet**/**classlist**; sync throws. **Not on the v1 build-pipeline path** (build uses interpreter `mount`). `classlist` case: per-key `effect` for ≤6 toggle entries, one looping `effect` for >6 (T=6 placeholder; `TODO(threshold)` comment). Component case: `capturedParentOwner = getOwner()` before `createRoot`; passes `childSlotContext` to recursive `emitSetup`. Slot-outlet case calls factory (`content(slotProps)`) and uses `runWithOwner(capturedParentOwner, () => createRoot(...))` — parent-lexical ownership (D-slot-1). **Invocation-scoped by construction** (same as interpreter — `capturedParentOwner = getOwner()` at L550 inside the row's `createRoot` when nested in a list). D-slot-2 CLOSED 2026-06-24. Direct-capture (`componentFactory` + `propEntries`), never captures binding object. |

### `src/renderer/` → `@neutro/view/renderer`
| File | Status | Notes |
|---|---|---|
| `ir.ts` | REAL | IR types, matches Template-IR **v0.4.4**. 13 binding kinds (6 PoC + List + RecycledListBinding + ComponentBinding + SlotOutletBinding + ClassListBinding + **StyleVarBinding** landed; Sync deferred). `RecycledListBinding` = `{ kind:'recycled-list', pathIndex, items, itemTemplate }` (v0.4.4) — non-keyed, position-identity contract. `ClassListBinding` = `{ kind:'classlist', pathIndex, entries: readonly ClassListEntry[] }` where entry is `{ kind:'static'; token } \| { kind:'toggle'; key; expr }` — additive union member (v0.4.1). `StyleVarBinding` = `{ kind:'style-var', pathIndex, varName: string, expr }` (v0.4.2). `ComponentBinding` adds `component: ComponentRef`, `props: PropEntry[]`, `propNames`, `slots: SlotEntry[]`. `SlotEntry.content` is now a factory `(props: SlotProps) => TemplateIR` (hard-cut, v0.4). `SlotOutletBinding` = `{ kind:'slot-outlet', pathIndex, name, fallback?: TemplateIR, props?: readonly PropEntry[] }`. `TemplateIR` root carries optional `styleArtifact` ({staticCss, scopeHash, varBindingDescs?}) + `classRewrites` (v0.4.2, .nv-FE-only). `SlotContent` exported. All types local-structural (no DOM/core imports). |
| `interpreter.ts` | REAL | Back-end / **semantic ground truth**. Exports `mount(ir, parent, doc): () => void` and `walkPath`. `mount` **creates its own `createRoot`**; effects enqueued, run on first flush. `mountFragment` internal. Handles all 6 PoC kinds + list + component + slot-outlet + **classlist** (`wireClassList`); sync throws. `wireClassList`: statics added once at mount via `classList.add`; toggles wired as per-key `effect` for ≤6, one looping `effect` for >6 (T=6; `TODO(threshold)` comment). `wireSlotOutlet` calls `content(slotProps)` factory (v0.4). Slot content rendered via `runWithOwner(capturedParentOwner, () => createRoot(...))` — parent-lexical ownership (D-slot-1). **Slot-content ownership is invocation-scoped by construction:** `capturedParentOwner = getOwner()` at wire time (L680); inside an `each` row this is the row's `createRoot`, so slot content disposes with the row. D-slot-2 CLOSED 2026-06-24 (premise dissolved) — do not flip this. Nested roots bridged via `onCleanup`. |
| `html-tag.ts` | REAL | Tagged-template front-end (`createHtmlTag(doc)`). Handles `text`, `attr`, `prop` (`.name=`), `event` (`@name=`), `component`, **slot-outlet** (`${slots('name')}` sentinel), and **classlist** (`${classes(...)}` sentinel). `classes(...args)` returns a `ClassesSentinel` (`__nvClasses` brand); detected in `buildHtmlHoleBinding`'s attr branch when `name === 'class'`. **`cx(...args): string`** — pure string builder (no reactivity); handles string/object/array/falsy args recursively. A bare object literal at a `class` hole still throws (validator allowlist). Named slot capture, fallback sentinel, `slot(name, factory)` fill sentinel. Exports `slots`, `slot`, `cx`, `classes`, `ClassesSentinel` from renderer barrel. |
| `nv-parser.ts` | PARTIAL → **REAL for the build path** | `parseNvFile` (structural-only, stub thunks) + `parseNvFileForEmit` (real emit payload). **`<each>` authoring LANDED (2026-06-22):** both `walkNvNodeList` and `parseNvFileForEmit`'s thunk builder handle `<each .of=... key=... let={...}>` → `ListBinding`. Variant-A adapter at construction in both FEs. **`<each>`-in-slot + static-class structural collapse LANDED (Increment SS, 2026-06-23):** `pushListBinding` module-level helper shared by `processHtmlTemplate` and `buildNvSlotContentIR`; `walkNvNodeList` gains `diagnostics` param; `buildNvSlotContentIR` wires `lists: slotLists`. `liftStaticClassBindings(root: ParentNode, allPaths, bindings)` module-level helper strips `class=` attrs into `ClassListBinding` entries; called on `frag` (main) and `fragWrapper` (slot) before shape serialization; `patchClasslistTokens` component-case regex rewrite REMOVED. Main-path static-class live bug CLOSED. `html-tag.ts` `buildSlotContentIR` now wires `lists` from `walkNodeList`. **Classlist LANDED (Increment C, 2026-06-22):** `buildNvHoleBinding` attr branch routes `class` + object/array literal → `ClassListBinding`; computed/shorthand keys → `AttrBinding` fallback. Structural path emits `stubExpr` for toggle `expr` (structural-only — by design). `parseNvFileForEmit` classlist branch (~L2188–2257) extracts real `boolSrc: string` per toggle entry. **D-cl-3 (known defect):** key extraction uses `prop.name.getText()` at four sites (L367/L399/L2205/L2237); returns source text with surrounding quotes for string-literal keys (e.g. `'is-active'` → key `"'is-active'"`). Identifier keys unaffected. Fix deferred to S0 (`propertyKeyText` helper; `p.name.text` for Identifier/StringLiteral). `eraseSignalReadsInNode` PropertyAccess guard: always skip property-name position; skip object position only when `accessor === undefined`. JSDOM `let={item, index}` comma-split reassembly added. `ThunkSource` includes `slot-outlet`, `list`, and `classlist` variants. |
| `nv-emitter.ts` | **REAL** | `emitModule(results) → ES module text`. A2 shape + `Name.mount` sugar. **`classlist` case LANDED:** `emitBindingLiteral` case `'classlist'` emits `{ kind: 'classlist', pathIndex, entries: [...] }` with per-toggle `expr: () => (${boolSrc})` — real reactive thunks, not stubs (D-cl-1 closed). Arrow-body paren fix: `((slotProps) => (${bodyLiteral}))` to prevent esbuild block-vs-object parse failure. `emitThunkSource` leaf-only (`LeafThunkSource`); structural kinds handled by `emitBindingLiteral`. Slot thunks fully erased. Imports: only $script-referenced primitives + `mount`. |
| `nv-esbuild-plugin.ts` | **REAL** | `nvPlugin()`: `onLoad(/\.nv$/)` → jsdom doc → `parseNvFileForEmit` → `emitModule` → `{ contents, loader: 'js' }`. Thin I/O glue. |
| build pipeline (overall) | **REAL** | Transform + erasure layer verified. Executable-module gate CLOSED (EX-01..03). Multi-root dispose fixed. |
| `comparator.ts` | REAL | Structural DOM comparison (`structurallyEqual`) for the differential suite. `irStructurallyEqual` comparator's `classlist` case compares entry length/kind/token/key (skips expr-thunk identity). |

**Published surface note.** `@neutro/view/renderer` barrel exports `parseNvFileForEmit`, `NvEmitPayload`, `ThunkSource`, **`cx`**, **`classes`**, **`ClassesSentinel`**, **`ClassListBinding`**, **`ClassListEntry`** — all intended external surfaces. `@neutro/view/core` unchanged.

### `test/`, `integration/`
Differential conformance corpus TC-01..TC-10 (both back-ends), real-browser Playwright gate
(Chromium + cross-engine Blink/Gecko/WebKit), PoC integration. **659/659 green (2026-06-23, Increment SS).**
`nv-emitter-exec.test.ts` includes:
- EX-01..03: Counter/Conditional/Multi-component emit-exec.
- EX-EACH-01..05: `.nv` `<each>` behavioral e2e — initial render, item reactivity (Variant-A
  proof), index reactivity, add/remove/clear, unmount teardown.
- EX-CL-01..04: `.nv` class-selection emit-exec (closes D-cl-1) — initial render, per-key
  toggle reactivity (load-bearing: real `boolSrc` in emitted JS), per-key isolation,
  unmount. Uses identifier-only keys (`card`, `active`, `alpha`, `beta`) — D-cl-3 avoidance
  (hyphenated keys pending the `propertyKeyText` fix in S0).

---

## Load-bearing seams (touch with care)

- **IR is the only seam between 2 front-ends and 2 back-ends.** A wrong IR forks both
  back-ends. Front-end equivalence (IR §6.1) is enforced by the differential suite.
- **`mount` owns its root; nested roots are bridged by hand.** Any code that mounts *inside*
  another reactive scope (conditional, list, and the build pipeline's `$script` wrapper) must
  bridge the inner `createRoot`'s disposer via `onCleanup` — `createRoot` does **not**
  auto-attach to the parent owner.
- **Erasure regions: `$script` (via `preprocessMutationWrites`) AND render holes (via
  `parseNvFileForEmit`).** Render-hole erasure: bare-read on every hole; **bare-read +
  mutation-write on event handlers** (`eraseHandlerExpr`). `parseNvFile` (the non-emit path)
  still does not erase render holes; only `parseNvFileForEmit` does.
- **classlist key extraction (D-cl-3 seam):** four sites in `nv-parser.ts` use
  `prop.name.getText()` — safe for identifier keys only. Do not add new classlist key
  extraction without the `propertyKeyText` helper fix.
- **SignalId derivation** must use the same `signalSymbolId` across compiler steps 1–2/4 and
  any renderer write-back (SyncBinding `writeTargetId`).
- **`core.ts` is never modified by the compiler** (standing constraint). Field order locked.

---

## Known gaps / stubs / v0 limitations (named, not hidden)

- **Build pipeline executable-module gate — CLOSED (2026-06-20).** EX-01..03 verified.
- **`<each>` authoring — LANDED (2026-06-22, feat/each-authoring).** Both FEs produce
  `ListBinding` from `.nv <each>` elements. Behavioral e2e on the emit path: EX-EACH-01..05.
  Bugs fixed in this increment: arrow-body paren (`((slotProps) => (...))`) and JSDOM
  `let={item, index}` comma-split reassembly and `eraseSignalReadsInNode` PropertyAccess guard.
- **Class-selection — LANDED + ARCHITECT-VERIFIED (2026-06-22, feat/class-selection,
  feat/class-emit-exec).** `ClassListBinding` in IR (v0.4.1); `cx`, `classes()`,
  `ClassesSentinel` in `html-tag.ts`; `wireClassList` in both back-ends; G1 per-key isolation
  proven (TC-CL-04 call-count, both back-ends); D-cl-1 CLOSED (EX-CL-01..04, emitted JS
  shows real `boolSrc`). **D-cl-3 CLOSED (2026-06-22, `6baa64e`):** hyphenated/quoted/numeric
  classlist keys fixed via `propertyKeyText` helper (live at all call sites in `nv-parser.ts`).
- **Handler destructuring-write — DIAGNOSED (2026-06-21).** `eraseHandlerExpr` emits
  diagnostic; reads of props-destructured locals erased via `buildPropsAccessorMap`.
- **`parseNvFile` thunks are stubs** — structural form is real; thunks are `(() => undefined)`.
  Use `parseNvFileForEmit` for the build path.
- **`html-tag.ts`** covers text/attr/prop/event/component/classlist. Conditional/list require
  manual IR or the `.nv` path.
- **Component API v1 — LANDED (2026-06-21).** `ComponentBinding` real in `ir.ts` (v0.3).
  Both FEs detect capitalized elements → `ComponentBinding`. Both back-ends consume it.
  Slot consumption increments 1 + 1.5 + 2 LANDED (2026-06-22). D-slot-1 RETAINED;
  **D-slot-2 CLOSED 2026-06-24 (premise dissolved — no implementation).**
- **Cross-file emitted-component composition — DONE + VERIFIED (TC-C15/16/17, 7fece12).**
  Emitted factory `Name(props, slots)` returns `TemplateIR` (ComponentRef-shaped); `.mount`
  is sugar beside it (TC-C16). `App` importing + child-rendering `Counter` across `.nv` files
  works end-to-end incl. reactive prop threading (0→42) and dispose-no-leak. The "factory-shape
  convergence" forward item was a stale-handoff artifact, not a real gap — closed 2026-06-25.
- **Equality hook inert; step 4 shelved** — neither specialization saves work.
- **SyncBinding — LANDED (Parts 1+2 + emitMount parity).** Wired both back-ends:
  `wireSync` (interpreter L313, dispatched L168) and emitted-mount `case 'sync'` (L661).
  External-source sync (`reads: ∅`, no §8.5.2 write-graph edge); bounded by §8.5.4
  external-event budget. Part 3 CLOSED 2026-06-24.
- **Multi-root list items not supported** — single-root guard; wrap in a container element.
- **CP-2a — CLOSED 2026-06-26 (`ef86bd7` + `4ef0205`).** Benchmark keyed app proven in pure `.nv`,
  10 gates green both engines, 8 ops real-browser, keyed-move confirmed. 4 `src/` bugs surfaced +
  fixed (emitter thunk-slot, parser `propsAccessors` ×2, interpreter whitespace-root). CP-2b/2c
  remain.
- **CP-2 leak follow-up — CLOSED 2026-06-26 (`0e66fae`).** Probe: no per-item node growth;
  `tbody.childNodes` stable at 1003 across create→clear→create (+3 is static per-region, not
  per-row). Bug-3 orphans bounded. Shape-strip fix not needed.
- **CP-2b / CP-2c — RULED harness-venue** (external `krausest/js-framework-benchmark`), not in-repo.
  Gated on one-time venue setup. OPEN: (user) existing harness clone vs setup-first; (roadmap) does
  CP-2c numbers gate v0.1.0 or land post-tag.
- **`$style` × slots** — LANDED 2026-06-23 (Increment SS). `patchClasslistTokens` component
  case recurses into slot IR classlist entries. **D-slot-style-1 CLOSED (Increment SS):**
  `liftStaticClassBindings` replaces shape.html regex — static class= attrs lifted to
  ClassListBinding entries at IR build time (both main and slot paths). Main-path static-class
  live bug CLOSED (was: shape.html kept bare class=, CSS scoped but element unscoped). **G5
  CLOSED:** `<each>`-in-slot wired in both FEs; `pushListBinding` shared helper (D-SS-2).
  G1–G5, G3', G6, G7 green. 694 pass / 0 skip (HEAD `e40fec6`).
  **Real-browser gate LANDED 2026-06-25:** G5-E (`$style × <each>`-in-slot applied style) +
  G7 (child `$style` via `wireComponent`) green 9/9 across Blink/Gecko/WebKit. A production
  fix landed with it — `wireComponent` was dropping child `styleArtifact` injection
  (interpreter L691, fix `a6cafbd`); now mirrors `mount()`, transitive through
  conditional/list. `<each>`-in-slot styling CONFIRMED & CLOSED.
- **Injected-style teardown — NONE (deliberate, OPEN-6 trigger-gated).** `style-inject.ts`
  is inject-once: `adoptedStyleSheets`-first with `<style>` fallback, dedup'd per
  `(doc, identityHash)` in a `WeakMap`. No `removeComponentStyle`/refcount/eviction —
  injected style persists for the document's lifetime; the `WeakMap` reclaims only on
  whole-document GC, not component unmount. Not a leak in the common case (dedup by identity;
  re-mount reuses). Eviction policy deferred until a workload measures distinct-identity
  accretion as a real cost (decision log 2026-06-25). `$style` OPEN-1/2/3/4/5/7 CLOSED.
- **`extractModuleScope` edge:** non-`$component` top-level statements pass through verbatim.

---

## Not built at all (forward queue)
LIS list move-minimization (parked, gated on row-churn reorder-cost measurement), kind-split
(`ReactiveNode` struct split — parked behind real-app evidence), `roots[0] as Node`
biome-laundering cleanup, `checkProgram` build-wiring (trigger-gated: a production flow
constructing a `ts.Program` over user source). **Landed since this list last edited:**
`$style` scoping (S0→S1+S2→SS), SyncBinding, D-cl-3 — all removed from queue.

**Track T — DX gaps (v0.5.0, tagged-template surface):** T-5 `each<T>` generic typing (highest value
— item type flows through list factory), T-6 tagged-template scoped-style ergonomics (`injectComponentStyle`
exists internally but is NOT on the public API — no-build users need an external CSS pipeline or a new
exported helper), T-7 `slots`/`slot` DX pass.

- Tagged-template docs — LANDED (first-class v0.1.0 path, both surfaces documented).
- DX gaps logged (v0.5.0 Track T, non-blocking): T-5 each<T> generic typing (highest value),
  T-6 tagged-template scoped-style (no public API hook — not just ergonomics), T-7 slots DX.
