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

Last verified against source: **2026-06-23 (Increment SS).** Contract **v0.4.2**, Template IR **v0.4.2**.

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
| `emitted-mount.ts` | REAL | Compiler back-end. Consumes a **real-thunk** IR → specialized mount. Handles text/attr/prop/event/child/conditional/list/component/**slot-outlet**/**classlist**; sync throws. **Not on the v1 build-pipeline path** (build uses interpreter `mount`). `classlist` case: per-key `effect` for ≤6 toggle entries, one looping `effect` for >6 (T=6 placeholder; `TODO(threshold)` comment). Component case: `capturedParentOwner = getOwner()` before `createRoot`; passes `childSlotContext` to recursive `emitSetup`. Slot-outlet case calls factory (`content(slotProps)`) and uses `runWithOwner(capturedParentOwner, () => createRoot(...))` — parent-lexical ownership (D-slot-1). Direct-capture (`componentFactory` + `propEntries`), never captures binding object. |

### `src/renderer/` → `@neutro/view/renderer`
| File | Status | Notes |
|---|---|---|
| `ir.ts` | REAL | IR types, matches Template-IR **v0.4.2**. 12 binding kinds (6 PoC + List + ComponentBinding + SlotOutletBinding + ClassListBinding + **StyleVarBinding** landed; Sync deferred). `ClassListBinding` = `{ kind:'classlist', pathIndex, entries: readonly ClassListEntry[] }` where entry is `{ kind:'static'; token } \| { kind:'toggle'; key; expr }` — additive union member (v0.4.1). `StyleVarBinding` = `{ kind:'style-var', pathIndex, varName: string, expr }` (v0.4.2). `ComponentBinding` adds `component: ComponentRef`, `props: PropEntry[]`, `propNames`, `slots: SlotEntry[]`. `SlotEntry.content` is now a factory `(props: SlotProps) => TemplateIR` (hard-cut, v0.4). `SlotOutletBinding` = `{ kind:'slot-outlet', pathIndex, name, fallback?: TemplateIR, props?: readonly PropEntry[] }`. `TemplateIR` root carries optional `styleArtifact` ({staticCss, scopeHash, varBindingDescs?}) + `classRewrites` (v0.4.2, .nv-FE-only). `SlotContent` exported. All types local-structural (no DOM/core imports). |
| `interpreter.ts` | REAL | Back-end / **semantic ground truth**. Exports `mount(ir, parent, doc): () => void` and `walkPath`. `mount` **creates its own `createRoot`**; effects enqueued, run on first flush. `mountFragment` internal. Handles all 6 PoC kinds + list + component + slot-outlet + **classlist** (`wireClassList`); sync throws. `wireClassList`: statics added once at mount via `classList.add`; toggles wired as per-key `effect` for ≤6, one looping `effect` for >6 (T=6; `TODO(threshold)` comment). `wireSlotOutlet` calls `content(slotProps)` factory (v0.4). Slot content rendered via `runWithOwner(capturedParentOwner, () => createRoot(...))` — parent-lexical ownership (D-slot-1). Nested roots bridged via `onCleanup`. |
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
  shows real `boolSrc`). **D-cl-3 open:** hyphenated keys silently broken — deferred to S0.
- **Handler destructuring-write — DIAGNOSED (2026-06-21).** `eraseHandlerExpr` emits
  diagnostic; reads of props-destructured locals erased via `buildPropsAccessorMap`.
- **`parseNvFile` thunks are stubs** — structural form is real; thunks are `(() => undefined)`.
  Use `parseNvFileForEmit` for the build path.
- **`html-tag.ts`** covers text/attr/prop/event/component/classlist. Conditional/list require
  manual IR or the `.nv` path.
- **Component API v1 — LANDED (2026-06-21).** `ComponentBinding` real in `ir.ts` (v0.3).
  Both FEs detect capitalized elements → `ComponentBinding`. Both back-ends consume it.
  Slot consumption increments 1 + 1.5 + 2 LANDED (2026-06-22). D-slot-1 RETAINED; D-slot-2
  ownership flip re-phased to land with `each`.
- **Equality hook inert; step 4 shelved** — neither specialization saves work.
- **SyncBinding** throws at both back-ends.
- **Multi-root list items not supported** — single-root guard; wrap in a container element.
- **`$style` × slots** — LANDED 2026-06-23 (Increment SS). `patchClasslistTokens` component
  case recurses into slot IR classlist entries. **D-slot-style-1 CLOSED (Increment SS):**
  `liftStaticClassBindings` replaces shape.html regex — static class= attrs lifted to
  ClassListBinding entries at IR build time (both main and slot paths). Main-path static-class
  live bug CLOSED (was: shape.html kept bare class=, CSS scoped but element unscoped). **G5
  CLOSED:** `<each>`-in-slot wired in both FEs; `pushListBinding` shared helper (D-SS-2).
  G1–G5, G3', G6, G7 green. 659 pass / 0 skip.
  Playwright gate (G-SS-browser ×3) deferred to follow-up increment.
- **`extractModuleScope` edge:** non-`$component` top-level statements pass through verbatim.

---

## Not built at all (forward queue)
`$style` scoping (S0 handoff written; D-cl-3 fix folded in), SyncBinding, LIS list
move-minimization (parked), kind-split (parked behind real-app evidence), `roots[0] as Node`
biome-laundering cleanup. **D-slot-2 ownership flip** queued behind `each` — requires real
per-row invocations to make the leak gate failable. **D-cl-3 fix** (`propertyKeyText` helper,
four sites) queued as part of S0 (`feat/style-s0-parser-seam`).
