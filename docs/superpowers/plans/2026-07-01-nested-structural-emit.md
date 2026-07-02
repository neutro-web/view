# Nested Structural Emit (Mode-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Mode-A emit path (`parseNvFileForEmit` → `computeBindingThunks` →
`emitIrLiteral`) reconstruct nested structural bindings (component / `<each>` /
`<recycle>` / `<switch>`) that appear *inside* an `<each>`/`<recycle>` item body or a
`<switch>` branch/fallback body, so all three back-ends (interpreter,
`emitted-mount.ts` compiler, Mode-A emitter) handle arbitrary nesting identically.

**Architecture:** The body walk (`walkNvNodeList`, called recursively via
`buildNvSlotContentIR`) already discovers nested structural children at every depth
and wires them into `bodyIR.bindings` — that part works. The gap is downstream:
the *pending-info* bundle that survives from the walk into `computeBindingThunks`
carries only `bodyHoleIndices` (hole positions) for body content, silently dropping
any nested component/each/recycle/switch pendings. This plan threads those nested
pendings through the same pipe holes already use (`NvWalked*` → `PendingNv*Info` →
`ThunkSource`), and replaces the per-body "map over bodyHoleIndices" logic with a
recursive body-thunk assembler shared with the top-level assembler — one recursive
reconstruction instead of a flat top-level path and a hole-only body path.

**Tech Stack:** TypeScript (`src/renderer/nv-parser.ts`, `src/renderer/nv-emitter.ts`),
Vitest (unit/exec tests), Playwright (`test/browser/`, real-browser gate).

## Global Constraints

- No `src/core/` diff of any kind (emit-path/reconstruction only). If a core change
  seems needed, STOP and escalate — do not implement it.
- Interpreter and `emitted-mount.ts` behavior must not change (regression on the two
  already-correct back-ends is a G0 disqualifier).
- No already-landed construct's semantics may change for non-nested cases
  (`<each>`/`<recycle>`/`<switch>`/conditional/component/slot).
- Any case left unhandled must still throw loudly at emit time — never silently emit
  wrong output.
- No partial coverage that silently mishandles some nesting combos while fixing
  others — either genuinely recursive, or the unhandled combo throws loudly and is
  documented and tested.
- Full existing suite must stay green (813/813 at `61d5987` — re-run and record the
  actual count at landing SHA independently).
- `tsc --strict` clean.
- Collapse discipline: prefer one shared recursive helper over duplicating the
  top-level structural-thunk logic inside body reconstruction.

---

## Design Fork Ruling (resolved — read before Task 1)

The commission poses two options and asks that the fork be ruled before implementation.
This was investigated directly against `main` HEAD `4204678` (≥ `61d5987`, confirmed by
`git log -1`).

**Ruling: Option 1 (thread nested structural pendings through `ThunkSource`,
recursive reconstruction). Option 2 is confirmed dead.**

Evidence for why Option 2 (emit straight from `bodyIR`) is impossible:

- `bodyIR` on every `NvWalkedEach`/`NvWalkedRecycle`/`NvWalkedMatchBranch` is built by
  `buildNvSlotContentIR` (`nv-parser.ts:1135`) using **stub accessors**:
  `const stubExpr = (() => undefined) as ReactiveExpr<unknown>` and
  `const stubHandler = (() => (_e: Event) => undefined) as HandlerExpr`
  (`nv-parser.ts:1145-1146`). These stubs are wired directly into the hole bindings
  returned in `bodyIR.bindings` via `buildNvHoleBinding` (`nv-parser.ts:1194-1204`).
- Emit needs **erased source strings** (the output of `eraseSignalReadsInNode` /
  `computeThunkSource`) to write a re-executable `.js` module — not evaluated
  function objects. `bodyIR`'s hole bindings hold the latter, not the former, at every
  depth. There is no path from a stub closure back to its source text.
- Confirmed no code path anywhere in `nv-emitter.ts` attempts to serialize a binding's
  evaluated closure to source; the ONLY thing emitted from a binding is precomputed
  `ThunkSource` source strings. Option 2 would require re-deriving source from an
  evaluated closure, which is not possible in general (closures don't carry their
  originating AST/text at runtime).

Evidence for the actual gap (confirms Option 1 is sufficient and precisely scoped):

- `walkNvNodeList` — used by `buildNvSlotContentIR` for **every** body (`<each>` body
  at `nv-parser.ts:634`, `<recycle>` body at `:732`, `<switch>` branch/fallback body at
  `:817`, component slot body at `:923`/`:945`) — **already recurses** and already
  discovers nested components/lists/recycledLists/switches at arbitrary depth, wiring
  them into `bodyIR.bindings` in a fixed order: holes first (`holeInfos` order), then
  components, then lists, then recycledLists, then switches
  (`buildNvSlotContentIR`, `nv-parser.ts:1192-1230`).
- `buildNvSlotContentIR` returns only `{ ir, holeIndices, letNames }`
  (`nv-parser.ts:1236-1245`) — the nested component/list/recycledList/switch info the
  walk just produced (`components`, `slotLists`, `slotRecycledLists`, `slotSwitches`
  locals, `nv-parser.ts:1164-1171`) is **used to build `bodyIR.bindings` but never
  returned as pending info**. It is thrown away the moment the function returns.
- `PendingNvEachInfo`/`PendingNvRecycleInfo` (`nv-parser.ts:1362-1374`) have no field
  to receive it even if it were returned. `PendingNvSwitchInfo` (`:1376-1379`) keeps
  `bodyIR` per branch but nothing in `computeBindingThunks` ever reads it.
- `computeBindingThunks`'s body-thunk construction (`nv-parser.ts:3195-3208` for each,
  `:3236-3249` for recycle, `:3264-3277`/`:3284-3297` for switch branches/fallback) is
  a `.map()` over `bodyHoleIndices` only — structurally incapable of producing a
  `ThunkSource` for a nested list/recycledList/switch/component, because it never sees
  one.
- `ThunkSource`'s `list`/`recycled-list`/`switch` variants (`nv-parser.ts:131-149`)
  have only `bodyThunks: ThunkSource[]` — no channel for nested structural children.
- `emitIrLiteral` (`nv-emitter.ts:288-336`) walks `ir.bindings` **in bindings order**
  and pulls one `ThunkSource` per binding off a flat cursor
  (`const thunk = thunks[thunkIdx++]`, `nv-emitter.ts:~295`), dispatching on
  `thunk.kind` and throwing `"... thunk kind mismatch"` when the cursor and the
  binding disagree (list: `nv-emitter.ts:171`, recycled-list: `:196`, switch: `:217`).
  When `bodyIR.bindings` contains a nested structural binding that has no
  corresponding entry in `thunk.bodyThunks` (because it was never built), the cursor
  desyncs at that position and the throw fires. This exactly matches the reported
  failure mode.
- **Ordering constraint (load-bearing for Task 3):** the flat thunk array consumed by
  `emitIrLiteral` for a given `ir` must be in the SAME order as `ir.bindings`. The
  top-level `ir` (built by `processHtmlTemplate`, bindings pushed in the order
  component → list → recycledList → switch → hole, `nv-parser.ts:1509-1547`) is why
  `computeBindingThunks`'s top-level return concatenates
  `[...componentThunks, ...listThunks, ...recycledListThunks, ...switchThunks, ...holeThunks]`
  (`nv-parser.ts:3319`). Body IRs built by `buildNvSlotContentIR` push bindings in a
  **different** order — hole → component → list → recycledList → switch
  (`nv-parser.ts:1192-1230`). The recursive body-thunk assembler (Task 3) MUST
  reproduce `buildNvSlotContentIR`'s order, not the top-level order — they are
  different functions producing differently-ordered `bindings` arrays.
- One more real constraint already enforced upstream: `<recycle>` nested inside an
  `<each>` body is a **hard parse-time error** today
  (`nv-parser.ts:1218-1219`, `isEachBody` guard), independent of this bug. That
  remains out of scope to lift — it stays a documented, loudly-thrown unsupported
  combination (Task 7 adds a regression test asserting the throw still fires).

**Adjacent gap noted, explicitly OUT of scope:** a component's own slot content
(`buildNvSlotContentIR` called with `isEachBody=false` at `nv-parser.ts:923`/`:945`)
has the identical hole-only limitation for structural children nested directly inside
a component's slot (as opposed to inside an each/recycle/switch body). The G1 nesting
matrix in this commission only requires the four containers
(`<each>`, `<recycle>`, `<switch>` branch, `<switch>` fallback); component slot bodies
are not one of them. Do not fix this in the same change — note it in the landing
report as a related follow-up candidate, per G0 (no scope creep).

---

## File Structure

- **Modify `src/renderer/nv-parser.ts`:**
  - `NvWalkedEach`, `NvWalkedRecycle`, `NvWalkedMatchBranch` (types, ~L513-536): add
    fields carrying the nested pending bundle collected from the body's own walk.
  - `buildNvSlotContentIR` (~L1135-1246): return the nested pending bundle for the
    level it just built, in addition to `{ ir, holeIndices, letNames }`.
  - `PendingNvEachInfo`, `PendingNvRecycleInfo`, `PendingNvSwitchInfo` (~L1362-1379):
    add the same nested pending bundle fields.
  - The pending-info conversion at ProcessResult return (~L1583-1602): copy the new
    fields through.
  - `ThunkSource` type (~L100-150): add `bodyComponents`/`bodyLists`/`bodyRecycles`/
    `bodySwitches` channels to the `list`/`recycled-list`/`switch` variants.
  - `computeBindingThunks` (~L3116-3320): extract the per-kind thunk builders
    (component/list/recycledList/switch) that currently live inline as local
    closures into a shared recursive function `computeStructuralThunks(pending, ...)`
    that both the top level and body levels call; rewrite the four body-thunk sites
    (`:3195`, `:3236`, `:3264`, `:3284`) to call it recursively and assemble
    `bodyThunks` in `buildNvSlotContentIR`'s bindings order (hole → component → list →
    recycledList → switch).
- **Modify `src/renderer/nv-emitter.ts`:** no signature change expected (thunks stay a
  flat array consumed by the existing cursor). Verify only; add nothing unless the
  investigation in Task 1 finds otherwise (if it does, STOP and re-plan that task
  before continuing).
- **Create `docs/design/design-nested-structural-emit.md`:** the paste-ready fork
  ruling above, for Kofi's decision-log entry (do not write the decision-log itself —
  per commission, Kofi writes that on landing).
- **Create fixtures under `test/browser/fixtures/nested-structural/`:** one `.nv`-style
  source string per nesting-matrix cell (see Task 7).
- **Modify/create tests:**
  - `test/renderer/nv-emitter-exec.test.ts`: add nesting-matrix unit/exec cases
    (fast, jsdom-free — these exercise emit + module execution in Node, not DOM
    rendering, matching the existing `EX-EACH-*` pattern).
  - `test/browser/nested-structural.spec.ts` (new): the real-browser Playwright gate
    (G1 nesting matrix DOM assertions, three-back-end parity, reactivity, disposal).

---

## Task 1: Land the design-fork ruling doc and get Gate-P go-ahead

**Files:**
- Create: `docs/design/design-nested-structural-emit.md`

- [ ] **Step 1: Write the ruling doc**

Copy the "Design Fork Ruling" section above verbatim into
`docs/design/design-nested-structural-emit.md`, prefixed with a one-line header:

```markdown
# Design Fork Ruling — Nested Structural Bindings on the Mode-A Emit Path

**Commission:** commission-nested-structural-emit.md. **Ruled at:** main `4204678`
(≥ `61d5987`). **Ruling:** Option 1 (recursive `ThunkSource` reconstruction).
Option 2 (emit straight from `bodyIR`) is confirmed dead — see evidence below.

<!-- paste the "Design Fork Ruling" section content from the plan here -->
```

- [ ] **Step 2: Surface to Kofi, wait for go**

This fork was scoped in-stream by the commission (no §1 invariant, no observation-order
question) — proceed on go without waiting for a separate escalation review, per the
commission's own escalation check. Do not start Task 2 until Kofi acknowledges the
ruling doc.

- [ ] **Step 3: Commit**

```bash
git add docs/design/design-nested-structural-emit.md
git commit -m "docs(design): rule nested-structural-emit fork — Option 1 (recursive ThunkSource)"
```

---

## Task 2: Extend `NvWalked*` types and `buildNvSlotContentIR` to surface nested pendings

**Files:**
- Modify: `src/renderer/nv-parser.ts:513-543` (`NvWalkedEach`, `NvWalkedRecycle`,
  `NvWalkedMatchBranch`, `NvWalkedSwitch` — read-only for this task, no field changes
  needed on `NvWalkedSwitch` itself)
- Modify: `src/renderer/nv-parser.ts:1135-1246` (`buildNvSlotContentIR`)
- Test: `test/renderer/nv-parser-nested-thunks.test.ts` (new)

**Interfaces:**
- Produces: a new exported-from-module (module-private is fine — same file) type
  `NestedStructuralPending`:
  ```typescript
  interface NestedStructuralPending {
    components: PendingNvComponentInfo[]
    lists: PendingNvEachInfo[]
    recycles: PendingNvRecycleInfo[]
    switches: PendingNvSwitchInfo[]
  }
  ```
  and `buildNvSlotContentIR` now returns
  `{ ir: TemplateIR; holeIndices: number[]; letNames: string[]; nested: NestedStructuralPending }`.
  `NvWalkedEach`/`NvWalkedRecycle`/`NvWalkedMatchBranch` gain a `nested: NestedStructuralPending`
  field populated from that return value at each call site (`:634`, `:732`, `:817`).

- [ ] **Step 1: Write the failing test — `buildNvSlotContentIR` surfaces one level of nesting**

Add `test/renderer/nv-parser-nested-thunks.test.ts`. This test drives the parser's
internal pipeline through `parseNvFileForEmit` (the public entry point) rather than
calling `buildNvSlotContentIR` directly (it's not exported) — assert on the
`ThunkSource` shape it produces, which is the externally-observable effect of Task 2 +
Task 3 together. Since Task 2 alone doesn't change any exported behavior, write this
as a single test that will only pass once Task 3 also lands — mark it `.todo` for now
and un-skip it in Task 3, OR (preferred, keeps TDD honest per-task) assert an
intermediate, task-2-only observable: that parsing does NOT throw during parse (only
at `emitIrLiteral` time, unchanged) and that `parseNvFileForEmit`'s returned
`ThunkSource[]` for the each's `bodyThunks` is UNCHANGED in length for the no-nesting
case (regression guard for Task 2's refactor before Task 3 adds new fields):

**Verified API (read `nv-parser.ts:159-178`, `:3439-3443` and existing call sites in
`test/renderer/nv-emitter.test.ts`/`nv-emitter-exec.test.ts` directly — this is the
real signature, not a guess):**

```typescript
export function parseNvFileForEmit(source: string, fileName: string, doc: Document): NvComponentResult[]

export interface NvEmitPayload {
  scriptBody: string
  /** Per-binding erased thunk source, index-aligned with ir.bindings. */
  bindingThunks: ThunkSource[]
  moduleScope: string
}

export interface NvComponentResult {
  name: string
  ir: TemplateIR
  scriptSignals: readonly string[]
  style: NvStyleInfo | null
  verdicts: ReadonlyArray<'ACCEPT' | 'PLAIN'>
  diagnostics: ReadonlyArray<NvDiagnostic>
  emit?: NvEmitPayload // present when produced by parseNvFileForEmit
}
```

`doc` is required (third positional arg) — every call site in the existing suite
passes either the shared jsdom `document` global or a `makeDoc()`-built `Document`.
Thunks live at `results[i].emit!.bindingThunks`, a flat `ThunkSource[]`
index-aligned with `results[i].ir.bindings` (top-level bindings order:
component → list → recycledList → switch → hole, per the Design Fork Ruling).

```typescript
import { describe, expect, test } from 'vitest'
import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'

describe('P2C-NEST-01  buildNvSlotContentIR nested-pending plumbing does not regress flat bodies', () => {
  test('a plain (non-nested) <each> body still parses and emits with one bodyThunk per hole', () => {
    const source = `
const List = $component(() => {
  $script(() => {
    const items = signal([{ id: 1, label: 'A' }])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><li>\${item.label}</li></each></ul>\`)
})`
    const results = parseNvFileForEmit(source, 'list.nv', document)
    const listThunk = results[0]!.emit!.bindingThunks.find((t) => t.kind === 'list')
    expect(listThunk).toBeDefined()
    expect(listThunk!.kind === 'list' && listThunk!.bodyThunks.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test, confirm it currently passes (baseline, not a red step)**

This step is a baseline capture, not a TDD red step — Task 2 is a pure plumbing
change with no new externally-observable behavior yet. Run:

```bash
npx vitest run test/renderer/nv-parser-nested-thunks.test.ts
```

Expected: PASS (this behavior already exists). This test now guards against Task 2's
refactor breaking the non-nested case.

- [ ] **Step 3: Implement — add `NestedStructuralPending`, thread it through `NvWalked*` and `buildNvSlotContentIR`**

In `nv-parser.ts`, near `NvWalkedEach` (~L513), add:

```typescript
/** Nested structural pendings discovered one level below a body/slot walk. */
interface NestedStructuralPending {
  components: PendingNvComponentInfo[]
  lists: PendingNvEachInfo[]
  recycles: PendingNvRecycleInfo[]
  switches: PendingNvSwitchInfo[]
}
```

Move this above `PendingNvComponentInfo`/`PendingNvEachInfo`/etc. if TypeScript's
declaration order requires it (interfaces are hoisted in TS, so file order doesn't
actually matter — place it next to `NvWalkedEach` for readability, it will compile
regardless of forward references to `PendingNv*Info`).

Add `nested: NestedStructuralPending` to `NvWalkedEach`, `NvWalkedRecycle`, and to
`NvWalkedMatchBranch` (all three, `nv-parser.ts:513-536`).

In `buildNvSlotContentIR` (`nv-parser.ts:1135-1246`), after computing `components`,
`slotLists`, `slotRecycledLists`, `slotSwitches` from the `walkNvNodeList` result
(already destructured at `:1164-1171`), build the pending bundle using the SAME
conversion the top-level `ProcessResult` return uses (`nv-parser.ts:1573-1602`) —
extract that conversion into a shared helper first so both call sites use it:

```typescript
/** Convert one level of walk-result structural collections into Pending*Info. Shared
 * by the top-level ProcessResult return and buildNvSlotContentIR (body/slot walks). */
function toPendingBundle(
  components: NvWalkedComponent[],
  lists: NvWalkedEach[],
  recycledLists: NvWalkedRecycle[],
  switches: NvWalkedSwitch[],
): NestedStructuralPending {
  return {
    components: components.map(
      ({ tagName, propNames, reactiveHoles, slots, slotHoleGroups, slotLetNames }) => ({
        tagName,
        propNames,
        reactiveHoles,
        slots,
        slotHoleGroups,
        slotLetNames,
      }),
    ),
    lists: lists.map((wl) => ({
      itemsHoleIdx: wl.itemsHoleIdx,
      keyHoleIdx: wl.keyHoleIdx,
      letNames: wl.letNames,
      bodyHoleIndices: wl.bodyHoleIndices,
      itemReadsIndex: wl.itemReadsIndex,
      nested: wl.nested,
    })),
    recycles: recycledLists.map((wl) => ({
      itemsHoleIdx: wl.itemsHoleIdx,
      letNames: wl.letNames,
      bodyHoleIndices: wl.bodyHoleIndices,
      nested: wl.nested,
    })),
    switches: switches.map((ws) => ({
      branches: ws.branches.map((b) => ({
        whenHoleIdx: b.whenHoleIdx,
        bodyHoleIndices: b.bodyHoleIndices,
        bodyIR: b.bodyIR,
        nested: b.nested,
      })),
      hasFallback: ws.hasFallback,
    })),
  }
}
```

Replace the inline conversion at `nv-parser.ts:1573-1602` (the `ProcessResult` return)
with calls to `toPendingBundle(...)`, keeping `pendingComponents`/`pendingEachItems`/
`pendingRecycleItems`/`pendingSwitchItems` as the destructured fields of its result
(this is the DRY collapse the commission's "distinct-path discipline" asks for — do
this now rather than duplicating the conversion a second time inside
`buildNvSlotContentIR`).

In `buildNvSlotContentIR`, after building `bindings` (~L1230), compute:

```typescript
const nested = toPendingBundle(components, slotLists, slotRecycledLists, slotSwitches)
```

and change the return statement (`:1236-1245`) to:

```typescript
return {
  ir: { /* unchanged */ },
  holeIndices,
  letNames,
  nested,
}
```

Update the three call sites that destructure `buildNvSlotContentIR`'s return
(`nv-parser.ts:634`, `:732`, `:817`) to also capture `nested`, and pass it through to
the `lists.push(...)` / `recycledLists.push(...)` / branch object at `:665-673`,
`:753`, and the switch branch construction near `:817` — each now includes
`nested` alongside `bodyIR`/`bodyHoleIndices`.

Update `PendingNvEachInfo`, `PendingNvRecycleInfo`, `PendingNvSwitchInfo`
(`nv-parser.ts:1362-1379`) to add `nested: NestedStructuralPending` (each/recycle) and
`nested: NestedStructuralPending` per branch (switch, alongside existing `bodyIR`):

```typescript
interface PendingNvEachInfo {
  itemsHoleIdx: number
  keyHoleIdx: number
  letNames: string[]
  bodyHoleIndices: number[]
  itemReadsIndex: boolean
  nested: NestedStructuralPending
}

interface PendingNvRecycleInfo {
  itemsHoleIdx: number
  letNames: string[]
  bodyHoleIndices: number[]
  nested: NestedStructuralPending
}

interface PendingNvSwitchInfo {
  branches: Array<{
    whenHoleIdx: number
    bodyHoleIndices: number[]
    bodyIR: TemplateIR
    nested: NestedStructuralPending
  }>
  hasFallback: boolean
}
```

The `pendingEachItems.map(...)`/`pendingRecycleItems.map(...)`/`pendingSwitchItems.map(...)`
conversions at `nv-parser.ts:1583-1602` (now operating on `NvWalkedEach`/`NvWalkedRecycle`/
`NvWalkedSwitch` values that carry `.nested`) copy `.nested` straight through, unchanged
in shape from what Task 2's `toPendingBundle` already produced at the walk site — no
double conversion needed here; this call site already exists and just needs `nested:
wl.nested` (each/recycle) / `nested: b.nested` (switch branch) added to its object
literals.

- [ ] **Step 4: Run `tsc --strict` and the full test suite**

```bash
npx tsc --noEmit --strict
npx vitest run
```

Expected: no new type errors; full suite still green (the new field is additive and
unused by `computeBindingThunks` until Task 3, so behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/nv-parser.ts test/renderer/nv-parser-nested-thunks.test.ts
git commit -m "refactor(nv-parser): thread nested structural pendings through body walks"
```

---

## Task 3: Recursive body-thunk assembly in `computeBindingThunks`

**Files:**
- Modify: `src/renderer/nv-parser.ts:100-150` (`ThunkSource` type)
- Modify: `src/renderer/nv-parser.ts:3116-3320` (`computeBindingThunks`)
- Modify: `test/renderer/nv-parser-nested-thunks.test.ts` (un-skip / extend the Task 2 test)

**Interfaces:**
- Consumes: `NestedStructuralPending` from Task 2, `PendingNv*Info.nested`.
- Produces: `ThunkSource`'s `list`/`recycled-list`/`switch` variants gain
  `bodyComponentThunks`/`bodyListThunks`/`bodyRecycledListThunks`/`bodySwitchThunks`
  fields (parallel to the existing `bodyThunks`, which keeps meaning "hole thunks for
  this body"). A new function
  `computeBodyThunks(pending: NestedStructuralPending, bodyHoleIndices: number[], holeExprs, positions, doc, symbols, diagnostics, propsParamName, propsAccessors): { bodyThunks: ThunkSource[]; bodyComponentThunks: ThunkSource[]; bodyListThunks: ThunkSource[]; bodyRecycledListThunks: ThunkSource[]; bodySwitchThunks: ThunkSource[] }`
  is the single recursive assembler both the each/recycle/switch-branch/switch-fallback
  sites call.

- [ ] **Step 1: Write the failing test — nested list-in-each round-trips through emit**

Extend `test/renderer/nv-parser-nested-thunks.test.ts`:

```typescript
describe('P2C-NEST-02  each-in-each thunk assembly (Mode-A emit path)', () => {
  test('nested <each> inside an <each> body produces a nested list ThunkSource, not a throw', () => {
    const source = `
const Grid = $component(() => {
  $script(() => {
    const rows = signal([{ id: 1, cells: [{ id: 10, v: 'a' }] }])
  })
  $render(() => html\`<div><each .of="\${rows}" key="\${(r) => r.id}" let={row}>
    <div><each .of="\${row.cells}" key="\${(c) => c.id}" let={cell}><span>\${cell.v}</span></each></div>
  </each></div>\`)
})`
    const results = parseNvFileForEmit(source, 'grid.nv', document)
    const outerList = results[0]!.emit!.bindingThunks.find((t) => t.kind === 'list')
    expect(outerList).toBeDefined()
    expect(outerList!.kind === 'list' && outerList!.bodyListThunks.length).toBe(1)
    const innerList = outerList!.kind === 'list' ? outerList!.bodyListThunks[0] : undefined
    expect(innerList?.kind).toBe('list')
  })
})
```

(Uses the verified `parseNvFileForEmit(source, fileName, doc)` → `NvComponentResult[]`
signature and `results[0].emit!.bindingThunks` field confirmed in Task 2.)

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run test/renderer/nv-parser-nested-thunks.test.ts
```

Expected: FAIL — `ThunkSource`'s `list` variant has no `bodyListThunks` field yet
(type error) or the field is always `[]` (runtime assertion failure), depending on
which lands first; either is an acceptable red state.

- [ ] **Step 3: Extend `ThunkSource`'s structural variants**

In the `ThunkSource` type (`nv-parser.ts:~131-149`), add the four channels to
`list`, `recycled-list`, and `switch` (switch needs them per-branch and on the
fallback):

```typescript
{
  kind: 'list'
  itemsSrc: string
  keySrc: string
  bodyThunks: ThunkSource[]
  bodyComponentThunks: ThunkSource[]
  bodyListThunks: ThunkSource[]
  bodyRecycledListThunks: ThunkSource[]
  bodySwitchThunks: ThunkSource[]
  letNames: string[]
  itemReadsIndex: boolean
}
```
```typescript
{
  kind: 'recycled-list'
  itemsSrc: string
  bodyThunks: ThunkSource[]
  bodyComponentThunks: ThunkSource[]
  bodyListThunks: ThunkSource[]
  bodyRecycledListThunks: ThunkSource[]
  bodySwitchThunks: ThunkSource[]
  letNames: [string, string]
}
```
```typescript
{
  kind: 'switch'
  branches: Array<{
    whenSrc: string
    bodyThunks: ThunkSource[]
    bodyComponentThunks: ThunkSource[]
    bodyListThunks: ThunkSource[]
    bodyRecycledListThunks: ThunkSource[]
    bodySwitchThunks: ThunkSource[]
  }>
  fallbackThunks: ThunkSource[] | null
  fallbackComponentThunks: ThunkSource[]
  fallbackListThunks: ThunkSource[]
  fallbackRecycledListThunks: ThunkSource[]
  fallbackSwitchThunks: ThunkSource[]
}
```

(`fallbackThunks` stays nullable per existing convention — no fallback means `null`;
the four new fallback channels default to `[]` when there's no fallback, since an
empty array is cheaper to consume unconditionally in the emitter than adding null
checks four more times.)

- [ ] **Step 4: Add `computeBodyThunks`, the shared recursive assembler**

Place this directly above `computeBindingThunks` in `nv-parser.ts`. It mirrors the
existing per-kind mapping logic (component/list/recycledList/switch) that
`computeBindingThunks` already has inline — extract those four `.map()` bodies
(currently local to `computeBindingThunks`, `nv-parser.ts:3130-3301`) into standalone
functions parameterized by the merged accessors, so both the top-level call and this
new recursive call reuse the identical per-binding-kind source-erasure logic instead
of duplicating it:

```typescript
/**
 * Recursively assemble the four structural thunk channels plus the hole
 * (`bodyThunks`) channel for one body/slot level. Shared by every body-producing
 * site (each/recycle/switch branch/switch fallback) — this is the single recursive
 * reconstruction that replaces the old flat "map over bodyHoleIndices only" logic.
 */
function computeBodyThunks(
  pending: NestedStructuralPending,
  bodyHoleIndices: number[],
  holeExprs: ts.Expression[],
  positions: PosKind[],
  doc: Document,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  propsParamName: string | undefined,
  propsAccessors: ReadonlyMap<string, string> | undefined,
): {
  bodyThunks: ThunkSource[]
  bodyComponentThunks: ThunkSource[]
  bodyListThunks: ThunkSource[]
  bodyRecycledListThunks: ThunkSource[]
  bodySwitchThunks: ThunkSource[]
} {
  const bodyThunks = bodyHoleIndices.map((holeIdx) => {
    const holeExpr = holeExprs[holeIdx]
    if (holeExpr === undefined)
      throw new Error(`[nv/emitter] Body hole index ${holeIdx} out of range`)
    return computeThunkSource(
      holeExpr,
      positions[holeIdx] as PosKind,
      doc,
      symbols,
      diagnostics,
      propsParamName,
      propsAccessors,
    )
  })

  const bodyComponentThunks = computeComponentThunks(
    pending.components,
    holeExprs,
    positions,
    doc,
    symbols,
    diagnostics,
    propsParamName,
    propsAccessors,
  )
  const bodyListThunks = computeListThunks(
    pending.lists,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )
  const bodyRecycledListThunks = computeRecycledListThunks(
    pending.recycles,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )
  const bodySwitchThunks = computeSwitchThunks(
    pending.switches,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )

  return { bodyThunks, bodyComponentThunks, bodyListThunks, bodyRecycledListThunks, bodySwitchThunks }
}
```

Extract `computeComponentThunks`, `computeListThunks`, `computeRecycledListThunks`,
`computeSwitchThunks` from the four inline `.map()` blocks currently at
`nv-parser.ts:3130-3176` (component), `:3178-3218` (list), `:3220-3256` (recycled-list),
`:3258-3301` (switch). Each keeps its exact existing body EXCEPT the four body-thunk
sub-blocks — replace those four specific inline blocks:

- List's `const bodyThunks: ThunkSource[] = pe.bodyHoleIndices.map(...)` (`:3195-3208`)
  → `const { bodyThunks, bodyComponentThunks, bodyListThunks, bodyRecycledListThunks, bodySwitchThunks } = computeBodyThunks(pe.nested, pe.bodyHoleIndices, holeExprs, positions, doc, symbols, diagnostics, propsParamName, mergedAccessors)`
  and add all five to the returned `{ kind: 'list' as const, ... }` object literal
  (`:3210-3217`).
- Recycled-list's equivalent block (`:3236-3249`) → same pattern, using `pe.nested`
  and `mergedAccessors` from that closure, added to the `:3250-3255` return literal.
- Switch branch's block (`:3264-3277`) → same pattern per-branch, using `b.nested`;
  the per-branch return object (`:3278`) gains all five fields.
- Switch fallback's block (`:3284-3297`) → same pattern using
  `fallbackBranch.nested`, guarded the same way the existing code guards
  `fallbackBranch !== undefined` (`:3282-3298`); when there's no fallback, all four
  new fallback channels are `[]` and `fallbackThunks` stays `null` (per Step 3's note).

Note: `computeComponentThunks` (extracted from `:3130-3176`) is reused recursively
here for a body's OWN nested components — this is exactly the "genuinely shared
helper" the collapse-discipline section of the commission asks to prefer.

- [ ] **Step 5: Wire `emitIrLiteral` to consume the new channels**

In `nv-emitter.ts`, the recursive `emitIrLiteral(bodyIR, thunk.bodyThunks, indent)`
calls (list: `~L177`, recycled-list: `~L206`, switch branch: `~L225`, switch
fallback: similar) currently pass only `thunk.bodyThunks` — a flat array that, after
Task 2/3, is STILL only the hole thunks, not the full binding-ordered array
`emitIrLiteral` expects (recall `bodyIR.bindings` order is hole → component → list →
recycledList → switch, per the Design Fork Ruling's ordering constraint). Build the
full ordered array at each of these four call sites before recursing:

```typescript
const bodyThunksOrdered: ThunkSource[] = [
  ...thunk.bodyThunks,
  ...thunk.bodyComponentThunks,
  ...thunk.bodyListThunks,
  ...thunk.bodyRecycledListThunks,
  ...thunk.bodySwitchThunks,
]
const bodyLiteral = emitIrLiteral(bodyIR, bodyThunksOrdered, i2)
```

Apply the same pattern to the switch fallback branch, using
`thunk.fallbackThunks ?? []` concatenated with `thunk.fallbackComponentThunks` /
`fallbackListThunks` / `fallbackRecycledListThunks` / `fallbackSwitchThunks`. Confirm
by reading `emitIrLiteral`'s bindings-order construction (`nv-parser.ts:1192-1230`,
already read in the Design Fork Ruling) that this exact concatenation order — hole,
component, list, recycledList, switch — matches; do not reorder without re-reading
that function, since a mismatch here reproduces the exact bug this plan fixes.

- [ ] **Step 6: Run the Task 3 test, confirm it passes**

```bash
npx vitest run test/renderer/nv-parser-nested-thunks.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run `tsc --strict` and the full existing suite**

```bash
npx tsc --noEmit --strict
npx vitest run
```

Expected: no new type errors; 813/813 (or the current actual count) still green — this
is the regression gate for the two already-correct back-ends (neither `nv-emitter.ts`'s
interpreter path nor `emitted-mount.ts` is touched by this task, so any failure here
means Task 3's emitter change broke a previously-passing Mode-A case; investigate
before proceeding).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/nv-parser.ts src/renderer/nv-emitter.ts test/renderer/nv-parser-nested-thunks.test.ts
git commit -m "feat(nv-emitter): recursive nested-structural thunk reconstruction for Mode-A body emit"
```

---

## Task 4: Loud-failure regression test for the still-unsupported `<recycle>`-in-`<each>` case

**Files:**
- Test: `test/renderer/nv-parser-nested-thunks.test.ts`

**Interfaces:** none new — this asserts existing behavior (the `isEachBody` guard at
`nv-parser.ts:1218-1219`) survives Task 2/3's refactor unchanged.

- [ ] **Step 1: Write the test**

```typescript
describe('P2C-NEST-03  <recycle> nested inside <each> body remains a loud parse-time error', () => {
  test('throws "[nv] <recycle> cannot be nested inside an <each> body"', () => {
    const source = `
const Grid = $component(() => {
  $script(() => {
    const rows = signal([{ id: 1, cells: [{ id: 10, v: 'a' }] }])
  })
  $render(() => html\`<div><each .of="\${rows}" key="\${(r) => r.id}" let={row}>
    <div><recycle .of="\${row.cells}" let={cell, i}><span>\${cell.v}</span></recycle></div>
  </each></div>\`)
})`
    expect(() => parseNvFileForEmit(source, 'grid.nv', document)).toThrow(
      '[nv] <recycle> cannot be nested inside an <each> body',
    )
  })
})
```

- [ ] **Step 2: Run it**

```bash
npx vitest run test/renderer/nv-parser-nested-thunks.test.ts
```

Expected: PASS immediately (behavior already exists — this step is a regression
guard, not a new-feature red/green cycle).

- [ ] **Step 3: Commit**

```bash
git add test/renderer/nv-parser-nested-thunks.test.ts
git commit -m "test(nv-parser): guard recycle-in-each stays a loud parse-time error"
```

---

## Task 5: Nesting-matrix `.nv` fixtures + entry files

**Verified harness convention (read `test/browser/nv-author-probe.spec.ts:1-70` and
`test/browser/fixtures/counter.nv` / `counter-entry.ts` directly):** a fixture is a
real `.nv` file containing raw `$component(...)` source (no export wrapper — `.nv`
files are not TS, they're processed by `nvPlugin()` at bundle time), paired with a
`*-entry.ts` file that re-exports the named component(s) plus `flushSync` from
`@neutro/view/core`:

```typescript
// counter-entry.ts (existing precedent, verbatim)
// @ts-nocheck — .nv modules have no TypeScript declarations; this file is a
// build-time esbuild entry processed by nvPlugin, not type-checked by tsc.
export { Counter } from './counter.nv'
export { flushSync } from '@neutro/view/core'
```

esbuild bundles the entry with `nvPlugin()` (from
`src/renderer/nv-esbuild-plugin.ts`, which internally calls `parseNvFileForEmit` +
`emitModule` — confirmed at `nv-esbuild-plugin.ts:51`) plus a `neutro-alias` resolver
plugin (aliasing `@neutro/view/core` / `@neutro/view/renderer*` to `src/`), producing
an IIFE global (`nv-author-probe.spec.ts:31-71`, `globalName` set per-fixture). This
is the ONLY Mode-A-in-browser bundling precedent in the repo and is what Task 6 uses
— no new harness needed.

**Files:**
- Create: `test/browser/fixtures/nested-structural/component-in-each.nv`
- Create: `test/browser/fixtures/nested-structural/component-in-each-entry.ts`
- Create: `test/browser/fixtures/nested-structural/each-in-each.nv`
- Create: `test/browser/fixtures/nested-structural/each-in-each-entry.ts`
- Create: `test/browser/fixtures/nested-structural/switch-in-each.nv`
- Create: `test/browser/fixtures/nested-structural/switch-in-each-entry.ts`
- Create: `test/browser/fixtures/nested-structural/each-in-switch-branch.nv`
- Create: `test/browser/fixtures/nested-structural/each-in-switch-branch-entry.ts`
- Create: `test/browser/fixtures/nested-structural/component-in-switch-fallback.nv`
- Create: `test/browser/fixtures/nested-structural/component-in-switch-fallback-entry.ts`
- Create: `test/browser/fixtures/nested-structural/switch-in-each-in-switch.nv`
- Create: `test/browser/fixtures/nested-structural/switch-in-each-in-switch-entry.ts`

The `<switch>`/`<match>` grammar below is verified against the landed implementation
(`test/renderer/nv-emitter.test.ts:748-800`, EM-12/EM-12b): `<match when="${expr}">`
per branch, a trailing bare `<match>` (no `when=`) as the fallback — exactly what was
drafted before verification, no correction needed.

- [ ] **Step 1: Write `component-in-each.nv` + entry**

`test/browser/fixtures/nested-structural/component-in-each.nv`:

```
const Row = $component((props) => {
  $render(() => html`<li class="row">${props.label}</li>`)
})
const List = $component(() => {
  $script(() => {
    const items = signal([{ id: 1, label: 'Alpha' }, { id: 2, label: 'Beta' }])
  })
  $render(() => html`<ul><each .of="${items}" key="${(i) => i.id}" let={item}><Row label="${item.label}" /></each></ul>`)
})
```

`test/browser/fixtures/nested-structural/component-in-each-entry.ts`:

```typescript
// @ts-nocheck — .nv modules have no TypeScript declarations; this file is a
// build-time esbuild entry processed by nvPlugin, not type-checked by tsc.
export { List } from './component-in-each.nv'
export { flushSync } from '@neutro/view/core'
```

- [ ] **Step 2: Write `each-in-each.nv` + entry** (rows of cells — same content as
  Task 3's unit test, reused here at browser-gate granularity)

`each-in-each.nv`:

```
const Grid = $component(() => {
  $script(() => {
    const rows = signal([
      { id: 1, cells: [{ id: 10, v: 'a' }, { id: 11, v: 'b' }] },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
  })
  $render(() => html`<div class="grid"><each .of="${rows}" key="${(r) => r.id}" let={row}>
    <div class="row"><each .of="${row.cells}" key="${(c) => c.id}" let={cell}><span class="cell">${cell.v}</span></each></div>
  </each></div>`)
})
```

`each-in-each-entry.ts`:

```typescript
// @ts-nocheck
export { Grid } from './each-in-each.nv'
export { flushSync, signal } from '@neutro/view/core'
```

(`signal` is exported here too — Task 6's reactivity test needs to construct an
external signal and pass it as a prop, matching the `EX-EACH-02` pattern in
`nv-emitter-exec.test.ts:1189-1223`. If reactivity is driven purely internally instead,
this export is unused and harmless — cheaper to include now than to re-bundle later.)

- [ ] **Step 3: Write `switch-in-each.nv` + entry** (each row branches on status)

```
const List = $component(() => {
  $script(() => {
    const items = signal([{ id: 1, status: 'ok' }, { id: 2, status: 'error' }])
  })
  $render(() => html`<ul><each .of="${items}" key="${(i) => i.id}" let={item}>
    <li><switch>
      <match when="${item.status === 'ok'}"><span class="ok">OK</span></match>
      <match><span class="err">ERR</span></match>
    </switch></li>
  </each></ul>`)
})
```

Entry re-exports `List` + `flushSync`, same shape as Step 1.

- [ ] **Step 4: Write `each-in-switch-branch.nv` + entry** (a branch renders a list)

```
const Panel = $component(() => {
  $script(() => {
    const mode = signal('list')
    const items = signal([{ id: 1, label: 'A' }, { id: 2, label: 'B' }])
  })
  $render(() => html`<div><switch>
    <match when="${mode() === 'list'}"><ul><each .of="${items}" key="${(i) => i.id}" let={item}><li>${item.label}</li></each></ul></match>
    <match><p>empty</p></match>
  </switch></div>`)
})
```

Entry re-exports `Panel` + `flushSync`.

- [ ] **Step 5: Write `component-in-switch-fallback.nv` + entry (single file — verified below)**

**Resolved (was open edge 1) — corrected after direct verification, not just reading
a precedent.** The first pass of this ruling (citing `TC-C15`'s two-file pattern) was
WRONG: it inferred a requirement from a test that happens to be cross-file, without
checking whether cross-file was load-bearing or incidental. Verified directly by
running the emit pipeline (`parseNvFileForEmit` + `emitModule`) against a same-file
case:

```typescript
const source = `
const Empty = $component(() => { $render(() => html\`<p>Nothing here</p>\`) })
const Panel = $component(() => {
  $script(() => { const label = signal('x') })
  $render(() => html\`<div><span>\${label}</span><Empty /></div>\`)
})
`
// emitModule(parseNvFileForEmit(source, 'test.nv', document)) produces:
//   export function Empty(props, slots) { ... }
//   export function Panel(props, slots) {
//     ...
//     bindings: [{ kind: 'component', ..., component: Empty, ... }]
//   }
```

This emits correctly — `component: Empty` resolves as a bare identifier because
`emitModule` compiles every `$component` in a source file into a hoisted
`export function` in the same output module (`nv-emitter.ts:366`,
`emitModule`'s `for (const result of results) { ...emitComponentFactory(result) }`
loop, `nv-emitter.ts:427-430`), in file order. `Panel` referencing `Empty` from the
same file is ordinary JS function hoisting — no import, no cross-file specifier
rewrite needed. `TC-C15`'s two-file split is testing cross-file import-specifier
rewriting as its OWN feature (per `TC-14`), not a requirement for composition itself.

(One unrelated quirk surfaced during verification, worth noting for future fixture
authors: a `$render` template with ZERO `${}` holes anywhere takes an early-return
path in `processHtmlTemplate` — `nv-parser.ts:1399`,
`ts.isNoSubstitutionTemplateLiteral(template)` — that skips component-element
detection entirely, treating the whole template as static text. Not relevant to this
fixture, since `Panel`'s template already has a hole (`${hasItems()}`), but worth
flagging: any FUTURE all-static fixture with a bare `<Component />` and no other holes
would silently fail to recognize the component. Out of scope to fix here — not part
of this commission's G1 matrix — but worth a one-line mention in the landing report
as a related finding.)

`test/browser/fixtures/nested-structural/component-in-switch-fallback.nv`:

```
const Empty = $component(() => {
  $render(() => html`<p class="empty-state">Nothing here</p>`)
})
const Panel = $component(() => {
  $script(() => {
    const hasItems = signal(false)
  })
  $render(() => html`<div><switch>
    <match when="${hasItems()}"><p>Has items</p></match>
    <match><Empty /></match>
  </switch></div>`)
})
```

`test/browser/fixtures/nested-structural/component-in-switch-fallback-entry.ts`:

```typescript
// @ts-nocheck
export { Panel } from './component-in-switch-fallback.nv'
export { flushSync } from '@neutro/view/core'
```

Single file, no cross-file import — Task 6's esbuild config needs no extra resolver
for this fixture (`nvPlugin()` alone handles it, same as every other fixture in this
task).

- [ ] **Step 6: Write `switch-in-each-in-switch.nv` + entry** (deep recursion-termination
  proof)

```
const Panel = $component(() => {
  $script(() => {
    const mode = signal('list')
    const rows = signal([{ id: 1, flag: true }, { id: 2, flag: false }])
  })
  $render(() => html`<div><switch>
    <match when="${mode() === 'list'}">
      <ul><each .of="${rows}" key="${(r) => r.id}" let={row}>
        <li><switch>
          <match when="${row.flag}"><span class="flagged">Y</span></match>
          <match><span class="unflagged">N</span></match>
        </switch></li>
      </each></ul>
    </match>
    <match><p>no rows</p></match>
  </switch></div>`)
})
```

Entry re-exports `Panel` + `flushSync`.

- [ ] **Step 7: Unit-level smoke check — all six parse and emit without throwing**

Add to `test/renderer/nv-parser-nested-thunks.test.ts` (Node-side check, faster
feedback than a full Playwright run; reads the `.nv` fixture files directly since
they're plain text, no bundling needed for this check):

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('P2C-NEST-04  all nesting-matrix fixtures parse and emit without throwing', () => {
  const fixturesDir = join(__dirname, '../browser/fixtures/nested-structural')
  test.each([
    'component-in-each',
    'each-in-each',
    'switch-in-each',
    'each-in-switch-branch',
    'component-in-switch-fallback',
    'switch-in-each-in-switch',
  ])('%s', (name) => {
    const source = readFileSync(join(fixturesDir, `${name}.nv`), 'utf8')
    expect(() => parseNvFileForEmit(source, `${name}.nv`, document)).not.toThrow()
  })
})
```

Run:

```bash
npx vitest run test/renderer/nv-parser-nested-thunks.test.ts -t "P2C-NEST-04"
```

Expected: all 6 PASS after Task 3 lands (if run before Task 3, all 6 FAIL with thunk
kind mismatch — do not skip running this before Task 3 is committed; it's the
concrete proof Task 3 fixed the reported failure mode across the whole matrix, not
just the Task 3 unit test's one case). Note: `component-in-switch-fallback` will only
pass this check once Step 5's cross-component-reference question is resolved — if
that fixture needed splitting into two files, update the entry import accordingly
before this test can pass for that case.

- [ ] **Step 8: Commit**

```bash
git add test/browser/fixtures/nested-structural/ test/renderer/nv-parser-nested-thunks.test.ts
git commit -m "test: nesting-matrix .nv fixtures (component/each/recycle/switch x each/switch)"
```

---

## Task 6: Real-browser Playwright gate — G1 nesting matrix + three-back-end parity

**Files:**
- Create: `test/browser/nested-structural.spec.ts`

**Bundling strategy (resolved — follow `nv-author-probe.spec.ts:1-71` exactly, do not
invent a new harness):** for each fixture, `esbuild.build()` the `*-entry.ts` with
`nvPlugin()` + the `ts-resolve` + `neutro-alias` plugins (copy the three-plugin array
verbatim from `nv-author-probe.spec.ts:39-70`), `format: 'iife'`, a per-fixture
`globalName` (e.g. `__nvComponentInEach`), output to
`test/browser/dist/nv-<fixture-name>-bundle.js`. Build all six once in
`test.beforeAll`, matching `nv-author-probe.spec.ts:33-71`'s single-bundle-built-once
pattern extended to six bundles built in a loop.

- [ ] **Step 1: Write the shared bundle-build helper**

```typescript
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixturesDir = join(__dirname, 'fixtures/nested-structural')
const distDir = join(__dirname, 'dist')

const FIXTURES = [
  { name: 'component-in-each', globalName: '__nvComponentInEach' },
  { name: 'each-in-each', globalName: '__nvEachInEach' },
  { name: 'switch-in-each', globalName: '__nvSwitchInEach' },
  { name: 'each-in-switch-branch', globalName: '__nvEachInSwitchBranch' },
  { name: 'component-in-switch-fallback', globalName: '__nvComponentInSwitchFallback' },
  { name: 'switch-in-each-in-switch', globalName: '__nvSwitchInEachInSwitch' },
] as const

const bundlePaths: Record<string, string> = {}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  for (const f of FIXTURES) {
    const outfile = join(distDir, `nv-${f.name}-bundle.js`)
    bundlePaths[f.name] = outfile
    await esbuild.build({
      entryPoints: [join(fixturesDir, `${f.name}-entry.ts`)],
      bundle: true,
      outfile,
      format: 'iife',
      globalName: f.globalName,
      platform: 'browser',
      target: 'es2022',
      plugins: [
        nvPlugin(),
        {
          name: 'ts-resolve',
          setup(build) {
            build.onResolve({ filter: /\.js$/ }, (args) => {
              const absTs = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'))
              return { path: absTs }
            })
          },
        },
        {
          name: 'neutro-alias',
          setup(build) {
            build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({
              path: join(repoRoot, 'src/core/index.ts'),
            }))
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
              path: join(repoRoot, 'src/renderer/index.ts'),
            }))
            build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
              path: join(repoRoot, 'src/renderer/runtime.ts'),
            }))
          },
        },
      ],
      sourcemap: false,
      minify: false,
    })
  }
})
```

(Copied verbatim in structure from `nv-author-probe.spec.ts:33-71`, parameterized
over `FIXTURES` instead of one hardcoded counter build.)

- [ ] **Step 2: Write the G1 nesting-matrix DOM test for each fixture**

```typescript
test('G1 component-in-each: Mode-A emit mounts <Row> per item in real browser', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: bundlePaths['component-in-each']! })
  const rows = await page.evaluate(() => {
    const app = (window as unknown as {
      __nvComponentInEach: { List: { mount: (p: Element, d: Document) => void }; flushSync: () => void }
    }).__nvComponentInEach
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.List.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((el) => el.textContent)
  })
  expect(rows).toEqual(['Alpha', 'Beta'])
})

test('G1 each-in-each: Mode-A emit mounts nested rows/cells in real browser', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: bundlePaths['each-in-each']! })
  const cellsByRow = await page.evaluate(() => {
    const app = (window as unknown as {
      __nvEachInEach: { Grid: { mount: (p: Element, d: Document) => void }; flushSync: () => void }
    }).__nvEachInEach
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((row) =>
      Array.from(row.querySelectorAll('.cell')).map((c) => c.textContent),
    )
  })
  expect(cellsByRow).toEqual([['a', 'b'], ['c']])
})

test('G1 switch-in-each: Mode-A emit picks the correct branch per row in real browser', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: bundlePaths['switch-in-each']! })
  const statuses = await page.evaluate(() => {
    const app = (window as unknown as {
      __nvSwitchInEach: { List: { mount: (p: Element, d: Document) => void }; flushSync: () => void }
    }).__nvSwitchInEach
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.List.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('li')).map((li) => li.querySelector('span')?.className)
  })
  expect(statuses).toEqual(['ok', 'err'])
})

test('G1 each-in-switch-branch: Mode-A emit mounts the list branch in real browser', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: bundlePaths['each-in-switch-branch']! })
  const labels = await page.evaluate(() => {
    const app = (window as unknown as {
      __nvEachInSwitchBranch: { Panel: { mount: (p: Element, d: Document) => void }; flushSync: () => void }
    }).__nvEachInSwitchBranch
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Panel.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('li')).map((li) => li.textContent)
  })
  expect(labels).toEqual(['A', 'B'])
})

test('G1 component-in-switch-fallback: Mode-A emit mounts <Empty> in the fallback branch in real browser', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: bundlePaths['component-in-switch-fallback']! })
  const text = await page.evaluate(() => {
    const app = (window as unknown as {
      __nvComponentInSwitchFallback: { Panel: { mount: (p: Element, d: Document) => void }; flushSync: () => void }
    }).__nvComponentInSwitchFallback
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Panel.mount(parent, document)
    app.flushSync()
    return parent.querySelector('.empty-state')?.textContent
  })
  expect(text).toBe('Nothing here')
})

test('G1 switch-in-each-in-switch: deep nesting recursion terminates and renders correctly in real browser', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: bundlePaths['switch-in-each-in-switch']! })
  const flags = await page.evaluate(() => {
    const app = (window as unknown as {
      __nvSwitchInEachInSwitch: { Panel: { mount: (p: Element, d: Document) => void }; flushSync: () => void }
    }).__nvSwitchInEachInSwitch
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Panel.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('li span')).map((s) => s.className)
  })
  expect(flags).toEqual(['flagged', 'unflagged'])
})
```

- [ ] **Step 3: Write the three-back-end parity test**

**Resolved (was open edge 2):** read `real-browser.spec.ts:829-884` in full (`TC-10:
ListBinding — initial render, both back-ends`) — this is the exact hand-built-IR
convention for lists: a `makeIR()` factory returning a `TemplateIR` literal with a
`kind: 'list'` binding whose `itemTemplate: (vs) => TemplateIR` closure returns
another literal `TemplateIR`. Critically, `itemTemplate` can return ANY `TemplateIR`,
including one that itself contains a nested `kind: 'list'` binding — `real-browser.spec.ts`
has no existing nested-list case (confirmed: no second `kind: 'list'` inside an
`itemTemplate` body anywhere in that file), so this is new coverage, not a duplicate.
`TC-10` also confirms the comparison convention actually used in this file: plain
`Array.from(...).map(el => el.textContent)` equality checks per back-end, returned
from one `page.evaluate` and asserted in Node — NOT a `structurallyEqual` DOM-tree
diff (that helper is used elsewhere in the file for non-list bindings; `TC-10`
itself doesn't use it). Follow `TC-10`'s actual convention:

```typescript
test('three-back-end parity: interpreter, emitted-mount, and Mode-A produce equivalent DOM for each-in-each', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: join(__dirname, 'dist/nv-bundle.js') }) // window.__nv (interpreter + emitMount)

  const irBased = await page.evaluate(() => {
    const { mount, emitMount } = window.__nv

    // Hand-built TemplateIR mirroring each-in-each.nv's authored structure:
    // rows = [{id:1, cells:[{id:10,v:'a'},{id:11,v:'b'}]}, {id:2, cells:[{id:20,v:'c'}]}]
    const makeIR = () => ({
      id: 'grid-nested',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [
        {
          kind: 'list' as const,
          pathIndex: 0,
          items: () => [
            { id: 1, cells: [{ id: 10, v: 'a' }, { id: 11, v: 'b' }] },
            { id: 2, cells: [{ id: 20, v: 'c' }] },
          ],
          key: (row: unknown) => (row as { id: number }).id,
          itemTemplate: (rowVs: WritableSignal<unknown>) =>
            ({
              id: 'row',
              shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
              bindings: [
                {
                  kind: 'list' as const,
                  pathIndex: 0,
                  items: () => (rowVs() as { cells: unknown[] }).cells,
                  key: (cell: unknown) => (cell as { id: number }).id,
                  itemTemplate: (cellVs: WritableSignal<unknown>) =>
                    ({
                      id: 'cell',
                      shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
                      bindings: [
                        {
                          kind: 'text' as const,
                          pathIndex: 0,
                          expr: () => (cellVs() as { v: string }).v,
                        },
                      ],
                    }) as TemplateIR,
                },
              ],
            }) as TemplateIR,
        },
      ],
    })

    const pI = document.createElement('div')
    document.body.appendChild(pI)
    mount(makeIR(), pI, document)

    const pE = document.createElement('div')
    document.body.appendChild(pE)
    emitMount(makeIR()).mountFn(pE, document)

    window.__nv.flushSync()

    const cellsFrom = (root: Element) =>
      Array.from(root.querySelectorAll('div > div')).map((row) =>
        Array.from(row.querySelectorAll('span')).map((s) => s.textContent),
      )

    return { interpreterCells: cellsFrom(pI), emittedMountCells: cellsFrom(pE) }
  })

  expect(irBased.interpreterCells).toEqual([['a', 'b'], ['c']])
  expect(irBased.emittedMountCells).toEqual([['a', 'b'], ['c']])

  await page.goto('about:blank') // fresh context — no global collision with window.__nv
  await page.addScriptTag({ path: bundlePaths['each-in-each']! })
  const modeACells = await page.evaluate(() => {
    const app = (window as unknown as {
      __nvEachInEach: { Grid: { mount: (p: Element, d: Document) => void }; flushSync: () => void }
    }).__nvEachInEach
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((row) =>
      Array.from(row.querySelectorAll('.cell')).map((c) => c.textContent),
    )
  })

  expect(modeACells).toEqual([['a', 'b'], ['c']])
})
```

All three back-ends assert the identical `[['a', 'b'], ['c']]` shape — that IS the
parity check (same-fixture-equivalent-data producing identical nested structure
across interpreter, `emitted-mount`, and Mode-A), matching `TC-10`'s plain-equality
convention rather than introducing a new comparison helper.

- [ ] **Step 4: Write the reactivity-through-nesting test**

Using `each-in-each`'s bundle: mount with an externally-supplied `rows` signal (via
`app.Grid.mount(parent, document, { rows: () => extRows() })`, requiring `Grid` to
accept `rows` as a prop — adjust `each-in-each.nv` from Step 2 of Task 5 to take
`rows` via `props` instead of an internal `$script` signal if the mount signature
needs external control, matching `EX-EACH-02`'s prop-threading pattern exactly). After
initial mount, call the bundle's exported `signal`'s `.set()` to change one nested
`cell.v`, `flushSync()`, and assert the corresponding `.cell` text updates AND the
`.cell` DOM node reference is unchanged (node-identity check, same shape as
`EX-EACH-02`'s `toBe(lisBefore[0])` in `nv-emitter-exec.test.ts:1241-1242`).

- [ ] **Step 5: Write the disposal-through-nesting test**

Mount `each-in-each`'s bundle, call the returned `dispose()`, and assert no leaked
effects/signals in the owner tree. Read `src/core/core.ts`'s `__test` surface first
(the same one `spec-recycling-playwright.md:15-28` documents, e.g.
`_recomputeCount`/`harvestCount`) to find a read-only counter usable here without
adding anything new — this task must NOT add `src/core/` instrumentation (G0). If the
existing `__test` surface has no owner-tree/effect-count field suitable for a
"nothing leaked after nested dispose" assertion, use whatever counter comes closest
(e.g. a harvest/recompute count returning to its pre-mount baseline after dispose +
one manual GC-independent tick) and state explicitly in the test's description which
proxy was used and why, rather than silently downgrading to a DOM-count assertion —
G1 asks for an owner-tree assertion specifically because DOM-count can't detect a
retained-but-invisible effect.

- [ ] **Step 6: Run the full Playwright suite**

```bash
pnpm test:browser
```

Expected: all new tests pass; no regression in existing `test/browser/*.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add test/browser/nested-structural.spec.ts
git commit -m "test(browser): G1 nesting-matrix + three-back-end parity + reactivity/disposal gates"
```

---

## Task 7: Full regression pass and landing report

**Files:** none (verification only)

- [ ] **Step 1: Full suite + strict typecheck**

```bash
npx vitest run
npx tsc --noEmit --strict
pnpm test:browser
```

Expected: all green. Record the actual passing count (compare against 813/813 at
`61d5987` — the count will be higher now given new tests; confirm zero regressions,
not an exact count match).

- [ ] **Step 2: Confirm `src/core/` diff is empty**

```bash
git diff main --stat -- src/core/
```

Expected: no output. If anything shows here, STOP — this is a G0 disqualifier; do not
commit further until resolved or escalated.

- [ ] **Step 3: Report to Kofi**

Per the commission's Definition of Done: report the landing commit SHA, the design
fork ruling (Task 1's doc path), and any deviations from this plan encountered during
implementation (e.g. if Task 6 Step 1 surfaced a harness gap, or if the `<switch>`
authoring syntax in Task 5 fixtures needed correction against the real grammar). Do
**not** write the decision-log entry — Kofi does that on landing, per the commission.

---

## Self-Review (3-pass, run before handing this plan back)

**Pass 1 — spec coverage against the commission.** Checked every commission section
against a task: G0 disqualifiers → Task 2/3 (no `src/core/` touch, verified in Task 7
Step 2), Task 3 (interpreter/`emitted-mount.ts` untouched — confirmed no modification
to those files anywhere in this plan), Task 4 (loud-failure preserved for
`<recycle>`-in-`<each>`), Task 3 (no partial coverage — the recursive assembler
handles all four structural kinds uniformly, not special-cased per combination). G1 →
Task 6 (nesting matrix, three-back-end parity, reactivity, disposal, loud-failure),
Task 7 (regression + `tsc --strict`). Design fork → resolved above with citations,
Task 1 lands it as a doc. Collapse discipline → Task 2's `toPendingBundle` extraction
and Task 3's `computeComponentThunks`/`computeListThunks`/etc. extraction are the
single shared recursive path, used by both top-level and body-level call sites — no
duplicate logic introduced. Gap: found none uncovered.

**Pass 2 — internal consistency of types/signatures across tasks.** Traced
`NestedStructuralPending` (defined Task 2) → consumed by `PendingNv*Info.nested`
(Task 2) → consumed by `computeBodyThunks(pending: NestedStructuralPending, ...)`
(Task 3) — field names (`components`/`lists`/`recycles`/`switches`) match at every
hop. Traced the five-channel naming (`bodyThunks`/`bodyComponentThunks`/
`bodyListThunks`/`bodyRecycledListThunks`/`bodySwitchThunks`) from `ThunkSource`'s
type extension (Task 3 Step 3) through `computeBodyThunks`'s return (Step 4) through
`emitIrLiteral`'s consumption (Step 5) — consistent at every hop, including the
switch-fallback variant's `fallback`-prefixed names. Caught and fixed one
inconsistency during drafting: Task 3 Step 5 initially risked reusing
`thunk.bodyThunks` name collision between "the hole-only channel" and "the full
ordered array passed to the recursive `emitIrLiteral` call" — resolved by naming the
locally-assembled ordered array `bodyThunksOrdered`, distinct from the `ThunkSource`
field `bodyThunks`, so the two are never confused in the diff.

**Pass 3 — buildability / TDD honesty check.** Three items were flagged as unverified
in the first draft; all three were run down against real source before finalizing:

1. `parseNvFileForEmit`'s exact exported signature and return shape — read
   `nv-parser.ts:159-178` and `:3439-3443` plus 60+ existing call sites. Real
   signature is `(source, fileName, doc: Document) => NvComponentResult[]`, with
   thunks at `results[i].emit!.bindingThunks`, not the `(source, fileName) => { thunks }`
   shape the first draft guessed. Task 2/3/4's test snippets and Task 5's smoke test
   are now corrected to the verified signature.
2. The `<switch>`/`<match>` authoring grammar — read `nv-emitter.test.ts:748-800`
   (EM-12/EM-12b, the landed switch/match emit tests). The grammar drafted in Task 5
   (`<match when="${expr}">` per branch, bare `<match>` as fallback) was already
   correct; no fixture change was needed, only removal of the "unverified" caveat.
3. Whether Mode-A-in-browser bundling has a harness precedent — read
   `test/browser/nv-author-probe.spec.ts` in full plus its `counter.nv`/
   `counter-entry.ts` fixtures. A precedent exists (esbuild + `nvPlugin()` +
   `ts-resolve` + `neutro-alias` plugins → IIFE global, exactly the "no JSDOM, real
   browser" pattern this plan needs). Task 5 was rewritten to produce real `.nv` +
   `*-entry.ts` fixture pairs (not TS string-literal fixtures, which was the first
   draft's incorrect guess at the fixture convention), and Task 6 was rewritten with
   a concrete `FIXTURES`-driven `beforeAll` bundler copied from that precedent's
   exact plugin configuration, replacing the earlier "STOP and report" placeholder.

**Both remaining open edges from the prior review pass are now resolved, before
implementation, not deferred to it:**

4. **Same-file vs. cross-file component reference** — the first pass of this ruling
   (citing `TC-C15`'s two-file `buildTwoComponentBundle` as the required pattern) was
   WRONG, caught only because it was pushed back on rather than accepted. Verified by
   directly running `parseNvFileForEmit` + `emitModule` against a same-file case
   (`Panel` referencing `Empty` declared earlier in the same source): it emits
   correctly. `emitModule` compiles every `$component` in a file into a hoisted
   `export function` in the same output module (`nv-emitter.ts:366`, `:427-430`), so a
   same-file reference is ordinary JS function hoisting — no import needed. `TC-C15`'s
   two-file split tests cross-file import-specifier rewriting as its own feature (per
   `TC-14`), not a requirement for composition. Task 5 Step 5 now uses a single
   `component-in-switch-fallback.nv` with both `Empty` and `Panel` declared together;
   no extra esbuild resolver was needed in Task 6 after all. (A real but unrelated
   quirk surfaced during this verification: an all-static `$render` template with zero
   `${}` holes skips component-element detection entirely, per the
   `ts.isNoSubstitutionTemplateLiteral` early return at `nv-parser.ts:1399` — noted for
   the landing report as a related finding, not fixed here.)
5. **The parity test's hand-built `TemplateIR`** — read `real-browser.spec.ts:829-884`
   (`TC-10: ListBinding — initial render, both back-ends`) in full. Confirmed the
   exact `itemTemplate: (vs) => TemplateIR` factory-closure convention, and confirmed
   no nested-list case exists yet in that file (this plan's Task 6 Step 3 is new
   coverage, not a duplicate). Also confirmed the file's actual comparison convention
   for list bindings is plain `.textContent` array equality per back-end, not a
   `structurallyEqual` tree diff (that helper is used for other binding kinds in the
   same file, not for `TC-10`). Task 6 Step 3 now contains a complete, concrete
   two-level nested-list `TemplateIR` literal (rows of cells) built on that exact
   pattern, mounted via `mount`/`emitMount`/the Mode-A bundle, with all three
   asserted against the identical `[['a', 'b'], ['c']]` shape.

No open edges remain — every fixture, type change, and test in this plan is now
grounded in a directly-read, cited precedent rather than an assumption.
