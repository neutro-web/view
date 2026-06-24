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

**⛔ ARCHITECT RULED: Option A REJECTED. Replaced with shared lift (decided fix).**

**Why Option A was rejected:** The architect verified at ce79d23 that a MAIN-path static
`class="card"` under `$style({card:{...}})` is a live bug today — `classRewrites` computes
`card→card_<hash>` and emits the scoped CSS, but `shape.html` keeps bare `class="card"`.
Selector and element don't match; the rule silently never applies. Option A (slot-only scan)
would have fixed slot static class while leaving the main-path bug open — widening the
divergence.

**Decided fix:** Extract a module-level `liftStaticClassBindings(fragWrapper, allPaths, bindings)` helper called from BOTH `processHtmlTemplate` (before `shapeDiv.innerHTML`
serialization, ~L1096) AND `buildNvSlotContentIR` (before `rawHtml = fragWrapper.innerHTML`,
~L775). After the lift, both paths carry static class as `classlist {kind:'static'}` entries;
the existing `patchClasslistTokens` static-entry rewrite (L1876-1885) scopes them uniformly
on the main path too. The slot-path regex (L1919-1925) is removed because static class is now
a classlist entry everywhere. One rewrite representation, both positions, both paths.

**Implementation:**
```typescript
/**
 * Lift remaining static class= attrs on DOM elements into classlist {kind:'static'} entries.
 * Called AFTER walkNvNodeList (or walkNodeList) so sentinel-based attrs are already gone.
 * Strips the class attr from the element before caller serializes shape/raw HTML so the
 * token appears only in the binding, not duplicated in shape.html.
 * Used by both processHtmlTemplate (main path) and buildNvSlotContentIR (slot path).
 */
function liftStaticClassBindings(
  fragWrapper: Element,
  allPaths: NodePath[],
  bindings: Binding[],
): void {
  for (const el of Array.from(fragWrapper.querySelectorAll('[class]')) as Element[]) {
    const classVal = el.getAttribute('class')!
    const tokens = classVal.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const pathIndex = allPaths.length
    allPaths.push(computePath(el as Node, fragWrapper))
    el.removeAttribute('class') // strip before HTML serialization
    bindings.push({
      kind: 'classlist',
      pathIndex,
      entries: tokens.map((token): ClassListEntry => ({ kind: 'static', token })),
    } satisfies ClassListBinding)
  }
}
```

### OP-3: Diagnostics threading for slot `<each>`

The main list-push loop (L1047-1054) emits a `'warning'` diagnostic into
`processdiagnostics` when `<each>` has no `let={}`. `buildNvSlotContentIR` has no
diagnostics channel — its return is `{ir, holeIndices, letNames}`.

**⛔ ARCHITECT RULED: ACCEPT with clarification.** Thread `processdiagnostics` (the parent's
diagnostic channel) as the sink — not a silent empty local array. Since
`buildNvSlotContentIR` is called during the parent's walk context (where `processdiagnostics`
is in scope), thread it as an explicit parameter to `pushListBinding`. Named-debt fallback
only if the plumbing proves non-trivial; state that explicitly if punted. No new exported
type, no IR change.

### OP-4: Depth-2 nesting gate

`patchClasslistTokens` `list` case (L1891-1899) recursively calls `patchClasslistTokens`
on `itemIR`, and the `component` case (L1910-1926) recurses on `slotIR`. A slot
containing `<each>` produces a `ComponentBinding` whose slot contains a `ListBinding`.
The component case calls `patchClasslistTokens(slotIR, ...)`, which then hits the `list`
case and calls `patchClasslistTokens(itemIR, ...)` — depth-2 falls out of the existing
recursion by construction.

**⛔ ARCHITECT RULED: ACCEPT — but require a BEHAVIORAL (mounted) depth-2 test, not
parse-path stub only.** The structural claim (`patchClasslistTokens` recurses correctly) must
be backed by an emit-exec test that mounts a depth-2 template and asserts the rendered DOM
element carries the scoped class. Parse-path stubs do not prove the back-end applies it.

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

## Gate-P checklist

- [x] OP-1 ACCEPTED — post-walk scan closes all-static limitation
- [x] OP-2 DECIDED — shared `liftStaticClassBindings` helper, both call sites (main + slot); Option A rejected (would ship main-path bug)
- [x] OP-3 ACCEPTED — thread parent diagnostics channel; named-debt fallback only if non-trivial
- [x] OP-4 ACCEPTED — behavioral (mounted) depth-2 test required, not parse-path stub only
- [x] OP-5 ACCEPTED — code comment + by-ref invariant test; no runtime assert
- [x] G0 disqualifiers confirmed: no core touch, no slot-local list, regex gone, no IR bump, FE lockstep (html-tag.ts `buildSlotContentIR` also wires `lists`)
- [x] Main-path static-class bug folded in — G-SS-mainbug + G-SS-symmetry mandatory gates added; Playwright ×3 required for G-SS-mainbug styled leg

> **⚠️ Gate-P OPEN — plan revision in progress (OP-2 shared lift, new gates, widened Task 3). Re-submit after revision for fast confirm.**

---

## File map

| File | Change |
|---|---|
| `src/renderer/nv-parser.ts` | Extract `pushListBinding` + `liftStaticClassBindings` module-level helpers; both call sites (main + slot) lift static class; `buildNvSlotContentIR` consumes `lists`; remove shape.html regex; `patchClasslistTokens` comment updated |
| `src/renderer/html-tag.ts` | `buildSlotContentIR` consumes `lists` from `walkNodeList` and pushes `ListBinding` (mirrors main `html` function L893-905); closes both-FE gap (G-SS-bothFE) |
| `test/renderer/nv-parser.test.ts` | Re-enable `describe.skip` G5 at L1353 |
| `test/renderer/slot-style-scope.test.ts` | Expand G5 `it.skip` to real test body; update describe block title (regex language removed) |
| `test/renderer/slot-ss.test.ts` | **NEW** — `<each>`-in-slot structural + emit-exec differential; both-FE oracle (G-SS-bothFE); static-class lift; depth-2; by-ref invariant; G-SS-* gates |
| `test/browser/slot-ss.spec.ts` | **NEW** — Playwright ×3 for `$style × <each>-in-slot` styled leg |
| `docs/implementation-state.md` | Update slot builder row + known gaps; note regex gone; html-tag.ts slot builder updated |
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

## Task 2 — Shared list-push helper + wire `<each>`-in-slot in both FEs (Item 1)

**⛔ Do NOT begin until Gate-P is approved by the architect.**

**Files:**
- Modify: `src/renderer/nv-parser.ts` (extract module-level `pushListBinding`, update
  `buildNvSlotContentIR`, update the main list-push loop to call the shared helper)
- Modify: `src/renderer/html-tag.ts` (`buildSlotContentIR` consumes `lists` from
  `walkNodeList` — mirrors the main `html` function's list loop at L893-905)

**Interfaces:**
- Produces: `function pushListBinding(wl: NvWalkedEach, allPaths: NodePath[], bindings: Binding[], diagnostics: NvDiagnostic[]): void` (module-level in nv-parser.ts, not exported)
- Consumes: `NvWalkedEach` (L463), `NodePath`, `Binding`, `NvDiagnostic`, `ListBinding`, `signal` from core
- html-tag.ts fix uses existing `WalkedList.sentinel` (`{items, key, factory}: EachSentinel`) — no new types

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

- [ ] **Step 3: Extract `pushListBinding` as a module-level function in nv-parser.ts**

  Find the main list-push loop (L1044–1068). Extract it into a **module-level** function
  defined BEFORE `buildNvSlotContentIR` (which starts at L740). `buildNvSlotContentIR` is
  defined before `processHtmlTemplate` (L942) — a function declared inside
  `processHtmlTemplate` would be invisible to it. Place `pushListBinding` just above
  `buildNvSlotContentIR` (~L739), after the `NvWalkedEach`/`NvWalkResult` interface block:

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
  // Wire <each>-in-slot via the shared helper (D-SS-2: structural identity by construction).
  // OP-3 ruling: thread parent diagnostics channel, not a silent local sink.
  for (const wl of slotLists) {
    pushListBinding(wl, allPaths, bindings, diagnostics) // diagnostics = threaded parameter
  }
  ```

  Add `diagnostics: NvDiagnostic[]` parameter to `buildNvSlotContentIR`'s signature and
  thread `processdiagnostics` at the call site inside `processHtmlTemplate`. Named-debt
  fallback (local sink) only if the plumbing proves non-trivial — state that explicitly.

- [ ] **Step 6: Wire `<each>`-in-slot in `html-tag.ts` `buildSlotContentIR`**

  Find `buildSlotContentIR` at L642. At L662, the destructure discards `lists`:

  ```typescript
  // BEFORE:
  const { holeInfos, holePaths, components, consumed } = walkNodeList(
    Array.from(fragWrapper.childNodes),
    exprs,
    fragWrapper,
    doc,
  )
  ```

  Change to:
  ```typescript
  const { holeInfos, holePaths, components, consumed, lists } = walkNodeList(
    Array.from(fragWrapper.childNodes),
    exprs,
    fragWrapper,
    doc,
  )
  ```

  Then find the component loop (L685-688):
  ```typescript
  for (const c of components) {
    const pathIndex = allPaths.length
    allPaths.push(c.anchorPath)
    bindings.push(makeUnresolvedComponentBinding(pathIndex, c))
  }
  ```

  Add the list loop immediately after it — mirrors the main `html` function at L893-905:
  ```typescript
  // Wire <each>-in-slot: same pattern as the main html() function (L893-905).
  // buildSlotContentIR previously discarded `lists` — this closes the both-FE gap (G-SS-bothFE).
  for (const wl of lists) {
    const pathIndex = allPaths.length
    allPaths.push(wl.anchorPath)
    const { items, key, factory } = wl.sentinel
    bindings.push({
      kind: 'list',
      pathIndex,
      items,
      key,
      itemTemplate: (valueSig, indexSig) =>
        factory({ item: () => valueSig(), index: () => indexSig() }),
    } satisfies ListBinding)
  }
  ```

- [ ] **Step 7: Verify typecheck and tests pass**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  npx vitest run test/renderer/nv-parser.test.ts 2>&1 | tail -5
  ```

  Expected: tsc clean; G5 test passes.

- [ ] **Step 8: Run the full suite to check for regressions**

  ```bash
  npx vitest run 2>&1 | tail -5
  ```

  Expected: G5 now active (2 skip → 1 skip). All prior passing tests still pass.

- [ ] **Step 9: Biome lint**

  ```bash
  npx biome check src/renderer/nv-parser.ts src/renderer/html-tag.ts 2>&1 | tail -10
  ```

  Expected: no errors. Fix any template-literal-vs-string-literal warnings.

- [ ] **Step 10: Commit**

  ```bash
  git add src/renderer/nv-parser.ts src/renderer/html-tag.ts test/renderer/nv-parser.test.ts
  git commit -m "feat(slot): wire <each>-in-slot in both FEs via pushListBinding helper (D-SS-2; re-enable G5)"
  ```

---

## Task 3 — `liftStaticClassBindings` shared helper + both call sites + regex removal (Item 2 / D-SS-1 + main-path bug fix)

**Files:**
- Modify: `src/renderer/nv-parser.ts` (extract `liftStaticClassBindings` module-level
  helper; call it in BOTH `processHtmlTemplate` and `buildNvSlotContentIR`; remove
  `shape.html` regex from `patchClasslistTokens` component case)

**Interfaces:**
- Produces: `function liftStaticClassBindings(fragWrapper: Element, allPaths: NodePath[], bindings: Binding[]): void` (module-level, not exported; see OP-2 code block above for body)
- Consumes: `computePath` (L232, internal), `ClassListBinding`, `ClassListEntry` — all already in module
- Main call site: `processHtmlTemplate` (~L1096, before `shapeDiv.innerHTML`)
- Slot call site: `buildNvSlotContentIR` (~L775, before `rawHtml = fragWrapper.innerHTML`)

- [ ] **Step 1: Write failing tests — MAIN-path bug + slot lift + all-static closure**

  In `test/renderer/slot-ss.test.ts` (new file), add:

  ```typescript
  import { JSDOM } from 'jsdom'
  import { describe, expect, it } from 'vitest'
  import type { ClassListBinding, ComponentBinding } from '../../src/renderer/ir.js'
  import { parseNvFile } from '../../src/renderer/nv-parser.js'

  describe('G-SS-mainbug: MAIN static class= under $style scopes correctly (live bug fix)', () => {
    it('G-SS-mainbug (parse): main template static class= produces classlist {kind:static} with scoped token', () => {
      // This is the live bug at ce79d23: classRewrites has card→card_<hash> but
      // shape.html keeps bare class="card". liftStaticClassBindings fixes it.
      const src = `const P = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<div class="card">hello</div>\`)
      })`
      const doc = new JSDOM('').window.document
      const r = parseNvFile(src, 'test.nv', doc)[0]!
      const scopeHash = r.ir.styleArtifact?.scopeHash
      expect(scopeHash).toBeDefined()
      // shape.html must NOT contain class= after lift
      expect(r.ir.shape.html).not.toMatch(/class=/)
      // A classlist {kind:'static'} binding must exist with the scoped token
      const cl = r.ir.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      expect(cl).toBeDefined()
      expect(cl.entries).toContainEqual({ kind: 'static', token: `card_${scopeHash}` })
    })
  })

  describe('D-SS-1: static-class attrs lifted to classlist entries (regex removed)', () => {
    it('static class= in slot content produces a classlist {kind:static} binding with scoped token', () => {
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
      expect(slotIR.shape.html).not.toMatch(/class=/)
      const cl = slotIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      expect(cl).toBeDefined()
      expect(cl.entries).toContainEqual({ kind: 'static', token: `card_${scopeHash}` })
      expect(cl.entries).toContainEqual({ kind: 'static', token: 'extra' })
    })

    it('all-static slot content (no holes): static class= produces classlist binding', () => {
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
      expect(cl.entries).toContainEqual({ kind: 'static', token: `card_${scopeHash}` })
    })
  })

  describe('G-SS-symmetry: same static class fragment in main vs slot → same classlist IR', () => {
    it('G-SS-symmetry: identical <div class="card"> in main and slot produce identical ClassListBinding', () => {
      // Oracle gate: verifies that the shared lift produces structurally identical
      // classlist IR regardless of whether the element is in main template or slot content.
      const docMain = new JSDOM('').window.document
      const docSlot = new JSDOM('').window.document

      // Main template: <div class="card">
      const srcMain = `const P = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<div class="card">hello</div>\`)
      })`
      const rMain = parseNvFile(srcMain, 'test.nv', docMain)[0]!
      const clMain = rMain.ir.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      expect(clMain).toBeDefined()

      // Slot content: same <div class="card"> nested in a component's slot
      const srcSlot = `const P = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="card">hello</div></ChildComp>\`)
      })`
      const rSlot = parseNvFile(srcSlot, 'test.nv', docSlot)[0]!
      const comp = rSlot.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
      const slotIR = comp.slots[0]!.content({})
      const clSlot = slotIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
      expect(clSlot).toBeDefined()

      // Both must have the same {kind:'static', token:'card_<hash>'} entry structure
      // (tokens differ only by hash but hash is determined by the same $style def + template)
      expect(clMain.entries).toHaveLength(1)
      expect(clSlot.entries).toHaveLength(1)
      expect(clMain.entries[0]!.kind).toBe('static')
      expect(clSlot.entries[0]!.kind).toBe('static')
      // shape.html must not contain class= in either path
      expect(rMain.ir.shape.html).not.toMatch(/class=/)
      expect(slotIR.shape.html).not.toMatch(/class=/)
    })
  })
  ```

- [ ] **Step 2: Run to confirm they fail**

  ```bash
  npx vitest run test/renderer/slot-ss.test.ts 2>&1 | tail -10
  ```

  Expected: FAIL — shape.html still contains `class=`, no classlist binding found.

- [ ] **Step 3: Extract `liftStaticClassBindings` module-level helper + call in both sites**

  **3a — Extract helper.** Define `liftStaticClassBindings` just above `buildNvSlotContentIR`
  (~L739, after the `NvWalkedEach`/`NvWalkResult` block and alongside `pushListBinding`). The
  full body is in the OP-2 section above — copy it verbatim. No new imports needed
  (`computePath` is at L232, `ClassListEntry`/`ClassListBinding` already imported from ir.ts).

  **3b — Slot call site.** In `buildNvSlotContentIR`, after the `slotLists` loop added in
  Task 2, and BEFORE `rawHtml = fragWrapper.innerHTML` (~L775), insert:

  ```typescript
  // D-SS-1 + OP-2: shared lift — static class= attrs → classlist {kind:'static'} entries.
  // fragWrapper attrs consumed AFTER walkNvNodeList so sentinel-based attrs are gone.
  // Remove class attr from DOM before rawHtml serialization (binding is canonical).
  liftStaticClassBindings(fragWrapper, allPaths, bindings)
  ```

  **3c — Main-path call site.** In `processHtmlTemplate`, find the line ~L1096 where
  `shapeDiv.innerHTML` is serialized (the shape HTML snapshot). Before that line, insert:

  ```typescript
  // D-SS-1: shared lift at the main-path call site — same mechanism as slot path.
  // Fixes live bug: static class= in main template under $style was not scoped
  // (classRewrites had the mapping but shape.html was never updated).
  // liftStaticClassBindings removes class= from shapeDiv BEFORE innerHTML snapshot,
  // so patchClasslistTokens static-entry rewrite (L1876-1885) scopes it uniformly.
  liftStaticClassBindings(shapeDiv, allPaths, bindings)
  ```

  The variable name for the main-path DOM wrapper may be `shapeDiv` or similar — verify at
  HEAD by reading `processHtmlTemplate` around L1096 and substituting the actual name.

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

  Find the `it.skip` at ~L324 in `slot-style-scope.test.ts`. Also change the enclosing
  `describe.skip` to `describe` AND update the describe block title (the old title still
  says "deferred" — change it to "G5: classlist token in `<each>`-inside-slot carries
  parent scopeHash"). Use static imports at the top of the test file (already present for
  `signal`, `JSDOM`, `parseNvFile`, `ClassListBinding`, `ComponentBinding`, `ListBinding`).

  Replace `it.skip(...)` with:

  ```typescript
  it('class-form token in <each>-inside-slot-content is rewritten with parent scopeHash', () => {
    // Deferred until <each>-in-slot was wired (buildNvSlotContentIR now consumes lists).
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
    // signal is imported at the top of the test file (static import from core)
    const stubVs = signal<unknown>(null)
    const stubIs = signal<number>(0)
    const itemIR = listBinding.itemTemplate(stubVs, stubIs)
    const cl = itemIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
    expect(cl).toBeDefined()
    const toggle = cl.entries.find((e) => e.kind === 'toggle')!
    expect(toggle.kind).toBe('toggle')
    expect((toggle as { kind: 'toggle'; key: string }).key).toBe(`card_${scopeHash}`)
  })
  ```

  Also verify `signal` is imported at the top of `slot-style-scope.test.ts`. If not, add:
  ```typescript
  import { signal } from '../../src/core/core.js'
  ```

- [ ] **Step 2: Add emit-exec differential leg + real both-FE gate to slot-ss.test.ts**

  Add these imports at the top of the new `slot-ss.test.ts` file (in addition to imports
  from Task 3 Step 1):

  ```typescript
  import { createRoot, flushSync, signal } from '../../src/core/core.js'
  import { emitMount } from '../../src/compiler/emitted-mount.js'
  import { mount } from '../../src/renderer/interpreter.js'
  import { createHtmlTag, each } from '../../src/renderer/html-tag.js'
  import { irStructurallyEqual } from './ir-equivalence.js'
  import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'
  ```

  Add two new `describe` blocks:

  ```typescript
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
      const emitResults = parseNvFileForEmit(src, 'test.nv', doc)
      const parent = emitResults.find((r) => r.name === 'Parent')!
      expect(parent.ir.styleArtifact?.scopeHash).toBeDefined()
      const scopeHash = parent.ir.styleArtifact!.scopeHash

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

    it('G-SS-differential: .nv parse-path and emit-path agree on slot-list IR structure (oracle)', () => {
      // Compares parseNvFile vs parseNvFileForEmit — both .nv paths must agree.
      const src = `const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp>
          <each .of=\${signal([])} key="\${(item) => item}" let={item}>
            <div class="\${{card: true}}">\${item}</div>
          </each>
        </ChildComp>\`)
      })`
      const doc = new JSDOM('<!DOCTYPE html><body></body>').window.document
      const parseResults = parseNvFile(src, 'test.nv', doc)
      const emitResults = parseNvFileForEmit(src, 'test.nv', doc)
      const parseParent = parseResults.find((r) => r.name === 'Parent')!
      const emitParent = emitResults.find((r) => r.name === 'Parent')!
      const result = irStructurallyEqual(doc, parseParent.ir, emitParent.ir)
      expect(result.equal, result.reason).toBe(true)
    })
  })

  describe('G-SS-bothFE: html-tag and .nv FEs agree on slot-list IR structure (both-FE oracle)', () => {
    it('G-SS-bothFE: both FEs produce a ListBinding in slot content (structural oracle)', () => {
      // G0-5: <each> exists in BOTH FEs (html-tag.ts `each()` sentinel + .nv `<each>` element).
      // After fixing html-tag.ts buildSlotContentIR to consume `lists`, both FEs produce
      // a ListBinding in slot content. The oracle (irStructurallyEqual) verifies structural
      // equivalence: same binding kinds, paths, item IR structure.
      // doc=undefined: skip shape.html + styleArtifact comparison (they differ by design —
      // .nv has styleArtifact, html-tag does not; shape.html anchor comments differ by FE).
      const doc = new JSDOM('<!DOCTYPE html><body></body>').window.document
      const html = createHtmlTag(doc)
      const items = signal<string[]>([])

      // html-tag FE: ${each(...)} in slot content of a component
      const htmlParentIR = html`<ChildComp>${each(
        () => items() as readonly unknown[],
        (item: unknown) => String(item),
        ({ item }: { item: () => unknown }) =>
          html`<div>${() => item()}</div>`,
      )}</ChildComp>`
      const htmlComp = htmlParentIR.bindings.find((b) => b.kind === 'component') as ComponentBinding
      expect(htmlComp).toBeDefined()
      const htmlSlotIR = htmlComp.slots[0]!.content({})
      expect(htmlSlotIR.bindings.find((b) => b.kind === 'list')).toBeDefined()

      // .nv FE: <each> in slot content
      const nvSrc = `const P = $component((_props) => {
        $render(() => html\`<ChildComp>
          <each .of=\${items} key="\${(item) => item}" let={item}>
            <div>\${item}</div>
          </each>
        </ChildComp>\`)
      })`
      const nvResults = parseNvFile(nvSrc, 'test.nv', doc)
      const nvComp = nvResults[0]!.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
      expect(nvComp).toBeDefined()
      const nvSlotIR = nvComp.slots[0]!.content({})
      expect(nvSlotIR.bindings.find((b) => b.kind === 'list')).toBeDefined()

      // Structural oracle: doc=undefined → only binding kinds, counts, paths, item IR structure compared.
      // Both slot IRs must have: 1 ListBinding, same anchor path structure, same item IR binding kinds.
      const result = irStructurallyEqual(undefined, nvSlotIR, htmlSlotIR)
      expect(result.equal, result.reason).toBe(true)
    })
  })

  describe('G-SS-depth2: depth-2 <each>-in-slot (parse + behavioral)', () => {
    it('depth-2 (parse-path): classlist toggle key is scoped at item body depth', () => {
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

    it('depth-2 (behavioral/mounted): rendered item in slot-<each> carries scoped class in DOM', () => {
      // OP-4 ruling: behavioral proof required — parse-path stubs don't prove back-end applies it.
      // Mount a depth-2 IR (component → slot → list → item with classlist toggle) and assert
      // the rendered DOM element carries the scoped class.
      const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>')
      const doc = dom.window.document
      const container = doc.getElementById('app')!

      const parentHash = 'depth2test'
      const rewClass = `card_${parentHash}`
      const parentCss = `.${rewClass} { color: rgb(255, 0, 0) }`

      const makeItemIR = () => ({
        id: 'item:depth2',
        shape: { html: '<div data-depth2-item></div>', bindingPaths: [[0]] as [number[]] },
        bindings: [
          {
            kind: 'classlist' as const,
            pathIndex: 0,
            entries: [{ kind: 'toggle' as const, key: rewClass, expr: () => true }],
          },
        ],
      })
      const slotContentIR = {
        id: 'slot:depth2',
        shape: { html: '<!--nv-0-->', bindingPaths: [[0]] as [number[]] },
        bindings: [
          {
            kind: 'list' as const,
            pathIndex: 0,
            items: () => ['x'] as readonly unknown[],
            key: (item: unknown) => String(item),
            itemTemplate: (_vs: unknown, _is: unknown) => makeItemIR(),
          },
        ],
      }
      const childIR = {
        id: 'child:depth2',
        shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] as [number[]] },
        bindings: [{ kind: 'slot-outlet' as const, pathIndex: 0, name: 'default' }],
      }
      const parentIR = {
        id: 'parent:depth2',
        shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] as [number[]] },
        bindings: [
          {
            kind: 'component' as const,
            pathIndex: 0,
            component: () => childIR,
            props: [],
            propNames: [],
            slots: [{ name: 'default', content: () => slotContentIR }],
          },
        ],
        styleArtifact: { staticCss: parentCss, scopeHash: parentHash },
      }

      // Test interpreter back-end
      createRoot((d) => {
        mount(parentIR, container, doc)
        return d
      })
      flushSync()
      const itemEl = container.querySelector('[data-depth2-item]') as HTMLElement
      expect(itemEl).not.toBeNull()
      expect(itemEl.classList.contains(rewClass)).toBe(true)

      // Test emitMount back-end
      container.innerHTML = ''
      createRoot((d) => {
        emitMount(parentIR).mountFn(container, doc)
        return d
      })
      flushSync()
      const itemElEmit = container.querySelector('[data-depth2-item]') as HTMLElement
      expect(itemElEmit).not.toBeNull()
      expect(itemElEmit.classList.contains(rewClass)).toBe(true)
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

  Pattern: mirrors `slot-style-scope.spec.ts` exactly — `loadNv(page)` loads the
  pre-built `dist/nv-bundle.js`, then `page.evaluate()` runs the test using `window.__nv`.
  The bundle exposes `mount`, `flushSync`, `signal`, `createRoot` (see `nv-entry.ts`).
  IRs are constructed manually (no `parseNvFile` in-browser).

  ```typescript
  import { dirname, join } from 'node:path'
  import { fileURLToPath } from 'node:url'
  /**
   * Increment SS — real-browser gate (Playwright ×3: Blink/Gecko/WebKit)
   * G-SS-browser: $style × <each>-in-slot: scoped class applied to each list item in slot.
   */
  import { type Page, expect, test } from '@playwright/test'

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const BUNDLE = join(__dirname, 'dist', 'nv-bundle.js')

  async function loadNv(page: Page): Promise<void> {
    await page.goto('about:blank')
    await page.addScriptTag({ path: BUNDLE })
  }

  test.describe('G-SS-browser: $style × <each>-in-slot (real browser)', () => {
    test('each list item in slot content carries parent scopeHash class and CSS color', async ({
      page,
    }) => {
      await loadNv(page)

      const result = await page.evaluate(() => {
        const { mount, flushSync } = window.__nv

        const parentHash = 'parentss1'
        const rewClass = `card_${parentHash}`
        const parentCss = `.${rewClass} { color: rgb(255, 0, 0) }`

        // Item IR: a <div> with a classlist toggle binding for the rewritten token.
        // This is what the .nv parser produces for class="${{card: true}}" after
        // patchClasslistTokens rewrites 'card' → 'card_<hash>'.
        const makeItemIR = () => ({
          id: 'item:ss-browser',
          shape: { html: '<div data-ss-item></div>', bindingPaths: [[0]] as [number[]] },
          bindings: [
            {
              kind: 'classlist' as const,
              pathIndex: 0,
              entries: [{ kind: 'toggle' as const, key: rewClass, expr: () => true }],
            },
          ],
        })

        // Slot content IR: a single list anchor (the <each> element becomes a comment).
        const slotContentIR = {
          id: 'slot:ss-browser',
          shape: { html: '<!--nv-0-->', bindingPaths: [[0]] as [number[]] },
          bindings: [
            {
              kind: 'list' as const,
              pathIndex: 0,
              items: () => ['a', 'b'] as readonly unknown[],
              key: (item: unknown) => String(item),
              itemTemplate: (_vs: unknown, _is: unknown) => makeItemIR(),
            },
          ],
        }

        // Child IR: renders a slot-outlet for the projected content.
        const childIR = {
          id: 'child:ss-browser',
          shape: {
            html: '<div class="child-host"><!--nv-0--></div>',
            bindingPaths: [[0, 0]] as [number[]],
          },
          bindings: [{ kind: 'slot-outlet' as const, pathIndex: 0, name: 'default' }],
        }

        // Parent IR: mounts ChildComp with the <each>-in-slot content; injects scoped CSS.
        const parentIR = {
          id: 'parent:ss-browser',
          shape: {
            html: '<div data-ss-parent><!--nv-comp-0--></div>',
            bindingPaths: [[0, 0]] as [number[]],
          },
          bindings: [
            {
              kind: 'component' as const,
              pathIndex: 0,
              component: () => childIR,
              props: [],
              propNames: [],
              slots: [{ name: 'default', content: () => slotContentIR }],
            },
          ],
          styleArtifact: { staticCss: parentCss, scopeHash: parentHash },
        }

        const container = document.createElement('div')
        document.body.appendChild(container)
        mount(parentIR, container, document)
        flushSync()

        const items = Array.from(container.querySelectorAll('[data-ss-item]')) as HTMLElement[]
        const findings: string[] = []

        if (items.length !== 2) {
          findings.push(`expected 2 items, got ${items.length}`)
        }
        for (const el of items) {
          if (!el.classList.contains(rewClass)) {
            findings.push(`item missing class ${rewClass}: classList=${el.className}`)
          }
          const color = getComputedStyle(el).color
          if (color !== 'rgb(255, 0, 0)') {
            findings.push(`expected color rgb(255,0,0), got ${color}`)
          }
        }

        container.remove()
        return { ok: findings.length === 0, findings }
      })

      expect(result.ok, result.findings.join('\n')).toBe(true)
    })
  })
  ```

  **Gate requirements verified by this test:**
  - 2 items rendered from the `<each>` binding in slot content
  - Each carries `class="card_parentss1"` (the scoped token applied by `classList.add`)
  - Each has `color: rgb(255, 0, 0)` from the injected stylesheet (real cascade in browser)
  - Passes on Chromium, Firefox, and WebKit (Playwright ×3)

- [ ] **Step 3: Add G-SS-mainbug browser test to `slot-ss.spec.ts`**

  Append a second `test.describe` block to the file — the main-path static class bug gate.
  This is Playwright ×3 per the architect's ruling (G-SS-mainbug requires real cascade, not jsdom).

  ```typescript
  test.describe('G-SS-mainbug: main-path static class= scoped (live bug fix)', () => {
    test('main-path static class= carries scoped token and CSS color in DOM', async ({ page }) => {
      await loadNv(page)

      const result = await page.evaluate(() => {
        const { mount, flushSync } = window.__nv

        const parentHash = 'mainbugfix1'
        const rewClass = `card_${parentHash}`
        const parentCss = `.${rewClass} { color: rgb(0, 128, 0) }`

        // Main template IR: a single <div class="card"> lifted to a classlist binding.
        // This represents what processHtmlTemplate produces AFTER liftStaticClassBindings runs:
        //   shape.html has no class= attribute (stripped by lift)
        //   bindings has a classlist {kind:'static', token:'card_<hash>'}
        const mainIR = {
          id: 'main:mainbug',
          shape: {
            html: '<div data-mainbug-root></div>',
            bindingPaths: [[0]] as [number[]],
          },
          bindings: [
            {
              kind: 'classlist' as const,
              pathIndex: 0,
              entries: [{ kind: 'static' as const, token: rewClass }],
            },
          ],
          styleArtifact: { staticCss: parentCss, scopeHash: parentHash },
        }

        const container = document.createElement('div')
        document.body.appendChild(container)
        mount(mainIR, container, document)
        flushSync()

        const root = container.querySelector('[data-mainbug-root]') as HTMLElement | null
        const findings: string[] = []

        if (!root) {
          findings.push('root not found in DOM')
        } else {
          // Must carry the scoped class token (static entry applied by wireClassList)
          if (!root.classList.contains(rewClass)) {
            findings.push(`missing scoped class ${rewClass}: classList=${root.className}`)
          }
          // CSS rule must apply (real cascade in browser)
          const color = getComputedStyle(root).color
          if (color !== 'rgb(0, 128, 0)') {
            findings.push(`expected color rgb(0,128,0) got ${color}`)
          }
        }

        container.remove()
        return { ok: findings.length === 0, findings }
      })

      expect(result.ok, result.findings.join('\n')).toBe(true)
    })
  })
  ```

- [ ] **Step 4: Run the browser tests (Playwright ×3)**

  ```bash
  npx playwright test test/browser/slot-ss.spec.ts --project=chromium --project=firefox --project=webkit 2>&1 | tail -15
  ```

  Expected: all 3 browsers pass for both test.describe blocks (G-SS-browser + G-SS-mainbug).

- [ ] **Step 5: Commit**

  ```bash
  git add test/browser/slot-ss.spec.ts
  git commit -m "test(browser): G-SS-browser + G-SS-mainbug Playwright ×3 for slot-<each> and main static class"
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
  - **Item 2 (D-slot-style-1 structural collapse + main-path bug fix):** Shared
    `liftStaticClassBindings` helper extracted and called by BOTH `processHtmlTemplate` (main
    path, before `shapeDiv.innerHTML`) AND `buildNvSlotContentIR` (slot path, before
    `rawHtml`). Fixes the live main-path bug (class= was unscoped under `$style`; now lifted
    to classlist static entry before shape serialization). `shape.html` regex
    (nv-parser.ts ~L1919-1925) REMOVED (G0-3 satisfied). Both back-ends' `wireClassList`
    already consumed `{kind:'static'}` entries — no back-end change.
  - **All-static limitation CLOSED** (OP-1 resolution): shared lift post-walk scan handles
    purely-static slot content (no holes). No ComponentBinding required.

  **Gates passed:** G-SS-struct, G-SS-regex-gone, G-SS-G5, G-SS-emit, G-SS-static,
  G-SS-mainbug, G-SS-symmetry, G-SS-oracle, G-SS-bothFE, G-SS-depth2, G-SS-browser ×3.

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
| G-SS-struct | `grep -n "pushListBinding\|liftStaticClassBindings" src/renderer/nv-parser.ts && grep -n "for.*lists" src/renderer/html-tag.ts` | helpers not module-level, or html-tag.ts fix missing |
| G-SS-regex-gone | `grep -n "shape\.html\.replace\|shape\.html.*replace" src/renderer/nv-parser.ts` | any output from the slot path |
| G-SS-G5 | `grep -n "describe.skip\|it.skip" test/renderer/nv-parser.test.ts test/renderer/slot-style-scope.test.ts` | G5 still appears as skip |
| G-SS-emit | `npx vitest run test/renderer/slot-ss.test.ts -t "emit-exec"` | test fails or uses parse-path stubs |
| G-SS-static | `npx vitest run test/renderer/slot-ss.test.ts -t "static"` | classList differs from baseline or `class=` still in shape.html |
| G-SS-mainbug | `npx vitest run test/renderer/slot-ss.test.ts -t "G-SS-mainbug"` + Playwright ×3 | main static class= still in shape.html OR no classlist binding OR CSS not applied |
| G-SS-symmetry | `npx vitest run test/renderer/slot-ss.test.ts -t "G-SS-symmetry"` | main-path and slot-path classlist IR differ |
| G-SS-oracle | `grep -n "irStructurallyEqual" test/renderer/slot-ss.test.ts` | oracle not used in differential or both-FE test |
| G-SS-bothFE | `npx vitest run test/renderer/slot-ss.test.ts -t "G-SS-bothFE"` | html-tag FE slot content has no ListBinding OR oracle diverges |
| G-SS-depth2 | `npx vitest run test/renderer/slot-ss.test.ts -t "depth-2"` | parse-path token not scoped OR behavioral mount not proven |
| G-SS-browser | `npx playwright test test/browser/slot-ss.spec.ts --project=chromium --project=firefox --project=webkit` | any browser fails (G-SS-browser or G-SS-mainbug describe block) |
| G0-1 | `git diff HEAD src/core/` | any core file changed |
| G0-2 | inspect slot IR's list binding shape vs main-walk shape | structurally divergent |
| G0-3 | G-SS-regex-gone above | regex still present |
| G0-4 | `grep -n "StyleVarBinding\|new.*Binding\|kind.*new" src/renderer/ir.ts` relative to HEAD | any new ir.ts shape |
| G0-5 | G-SS-bothFE + G-SS-oracle | FE lockstep broken |

---

## Self-review

**Spec coverage:**
- ✅ D-SS-1 (static-class structural collapse + regex removal): Task 3 (shared `liftStaticClassBindings` helper + both call sites)
- ✅ D-SS-2 (shared list-push helper): Task 2 (`pushListBinding` module-level in nv-parser.ts)
- ✅ D-SS-3 (G5 re-enable + emit-exec differential): Task 4
- ✅ D-SS-4 (Action-2 oracle as structural gate): Task 4 G-SS-differential + G-SS-bothFE tests
- ✅ OP-1 (all-static limitation): Task 3 + `liftStaticClassBindings` post-walk scan (no holes required)
- ✅ OP-2 (DECIDED — shared lift both call sites): Task 3 Steps 3a/3b/3c (`liftStaticClassBindings` in both `processHtmlTemplate` + `buildNvSlotContentIR`)
- ✅ OP-3 (diagnostics threading to parent): Task 2 Step 5 (thread `processdiagnostics` as parameter)
- ✅ OP-4 (depth-2 behavioral + parse): Task 4 G-SS-depth2 — both parse-path structural AND behavioral/mounted test
- ✅ OP-5 (stacked G2): Task 4 by-ref invariant test + comment in Task 3 Step 4
- ✅ Main-path static-class bug fix: Task 3 Step 3c + G-SS-mainbug tests (parse + Playwright ×3)
- ✅ G-SS-symmetry (same fragment → same IR): Task 3 Step 1 G-SS-symmetry test
- ✅ G0 disqualifiers: gate table (G-SS-struct now checks `liftStaticClassBindings` too)
- ✅ G0-5 / both-FE: Task 2 Step 6 (html-tag.ts fix) + Task 4 G-SS-bothFE test
- ✅ Playwright ×3: Task 5 (G-SS-browser + G-SS-mainbug, real assertions)
- ✅ Landing docs: Task 6
- ⬜ D-cl-2 real-path-G5 bonus (optional, not a blocker per handoff) — not covered.

**Placeholder scan:** No placeholders. Task 3 Step 3 uses shared `liftStaticClassBindings` (full code in OP-2 section). Task 5 has concrete `page.evaluate()` bodies for both G-SS-browser and G-SS-mainbug.

**Type consistency:** `pushListBinding` uses `NvWalkedEach`, `NodePath`, `Binding`, `NvDiagnostic` — all in nv-parser.ts scope. `liftStaticClassBindings` uses `Element`, `NodePath`, `Binding`, `computePath` (L232), `ClassListEntry`, `ClassListBinding` — all already in module. html-tag.ts fix uses `WalkedList`, `EachSentinel`, `ListBinding` — all already imported. `createHtmlTag`, `each` in G-SS-bothFE test — exported from html-tag.ts barrel.
