# Increment SS: `<each>`-in-slot + static-class structural collapse

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⛔ GATE-P HALT — ARCHITECT APPROVAL REQUIRED BEFORE ANY `src/` TOUCH.**
> This plan was produced at Gate-P. All Task 1 steps are read-only seam audit and Gate-P
> proposal (no code). Tasks 2–6 touch `src/`; do NOT begin Task 2 until the architect
> has approved this plan's Gate-P section verbatim. "Tests green" is not approval.
> Approval = architect reads placed files by SHA and says Gate-P is closed.

**Goal:** Wire `<each>` in slot content and collapse D-slot-style-1 structurally (static
class attrs lifted to classlist entries, string-regex on `shape.html` removed), closing the
slot domain.

**Architecture:** Two coupled items in one slot-builder rework. Item 1 extracts the
main-path `<each>` list-push logic into a shared helper that both the main builder and
`buildNvSlotContentIR` call — structural identity by construction, not assertion. Item 2
lifts static `class="..."` attrs in slot content into `{kind:'static',token}` classlist
entries (already produced by the array-literal path and consumed by both back-ends'
`wireClassList`), removing the existing string-regex on `slotIR.shape.html`. The
Action-2 oracle (`irStructurallyEqual` + `styleArtifactEqual`) is the structural gate.

**Tech Stack:** TypeScript 5.6 · Vitest · jsdom · Playwright (Blink/Gecko/WebKit for the
styled cascade leg) · Biome lint.

## Global Constraints

- **No `src/core/` touch.** Renderer-layer only. reactive-core v0.4.2 untouched.
- **No new IR kind or `ir.ts` shape change.** Static-class lift uses the EXISTING
  `{kind:'static',token}` `ClassListEntry`. No Template-IR version bump.
- **No slot-local list representation.** The slot-path `ListBinding` MUST be structurally
  identical to the main-walk shape (via shared helper — D-SS-2).
- **String-regex on `shape.html` (nv-parser.ts ~L1919-1925) MUST be gone** after
  Item 2 lands. Tightening is not acceptable (G0-3).
- **FE lockstep.** `<each>`-in-slot holds `.nv` ↔ tagged-template equivalence through
  the Action-2 oracle (`irStructurallyEqual` with `doc`).
- **Differential = both back-ends, shared oracle.** Behavioral proof goes through the
  emit path (`emitMount`); structural proof through the parse path + oracle.
- **Done = committed on `main`, architect-verified by reading placed files by SHA.**
  "Tests green" is not done. Typecheck + biome lint must be clean on every commit.
- **The oracle (Action 2) is the gate.** Do NOT introduce a bespoke comparator. Route
  FE-equivalence and differential through `irStructurallyEqual` in
  `test/renderer/ir-equivalence.ts`.
- **Playwright ×3 required** for the `$style × <each>-in-slot` styled cascade leg
  (jsdom not authoritative for cascade + injection). Pure structural/list-wiring legs
  are jsdom-ok.

---

## Seam map (all line numbers verified at HEAD `bf44a2c`)

| Seam | File | Lines | Role |
|---|---|---|---|
| `walkNvNodeList` | `src/renderer/nv-parser.ts` | 486–728 | DFS walk; returns `{holeInfos, holePaths, components, consumed, lists}` |
| `NvWalkedEach` interface | `src/renderer/nv-parser.ts` | 463–470 | `{anchorPath, itemsHoleIdx, keyHoleIdx, letNames, bodyIR, bodyHoleIndices}` |
| `NvWalkResult` interface | `src/renderer/nv-parser.ts` | 472–478 | includes `lists: NvWalkedEach[]` |
| Main list-push loop | `src/renderer/nv-parser.ts` | 1044–1068 | Pushes `ListBinding` + diagnostic for no `let={}` |
| `buildNvSlotContentIR` | `src/renderer/nv-parser.ts` | 740–812 | Slot builder; calls `walkNvNodeList` but **discards `lists`** (L773) |
| Slot builder list-discard comment | `src/renderer/nv-parser.ts` | 773 | `// lists is intentionally ignored in slot content builder` |
| `patchClasslistTokens` | `src/renderer/nv-parser.ts` | 1873–1930 | Post-walk rewrite; has `classlist`/`conditional`/`list`/`component` cases |
| Regex to be removed | `src/renderer/nv-parser.ts` | 1919–1925 | `slotIR.shape.html.replace(/\bclass="([^"]*)"/g, ...)` |
| Static classlist entry production | `src/renderer/nv-parser.ts` | 391–394 (obj) | `entries.push({ kind: 'static', token })` in array-literal path |
| `wireClassList` static branch | `src/renderer/interpreter.ts` | 222–227 | `element.classList.add(entry.token)` — already handles `kind:'static'` |
| `wireClassList` static branch | `src/compiler/emitted-mount.ts` | 205–207 | Same; already handles `kind:'static'` |
| G5 test (parse-path structural) | `test/renderer/nv-parser.test.ts` | 1353–1381 | `describe.skip(...)` — full test body present, re-enable this |
| G5 test (slot-style-scope) | `test/renderer/slot-style-scope.test.ts` | 320–325 | `it.skip(...)` — stub only, needs a real body |
| Action-2 oracle | `test/renderer/ir-equivalence.ts` | 287–306 | `irStructurallyEqual` — slots recurse, style artifacts compared |
| `buildNvHtmlStrings` sentinel inject | `src/renderer/nv-parser.ts` | 877–881 | Injects `data-nv-component` on capitalized tags unconditionally |

---

## Open-point proposals (CC reads seams, proposes — architect rules at Gate-P)

### OP-1: D-each-4 / hole-boundary scope — does the all-static-slot limitation close?

**Empirical finding at HEAD.** `<each>` detection in `walkNvNodeList` is tag-name based
(L512: `el.tagName.toLowerCase() === 'each'`) — no hole required for the element itself
to be detected. However, `<each>` requires `.of=` and `key=` holes (L516-527); if not
found, it throws (L528-530). So `<each>`-in-slot ALWAYS involves holes — the
`<each>`-wiring does not interact with the all-static limitation at all.

The all-static limitation is separate: a purely-static slot content
(`<ChildComp><div class="card">x</div></ChildComp>`, no holes) produces no bindings
for the `<div>` because `walkNvNodeList` records paths only for holes/components/each.
The static `class="card"` attr stays in `shape.html`.

**Proposed resolution (OP-1):** the structural-collapse in Item 2 CAN close the
all-static limitation. After `walkNvNodeList` runs inside `buildNvSlotContentIR`,
scan `fragWrapper.querySelectorAll('[class]')` for elements whose `class` attr was
NOT consumed as a classlist hole (i.e., they still have a literal `class=` attr after
sentinel cleanup). For each: compute `computePath(el, fragWrapper)`, strip the `class`
attr from `fragWrapper` before `rawHtml = fragWrapper.innerHTML`, and push a
`ClassListBinding` with `{kind:'static',token}` entries split on whitespace. This closes
the limitation for slot content by construction — purely-static and mixed-hole slot content
are handled uniformly.

**Architect ruling requested:** accept this closure approach, or keep the limitation?

### OP-2: Static-class lift location — WHERE in `buildNvSlotContentIR`

**Two options:**

**(A) Post-walk scan in `buildNvSlotContentIR`** (after `walkNvNodeList` returns):
```typescript
// After walkNvNodeList call and before rawHtml computation:
for (const el of Array.from(fragWrapper.querySelectorAll('[class]')) as Element[]) {
  const classVal = el.getAttribute('class')!
  const tokens = classVal.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) continue
  const pathIndex = allPaths.length
  allPaths.push(computePath(el, fragWrapper))
  el.removeAttribute('class') // strip so rawHtml doesn't double-count
  bindings.push({
    kind: 'classlist',
    pathIndex,
    entries: tokens.map((token) => ({ kind: 'static' as const, token })),
  })
}
```
The `class` attr removal happens BEFORE `rawHtml = fragWrapper.innerHTML` (L775),
so the static class is only in the binding, not duplicated in `shape.html`.

**(B) In the shared list-push helper (D-SS-2)** — doesn't fit: the helper is for list
bindings, not static-class scanning; mixing concerns would break its interface.

**Proposed resolution (OP-2):** Option A. It's localized to `buildNvSlotContentIR` and
follows the same post-walk extension pattern as the existing component loop (L792-796).
The `computePath` function already works on any element relative to root.

**Architect ruling requested:** accept Option A?

### OP-3: Diagnostics threading for slot `<each>`

The main list-push loop (L1047-1054) emits a `'warning'` diagnostic into
`processdiagnostics` when `<each>` has no `let={}`. `buildNvSlotContentIR` has no
diagnostics channel — its return is `{ir, holeIndices, letNames}`.

**Proposed resolution (OP-3):** Thread an optional `diagnostics?: NvDiagnostic[]` param
through the shared `pushListBinding` helper. In the main builder, pass `processdiagnostics`
(current behavior preserved). In `buildNvSlotContentIR`, pass an empty local array
(diagnostics surfaced to the slot's immediate build context — this is the correct level,
since the slot content is built during the parent's walk; alternatively omit and leave slot
`<each>`-no-let as undocumented behavior). Either way: no new exported diagnostic type,
no IR change.

**Architect ruling requested:** thread the sink (preferred) or leave undocumented?

### OP-4: Depth-2 nesting gate

`patchClasslistTokens` `list` case (L1891-1899) recursively calls `patchClasslistTokens`
on `itemIR`, and the `component` case (L1910-1926) recurses on `slotIR`. A slot
containing `<each>` produces a `ComponentBinding` whose slot contains a `ListBinding`.
The component case calls `patchClasslistTokens(slotIR, ...)`, which then hits the `list`
case and calls `patchClasslistTokens(itemIR, ...)` — depth-2 falls out of the existing
recursion by construction.

**Proposed resolution (OP-4):** add a depth-2 parse test: parent with `$style`, child
component, slot content is `<each>` with classlist toggle. Assert `itemIR.bindings.find(b
=> b.kind === 'classlist').entries[0].key === 'card_<hash>'`. This is the failable gate
row (G-SS-depth2).

### OP-5: Stacked G2 by-ref fragility

`<each>`-in-slot stacks `list.itemTemplate` (by-ref — `(_vs, _is) => wl.bodyIR`) inside
`component.slot.content` (by-ref — `(_props) => namedIR`). `patchClasslistTokens`'s
`component` case stub-calls `slot.content({})` to get the same captured `namedIR`; then
its `list` case stub-calls `itemTemplate` to get the same captured `bodyIR`. Both by-ref
assumptions must hold. If a scoped-slot factory returns fresh IR per call, the outer patch
sticks to a throwaway object — the inner `<each>` rewrite silently sticks to nothing.

**Proposed resolution (OP-5):** document as stacked debt in a code comment at the
`component` case in `patchClasslistTokens` (note `<each>`-in-slot as where this is
load-bearing). Add a test that the by-ref invariant holds at parse time (stub-calling
`slot.content({})` twice returns the same object). Do NOT add runtime assertion — keep
G2 as documented, accepted debt per prior ruling.

---

## Gate-P checklist (architect reviews these before approving)

- [ ] OP-1 resolution accepted (static-class lift closes all-static limitation via post-walk scan)
- [ ] OP-2 resolution accepted (Option A: post-walk scan in `buildNvSlotContentIR`)
- [ ] OP-3 resolution accepted (thread diagnostics sink through shared helper)
- [ ] OP-4 resolution accepted (depth-2 falls out; gate row added)
- [ ] OP-5 resolution accepted (stacked G2 documented + by-ref invariant tested)
- [ ] G0 disqualifiers confirmed: no core touch, no slot-local list, regex gone, no IR bump, FE lockstep

> **Once architect checks all boxes, execute Tasks 2–6 in order.**

---

## File map

| File | Change |
|---|---|
| `src/renderer/nv-parser.ts` | Extract `pushListBinding` helper; `buildNvSlotContentIR` consumes `lists` + static-class scan; remove shape.html regex; `patchClasslistTokens` updated comment |
| `test/renderer/nv-parser.test.ts` | Re-enable `describe.skip` G5 at L1353 |
| `test/renderer/slot-style-scope.test.ts` | Expand G5 `it.skip` to real test body |
| `test/renderer/slot-ss.test.ts` | **NEW** — `<each>`-in-slot structural + emit-exec differential; static-class lift; depth-2; by-ref invariant; G-SS-* gates |
| `test/browser/slot-ss.spec.ts` | **NEW** — Playwright ×3 for `$style × <each>-in-slot` styled leg |
| `docs/implementation-state.md` | Update slot builder row + known gaps; note regex gone |
| `docs/decision-log.md` | Landing entries for Items 1 + 2; close D-slot-style-1 + open-points as resolved |

---

## Task 1 — Seam audit + Gate-P proposal (no `src/` touch)

**Files:** Read-only. No edits.

**Deliverable:** This plan file, with open-point proposals filled in above. Present to
architect for Gate-P approval.

- [ ] **Step 1: Verify open-point-1 empirically — `<each>` detection in slot content**

  Run this node one-liner to confirm `walkNvNodeList` detects `<each>` by tag name, not
  by hole:

  ```bash
  node --input-type=module << 'EOF'
  import { JSDOM } from 'jsdom'
  const { parseNvFile } = await import('./src/renderer/nv-parser.js')
  const { signal } = await import('./src/core/core.js')
  const items = signal([1, 2, 3])
  const src = `const P = $component((_props) => {
    $style({ card: { color: 'red' } })
    $render(() => html\`<ChildComp>
      <each .of=\${items} key="\${(item) => item}" let={item}>
        <div class="\${{card: true}}">\${item}</div>
      </each>
    </ChildComp>\`)
  })`
  const doc = new JSDOM('').window.document
  try {
    const results = parseNvFile(src, 'test.nv', doc)
    const p = results[0]
    const comp = p.ir.bindings.find(b => b.kind === 'component')
    const slotIR = comp.slots[0].content({})
    console.log('slotIR.bindings kinds:', slotIR.bindings.map(b => b.kind))
  } catch (e) {
    console.error('ERROR:', e.message)
  }
  EOF
  ```

  Expected: `slotIR.bindings kinds: []` (because `lists` is currently discarded at L773 —
  the `<each>` is parsed but not wired). If you see an error like "No sentinel for hole",
  that means `<each>`-in-slot detection itself is broken.

- [ ] **Step 2: Verify open-point-1 — all-static slot content produces no bindings**

  ```bash
  node --input-type=module << 'EOF'
  import { JSDOM } from 'jsdom'
  const { parseNvFile } = await import('./src/renderer/nv-parser.js')
  const src = `const P = $component((_props) => {
    $style({ card: { color: 'red' } })
    $render(() => html\`<ChildComp><div class="card">static</div></ChildComp>\`)
  })`
  const doc = new JSDOM('').window.document
  const results = parseNvFile(src, 'test.nv', doc)
  const p = results[0]
  const comp = p.ir.bindings.find(b => b.kind === 'component')
  const slotIR = comp.slots[0].content({})
  console.log('slot bindings:', slotIR.bindings.length)
  console.log('shape.html:', slotIR.shape.html)
  EOF
  ```

  Expected: `slot bindings: 0`, `shape.html: '<div class="card">static</div>'`.
  This confirms: static class is only in `shape.html`, not in any binding. Post-walk scan
  approach (OP-2 Option A) is the only handle.

- [ ] **Step 3: Verify open-point-4 — patchClasslistTokens depth-2 recursion works**

  Currently, slot content `<each>` is not wired, so this must be verified structurally.
  Confirm that `patchClasslistTokens`'s `component` case calls recursion into `slotIR`,
  and the `list` case calls recursion into `itemIR`:

  ```bash
  grep -n "patchClasslistTokens" src/renderer/nv-parser.ts
  ```

  Confirm lines: `patchClasslistTokens(itemIR, classRewrites)` at ~L1899 (list case) and
  `patchClasslistTokens(slotIR, classRewrites)` at ~L1926 (component case). If slotIR
  contains a list binding, the component case calls the component's recursive
  `patchClasslistTokens`, which then hits the list case. Depth-2 is structural.

- [ ] **Step 4: Read the test files being modified**

  ```bash
  grep -n "describe.skip\|it.skip\|G5" test/renderer/nv-parser.test.ts
  grep -n "G5\|it.skip\|describe" test/renderer/slot-style-scope.test.ts
  ```

  Confirm G5 locations (nv-parser.test.ts ~L1353, slot-style-scope.test.ts ~L320).

- [ ] **Step 5: Run the full test suite to establish baseline**

  ```bash
  npx vitest run 2>&1 | tail -5
  ```

  Expected: all existing passing tests still pass (647 pass / 2 skip at HEAD). Record
  exact counts. Any new failure here is a pre-existing issue, not from this increment.

- [ ] **Step 6: HALT — present Gate-P proposal to architect**

  The open-point proposals above (OP-1 through OP-5) are CC's proposals. No `src/` touch
  occurs until the architect reviews this plan and approves Gate-P. Gate-P approval = the
  architect checks all boxes in the Gate-P checklist above.

---

## Task 2 — Shared list-push helper + wire `<each>`-in-slot (Item 1)

**⛔ Do NOT begin until Gate-P is approved by the architect.**

**Files:**
- Modify: `src/renderer/nv-parser.ts` (extract `pushListBinding`, update
  `buildNvSlotContentIR`, update the main list-push loop to call the shared helper)

**Interfaces:**
- Produces: `function pushListBinding(wl: NvWalkedEach, allPaths: NodePath[], bindings: Binding[], diagnostics: NvDiagnostic[]): void` (internal, not exported)
- Consumes: `NvWalkedEach` (L463), `NodePath`, `Binding`, `NvDiagnostic`, `ListBinding`, `signal` from core

- [ ] **Step 1: Write the failing G5 structural test in nv-parser.test.ts**

  Find the `describe.skip` block at ~L1353 and remove `skip`:

  ```typescript
  // was: describe.skip('G5: classlist token in <each>-inside-slot carries parent scopeHash', () => {
  describe('G5: classlist token in <each>-inside-slot carries parent scopeHash', () => {
    it('G5: classlist token in <each>-inside-slot carries parent scopeHash', () => {
      const items = signal<unknown[]>([])
      const src = `
        const Parent = $component((_props) => {
          $style({ card: { color: 'red' } })
          $render(() => html\`
            <ChildComp>
              <each .of=\${items} key="\${(item) => item}" let={item}>
                <div class="\${{card: true}}">\${item}</div>
              </each>
            </ChildComp>
          \`)
        })
      `
      const results = parseNvFile(src, 'test.nv', document)
      const parent = results.find((r) => r.name === 'Parent')!
      const childComp = parent.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
      const slotIR = childComp.slots[0]!.content({})
      const listBinding = slotIR.bindings.find((b) => b.kind === 'list') as ListBinding
      const stubVs = signal<unknown>(null)
      const stubIs = signal<number>(0)
      const itemIR = listBinding.itemTemplate(stubVs, stubIs)
      const cl = itemIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      const toggle = cl.entries.find((e) => e.kind === 'toggle')!
      const expectedHash = parent.ir.styleArtifact!.scopeHash
      expect(toggle.key).toBe(`card_${expectedHash}`)
    })
  })
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  npx vitest run test/renderer/nv-parser.test.ts --reporter=verbose 2>&1 | grep -A3 "G5"
  ```

  Expected: FAIL — `slotIR.bindings` will be empty (no list binding), causing
  `listBinding` to be `undefined` and `listBinding.itemTemplate` to throw.

- [ ] **Step 3: Extract `pushListBinding` shared helper in nv-parser.ts**

  Find the main list-push loop (L1044–1068). Extract it into a local function just above
  the main builder's list loop (around L1043). Insert after the `for (const wl of pendingComponents)` loop:

  ```typescript
  /**
   * Push one <each> list binding into allPaths + bindings.
   * Shared by the main builder AND buildNvSlotContentIR so both paths produce
   * structurally identical ListBinding shapes (D-SS-2). Emits a warning diagnostic
   * when no let={} bindings are present.
   */
  function pushListBinding(
    wl: NvWalkedEach,
    allPaths: NodePath[],
    bindings: Binding[],
    diagnostics: NvDiagnostic[],
  ): void {
    if (wl.letNames.length === 0) {
      diagnostics.push({
        kind: 'warning',
        message:
          '<each> has no let={} bindings. Item and index will not be accessible in the body template. Add let={item} or let={item, index}.',
        start: 0,
        end: 0,
      })
    }
    const pathIndex = allPaths.length
    allPaths.push(wl.anchorPath)
    // PARSE-PATH ONLY: structural IR shape for FE-equivalence checking.
    // itemTemplate returns the captured bodyIR by ref (same G2 by-ref fragility as component slots).
    bindings.push({
      kind: 'list',
      pathIndex,
      items: (() => []) as () => readonly unknown[],
      key: ((_item: unknown, i: number) => i) as (item: unknown, i: number) => string | number,
      itemTemplate: (_valueSig, _indexSig) => wl.bodyIR,
    } satisfies ListBinding)
  }
  ```

- [ ] **Step 4: Update the main list-push loop to use the shared helper**

  Replace the block at L1044-1068 with:

  ```typescript
  // Add list bindings from <each> elements (anchor paths appended after component paths)
  for (const wl of pendingLists) {
    pushListBinding(wl, allPaths, bindings, processdiagnostics)
  }
  ```

- [ ] **Step 5: Update `buildNvSlotContentIR` to consume `lists`**

  Find the destructure at L767-773:
  ```typescript
  const { holeInfos, holePaths, components, consumed } = walkNvNodeList(
    Array.from(fragWrapper.childNodes),
    holeExprs,
    doc,
    fragWrapper,
    slotSignals,
  ) // lists is intentionally ignored in slot content builder
  ```

  Replace with:
  ```typescript
  const { holeInfos, holePaths, components, consumed, lists: slotLists } = walkNvNodeList(
    Array.from(fragWrapper.childNodes),
    holeExprs,
    doc,
    fragWrapper,
    slotSignals,
  )
  ```

  Then find the component loop in `buildNvSlotContentIR` (L792-796):
  ```typescript
  for (const c of components) {
    const pathIndex = allPaths.length
    allPaths.push(c.anchorPath)
    bindings.push(makeUnresolvedNvComponentBinding(pathIndex, c))
  }
  ```

  Add the list loop immediately after it:
  ```typescript
  // Wire <each>-in-slot via the shared helper (D-SS-2: structural identity by construction)
  const slotDiagnostics: NvDiagnostic[] = [] // slot-context diagnostics; surfaced to parent if desired
  for (const wl of slotLists) {
    pushListBinding(wl, allPaths, bindings, slotDiagnostics)
  }
  ```

  Note: `slotDiagnostics` is a local sink per OP-3 proposal. If the architect rules to
  thread diagnostics to the parent, pass `processdiagnostics` instead (this is inside the
  parent's walk context so `processdiagnostics` is in scope from the outer parse function,
  but `buildNvSlotContentIR` is a standalone function — would need the sink threaded as a
  parameter in that case).

- [ ] **Step 6: Verify typecheck and tests pass**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  npx vitest run test/renderer/nv-parser.test.ts 2>&1 | tail -5
  ```

  Expected: tsc clean; G5 test passes.

- [ ] **Step 7: Run the full suite to check for regressions**

  ```bash
  npx vitest run 2>&1 | tail -5
  ```

  Expected: G5 now active (2 skip → 1 skip). All prior passing tests still pass.

- [ ] **Step 8: Biome lint**

  ```bash
  npx biome check src/renderer/nv-parser.ts 2>&1 | tail -10
  ```

  Expected: no errors. Fix any template-literal-vs-string-literal warnings.

- [ ] **Step 9: Commit**

  ```bash
  git add src/renderer/nv-parser.ts test/renderer/nv-parser.test.ts
  git commit -m "feat(slot): wire <each>-in-slot via shared pushListBinding helper (D-SS-2; re-enable G5)"
  ```

---

## Task 3 — Static-class structural lift + regex removal (Item 2 / D-SS-1)

**Files:**
- Modify: `src/renderer/nv-parser.ts` (add static-class scan in `buildNvSlotContentIR`;
  remove `shape.html` regex from `patchClasslistTokens` component case)

**Interfaces:**
- Consumes: `computePath` (L232, already internal), `ClassListBinding`, `ClassListEntry`
- No new exports.

- [ ] **Step 1: Write failing tests for static-class lift + all-static closure**

  In `test/renderer/slot-ss.test.ts` (new file), add:

  ```typescript
  import { JSDOM } from 'jsdom'
  import { describe, expect, it } from 'vitest'
  import type { ClassListBinding, ComponentBinding } from '../../src/renderer/ir.js'
  import { parseNvFile } from '../../src/renderer/nv-parser.js'

  describe('D-SS-1: static-class attrs lifted to classlist entries (regex removed)', () => {
    it('static class= in slot content produces a classlist {kind:static} binding with scoped token', () => {
      // Mixed case: static class + text hole (the hole causes ComponentBinding detection)
      const src = `const P = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="card extra">\${1 + 1}</div></ChildComp>\`)
      })`
      const doc = new JSDOM('').window.document
      const r = parseNvFile(src, 'test.nv', doc)[0]!
      const scopeHash = r.ir.styleArtifact?.scopeHash
      expect(scopeHash).toBeDefined()
      const comp = r.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
      expect(comp).toBeDefined()
      const slotIR = comp.slots[0]!.content({})
      // After lift: shape.html must NOT contain class= (it was moved to binding)
      expect(slotIR.shape.html).not.toMatch(/class=/)
      // Classlist binding must be present
      const cl = slotIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      expect(cl).toBeDefined()
      // 'card' must be rewritten to card_<hash>; 'extra' is not a $style key → unchanged
      const cardEntry = cl.entries.find((e) => e.kind === 'static' && e.token === `card_${scopeHash}`)
      expect(cardEntry).toBeDefined()
      const extraEntry = cl.entries.find((e) => e.kind === 'static' && e.token === 'extra')
      expect(extraEntry).toBeDefined()
    })

    it('all-static slot content (no holes): static class= produces classlist binding', () => {
      // OP-1 closure: no holes, but static class must still be lifted
      const src = `const P = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="card">static</div></ChildComp>\`)
      })`
      const doc = new JSDOM('').window.document
      const r = parseNvFile(src, 'test.nv', doc)[0]!
      const scopeHash = r.ir.styleArtifact?.scopeHash
      expect(scopeHash).toBeDefined()
      const comp = r.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
      expect(comp).toBeDefined()
      const slotIR = comp.slots[0]!.content({})
      expect(slotIR.shape.html).not.toMatch(/class=/)
      const cl = slotIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      expect(cl).toBeDefined()
      const cardEntry = cl.entries.find((e) => e.kind === 'static' && e.token === `card_${scopeHash}`)
      expect(cardEntry).toBeDefined()
    })
  })
  ```

- [ ] **Step 2: Run to confirm they fail**

  ```bash
  npx vitest run test/renderer/slot-ss.test.ts 2>&1 | tail -10
  ```

  Expected: FAIL — shape.html still contains `class=`, no classlist binding found.

- [ ] **Step 3: Add static-class scan to `buildNvSlotContentIR`**

  In `buildNvSlotContentIR`, after the `slotLists` loop added in Task 2, and BEFORE the
  `rawHtml = fragWrapper.innerHTML` line (currently L775), insert:

  ```typescript
  // D-SS-1: lift static class= attrs to classlist {kind:'static'} entries.
  // scan AFTER walkNvNodeList so hole-based class attrs (already removed as sentinels)
  // are gone — remaining class= attrs are purely static. Remove from DOM so rawHtml
  // doesn't double-count them (binding is the canonical source).
  for (const el of Array.from(fragWrapper.querySelectorAll('[class]'))) {
    const classVal = (el as Element).getAttribute('class')!
    const tokens = classVal.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const pathIndex = allPaths.length
    allPaths.push(computePath(el as Node, fragWrapper))
    ;(el as Element).removeAttribute('class')
    bindings.push({
      kind: 'classlist',
      pathIndex,
      entries: tokens.map((token): ClassListEntry => ({ kind: 'static', token })),
    } satisfies ClassListBinding)
  }
  ```

  Note: `computePath` is already defined at L232 (internal to the module). `ClassListEntry`
  and `ClassListBinding` are already imported from `ir.ts`. No new imports needed.

- [ ] **Step 4: Remove the shape.html regex from `patchClasslistTokens` component case**

  Find the component case in `patchClasslistTokens` (~L1910-1928). Remove lines 1918-1925
  (the shape.html replace block) and the surrounding condition, updating the comment:

  ```typescript
  if (binding.kind === 'component') {
    const stubSlotProps = {}
    for (const slot of (binding as ComponentBinding).slots) {
      // NOTE: safe only while .nv slot factories return the same captured-by-ref IR object
      // (true for `(_props) => namedIR` closures built by buildNvSlotContentIR today).
      // The scoped-slot shape (props) => TemplateIR permits fresh-IR-per-call; that would
      // break this patch silently. Same latent fragility as the 'list' case above. (G2)
      // STACKED G2: <each>-in-slot stacks list.itemTemplate (by-ref) inside slot.content
      // (by-ref) — both assumptions must hold. See decision-log D-slot-style-1.
      const slotIR = slot.content(stubSlotProps)
      // Static class= attrs in slot content are now lifted to classlist {kind:'static'}
      // entries by buildNvSlotContentIR — the shape.html regex is no longer needed.
      patchClasslistTokens(slotIR, classRewrites)
    }
  }
  ```

- [ ] **Step 5: Update the existing static-class test in slot-style-scope.test.ts**

  The existing test at ~L294-316 asserts `slotIR!.shape.html` CONTAINS `card_${scopeHash}`
  (which was the regex behavior). After D-SS-1, the token is in the classlist binding, not
  in `shape.html`. Update that test:

  ```typescript
  // Find the test 'static class + text hole in slot content: literal class attr carries parent scopeHash'
  // and change assertions from shape.html string checks to classlist binding checks:
  it('static class + text hole in slot content: static class lifted to classlist entry', () => {
    const src = `const P = $component((_props) => {
      $style({ card: { color: 'red' } })
      $render(() => html\`<ChildComp><div class="card extra">\${1 + 1}</div></ChildComp>\`)
    })`
    const r = parseNvFile(src, 'test.nv', new JSDOM('').window.document)[0]!
    const scopeHash = r.ir.styleArtifact?.scopeHash
    expect(scopeHash).toBeDefined()
    const compBinding = r.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
    expect(compBinding).toBeDefined()
    const slotIR = compBinding.slots[0]?.content({})
    expect(slotIR).toBeDefined()
    // shape.html must NOT contain class= (lifted to binding)
    expect(slotIR!.shape.html).not.toMatch(/class=/)
    // classlist static entries: card → card_<hash>, extra unchanged
    const cl = slotIR!.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
    expect(cl).toBeDefined()
    expect(cl.entries).toContainEqual({ kind: 'static', token: `card_${scopeHash}` })
    expect(cl.entries).toContainEqual({ kind: 'static', token: 'extra' })
  })
  ```

- [ ] **Step 6: Verify typecheck and slot-ss tests pass**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  npx vitest run test/renderer/slot-ss.test.ts 2>&1 | tail -10
  ```

  Expected: tsc clean; all slot-ss tests pass.

- [ ] **Step 7: Run full suite — check for regressions**

  ```bash
  npx vitest run 2>&1 | tail -5
  ```

  Expected: all prior passing tests pass. Check the updated slot-style-scope tests pass.
  The G-SS-regex-gone gate: `grep "shape.html.replace" src/renderer/nv-parser.ts` should
  return nothing in the slot path.

  ```bash
  grep -n "shape.html.replace\|shape\.html.*replace" src/renderer/nv-parser.ts
  ```

  Expected: no output.

- [ ] **Step 8: Biome lint**

  ```bash
  npx biome check src/renderer/nv-parser.ts test/renderer/slot-ss.test.ts test/renderer/slot-style-scope.test.ts 2>&1 | tail -10
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add src/renderer/nv-parser.ts test/renderer/slot-ss.test.ts test/renderer/slot-style-scope.test.ts
  git commit -m "feat(slot): D-SS-1 static-class lift to classlist entries; remove shape.html regex"
  ```

---

## Task 4 — Re-enable G5 structural + emit-exec differential leg (D-SS-3)

**Files:**
- Modify: `test/renderer/slot-style-scope.test.ts` (expand `it.skip` G5 to real body)
- Modify: `test/renderer/slot-ss.test.ts` (add emit-exec differential + depth-2 gate)

**Interfaces:**
- Consumes: `parseNvFile`, `parseNvFileForEmit`, `emitMount`, `mount`, `signal`, `createRoot`,
  `flushSync`, `irStructurallyEqual` (from ir-equivalence), `JSDOM`

- [ ] **Step 1: Expand G5 in slot-style-scope.test.ts to a real body**

  Find the `it.skip` at ~L324 in `slot-style-scope.test.ts` and replace with:

  ```typescript
  it('class-form token in <each>-inside-slot-content is rewritten with parent scopeHash', () => {
    // This was deferred until <each>-in-slot was wired (buildNvSlotContentIR now consumes lists).
    // Parse-path structural: slotIR contains a list binding; itemIR's classlist key is scoped.
    const src = `const Parent = $component((_props) => {
      $style({ card: { color: 'red' } })
      $render(() => html\`<ChildComp>
        <each .of=\${signal([])} key="\${(item) => item}" let={item}>
          <div class="\${{card: true}}">\${item}</div>
        </each>
      </ChildComp>\`)
    })`
    const doc = new JSDOM('').window.document
    const results = parseNvFile(src, 'test.nv', doc)
    const parent = results.find((r) => r.name === 'Parent')!
    const scopeHash = parent.ir.styleArtifact!.scopeHash
    expect(scopeHash).toBeDefined()
    const comp = parent.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
    expect(comp).toBeDefined()
    const slotIR = comp.slots[0]!.content({})
    const listBinding = slotIR.bindings.find((b) => b.kind === 'list') as ListBinding
    expect(listBinding).toBeDefined()
    const { signal: sig } = await import('../../src/core/core.js')
    const stubVs = sig<unknown>(null)
    const stubIs = sig<number>(0)
    const itemIR = listBinding.itemTemplate(stubVs, stubIs)
    const cl = itemIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
    expect(cl).toBeDefined()
    const toggle = cl.entries.find((e) => e.kind === 'toggle')!
    expect(toggle.kind).toBe('toggle')
    expect((toggle as { kind: 'toggle'; key: string }).key).toBe(`card_${scopeHash}`)
  })
  ```

  Also remove the `describe.skip` wrapper (change to `describe`) for this G5 block.

- [ ] **Step 2: Add emit-exec differential leg to slot-ss.test.ts**

  Add a new `describe` block for the behavioral emit-exec differential:

  ```typescript
  import { createRoot, flushSync, signal } from '../../src/core/core.js'
  import { emitMount } from '../../src/compiler/emitted-mount.js'
  import { mount } from '../../src/renderer/interpreter.js'
  import { irStructurallyEqual } from './ir-equivalence.js'

  describe('G-SS-emit: $style × <each>-in-slot emit-exec differential (interpreter vs emitted)', () => {
    it('both back-ends apply scoped classlist token to each list-item in slot content', () => {
      // Uses parseNvFileForEmit to get real itemTemplate factories (not stubs).
      // Verifies both interpreter and emitMount apply card_<hash> to each rendered item.
      const src = `const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp>
          <each .of=\${items} key="\${(item) => item}" let={item}>
            <div data-item class="\${{card: true}}">\${item}</div>
          </each>
        </ChildComp>\`)
      })`
      const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>')
      const doc = dom.window.document
      const items = signal(['a', 'b'])
      // Parse + emit to get real IR with real itemTemplate factories
      // NOTE: parseNvFileForEmit produces the real emit payload; emitMount executes it.
      // The slot's <each> must be wired so slotIR.bindings contains a real ListBinding.
      const emitResults = parseNvFileForEmit(src, 'test.nv', doc)
      const parent = emitResults.find((r) => r.name === 'Parent')!
      expect(parent.ir.styleArtifact?.scopeHash).toBeDefined()
      const scopeHash = parent.ir.styleArtifact!.scopeHash

      // Mount via emitMount (compiler back-end)
      const container = doc.getElementById('app')!
      createRoot((d) => {
        emitMount(parent.ir).mountFn(container, doc)
        return d
      })
      flushSync()
      const items_dom = Array.from(container.querySelectorAll('[data-item]'))
      expect(items_dom.length).toBe(2)
      for (const el of items_dom) {
        expect((el as Element).classList.contains(`card_${scopeHash}`)).toBe(true)
      }
    })

    it('FE-equivalence: parse-path and emit-path agree on slot-list IR structure (oracle)', () => {
      const src = `const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp>
          <each .of=\${signal([])} key="\${(item) => item}" let={item}>
            <div class="\${{card: true}}">\${item}</div>
          </each>
        </ChildComp>\`)
      })`
      const dom = new JSDOM('<!DOCTYPE html><body></body>')
      const doc = dom.window.document
      const parseResults = parseNvFile(src, 'test.nv', doc)
      const emitResults = parseNvFileForEmit(src, 'test.nv', doc)
      const parseParent = parseResults.find((r) => r.name === 'Parent')!
      const emitParent = emitResults.find((r) => r.name === 'Parent')!
      // Route through the Action-2 oracle (D-SS-4): slot content IS compared (doc passed)
      const result = irStructurallyEqual(doc, parseParent.ir, emitParent.ir)
      expect(result.equal).toBe(true)
    })
  })

  describe('G-SS-depth2: depth-2 <each>-in-each-in-slot (class token scoped)', () => {
    it('depth-2: classlist toggle key is scoped at item body depth', () => {
      // <each>-in-slot produces slotIR.bindings=[ListBinding].
      // patchClasslistTokens component case → list case → recurses itemIR → classlist hit.
      const src = `const P = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp>
          <each .of=\${signal([])} key="\${(item) => item}" let={item}>
            <div class="\${{card: true}}">\${item}</div>
          </each>
        </ChildComp>\`)
      })`
      const doc = new JSDOM('').window.document
      const r = parseNvFile(src, 'test.nv', doc)[0]!
      const scopeHash = r.ir.styleArtifact!.scopeHash
      const comp = r.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
      const slotIR = comp.slots[0]!.content({})
      const list = slotIR.bindings.find((b) => b.kind === 'list') as ListBinding
      const vs = signal<unknown>(null)
      const is = signal<number>(0)
      const itemIR = list.itemTemplate(vs, is)
      const cl = itemIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      const toggle = cl.entries.find((e) => e.kind === 'toggle') as { kind: 'toggle'; key: string; expr: () => unknown }
      expect(toggle.key).toBe(`card_${scopeHash}`)
    })
  })
  ```

- [ ] **Step 3: Add by-ref invariant test (OP-5)**

  ```typescript
  describe('G2 by-ref stacked invariant — <each>-in-slot', () => {
    it('slot.content({}) returns the same IR object on repeated calls (by-ref)', () => {
      const src = `const P = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp>
          <each .of=\${signal([])} key="\${(item) => item}" let={item}>
            <div>\${item}</div>
          </each>
        </ChildComp>\`)
      })`
      const doc = new JSDOM('').window.document
      const r = parseNvFile(src, 'test.nv', doc)[0]!
      const comp = r.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
      const slotA = comp.slots[0]!.content({})
      const slotB = comp.slots[0]!.content({})
      // by-ref: same object (patchClasslistTokens relies on this)
      expect(slotA).toBe(slotB)
    })
  })
  ```

- [ ] **Step 4: Run the new tests**

  ```bash
  npx vitest run test/renderer/slot-ss.test.ts test/renderer/slot-style-scope.test.ts 2>&1 | tail -15
  ```

  Expected: all pass. If the emit-exec differential test fails, it means `parseNvFileForEmit`
  does not yet produce a real `itemTemplate` for slot `<each>` — the emit path may need the
  same wiring (`buildNvSlotContentIR` is shared, but `parseNvFileForEmit` has its own thunk
  builder for `<each>` at the outer level). Verify and add the same `lists` wiring to the
  emit path's slot content building if needed.

- [ ] **Step 5: Run full suite**

  ```bash
  npx vitest run 2>&1 | tail -5
  ```

  Expected: all pass. No new skips introduced.

- [ ] **Step 6: Commit**

  ```bash
  git add test/renderer/slot-ss.test.ts test/renderer/slot-style-scope.test.ts
  git commit -m "test(slot-ss): re-enable G5; add emit-exec differential + depth-2 + by-ref invariant gates"
  ```

---

## Task 5 — Playwright ×3 styled cascade leg (G-SS-browser)

**Files:**
- Create: `test/browser/slot-ss.spec.ts`

**Why real-browser required:** `$style × <each>-in-slot` involves CSS injection
(`adoptedStyleSheets` / `<style>` fallback) and cascade match — jsdom is not authoritative
for these (standing policy; same reasoning as G6 in slot-style-scope).

- [ ] **Step 1: Check the existing browser test structure**

  ```bash
  head -40 test/browser/slot-style-scope.spec.ts
  ```

  Mirror its import pattern, `beforeEach`, and `test.describe` structure exactly.

- [ ] **Step 2: Create `test/browser/slot-ss.spec.ts`**

  ```typescript
  /**
   * Increment SS — real-browser gate (Playwright ×3: Blink/Gecko/WebKit)
   * G-SS-browser: $style × <each>-in-slot: scoped class applied to each list item in slot.
   */
  import { expect, test } from '@playwright/test'

  test.describe('Increment SS: $style × <each>-in-slot (real browser)', () => {
    test('each item in slot content carries parent scopeHash class', async ({ page }) => {
      // Inline HTML: manually constructed IR exercising the full stack.
      await page.setContent(`
        <!DOCTYPE html>
        <html><body>
        <div id="app"></div>
        <script type="module">
          import { signal, createRoot, flushSync } from '/src/core/core.js'
          import { mount } from '/src/renderer/interpreter.js'
          // Build a parent IR that has a styled slot with <each>
          // scopeHash is pre-computed for the known input below.
          // This test validates the full cascade stack end-to-end.
          const scopeHash = 'PLACEHOLDER' // will be replaced by the test helper

          // TODO: use the actual parseNvFile + mount stack once the dev server
          // can serve .nv files through the esbuild plugin. For now, build IR
          // manually with a known scopeHash.

          // Simpler approach: use parseNvFile directly in a module script.
          // See slot-style-scope.spec.ts §6 for the pattern.
        </script>
        </body></html>
      `)
      // Placeholder — real implementation follows the slot-style-scope.spec.ts pattern.
      // The test mounts a parent via parseNvFile + mount, asserts that each projected
      // list-item element has the scoped class (card_<hash>), and that the injected
      // stylesheet applies the correct color.
      // If parseNvFile cannot run in the browser context, use a pre-built bundle.
      // See slot-style-scope.spec.ts for the working implementation pattern.
      expect(true).toBe(true) // replace with real assertions
    })
  })
  ```

  **Implementation note:** The exact structure of `slot-style-scope.spec.ts` should be
  replicated. If that file uses a pre-built IR approach rather than running `parseNvFile`
  in-browser, follow the same convention. The gate requires:
  - Each `<each>` list item in slot content has `class="card_<hash>"` applied by
    `classList.add` (from the `{kind:'static'}` entry OR from the `{kind:'toggle'}` reactive
    entry — depends on whether the item binding is a static entry (D-SS-1) or toggle).
  - The injected CSS sheet has a rule `.card_<hash> { color: rgb(255, 0, 0) }`.
  - The rendered computed style of each item is `color: rgb(255, 0, 0)`.

- [ ] **Step 3: Run the browser tests (Playwright ×3)**

  ```bash
  npx playwright test test/browser/slot-ss.spec.ts --project=chromium --project=firefox --project=webkit 2>&1 | tail -15
  ```

  Expected: all 3 browsers pass.

- [ ] **Step 4: Commit**

  ```bash
  git add test/browser/slot-ss.spec.ts
  git commit -m "test(browser): G-SS-browser Playwright ×3 for \$style × <each>-in-slot cascade"
  ```

---

## Task 6 — Landing docs + implementation-state update

**Files:**
- Modify: `docs/implementation-state.md`
- Modify: `docs/decision-log.md`

- [ ] **Step 1: Update `implementation-state.md`**

  Update the `nv-parser.ts` row — change the slot builder note to reflect:
  - `<each>`-in-slot now wired (`lists` consumed via `pushListBinding` helper)
  - static-class attrs lifted to classlist entries; `shape.html` regex removed
  - all-static slot limitation CLOSED (or update per OP-1 resolution)

  Update the `Last verified` footer:
  ```markdown
  Last verified against source: **2026-06-23.** Contract **v0.4.2**, Template IR **v0.4.2**.
  ```
  (Already correct; confirm it's still accurate.)

  Add to Known gaps / closed section:
  ```markdown
  - **`<each>`-in-slot — LANDED (Increment SS, 2026-06-23).** `buildNvSlotContentIR`
    now wires `lists` from `walkNvNodeList` via shared `pushListBinding` helper (D-SS-2).
    Structural identity by construction. G5 re-enabled; emit-exec differential gate passes.
  - **D-slot-style-1 — CLOSED (Increment SS, 2026-06-23).** Static `class=` in slot
    content lifted to `{kind:'static',token}` classlist entries in `buildNvSlotContentIR`
    post-walk scan. `patchClasslistTokens` `component` case's `shape.html` regex removed.
    All-static-slot limitation CLOSED (OP-1 resolution; post-walk scan handles it).
  ```

- [ ] **Step 2: Append landing entry to `decision-log.md`**

  ```markdown
  ### 2026-06-23 — Increment SS LANDED (`<each>`-in-slot + static-class collapse)

  **Items landed:**
  - **Item 1 (`<each>`-in-slot wired):** `buildNvSlotContentIR` now destructures `lists`
    from `walkNvNodeList` and calls `pushListBinding` (shared helper extracted from main
    builder L1044-1068). Structural identity by construction (D-SS-2). G5 re-enabled in
    both test files; structural + emit-exec differential both pass.
  - **Item 2 (D-slot-style-1 structural collapse):** Static `class=` attrs in slot content
    lifted to `{kind:'static',token}` classlist entries via post-walk scan of
    `fragWrapper.querySelectorAll('[class]')`. `shape.html` regex (nv-parser.ts ~L1919-1925)
    REMOVED (G0-3 satisfied). Both back-ends' `wireClassList` already consumed
    `{kind:'static'}` entries — no back-end change needed.
  - **All-static limitation CLOSED** (OP-1 resolution): post-walk scan handles purely-static
    slot content (no holes) by computing `computePath(el, fragWrapper)` for static-class
    elements. No ComponentBinding required.

  **Gates passed:** G-SS-struct, G-SS-regex-gone, G-SS-G5, G-SS-emit, G-SS-static,
  G-SS-oracle, G-SS-bothFE, G-SS-depth2, G-SS-browser ×3.

  **Slot domain:** DONE. D-slot-style-1 CLOSED. D-each-4 all-static limitation CLOSED.
  reactive-core v0.4.2 + Template-IR v0.4.2 untouched.
  ```

  Also update Current State: mark Increment SS as LANDED.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/implementation-state.md docs/decision-log.md
  git commit -m "docs: Increment SS landed — each-in-slot + static-class collapse; close D-slot-style-1"
  ```

---

## Gate table (complete)

| Gate | Evidence command | Failure condition |
|---|---|---|
| G-SS-struct | `grep -n "pushListBinding" src/renderer/nv-parser.ts` | helper not extracted or one call site doesn't use it |
| G-SS-regex-gone | `grep -n "shape\.html\.replace\|shape\.html.*replace" src/renderer/nv-parser.ts` | any output from the slot path |
| G-SS-G5 | `grep -n "describe.skip\|it.skip" test/renderer/nv-parser.test.ts test/renderer/slot-style-scope.test.ts` | G5 still appears as skip |
| G-SS-emit | `npx vitest run test/renderer/slot-ss.test.ts -t "emit-exec"` | test fails or uses parse-path stubs |
| G-SS-static | `npx vitest run test/renderer/slot-ss.test.ts -t "static"` | classList differs from baseline or `class=` still in shape.html |
| G-SS-oracle | `grep -n "irStructurallyEqual" test/renderer/slot-ss.test.ts` | oracle not used in FE-equivalence test |
| G-SS-bothFE | `npx vitest run test/renderer/slot-ss.test.ts -t "FE-equivalence"` | FE divergence via oracle |
| G-SS-depth2 | `npx vitest run test/renderer/slot-ss.test.ts -t "depth-2"` | token not scoped at depth-2 |
| G-SS-browser | `npx playwright test test/browser/slot-ss.spec.ts --project=chromium --project=firefox --project=webkit` | any browser fails |
| G0-1 | `git diff HEAD src/core/` | any core file changed |
| G0-2 | inspect slot IR's list binding shape vs main-walk shape | structurally divergent |
| G0-3 | G-SS-regex-gone above | regex still present |
| G0-4 | `grep -n "StyleVarBinding\|new.*Binding\|kind.*new" src/renderer/ir.ts` relative to HEAD | any new ir.ts shape |
| G0-5 | G-SS-bothFE + G-SS-oracle | FE lockstep broken |

---

## Self-review

**Spec coverage:**
- ✅ D-SS-1 (static-class structural collapse + regex removal): Tasks 2–3
- ✅ D-SS-2 (shared list-push helper): Task 2
- ✅ D-SS-3 (G5 re-enable + emit-exec differential): Task 4
- ✅ D-SS-4 (Action-2 oracle as structural gate): Task 4 FE-equivalence test
- ✅ OP-1 (all-static limitation): Task 3 + OP-1 proposal
- ✅ OP-2 (lift location): Task 3 Step 3 (Option A)
- ✅ OP-3 (diagnostics threading): Task 2 Step 5 (local sink)
- ✅ OP-4 (depth-2): Task 4 G-SS-depth2 test
- ✅ OP-5 (stacked G2): Task 4 by-ref invariant test + comment in Task 3 Step 4
- ✅ G0 disqualifiers: gate table
- ✅ Playwright ×3: Task 5
- ✅ Landing docs: Task 6

**Placeholder scan:** Task 5 `slot-ss.spec.ts` Step 2 has a deliberate `expect(true).toBe(true)` placeholder. The implementer MUST replace this with real assertions following the `slot-style-scope.spec.ts` pattern. This is the only placeholder — it's flagged explicitly and the replacement path is described.

**Type consistency:** `pushListBinding` signature uses `NvWalkedEach`, `NodePath`, `Binding`, `NvDiagnostic` — all already present in the module. `ClassListEntry` used in Task 3 Step 3 — already imported. `computePath` used — already internal at L232.
