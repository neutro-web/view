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

Last verified against source: **2026-06-22.** Contract **v0.4.2**, Template IR **v0.3.3**.

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
| `emitted-mount.ts` | REAL | Compiler back-end. Consumes a **real-thunk** IR → specialized mount. Handles text/attr/prop/event/child/conditional/list/component/**slot-outlet**; sync throws. **Not on the v1 build-pipeline path** (build uses interpreter `mount`). Component case: `capturedParentOwner = getOwner()` before `createRoot`; passes `childSlotContext` to recursive `emitSetup`. Slot-outlet case: `runWithOwner(capturedParentOwner, () => createRoot(...))` — parent-lexical ownership (D-slot-1). Direct-capture (`componentFactory` + `propEntries`), never captures binding object. |

### `src/renderer/` → `@neutro/view/renderer`
| File | Status | Notes |
|---|---|---|
| `ir.ts` | REAL | IR types, matches Template-IR **v0.3.3**. 10 binding kinds (6 PoC + List + ComponentBinding + **SlotOutletBinding** landed; Sync deferred). `ComponentBinding` adds `component: ComponentRef`, `props: PropEntry[]`, `propNames`, `slots: SlotEntry[]`. `SlotOutletBinding` = `{ kind:'slot-outlet', pathIndex, name, fallback?: TemplateIR }` — `fallback` additive (v0.3.3). All types local-structural (no DOM/core imports). |
| `interpreter.ts` | REAL | Back-end / **semantic ground truth**. Exports `mount(ir, parent, doc): () => void` and `walkPath`. `mount` **creates its own `createRoot`**; effects enqueued, run on first flush. `mountFragment(ir,parent,doc,before?,slotContext?)` is **internal (not exported)**. Handles all 6 PoC kinds + list + component + **slot-outlet** (`wireSlotOutlet`); sync throws. Slot content rendered via `runWithOwner(capturedParentOwner, () => createRoot(...))` — parent-lexical ownership (D-slot-1). Nested roots (conditional/list/component) bridged via `onCleanup`. |
| `html-tag.ts` | REAL | Tagged-template front-end (`createHtmlTag(doc)`). Handles `text`, `attr`, `prop` (`.name=`), `event` (`@name=`), `component`, and **`slot-outlet`** (`${slots('name')}` sentinel; B2 fix). Named slot capture: `<slot name="x">` wrappers → `SlotEntry{name, content: TemplateIR}`; slot content goes through the unified `walkNodeList` (GATE-2 collapse; `buildSlotSubIR` RETIRED). `ComponentBinding` inside slot content falls out of the unified walk (component-as-slot-child). Fallback sentinel: `slots('name', { fallback: html\`...\` })`. Exports `slots(name)` from renderer barrel. |
| `nv-parser.ts` | PARTIAL → **REAL for the build path** | Adds `parseNvFileForEmit` + `eraseHandlerExpr` + `computeThunksForTemplate`/`computeThunkSource` + `extractScriptBodySource`/`extractModuleScope`. `parseNvFile` (structural-only, stub thunks) unchanged. `parseNvFileForEmit` returns the real `emit` payload: erased `scriptBody`, index-aligned `bindingThunks` (recursive for conditional + component + **slot-outlet**), `moduleScope`. Named slot capture: `<slot name="x">` → `slotHoleGroups` (index-aligned with `slots[]`). `ThunkSource` includes `{ kind:'slot-outlet'; name }` variant. `computeThunkSource` detects `slots.name` PropertyAccessExpression → slot-outlet ThunkSource; `{slots.x ?? html\`...\`}` → fallback detection. Slot content goes through the unified `walkNvNodeList` (GATE-2 collapse; `buildNvSlotSubIR` RETIRED). |
| `nv-emitter.ts` | **REAL** | `emitModule(results) → ES module text`. A2 shape: `(props, slots) => TemplateIR` ComponentRef + `Name.mount` sugar. **Slot thunks fully erased** — `slots:[]` hardcode replaced with `slotHoleGroups`-driven thunk computation under parent scope. `emitBindingLiteral` handles `slot-outlet`. Imports: only $script-referenced primitives + `mount`. No forced `createRoot`/`onCleanup`. Composition gap CLOSED. Spec §5. |
| `nv-esbuild-plugin.ts` | **REAL** | `nvPlugin()`: `onLoad(/\.nv$/)` → jsdom doc → `parseNvFileForEmit` → `emitModule` → `{ contents, loader: 'js' }`. Thin I/O glue. |
| build pipeline (overall) | **REAL** | Transform + erasure layer verified. Executable-module gate CLOSED (EX-01..03, dynamic import, esbuild alias). Multi-root dispose fixed. |
| `comparator.ts` | REAL | Structural DOM comparison (`structurallyEqual`) for the differential suite. |

**Published surface note.** `@neutro/view/renderer` barrel now also exports `parseNvFileForEmit`
and types `NvEmitPayload` / `ThunkSource` — intended, the build tool is an external consumer.
`@neutro/view/core` (`src/core/index.ts`) unchanged.

### `test/`, `integration/`
Differential conformance corpus TC-01..TC-10 (both back-ends), real-browser Playwright gate
(Chromium + cross-engine Blink/Gecko/WebKit), PoC integration. All green at last report.

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
  mutation-write on event handlers** (`eraseHandlerExpr`, handles arrow block-body *and*
  arrow-expression-body assignments; reuses the `$script` shadow helpers — no duplicated
  logic). `parseNvFile` (the non-emit path) still does not erase render holes; only
  `parseNvFileForEmit` does.
- **SignalId derivation** must use the same `signalSymbolId` across compiler steps 1–2/4 and
  any renderer write-back (SyncBinding `writeTargetId`).
- **`core.ts` is never modified by the compiler** (standing constraint). Field order locked.

---

## Known gaps / stubs / v0 limitations (named, not hidden)

- **Build pipeline executable-module gate — CLOSED (2026-06-20).** EX-01..03 in
  `nv-emitter-exec.test.ts` write the emitted `.js` to disk, bundle via esbuild (alias
  `@neutro/view/*` → `src/`), `import()` the bundle, mount, and assert DOM. Conditional
  literal and multi-component emission both verified end-to-end.
- **Handler destructuring-write — DIAGNOSED (2026-06-21).** `eraseHandlerExpr` now detects
  destructuring assignment targets (`[a,b] = …`, `({x} = …)`) where any bound name is a
  reactive signal, and emits an error diagnostic pointing to explicit `.set()`. The gap is
  closed for writes. Reads of props-destructured locals inside handler bodies are also erased
  via `buildPropsAccessorMap` (now called from handler erasure as a second call site).
- **`extractModuleScope` edge:** passes top-level imports + non-`$component` statements
  through verbatim; verify non-`const` component forms and `$component` helper functions
  behave as intended (low risk).
- **`parseNvFile` thunks are stubs** — structural form is real; thunks are `(() => undefined)`.
  Use `parseNvFileForEmit` for the build path (returns real erased thunk sources).
- **Child & List not `.nv`-reachable** — interpreter supports them via hand-authored IR only.
- **`html-tag.ts`** now covers text/attr/prop/event/component. Conditional/list require manual
  IR or the `.nv` path.
- **Component API v1 — LANDED (2026-06-21).** `ComponentBinding` is real in `ir.ts` (v0.3).
  Both front-ends (`html-tag.ts`, `nv-parser.ts`) detect capitalized component elements and
  produce `ComponentBinding` with throwing stub factory (factory resolution deferred — cannot
  resolve at parse time), real `props[]`/`propNames`/`slots[]`. Both back-ends
  (`interpreter.ts` wireComponent, `emitted-mount.ts` case 'component') consume
  `ComponentBinding` — create child reactive root, build propsObj/slotsObj, call factory,
  mount returned IR, cleanup on owner dispose. Props-erasure: `buildPropsAccessorMap` shared
  across `eraseScriptBlock`, `eraseHandlerExpr`, `computeThunkSource` (three callers). D3
  (destructuring write in handler → diagnostic) closed. Static default-slot capture in both
  front-ends; dynamic/nested-component slot content is warned and deferred.
  Cross-file / nested composition via the emitter path **works (A2, 2026-06-21).** Emitted
  factories are `ComponentRef`-shaped — `export function Name(props, slots) { <$script>; return
  <IR literal> }` returning `TemplateIR` directly (no `createRoot`, no `__ir`), plus a
  `Name.mount = (parent, doc, props = {}, slots = {}) => mount(Name(props, slots), parent, doc)`
  root sugar. A parent emitting a `<Child/>` binding threads prop accessor thunks
  (`expr: () => (n())`) into the child factory; the parent root owns the child's effects by
  construction. Slot **consumption** LANDED (increment 1, 2026-06-22): walk-collapse, component-as-slot-child, fallback (`SlotOutletBinding.fallback?`). Increment 2 (scoped slots) queued.
- **Equality hook inert; step 4 shelved** — neither specialization is wired to save work.
- **SyncBinding** throws at both back-ends.
- **Multi-root mount/dispose — FIXED (v0.2.1).** Both back-ends now snapshot all fragment
  children before insert and remove every root on cleanup. The single-root PoC constraint is gone.
- **Multi-root list items not supported** — both back-ends throw loudly if an item template
  produces more than one root node. Single-root guard is the v1 limitation; wrap in a container element.
- **`$style`** — parser extracts `{form, keys, source}`; scoping/injection unbuilt (own item).

---

## Not built at all (forward queue)
`$style` scoping, SyncBinding, LIS list move-minimization (parked), kind-split (parked behind
real-app evidence), `roots[0] as Node` biome-laundering cleanup (replace with `biome-ignore`
+ `!`; no runtime impact). Increment 2 (scoped slots + `SlotOutletBinding.props?` + `let={...}`
authoring + D-slot-2 invocation-scoped ownership) queued.
