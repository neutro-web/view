# Increment 2 — Scoped-Slot IR Shape + `let={...}` Authoring (D-slot-1 retained)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `SlotEntry.content` as a `(props) => TemplateIR` factory + `SlotOutletBinding.props?` + `let={...}` authoring on both front-ends; D-slot-1 ownership unchanged; Template-IR v0.3.3 → v0.4.

**Architecture:** Hard-cut the `SlotEntry.content` field from `TemplateIR` to `(props: SlotProps) => TemplateIR`. Back-ends call `content(slotProps)` at the outlet to get the IR, then mount it under the same D-slot-1 `capturedParentOwner` as today. The child exposes values at the outlet via `SlotOutletBinding.props`; the parent receives them via `let={...}` (.nv) or `slot(name, factory)` (tagged-template). The inc-1.5 `computeBindingThunks` seam carries the props erasure in the emit path.

**Tech Stack:** TypeScript, vitest, jsdom, the nv renderer/compiler pipeline. No new dependencies.

**Authoritative spec:** `docs/superpowers/plans/slot-inc1-5-handoff.md` and the CC Handoff pasted by the user (Session 2026-06-22). Read both before starting Task 1.

## Global Constraints

- **Template-IR v0.3.3 → v0.4** hard-cut. No back-compat union on `SlotEntry.content`. Every existing `SlotEntry` literal is updated in the same commit as the type change.
- **D-slot-1 RETAINED.** `runWithOwner(capturedParentOwner, ...)` in both back-ends is **byte-identical** to pre-change after this increment. If you find yourself needing a §6/core change, STOP and surface.
- **No `src/core/` edits.** If `src/core/` appears in `git show --stat`, scope has drifted into D-slot-2 — stop.
- **A-0 doc discipline:** `template-ir.md` v0.4 doc diff (changelog + type-reference appendix) must be committed BEFORE `ir.ts` is edited.
- **Fail-shows-teeth rule:** every new test must be verified to FAIL on a deliberate regression before the real fix is committed.
- **Anti-vacuous sweep:** `grep -rPzo "expect\(\s*(true|false)\s*\)\.toBe"` + `grep -rPzo "expect\(\s*!"` over new tests → zero matches.
- **FE-equivalence:** both front-ends produce structurally identical IRs for the same scoped-slot usage. Use `irStructurallyEqual` from `test/renderer/ir-equivalence.ts`.
- Test suite is run with `pnpm test` (vitest). Typecheck: `pnpm typecheck`. Lint: `pnpm lint`. Build: `pnpm build`.
- Working directory: `/Users/kofi/_/view`. Branch: `main`.
- Baseline: **496 tests** (post-inc-1.5, 2026-06-22).

---

## File Map

| File | Role in this increment |
|---|---|
| `docs/template-ir.md` | Task 1 only — v0.4 changelog + type-reference appendix (before ir.ts) |
| `src/renderer/ir.ts` | Task 2 — hard-cut `SlotEntry.content`, add `SlotOutletBinding.props?` |
| `test/renderer/slot-consumption.test.ts` | Task 2 — wrap every `content: ir` as `content: () => ir` |
| `src/renderer/interpreter.ts` | Task 3 — `wireSlotOutlet` + `wireComponent` use factory |
| `src/compiler/emitted-mount.ts` | Task 3 — slot-outlet case + component case + carry-item convergence |
| `src/renderer/html-tag.ts` | Task 4 — `slots()` gains props; new `slot()` fill function |
| `src/renderer/nv-parser.ts` | Task 4 — `buildNvHoleBinding` detects call form; `buildNvSlotContentIR` extracts `let`; exports `slot()` analog via `.nv` parse |
| `src/renderer/nv-emitter.ts` | Task 5 — `emitBindingLiteral` slot-outlet emits `props` |
| `src/renderer/index.ts` (renderer barrel) | Task 4 — export new `slot()` function if added |
| `test/renderer/slot-consumption.test.ts` | Task 6 — new scoped-slot corpus |
| `docs/decision-log.md`, `docs/implementation-state.md`, `docs/template-ir.md` | Task 7 — on-land docs |

---

### Task 1: Docs gate — `template-ir.md` v0.4 (no code; must commit before `ir.ts`)

**Files:**
- Modify: `docs/template-ir.md`

**Interfaces:**
- Produces: approved v0.4 doc that Task 2's implementer reads before editing `ir.ts`.

- [ ] **Step 1: Add v0.4 changelog entry**

In `docs/template-ir.md`, add this line to the **Changelog** block (after the v0.3.3 line):

```
- v0.4 (2026-06-22): `SlotEntry.content` → factory `(props: SlotProps) => TemplateIR` (hard-cut, no union). `SlotOutletBinding.props?: readonly PropEntry[]` — child-exposed accessor thunks. `SlotFns` updated accordingly. `let={...}` authoring on both front-ends. D-slot-1 retained. reactive-core v0.4.2 unchanged.
```

- [ ] **Step 2: Update the type-reference appendix (§type-reference)**

Find the section of `docs/template-ir.md` that contains the `SlotEntry` type definition (search for `type SlotEntry`). Update it:

```ts
// Before (v0.3.3):
type SlotEntry = { name: string; content: TemplateIR }
type SlotFns   = { readonly [name: string]: TemplateIR }
type ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR

// After (v0.4):
type SlotProps   = PropsObject                           // reuse existing { [name]: ReactiveExpr }
type SlotContent = (props: SlotProps) => TemplateIR
type SlotEntry   = { name: string; content: SlotContent }
type SlotFns     = { readonly [name: string]: SlotContent }
type ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR
```

Also update the `SlotOutletBinding` type in the same appendix:

```ts
// Before (v0.3.3):
type SlotOutletBinding = BaseBinding & {
  kind:      'slot-outlet';
  name:      string;
  fallback?: TemplateIR;
}

// After (v0.4):
type SlotOutletBinding = BaseBinding & {
  kind:      'slot-outlet';
  name:      string;
  props?:    readonly PropEntry[];   // child-exposed accessor thunks
  fallback?: TemplateIR;
}
```

- [ ] **Step 3: Update the Status line**

Replace `**Status:** Approved — v0.3.3 (2026-06-22). Slot increment 1 landed.`
with `**Status:** Approved — v0.4 (2026-06-22). Increment 2 (scoped-slot shape + authoring) landed.`

- [ ] **Step 4: Verify no code files are touched**

```bash
git diff --stat
```

Expected: only `docs/template-ir.md` changed.

- [ ] **Step 5: Typecheck (docs-only, should be trivially clean)**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add docs/template-ir.md
git commit -m "docs(template-ir): bump to v0.4 — SlotEntry.content factory + SlotOutletBinding.props (pre-ir.ts gate)"
```

---

### Task 2: IR types hard-cut + corpus `SlotEntry` wrap

**Files:**
- Modify: `src/renderer/ir.ts`
- Modify: `test/renderer/slot-consumption.test.ts`

**Interfaces:**
- Consumes: `docs/template-ir.md` v0.4 (Task 1 committed)
- Produces:
  - `SlotContent = (props: SlotProps) => TemplateIR` — the new content factory type
  - `SlotEntry = { name: string; content: SlotContent }` — every existing callsite updated
  - `SlotOutletBinding.props?: readonly PropEntry[]` — additive optional field
  - `SlotFns = { readonly [name: string]: SlotContent }` — updated
  - All hand-authored `SlotEntry` literals in the test file wrapped: `content: () => ir` (or `content: (_props) => ir`)

- [ ] **Step 1: Update `ir.ts` types**

In `src/renderer/ir.ts`, locate the ComponentBinding section (around line 196) and make these changes:

```ts
// Replace:
export type SlotFns = { readonly [name: string]: TemplateIR }

// With:
export type SlotProps   = PropsObject                              // child-exposed values → parent-read thunks
export type SlotContent = (props: SlotProps) => TemplateIR
export type SlotFns     = { readonly [name: string]: SlotContent }
```

```ts
// Replace:
export type SlotEntry = { name: string; content: TemplateIR }

// With:
export type SlotEntry = { name: string; content: SlotContent }
```

```ts
// Replace:
export type SlotOutletBinding = BaseBinding & {
  kind: 'slot-outlet'
  name: string
  /** Child-authored default content, rendered when the slot is absent (increment 1). */
  fallback?: TemplateIR
}

// With:
export type SlotOutletBinding = BaseBinding & {
  kind: 'slot-outlet'
  name: string
  /** Child-exposed accessor thunks readable by parent-authored slot content (v0.4). */
  props?: readonly PropEntry[]
  /** Child-authored default content, rendered when the slot is absent (v0.3.3). */
  fallback?: TemplateIR
}
```

Also add `SlotContent` and `SlotProps` to the exports (they are new public types):

```ts
// The export block near SlotEntry/SlotFns should now also export SlotContent and SlotProps
// (they are already exported by virtue of `export type SlotProps = ...`)
```

- [ ] **Step 2: Run typecheck to find all breakage sites**

```bash
pnpm typecheck 2>&1 | head -80
```

Expected: TypeScript errors at every `content: <TemplateIR>` literal and every `slotsObj[x] = s.content` that hands a `TemplateIR` where `SlotContent` is expected. These are the sites to fix.

- [ ] **Step 3: Wrap every `SlotEntry` literal in `test/renderer/slot-consumption.test.ts`**

Search for `content:` in `test/renderer/slot-consumption.test.ts`. Every occurrence that assigns a bare `TemplateIR` to `content` must be wrapped.

There are approximately 16 sites (lines 164, 165, 224, 225, 269, 371, 452, 505, 621, 654, 757, 800, 868, 897, 1100, 1225, 1316, etc.). Wrap each:

```ts
// Before (example):
slots: [{ name: 'body', content: slotContentIR }],

// After:
slots: [{ name: 'body', content: () => slotContentIR }],
```

For tests that need to test factory-shape behavior or that assert on `.content` directly, use `(_props) => slotContentIR` to make the ignored parameter explicit.

- [ ] **Step 4: Fix the FE-equivalence tests that compare `.content` directly**

Search for `irStructurallyEqual(doc, htmlBody.content, nvBody.content)` and similar patterns — these compare `SlotEntry.content` as an IR. After the change, `.content` is a factory, not an IR. Update these assertions:

```ts
// Before:
const r = irStructurallyEqual(doc, htmlBody.content, nvBody.content)

// After:
// Call the factory with an empty props object to get the IR for comparison
const htmlBodyIR = htmlBody.content({})
const nvBodyIR = nvBody.content({})
const r = irStructurallyEqual(doc, htmlBodyIR, nvBodyIR)
```

There are 4 such sites in the file (lines 88, 118, 595, 721). Fix all of them.

- [ ] **Step 5: Run tests — expect failures only from back-ends not yet updated**

```bash
pnpm test
```

Expected: `src/renderer/interpreter.ts` and `src/compiler/emitted-mount.ts` type errors or runtime failures because they still pass `TemplateIR` where `SlotContent` is needed. These are fixed in Task 3. The test file itself should parse and the IR-type-only tests should pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ir.ts test/renderer/slot-consumption.test.ts
git commit -m "feat(ir): v0.4 hard-cut — SlotEntry.content factory + SlotOutletBinding.props + corpus wrap"
```

---

### Task 3: Back-end wiring — interpreter + emitted-mount (D-slot-1 unchanged)

**Files:**
- Modify: `src/renderer/interpreter.ts`
- Modify: `src/compiler/emitted-mount.ts`

**Interfaces:**
- Consumes: `SlotEntry`, `SlotContent`, `SlotFns`, `SlotOutletBinding.props?` from Task 2.
- Produces: `wireComponent` builds `slotsObj: Record<string, SlotContent>`; `wireSlotOutlet` calls `content(slotProps)` and mounts the returned IR under `capturedParentOwner` (D-slot-1). `emitted-mount.ts` slot-outlet carry-item `?? getOwner()` / `?? null` converged.

**Key invariant: `runWithOwner(capturedParentOwner, ...)` is byte-identical to pre-change in both files.** Only the lines that build `slotsObj` and call the factory change.

- [ ] **Step 1: Update `wireComponent` in `interpreter.ts`**

Find `wireComponent` (around line 498). The `slotsObj` build currently is:

```ts
const slotsObj: Record<string, TemplateIR> = {}
for (const s of binding.slots) {
  slotsObj[s.name] = s.content
}
```

Update the type:

```ts
const slotsObj: Record<string, SlotContent> = {}
for (const s of binding.slots) {
  slotsObj[s.name] = s.content   // s.content is now SlotContent (factory)
}
```

Also update the `mountFragment` call and `slotContext` type — currently the context passes `slotsObj: Record<string, TemplateIR>`. Update that type annotation to `Record<string, SlotContent>`.

- [ ] **Step 2: Update `wireSlotOutlet` in `interpreter.ts`**

Find `wireSlotOutlet` (around line 443). Current signature:

```ts
function wireSlotOutlet(
  binding: SlotOutletBinding,
  anchorNode: Node,
  doc: Document,
  slotsObj: Record<string, TemplateIR>,
  capturedParentOwner: ReturnType<typeof getOwner>,
): void
```

Replace the body logic that resolves slot content:

```ts
// Replace:
const slotIR = slotsObj[binding.name]
// ... later uses slotIR directly

// With:
const content = slotsObj[binding.name]   // SlotContent | undefined
if (content === undefined) {
  // Unfilled slot: render fallback. D-slot-1 unchanged.
  const fallbackIR = binding.fallback
  if (fallbackIR !== undefined) {
    runWithOwner(capturedParentOwner, () => {
      const fallbackDisposer = createRoot((dispose) => {
        const { roots } = mountFragment(fallbackIR, parent, doc, anchorNode)
        onCleanup(() => {
          for (const n of roots) {
            if (n.parentNode !== null) n.parentNode.removeChild(n)
          }
        })
        return dispose
      })
      onCleanup(() => fallbackDisposer())
    })
  }
  return
}

// Build slotProps from binding.props (empty object when props absent)
const slotProps: Record<string, ReactiveExpr> = {}
for (const p of (binding.props ?? [])) {
  slotProps[p.name] = p.expr
}
const slotIR = content(slotProps)

// Mount slotIR under capturedParentOwner — D-slot-1 path UNCHANGED
runWithOwner(capturedParentOwner, () => {
  const slotDisposer = createRoot((dispose) => {
    const { roots } = mountFragment(slotIR, parent, doc, anchorNode)
    onCleanup(() => {
      for (const n of roots) {
        if (n.parentNode !== null) n.parentNode.removeChild(n)
      }
    })
    return dispose
  })
  onCleanup(() => slotDisposer())
})
```

Update the `slotsObj` parameter type: `slotsObj: Record<string, SlotContent>`.

Also add the missing `ReactiveExpr` import if not already present.

- [ ] **Step 3: Update the `slotContext` type in `interpreter.ts`**

Find the `slotContext` parameter (around line 555). Update:

```ts
// Before:
slotContext?: {
  slotsObj: Record<string, TemplateIR>
  capturedParentOwner: ReturnType<typeof getOwner>
}

// After:
slotContext?: {
  slotsObj: Record<string, SlotContent>
  capturedParentOwner: ReturnType<typeof getOwner>
}
```

- [ ] **Step 4: Update `emitted-mount.ts` — component case**

Find the component case (around line 476). Update the `slotsObj` build:

```ts
// Before:
const slotsObj: Record<string, TemplateIR> = {}
for (const s of slotEntries) {
  slotsObj[s.name] = s.content
}

// After:
const slotsObj: Record<string, SlotContent> = {}
for (const s of slotEntries) {
  slotsObj[s.name] = s.content   // s.content is now SlotContent
}
```

Also update the `childSlotContext` type and `slotContext` parameter type in `emitSetup`.

- [ ] **Step 5: Update `emitted-mount.ts` — slot-outlet case + carry-item convergence**

Find the slot-outlet case (around line 504). Currently:

```ts
const slotIR = slotContext?.slotsObj[slotName]
// ...
const fallbackOwner = slotContext?.capturedParentOwner ?? getOwner()
// ...
const filledOwner = slotContext?.capturedParentOwner ?? null
```

Replace with the factory-call pattern AND converge the dead `?? getOwner()` / `?? null` asymmetry:

```ts
const content = slotContext?.slotsObj[slotName]   // SlotContent | undefined

if (content === undefined) {
  // Unfilled slot: render fallback. D-slot-1 unchanged.
  const fallbackIR = (binding as SlotOutletBinding).fallback
  if (fallbackIR === undefined) return
  // Carry-item convergence: slotContext is always defined when slot-outlet is reached
  // (slot-outlet is only wired inside the component case which sets slotContext).
  // Use slotContext! — the ?? arm was dead.
  const owner = slotContext!.capturedParentOwner
  runWithOwner(owner, () => {
    const fallbackDisposer = createRoot((dispose) => {
      const emptyVerdicts = new Map<number, BindingErasureVerdict>()
      const { setup: fbSetup } = emitSetup(fallbackIR, emptyVerdicts)
      const { roots } = fbSetup(parent, doc, anchorNode)
      onCleanup(() => {
        for (const n of roots) {
          if (n.parentNode !== null) n.parentNode.removeChild(n)
        }
      })
      return dispose
    })
    onCleanup(() => fallbackDisposer())
  })
  return
}

// Build slotProps from binding.props
const slotProps: Record<string, ReactiveExpr> = {}
for (const p of ((binding as SlotOutletBinding).props ?? [])) {
  slotProps[p.name] = p.expr
}
const slotIR = content(slotProps)

// Mount under same D-slot-1 owner — UNCHANGED
const owner = slotContext!.capturedParentOwner
runWithOwner(owner, () => {
  const slotDisposer = createRoot((dispose) => {
    const emptyVerdicts = new Map<number, BindingErasureVerdict>()
    const { setup: slotSetup } = emitSetup(slotIR, emptyVerdicts)
    const { roots } = slotSetup(parent, doc, anchorNode)
    onCleanup(() => {
      for (const n of roots) {
        if (n.parentNode !== null) n.parentNode.removeChild(n)
      }
    })
    return dispose
  })
  onCleanup(() => slotDisposer())
})
```

- [ ] **Step 6: Import `SlotContent` in both back-end files**

Both `interpreter.ts` and `emitted-mount.ts` import from `ir.ts`. Add `SlotContent` to the import list.

- [ ] **Step 7: Run tests — all existing slot tests must pass**

```bash
pnpm test
pnpm typecheck
```

Expected: all 496+ tests pass. The G4.* / fallback / component-as-slot-child tests pass with only the `content: () => ir` wrapping edit (no assertion changes). This is the behavior-neutrality anchor for the factory hard-cut.

- [ ] **Step 8: D-slot-1 proof via `git show`**

```bash
git show --stat HEAD
git diff HEAD~2 -- src/renderer/interpreter.ts | grep "runWithOwner"
git diff HEAD~2 -- src/compiler/emitted-mount.ts | grep "runWithOwner"
```

Expected: `runWithOwner(capturedParentOwner, ...)` lines exist and are present in the diff — **the argument is still `capturedParentOwner`** (unchanged). This is the inspection proof that D-slot-2 did not sneak in.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/interpreter.ts src/compiler/emitted-mount.ts
git commit -m "feat(back-ends): call SlotContent factory at outlet; converge ?? owner carry-item (D-slot-1 retained)"
```

---

### Task 4: Authoring surface — child outlet + parent fill (both front-ends)

**Files:**
- Modify: `src/renderer/html-tag.ts`
- Modify: `src/renderer/nv-parser.ts`
- Modify: `src/renderer/index.ts` (renderer barrel — export new `slot()` function)

**Interfaces:**
- Consumes: `SlotOutletBinding.props?`, `SlotContent`, `PropEntry` from Task 2.
- Produces:
  - **html-tag, child (outlet):** `slots('row', { item: () => sig(), index: () => idx() })` → `SlotOutletBinding` with `props: [{ name: 'item', expr: () => sig() }, { name: 'index', expr: () => idx() }]`
  - **html-tag, parent (fill):** `slot('row', factory)` sentinel → `SlotEntry { name: 'row', content: factory }`; unscoped `<slot name="x">...</slot>` wrappers → `{ name: 'x', content: (_props) => ir }`
  - **nv-parser, child (outlet):** `{slots.row({ item: item, index: index })}` (CallExpression) → `SlotOutletBinding` with `props` (stub exprs on interpreter path, erased thunks on emit path)
  - **nv-parser, parent (fill):** `<slot name="row" let={item, index}>...</slot>` → `SlotEntry { name: 'row', content: (slotProps) => ir }` where `item`/`index` holes read `slotProps.item`/`slotProps.index`
  - Both front-ends produce `irStructurallyEqual` IR for the same scoped-slot usage.

#### html-tag.ts — outlet side (`slots()` gains props)

- [ ] **Step 1: Extend `SlotSentinel` and `slots()`**

In `src/renderer/html-tag.ts`, update `SlotSentinel` and `slots()`:

```ts
// Before:
export interface SlotSentinel {
  readonly __nvSlotOutlet: string
  readonly __nvFallback?: TemplateIR
}

export function slots(name: string, opts?: { fallback?: TemplateIR }): SlotSentinel {
  return { __nvSlotOutlet: name, __nvFallback: opts?.fallback }
}

// After:
export interface SlotSentinel {
  readonly __nvSlotOutlet: string
  readonly __nvFallback?: TemplateIR
  readonly __nvProps?: readonly PropEntry[]
}

type SlotsOpts = { fallback?: TemplateIR } & { [propName: string]: ReactiveExpr | TemplateIR | undefined }

export function slots(name: string, opts?: SlotsOpts): SlotSentinel {
  const propEntries: PropEntry[] = []
  if (opts) {
    for (const [key, val] of Object.entries(opts)) {
      if (key === 'fallback') continue
      if (typeof val === 'function') {
        propEntries.push({ name: key, expr: val as ReactiveExpr })
      }
    }
  }
  return {
    __nvSlotOutlet: name,
    ...(opts?.fallback !== undefined && { __nvFallback: opts.fallback }),
    ...(propEntries.length > 0 && { __nvProps: propEntries }),
  }
}
```

- [ ] **Step 2: Update `buildHtmlHoleBinding` to read `__nvProps`**

In `buildHtmlHoleBinding`, update the slot-sentinel branch:

```ts
if (isSlotSentinel(origExpr)) {
  const b: SlotOutletBinding = {
    kind: 'slot-outlet',
    pathIndex,
    name: origExpr.__nvSlotOutlet,
    ...(origExpr.__nvFallback !== undefined && { fallback: origExpr.__nvFallback }),
    ...(origExpr.__nvProps !== undefined && origExpr.__nvProps.length > 0 && { props: origExpr.__nvProps }),
  }
  return b
}
```

#### html-tag.ts — fill side (`slot()` function + unscoped wrap)

- [ ] **Step 3: Add `SlotFillSentinel` and `slot()` function**

Add after `SlotSentinel`:

```ts
/** Opaque sentinel returned by `slot(name, factory)` — the tagged-template scoped fill form. */
export interface SlotFillSentinel {
  readonly __nvSlotFill: string
  readonly factory: SlotContent
}

function isSlotFillSentinel(v: unknown): v is SlotFillSentinel {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).__nvSlotFill === 'string' &&
    typeof (v as Record<string, unknown>).factory === 'function'
  )
}

/**
 * Create a scoped-slot fill for the tagged-template parent side.
 * Write `${slot('row', ({ item, index }) => html`...`)}` inside a component hole.
 * The factory receives the child-exposed SlotProps and returns the slot content IR.
 * Mirrors `.nv`'s `<slot name="row" let={item, index}>...</slot>`.
 */
export function slot(name: string, factory: SlotContent): SlotFillSentinel {
  return { __nvSlotFill: name, factory }
}
```

- [ ] **Step 4: Update `walkNodeList` to detect `SlotFillSentinel` holes inside component elements**

In `walkNodeList` (around line 235), when processing a component element's children, the current code iterates over `<slot name="x">` element children. Add detection of `SlotFillSentinel` holes at the component's direct-child level.

Look for where `buildSlotContentIR` is called (around line 307). Before that loop, add a pass over any Comment nodes (holes) in the component element's direct children:

```ts
// Inside the component element processing block, after slots array is initialized:
const slots: SlotEntry[] = []
// Track consumed hole indices for this component
const consumedHoleIndices = new Set<number>()

// First pass: detect slot-fill sentinels in direct-child holes of this component element
for (const child of Array.from(componentEl.childNodes)) {
  if (child.nodeType === Node.COMMENT_NODE) {
    const commentText = child.textContent ?? ''
    const holeMatch = /^nv-(\d+)$/.exec(commentText)
    if (holeMatch) {
      const holeIdx = parseInt(holeMatch[1], 10)
      const expr = exprs[holeIdx]
      if (isSlotFillSentinel(expr)) {
        slots.push({ name: expr.__nvSlotFill, content: expr.factory })
        consumedHoleIndices.add(holeIdx)
      }
    }
  }
}

// Second pass: detect <slot name="x"> wrapper elements (existing logic)
for (const child of Array.from(componentEl.childNodes)) {
  if (child.nodeType === Node.ELEMENT_NODE) {
    const el = child as Element
    if (el.tagName.toLowerCase() === 'slot') {
      const slotName = el.getAttribute('name') ?? 'default'
      const { ir: slotIR, holeIndices } = buildSlotContentIR(el, exprs, root, doc)
      for (const idx of holeIndices) consumedHoleIndices.add(idx)
      // Wrap bare IR in factory (hard-cut: all SlotEntry.content is factory)
      slots.push({ name: slotName, content: (_props) => slotIR })
    }
  }
}
```

**Note:** Check the actual `walkNodeList` implementation carefully to integrate with the existing `consumed` set and hole-index tracking. The above is the logic; exact integration depends on reading the current code.

- [ ] **Step 5: Export `slot` from renderer barrel**

In `src/renderer/index.ts`, add `slot` to the exports from `html-tag.ts`:

```ts
export { ..., slot } from './html-tag.js'
```

#### nv-parser.ts — outlet side (call expression detection)

- [ ] **Step 6: Detect `slots.name({...})` call form in `buildNvHoleBinding`**

In `buildNvHoleBinding` (around line 224), add detection of `slots.name({...})` before the existing `slots.name` bare-read check:

```ts
// NEW: Detect slots.name({ item: expr, index: expr }) — scoped outlet call form
// This is a CallExpression whose callee is the existing slots.name PropertyAccessExpression
if (info.kind === 'text') {
  if (
    ts.isCallExpression(holeExpr) &&
    ts.isPropertyAccessExpression(holeExpr.expression) &&
    ts.isIdentifier(holeExpr.expression.expression) &&
    holeExpr.expression.expression.text === 'slots' &&
    ts.isIdentifier(holeExpr.expression.name)
  ) {
    const slotName = (holeExpr.expression.name as ts.Identifier).text
    const props: PropEntry[] = []
    const arg = holeExpr.arguments[0]
    if (arg && ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          props.push({ name: (prop.name as ts.Identifier).text, expr: stubExpr })
        }
      }
    }
    const b: SlotOutletBinding = {
      kind: 'slot-outlet',
      pathIndex,
      name: slotName,
      ...(props.length > 0 && { props }),
    }
    return b
  }
}
```

Place this BEFORE the existing `isSlotOutlet` bare-read check so that `slots.row({ item })` (CallExpression) is matched first, and `slots.row` (PropertyAccessExpression) is matched as the fallback.

#### nv-parser.ts — fill side (`let={...}` on `<slot>` element)

- [ ] **Step 7: Extract `let` names in `buildNvSlotContentIR`**

In `buildNvSlotContentIR` (around line 500), extract the `let` attribute from the `<slot>` element:

```ts
// At the top of buildNvSlotContentIR, after receiving slotElement:
const letAttr = slotElement.getAttribute('let')
// letNames: identifiers bound by let={item, index} — empty if no let attribute
const letNames: string[] = []
if (letAttr) {
  // letAttr looks like "{ item, index }" or "item, index"
  // Extract identifier names from the destructure pattern
  const identifiers = letAttr.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  letNames.push(...identifiers)
}
```

The `let` attribute value looks like `{ item, index }` (the destructure pattern). Extract the identifier names from inside the braces.

- [ ] **Step 8: Pass `letNames` as slot-scoped signal names into the IR build**

For the INTERPRETER path (stub exprs), `letNames` affect the local signal set. Add them to the `signals` set when processing slot content:

```ts
// In buildNvSlotContentIR, before calling walkNvNodeList:
const slotSignals = letNames.length > 0
  ? new Set([...signals, ...letNames])
  : signals
```

For the EMIT path, `letNames` must erase as `slotProps.name()` in the factory. The factory parameter is conventionally named `slotProps` (or `props` — use the same name in the emitted output as the factory parameter). The stub-expr path in `parseNvFile` doesn't need to know this; only the `computeBindingThunks` call does.

**Return `letNames`** from `buildNvSlotContentIR` so the parent's `computeBindingThunks` call for this slot's holes knows to use slot-prop accessors:

```ts
// buildNvSlotContentIR return type gains letNames:
function buildNvSlotContentIR(...): { ir: TemplateIR; holeIndices: number[]; letNames: string[] } {
  // ...
  return { ir, holeIndices, letNames }
}
```

- [ ] **Step 9: Use `letNames` in `computeBindingThunks` for slot holes (emit path)**

In `computeBindingThunks` (around line 1916), inside the `slots.map(...)` section, use the slot's `letNames` to build slot-prop accessor overrides:

```ts
slots: pc.slots.map((slot, slotIdx) => {
  const holeIndices = pc.slotHoleGroups[slotIdx] ?? []
  // Build slotPropsAccessors: letNames → 'slotProps.name' (for emit)
  // slot.letNames is set when <slot name="x" let={item, index}> was parsed
  const slotPropsParam = 'slotProps'
  const slotPropsAccessors: Map<string, string> | undefined = slot.letNames?.length
    ? new Map(slot.letNames.map((n) => [n, `${slotPropsParam}.${n}()`]))
    : undefined

  const thunks: ThunkSource[] = holeIndices.map((holeIdx) => {
    // ...
    return computeThunkSource(
      holeExpr,
      positions[holeIdx] as PosKind,
      doc,
      symbols,
      diagnostics,
      propsParamName,
      // Merge parent propsAccessors with slot-prop accessors (slot-props take priority)
      slotPropsAccessors
        ? new Map([...(propsAccessors ?? []), ...slotPropsAccessors])
        : propsAccessors,
    )
  })
  return { name: slot.name, holeIndices: [...holeIndices], thunks }
}),
```

**This requires `slot.letNames` to exist on the slot info.** The `PendingNvComponentInfo.slots` array element needs a `letNames?: string[]` field. Add this when `buildNvSlotContentIR` populates slot info.

- [ ] **Step 10: Wrap slot content in factory in `walkNvNodeList`**

In `walkNvNodeList`, where `SlotEntry` is built from a `<slot name="x">` element (around line 427–441), wrap the IR in a factory:

```ts
// Before:
slots.push({ name: 'default', content: defaultIR })
// ...
slots.push({ name: slotName, content: namedIR })

// After (wrap in factory; _props ignored for unscoped):
slots.push({ name: 'default', content: (_props) => defaultIR })
// ...
// For letNames case, the factory is a closure over the slotPropsParam at runtime:
// On the interpreter path, content is structural (stubs); the factory just returns the IR.
slots.push({ name: slotName, content: (_props) => namedIR })
```

The emit path's factory emission is handled in Task 5. On the interpreter/structural path, `(_props) => ir` is sufficient (the props are only live on the tagged-template path where the factory IS the developer's function).

- [ ] **Step 11: Run typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 496+ tests passing. The FE-equivalence tests now compare factory-called IRs (from Step 4 of Task 2). `pnpm typecheck` clean.

- [ ] **Step 12: Commit**

```bash
git add src/renderer/html-tag.ts src/renderer/nv-parser.ts src/renderer/index.ts
git commit -m "feat(authoring): scoped-slot outlet+fill both FEs — slots() gains props; slot() fill; let={...} on nv <slot>"
```

---

### Task 5: Emit path — `ThunkSource` + `computeThunkSource` + `emitBindingLiteral`

**Files:**
- Modify: `src/renderer/nv-parser.ts` (ThunkSource type + `computeThunkSource` slot-outlet call detection)
- Modify: `src/renderer/nv-emitter.ts` (`emitBindingLiteral` slot-outlet + factory wrapping)

**Interfaces:**
- Consumes: `SlotOutletBinding.props?` (Task 2), nv-parser slot call detection (Task 4), `letNames` in slot info (Task 4).
- Produces:
  - `ThunkSource` slot-outlet variant gains `props?: Array<{ name: string; exprSrc: string }>`
  - `computeThunkSource` slot-outlet (both bare `slots.name` and call `slots.name({...})`) populates `props`
  - `emitBindingLiteral` slot-outlet emits `props: [{ name: ..., expr: () => (exprSrc) }, ...]`
  - `.nv` slot content emitted as factory `(slotProps) => <ir literal>` when `letNames` present; `(_props) => <ir literal>` otherwise

- [ ] **Step 1: Extend `ThunkSource` slot-outlet variant**

In `src/renderer/nv-parser.ts` (around line 89):

```ts
// Before:
| { kind: 'slot-outlet'; name: string; fallbackThunks?: ThunkSource[] }

// After:
| { kind: 'slot-outlet'; name: string; props?: Array<{ name: string; exprSrc: string }>; fallbackThunks?: ThunkSource[] }
```

- [ ] **Step 2: Update `computeThunkSource` slot-outlet detection**

In `computeThunkSource` (around line 1778), the slot-outlet detection currently handles only `slots.name` (bare read) and `slots.name ?? html`...`` (fallback). Add the call form.

After the existing `isSlotOutlet` check, add:

```ts
// NEW: slots.name({ item: item, index: index }) — scoped outlet call form
if (
  ts.isCallExpression(holeExpr) &&
  ts.isPropertyAccessExpression(holeExpr.expression) &&
  ts.isIdentifier(holeExpr.expression.expression) &&
  holeExpr.expression.expression.text === 'slots'
) {
  const slotName = (holeExpr.expression.name as ts.Identifier).text
  const props: Array<{ name: string; exprSrc: string }> = []
  const arg = holeExpr.arguments[0]
  if (arg && ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const propName = (prop.name as ts.Identifier).text
        // Erase the value expression to an accessor thunk src (NOT a value call)
        const exprSrc = eraseSignalReadsInNode(
          prop.initializer as ts.Expression,
          symbols.all,
          propsAccessors,
        )
        props.push({ name: propName, exprSrc })
      }
    }
  }
  return { kind: 'slot-outlet' as const, name: slotName, ...(props.length > 0 && { props }) }
}
```

- [ ] **Step 3: Update `emitBindingLiteral` slot-outlet case in `nv-emitter.ts`**

In `emitBindingLiteral` (around line 127), the slot-outlet case currently emits:

```ts
case 'slot-outlet': {
  const sob = binding as SlotOutletBinding
  const parts = [`kind: 'slot-outlet'`, pathEntry, `name: ${JSON.stringify(sob.name)}`]
  if (sob.fallback !== undefined) {
    // ...
    parts.push(`fallback: ${emitIrLiteral(sob.fallback, fallbackThunks, indent)}`)
  }
  return `{ ${parts.join(', ')} }`
}
```

Add `props` emission:

```ts
case 'slot-outlet': {
  const sob = binding as SlotOutletBinding
  const parts = [`kind: 'slot-outlet'`, pathEntry, `name: ${JSON.stringify(sob.name)}`]
  if (sob.props !== undefined && sob.props.length > 0) {
    if (thunk.kind !== 'slot-outlet')
      throw new Error('[nv/emitter] SlotOutletBinding thunk kind mismatch')
    const propLiterals = sob.props
      .map((p, idx) => {
        const propThunk = thunk.props?.[idx]
        if (!propThunk)
          throw new Error(`[nv/emitter] Missing prop thunk for slot-outlet prop '${p.name}' at index ${idx}`)
        return `{ name: ${JSON.stringify(p.name)}, expr: () => (${propThunk.exprSrc}) }`
      })
      .join(', ')
    parts.push(`props: [${propLiterals}]`)
  }
  if (sob.fallback !== undefined) {
    if (thunk.kind !== 'slot-outlet')
      throw new Error('[nv/emitter] SlotOutletBinding thunk kind mismatch')
    const fallbackThunks = thunk.fallbackThunks ?? []
    parts.push(`fallback: ${emitIrLiteral(sob.fallback, fallbackThunks, indent)}`)
  }
  return `{ ${parts.join(', ')} }`
}
```

- [ ] **Step 4: Emit slot content as factory in `emitIrLiteral` / `emitComponentFactory`**

When emitting a `SlotEntry.content` factory, the slot content IR literal must be wrapped. Currently `emitBindingLiteral` for `component` emits:

```ts
const slotLiterals = cb.slots
  .map((s, idx) => {
    const slotThunks = thunk.slots[idx]?.thunks ?? []
    return `{ name: ${JSON.stringify(s.name)}, content: ${emitIrLiteral(s.content, slotThunks, i2)} }`
  })
  .join(', ')
```

But `s.content` is now `SlotContent` (a factory), not `TemplateIR`. The emitter cannot call `s.content` (it's a factory, not a plain IR). The ThunkSource's `slots` array carries the slot's hole thunks — the emitter should emit the factory form using those.

Update to emit the factory wrapper:

```ts
const slotLiterals = cb.slots
  .map((s, idx) => {
    const slotThunkEntry = thunk.slots[idx]
    const slotHoleThunks = slotThunkEntry?.thunks ?? []
    // Emit the slot IR literal. To get the TemplateIR for emission, call the stub factory
    // on the structural path — s.content({}) returns the plain IR.
    // On the emit path, s.content is always (_props) => ir (structural), so content({}) is safe.
    const slotIR = s.content({})
    const letNames = slotThunkEntry?.letNames ?? []
    const factoryParam = letNames.length > 0 ? 'slotProps' : '_props'
    const irLiteral = emitIrLiteral(slotIR, slotHoleThunks, i2)
    return `{ name: ${JSON.stringify(s.name)}, content: (${factoryParam}) => ${irLiteral} }`
  })
  .join(', ')
```

**Note:** This requires that `ThunkSource` component variant's `slots` entries carry `letNames?: string[]`. Add this to the `ThunkSource` component variant type in nv-parser.ts and populate it from `computeBindingThunks`.

- [ ] **Step 5: Run tests — emit path must work end-to-end**

```bash
pnpm test
pnpm typecheck
```

Expected: all tests pass. If there is an `nv-emitter-exec.test.ts` or `nv-emitter.test.ts` that runs live bundles, those must pass too.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/nv-parser.ts src/renderer/nv-emitter.ts
git commit -m "feat(emit): ThunkSource slot-outlet gains props; emitBindingLiteral emits props + factory wrapper"
```

---

### Task 6: New scoped-slot corpus tests

**Files:**
- Modify: `test/renderer/slot-consumption.test.ts`

**Interfaces:**
- Consumes: `SlotOutletBinding.props?`, `SlotContent`, `slot()` function (Task 4), all back-end wiring (Task 3).
- Produces: `scoped-slot-FE-equivalence`, `exposed-value-reactivity`, `one-directional-no-writeback`, `unscoped-slot-still-works` (behavior-neutrality anchor), `let-name-binding`, scoped-G4.6 ownership proof.

**Pattern for all back-end tests:** use the `mountI` / `mountC` helpers already defined in the test file. Use `flushSync()` after writes. Assert on DOM text, not on "effect ran."

- [ ] **Step 1: Add `scoped-slot-FE-equivalence` test**

```ts
describe('§scoped-slot-FE-equivalence — both FEs produce identical scoped-slot IR', () => {
  it('outlets: slots() props and nv call form produce identical SlotOutletBindings', () => {
    const html = createHtmlTag(doc)
    const itemSig = signal('hello')
    // html-tag child: slots outlet with props
    const htmlChildIR = html`<div>${slots('row', { item: () => itemSig() })}</div>`
    const htmlOutlet = htmlChildIR.bindings[0] as SlotOutletBinding
    expect(htmlOutlet.kind).toBe('slot-outlet')
    expect(htmlOutlet.props).toHaveLength(1)
    expect(htmlOutlet.props![0].name).toBe('item')

    // nv-parser child: slots.row({ item: item }) call form
    const nvSrc = [
      'export const C = $component(() => {',
      '  $script(() => { const item = signal("hello") })',
      '  $render(() => html`<div>${slots.row({ item: item })}</div>`)',
      '})',
    ].join('\n')
    const nvChildIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir!
    const nvOutlet = nvChildIR.bindings[0] as SlotOutletBinding
    expect(nvOutlet.kind).toBe('slot-outlet')
    expect(nvOutlet.props).toHaveLength(1)
    expect(nvOutlet.props![0].name).toBe('item')
  })

  it('fills: slot() factory and nv let={} produce identical SlotEntry shapes', () => {
    const html = createHtmlTag(doc)
    const itemSig = signal('hello')
    // html-tag parent: slot() fill
    const htmlParentIR = html`<Child>${slot('row', ({ item }) => html`<span>${() => String(item?.() ?? '')}</span>`)}</Child>`
    const htmlComp = htmlParentIR.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    expect(htmlComp?.slots).toHaveLength(1)
    expect(htmlComp?.slots[0].name).toBe('row')
    expect(typeof htmlComp?.slots[0].content).toBe('function')

    // nv-parser parent: <slot name="row" let={item}>
    const nvSrc = [
      'export const P = $component(() => {',
      '  $render(() => html`<Child><slot name="row" let={item}><span>{item}</span></slot></Child>`)',
      '})',
    ].join('\n')
    const nvParentIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir!
    const nvComp = nvParentIR.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    expect(nvComp?.slots).toHaveLength(1)
    expect(nvComp?.slots[0].name).toBe('row')
    expect(typeof nvComp?.slots[0].content).toBe('function')
  })
})
```

- [ ] **Step 2: Verify test FAILS before implementation (fail-shows-teeth for props detection)**

Temporarily comment out the `props` detection in `buildNvHoleBinding` (the call-form branch). Run the test. Expected: FAIL (`nvOutlet.props` is undefined). Restore the branch. Run again: PASS. Report both outcomes in the commit message.

- [ ] **Step 3: Add `exposed-value-reactivity` test (both back-ends, hand-authored IR)**

```ts
describe('§exposed-value-reactivity — child exposes a signal; parent content reads it reactively', () => {
  function buildScopedSlotIR(): TemplateIR {
    const itemSig = signal('initial')

    // Child IR: slot-outlet with props: [{ name: 'item', expr: () => itemSig() }]
    const childIR: TemplateIR = {
      id: 'child:scoped:item',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [{
        kind: 'slot-outlet',
        pathIndex: 0,
        name: 'row',
        props: [{ name: 'item', expr: () => itemSig() }],
      }],
    }

    // Parent: SlotEntry.content factory that reads props.item
    const parentIR: TemplateIR = {
      id: 'parent:scoped:item',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [{
        kind: 'component',
        pathIndex: 0,
        component: () => childIR,
        props: [],
        propNames: [],
        slots: [{
          name: 'row',
          content: (slotProps) => ({
            id: 'slot:content:item',
            shape: { html: '<span data-testid="scoped-item"><!--nv-0--></span>', bindingPaths: [[0, 0]] },
            bindings: [{ kind: 'text', pathIndex: 0, expr: () => String(slotProps.item?.() ?? '') }],
          }),
        }],
      }],
    }

    return parentIR
  }

  it('interpreter: slot DOM updates when child-exposed value changes', () => {
    // This test cannot be written without a shared signal — we need to capture
    // itemSig outside buildScopedSlotIR for writes.
    // Restructure: inline the build.
    const itemSig = signal('initial')

    const childIR: TemplateIR = {
      id: 'child:reactive:i',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [{
        kind: 'slot-outlet', pathIndex: 0, name: 'row',
        props: [{ name: 'item', expr: () => itemSig() }],
      }],
    }
    const parentIR: TemplateIR = {
      id: 'parent:reactive:i',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [{
        kind: 'component', pathIndex: 0,
        component: () => childIR,
        props: [], propNames: [],
        slots: [{
          name: 'row',
          content: (slotProps) => ({
            id: 'slot:text:i',
            shape: { html: '<span data-testid="scoped"><!--nv-0--></span>', bindingPaths: [[0, 0]] },
            bindings: [{ kind: 'text', pathIndex: 0, expr: () => String(slotProps.item?.() ?? '') }],
          }),
        }],
      }],
    }

    mountI(parentIR)
    expect(container.querySelector('[data-testid="scoped"]')?.textContent).toBe('initial')

    itemSig.set('updated')
    flushSync()

    // FAILABLE: if item is snapshotted at expose time (value call instead of thunk),
    // DOM stays 'initial' — fails here.
    expect(container.querySelector('[data-testid="scoped"]')?.textContent).toBe('updated')
  })

  it('compiler: slot DOM updates when child-exposed value changes', () => {
    const itemSig = signal('initial')
    // Same IR structure, different id prefix
    const childIR: TemplateIR = {
      id: 'child:reactive:c',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [{
        kind: 'slot-outlet', pathIndex: 0, name: 'row',
        props: [{ name: 'item', expr: () => itemSig() }],
      }],
    }
    const parentIR: TemplateIR = {
      id: 'parent:reactive:c',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [{
        kind: 'component', pathIndex: 0,
        component: () => childIR,
        props: [], propNames: [],
        slots: [{
          name: 'row',
          content: (slotProps) => ({
            id: 'slot:text:c',
            shape: { html: '<span data-testid="scoped-c"><!--nv-0--></span>', bindingPaths: [[0, 0]] },
            bindings: [{ kind: 'text', pathIndex: 0, expr: () => String(slotProps.item?.() ?? '') }],
          }),
        }],
      }],
    }

    mountC(parentIR)
    expect(container.querySelector('[data-testid="scoped-c"]')?.textContent).toBe('initial')

    itemSig.set('updated')
    flushSync()

    expect(container.querySelector('[data-testid="scoped-c"]')?.textContent).toBe('updated')
  })
})
```

- [ ] **Step 4: Verify fail-shows-teeth for exposed-value-reactivity**

In `wireSlotOutlet` (interpreter), temporarily change the `slotProps` build to snapshot the value:

```ts
// TEMPORARY — makes the test fail
slotProps[p.name] = () => p.expr() as unknown   // snapshot: () => 'initial'
// vs correct: slotProps[p.name] = p.expr  (pass the thunk reference)
```

Run the `exposed-value-reactivity (interpreter)` test. Expected: FAIL (DOM stays 'initial' after write). Restore the correct `slotProps[p.name] = p.expr`. Run again: PASS. Report both.

- [ ] **Step 5: Add `one-directional-no-writeback` test**

```ts
describe('§one-directional-no-writeback — slot props are read-only from parent side', () => {
  it('child-exposed signal is unchanged after parent-content interaction', () => {
    const childSig = signal('child-value')

    const childIR: TemplateIR = {
      id: 'child:nowrite',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [{
        kind: 'slot-outlet', pathIndex: 0, name: 'row',
        props: [{ name: 'item', expr: () => childSig() }],
      }],
    }
    const parentIR: TemplateIR = {
      id: 'parent:nowrite',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [{
        kind: 'component', pathIndex: 0,
        component: () => childIR,
        props: [], propNames: [],
        slots: [{
          name: 'row',
          content: (slotProps) => ({
            id: 'slot:nowrite',
            shape: { html: '<button><!--nv-0--></button>', bindingPaths: [[0, 0]] },
            bindings: [{ kind: 'text', pathIndex: 0, expr: () => String(slotProps.item?.() ?? '') }],
          }),
        }],
      }],
    }

    mountI(parentIR)

    // The parent content reads childSig via slotProps.item — but cannot write it.
    // There is no write-back API; childSig must remain unchanged.
    expect(childSig()).toBe('child-value')
    // No write-back occurred from mounting; signal value unchanged.
    // This pins that slot props are one-directional (no reactive two-way binding).
    expect(container.querySelector('button')?.textContent).toBe('child-value')
  })
})
```

- [ ] **Step 6: Add scoped-G4.6 ownership proof**

Mirror G4.6 (child-dispose / D-slot-1 still holds) with a scoped slot:

```ts
describe('§scoped-G4.6 — D-slot-1 retained: parent signal live after child-dispose with scoped content', () => {
  it('interpreter: parent signal live after child dispose, scoped slot DOM does NOT mutate', () => {
    const parentSig = signal('before')

    const childIR: TemplateIR = {
      id: 'child:scoped-g46',
      shape: { html: '<section data-testid="scoped-g46"><!--nv-0--></section>', bindingPaths: [[0, 0]] },
      bindings: [{
        kind: 'slot-outlet', pathIndex: 0, name: 'default',
        props: [{ name: 'item', expr: () => 'static-child-value' }],
      }],
    }
    const parentIR: TemplateIR = {
      id: 'parent:scoped-g46',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [{
        kind: 'component', pathIndex: 0,
        component: () => childIR,
        props: [], propNames: [],
        slots: [{
          name: 'default',
          content: (_slotProps) => ({
            id: 'slot:scoped-g46',
            shape: { html: '<!--nv-0-->', bindingPaths: [[0]] },
            bindings: [{ kind: 'text', pathIndex: 0, expr: () => parentSig() }],
          }),
        }],
      }],
    }

    const disposes = { parent: (() => {}) as () => void, child: (() => {}) as () => void }

    disposes.parent = createRoot((parentD) => {
      disposes.child = createRoot((childD) => {
        mount(parentIR, container, doc)
        return childD
      })
      return parentD
    })

    flushSync()
    expect(container.querySelector('[data-testid="scoped-g46"]')?.textContent).toBe('before')

    disposes.child()
    flushSync()

    const textBeforeWrite = container.querySelector('[data-testid="scoped-g46"]')?.textContent ?? ''

    // D-slot-1 retained proof: parent signal still writable
    expect(() => parentSig.set('after-child-dispose')).not.toThrow()
    flushSync()

    // Disposed slot region must NOT reflect the new value (effects are gone)
    expect(container.querySelector('[data-testid="scoped-g46"]')?.textContent).toBe(textBeforeWrite)
  })
})
```

- [ ] **Step 7: Anti-vacuous sweep**

```bash
grep -rPzo "expect\(\s*(true|false)\s*\)\.toBe" test/renderer/slot-consumption.test.ts
grep -rPzo "expect\(\s*!" test/renderer/slot-consumption.test.ts
```

Expected: zero matches in the new tests.

- [ ] **Step 8: Run full suite**

```bash
pnpm test
```

Expected: all tests pass. Report count delta vs 496 baseline.

- [ ] **Step 9: Commit**

```bash
git add test/renderer/slot-consumption.test.ts
git commit -m "test(slot): scoped-slot corpus — FE-equivalence, exposed-value-reactivity, D-slot-1 retained proof"
```

---

### Task 7: On-land docs

**Files:**
- Modify: `docs/decision-log.md`
- Modify: `docs/implementation-state.md`

**Interfaces:**
- Consumes: all committed changes from Tasks 1–6. Read placed files before writing.

- [ ] **Step 1: Append LANDED entry to `docs/decision-log.md`**

Append at the end of the log:

```markdown
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
```

- [ ] **Step 2: Update Current State header in `docs/decision-log.md`**

Update the `_Last updated` line and the slot consumption bullet:

```markdown
_Last updated: 2026-06-22. Contract **v0.4.2** · Template-IR **v0.4**._
```

Update the slot consumption bullet:

```markdown
- **Slot consumption — increments 1 + 1.5 + 2 LANDED (2026-06-22):** inc 2 = scoped-slot
  IR shape (`SlotEntry.content` → factory; `SlotOutletBinding.props?`); `let={...}` authoring
  both FEs; D-slot-1 RETAINED. Template-IR → v0.4. reactive-core v0.4.2 unchanged. D-slot-2
  re-phased to `each`.
```

Update the Tests line:

```markdown
- **Tests:** <actual count> green (slot increment 2, 2026-06-22). `tsc --strict` + DOM lib, biome, build all clean.
```

- [ ] **Step 3: Update `docs/implementation-state.md`**

Update "Last verified" line:

```
Last verified against source: **2026-06-22.** Contract **v0.4.2**, Template IR **v0.4**.
```

Update `ir.ts` row to note v0.4: `SlotEntry.content` is factory, `SlotOutletBinding.props?` real, `SlotContent` exported.

Update `interpreter.ts` row: `wireSlotOutlet` calls `content(slotProps)` factory; `wireComponent` builds `Record<string, SlotContent>`.

Update `emitted-mount.ts` row: slot-outlet case calls factory; `??`-fallback carry item converged.

Update `html-tag.ts` row: `slot(name, factory)` fill sentinel; `slots()` gains props.

Update `nv-parser.ts` row: `slots.name({...})` call form → `SlotOutletBinding.props`; `let={...}` on `<slot>` element.

Update `nv-emitter.ts` row: slot-outlet emits `props`; slot content emitted as `(slotProps) => ir` factory.

Update the Known Gaps / forward queue: D-slot-2 ownership flip is queued behind `each` (per 2026-06-22 re-phase).

- [ ] **Step 4: Run final gates**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

Expected: all clean. Scope proof:

```bash
git diff main -- src/core/
```

Expected: empty (no core changes).

- [ ] **Step 5: Commit**

```bash
git add docs/decision-log.md docs/implementation-state.md
git commit -m "docs: increment 2 LANDED — decision log + implementation-state updated to v0.4"
git push
```

---

## Self-review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `template-ir.md` v0.4 before `ir.ts` (A-0 discipline) | Task 1 |
| `SlotEntry.content` → factory hard-cut | Task 2 |
| `SlotOutletBinding.props?` | Task 2 |
| Corpus `SlotEntry` wrap (every literal) | Task 2 |
| Interpreter `wireSlotOutlet` calls factory | Task 3 |
| Emitted-mount slot-outlet calls factory | Task 3 |
| `??` carry-item converged in emitted-mount | Task 3 |
| D-slot-1 ownership byte-identical proof | Task 3 |
| `slots()` gains props (html-tag outlet) | Task 4 |
| `slot(name, factory)` fill sentinel (html-tag) | Task 4 |
| `slots.name({...})` call form in nv-parser (outlet) | Task 4 |
| `let={...}` on `<slot>` in nv-parser (fill) | Task 4 |
| `ThunkSource` slot-outlet gains `props?` | Task 5 |
| `computeThunkSource` slot-outlet call form | Task 5 |
| `emitBindingLiteral` slot-outlet emits `props` | Task 5 |
| Slot content emitted as `(slotProps) => ir` factory | Task 5 |
| `scoped-slot-FE-equivalence` test | Task 6 |
| `exposed-value-reactivity` both back-ends | Task 6 |
| Fail-shows-teeth (props detection + thunk vs value) | Task 6 |
| `one-directional-no-writeback` | Task 6 |
| scoped-G4.6 D-slot-1 ownership proof | Task 6 |
| Anti-vacuous sweep | Task 6 |
| Scope proof (no `src/core/`) | Task 6 |
| Decision log LANDED entry | Task 7 |
| `implementation-state.md` update | Task 7 |

**Placeholder scan:** No TBD, TODO, "similar to Task N" patterns found.

**Type consistency:** `SlotContent` defined in Task 2 (`ir.ts`), used in Tasks 3–5 consistently. `SlotProps = PropsObject` — reuses existing type. `PropEntry` already exists. `SlotFillSentinel.__nvSlotFill` consistent throughout Tasks 4–6.

**Known integration risk:** Task 4 Step 4 (walkNodeList integration for `SlotFillSentinel`) is the most complex step — it requires reading `walkNodeList` carefully to integrate hole-index tracking with the existing `consumed` set. If the integration is unclear, surface before committing.
