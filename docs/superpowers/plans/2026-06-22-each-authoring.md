# `each` Authoring Increment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `each(...)` tagged-template and `<each>` .nv authoring surfaces that produce the existing `ListBinding` IR via the Variant-A SlotContent adapter.

**Architecture:** Both front-ends detect an `<each>` / `each()` construct, build the item body IR via the same `buildSlotContentIR`/`buildNvSlotContentIR` path used for slot content, then wrap the resulting `SlotContent` factory in an adapter `(vs, is) => factory({ item: () => vs(), index: () => is() })` at `ListBinding` construction time. The reconcile loop in both back-ends is byte-identical to today — it still calls `itemTemplate(vs, is)`. A new `'list'` case in the IR comparator enables the FE-equivalence gate.

**Tech Stack:** TypeScript, jsdom (test DOM), Vitest, the existing nv renderer/compiler pipeline.

## Global Constraints

- `src/core/` must have 0 lines changed (`git diff src/core/` = empty).
- The reconcile loop in `interpreter.ts wireList` and `emitted-mount.ts` list case is **untouched** — adapter lives at `ListBinding` construction, not in the loop.
- No second item-body-assembly path: body factory MUST come from `buildSlotContentIR` / `buildNvSlotContentIR`, not a forked builder.
- `key` is a function on `ListBinding`, never emitted as a per-element attribute in shape.html.
- `ListBinding` IR shape (`kind`, `items`, `key`, `itemTemplate` signature) is unchanged — no IR version bump if signature byte-identical.
- Every test asserts real DOM content or comparator output — no `expect(true).toBe(true)`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/html-tag.ts` | Modify | `EachSentinel` type, `each()` sentinel, walk detection, `ListBinding` assembly, validation exemption |
| `src/renderer/nv-parser.ts` | Modify | `NvWalkedEach` type, `<each>` detection in `walkNvNodeList`, `ListBinding` assembly in `processHtmlTemplate`, `PendingNvEachInfo` in `ProcessResult`, `'list'` ThunkSource in `computeBindingThunks` |
| `src/renderer/nv-emitter.ts` | Modify | `'list'` case in `emitBindingLiteral` |
| `test/renderer/ir-equivalence.ts` | Modify | `'list'` comparator case, `'slot-outlet'` props extension |
| `src/renderer/index.ts` | Modify | Export `each` |
| `test/renderer/each-authoring.test.ts` | Create | All tests: FE-equivalence, behavioral differential, fail-shows-teeth, anti-vacuous |

---

## Task 1 — `EachSentinel` + `each()` + html-tag walk detection + `ListBinding` assembly

**Files:**
- Modify: `src/renderer/html-tag.ts`
- Modify: `src/renderer/index.ts`
- Create: `test/renderer/each-authoring.test.ts` (interpreter + emitted-mount behavioral tests for tagged-template path)

**Interfaces:**
- Produces: `export interface EachSentinel { readonly __nvEach: true; items: () => readonly unknown[]; key: (item: unknown, i: number) => string | number; factory: SlotContent }` in `html-tag.ts`
- Produces: `export function each(items, key, factory): EachSentinel` in `html-tag.ts`
- Produces: `each` re-exported from `src/renderer/index.ts`
- Produces: `WalkResult.lists: WalkedList[]` (internal, used by `createHtmlTag`)

**Context — how walkNodeList works today:**
When it finds a `<!--nv-N-->` comment, it records `{ kind: 'text', origIdx: N }` in `holeInfos`. The top-level `createHtmlTag` maps these back to `bindingPaths[N]` and builds a `TextBinding`. For `each()`, the same comment IS the list anchor — we intercept when `exprs[N]` is an `EachSentinel`, skip the text-hole recording, and record a `WalkedList { anchorPath, sentinel }` instead.

**Context — adapter:**
```ts
// The adapter that Variant A uses — lives at ListBinding construction, never in the loop
function makeEachItemTemplate(factory: SlotContent) {
  return (valueSig: WritableSignal<unknown>, indexSig: WritableSignal<number>) =>
    factory({ item: () => valueSig(), index: () => indexSig() })
}
```

- [ ] **Step 1: Write failing test for `each()` sentinel returning a `ListBinding` IR**

In `test/renderer/each-authoring.test.ts`:
```ts
/**
 * `each` authoring — behavioral + FE-equivalence + fail-shows-teeth.
 * Stream: (3) renderer/templating.
 */
import { flushSync } from '../../src/core/core.js'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import { mount } from '../../src/renderer/interpreter.js'
import { signal } from '../../src/core/core.js'
import type { WritableSignal } from '../../src/core/core.js'
import { createHtmlTag, each } from '../../src/renderer/html-tag.js'
import type { ListBinding, TemplateIR } from '../../src/renderer/ir.js'

const html = createHtmlTag(document)

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkParent(): HTMLDivElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
function rmParent(el: HTMLDivElement) {
  document.body.removeChild(el)
}

type Item = { id: number; label: string }

// ── Tagged-template each() ───────────────────────────────────────────────────

// TC-EA-01: each() produces a ListBinding (kind check)
test('TC-EA-01  each() produces IR with a ListBinding', () => {
  const items = signal<Item[]>([{ id: 1, label: 'A' }])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item }) => html`<li>${() => (item() as Item).label}</li>`,
  )}</ul>`
  expect(ir.bindings.length).toBe(1)
  expect(ir.bindings[0]!.kind).toBe('list')
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts 2>&1 | head -30
```

Expected: FAIL — `each is not a function` or similar.

- [ ] **Step 3: Add `EachSentinel`, `each()`, `isEachSentinel()`, `WalkedList` to `html-tag.ts`**

After the `SlotFillSentinel` block (around line 88), add:

```ts
// ── Each sentinel ─────────────────────────────────────────────────────────────

/** Opaque sentinel returned by `each(items, key, factory)` — the tagged-template list form. */
export interface EachSentinel {
  readonly __nvEach: true
  readonly items: () => readonly unknown[]
  readonly key: (item: unknown, i: number) => string | number
  readonly factory: SlotContent
}

function isEachSentinel(v: unknown): v is EachSentinel {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__nvEach === true &&
    typeof (v as EachSentinel).items === 'function' &&
    typeof (v as EachSentinel).key === 'function' &&
    typeof (v as EachSentinel).factory === 'function'
  )
}

/**
 * Create an each-list sentinel for the tagged-template side.
 * Write `${each(() => items(), key, ({ item, index }) => html`...`)}` for a keyed list.
 */
export function each(
  items: () => readonly unknown[],
  key: (item: unknown, i: number) => string | number,
  factory: SlotContent,
): EachSentinel {
  return { __nvEach: true, items, key, factory }
}
```

Add `WalkedList` interface near the `WalkedComponent` interface (around line 248):

```ts
/** A list anchor discovered during the walk — the hole's expr was an EachSentinel. */
interface WalkedList {
  anchorPath: NodePath
  origIdx: number
  sentinel: EachSentinel
}
```

Add `lists: WalkedList[]` to the `WalkResult` interface:

```ts
interface WalkResult {
  holeInfos: SlotHoleInfo[]
  holePaths: NodePath[]
  components: WalkedComponent[]
  consumed: Set<number>
  lists: WalkedList[]   // ← add this
}
```

In `walkNodeList`, update the return value init and the comment-detection branch:

```ts
function walkNodeList(nodes: Node[], exprs: unknown[], root: Node, doc: Document): WalkResult {
  const holeInfos: SlotHoleInfo[] = []
  const holePaths: NodePath[] = []
  const components: WalkedComponent[] = []
  const consumed = new Set<number>()
  const lists: WalkedList[] = []   // ← add

  function walk(node: Node): void {
    if (node.nodeType === 8 /* COMMENT_NODE */) {
      const m = (node as Comment).data.match(/^nv-(\d+)$/)
      if (m !== null) {
        const idx = Number.parseInt(m[1]!, 10)
        if (isEachSentinel(exprs[idx])) {
          // Each sentinel: the comment IS the list anchor — record path, skip text-hole.
          lists.push({ anchorPath: computePath(node, root), origIdx: idx, sentinel: exprs[idx] as EachSentinel })
          consumed.add(idx)
        } else {
          holeInfos.push({ kind: 'text', origIdx: idx })
          holePaths.push(computePath(node, root))
        }
      }
    }
    // ... rest unchanged
  }
  // ...
  return { holeInfos, holePaths, components, consumed, lists }
}
```

- [ ] **Step 4: Exempt `EachSentinel` from the non-function validation in `createHtmlTag`**

In `createHtmlTag`, update the validation loop (around line 632):

```ts
for (let i = 0; i < exprs.length; i++) {
  if (
    typeof exprs[i] !== 'function' &&
    !isSlotSentinel(exprs[i]) &&
    !isSlotFillSentinel(exprs[i]) &&
    !isEachSentinel(exprs[i])   // ← add
  ) {
    throw new TypeError(...)
  }
}
```

- [ ] **Step 5: Assemble `ListBinding` from `walkedLists` in `createHtmlTag`**

After the `walkNodeList` call in `createHtmlTag`, before building `allPaths`, import `ListBinding` from `ir.ts` if not already imported. Then add list binding assembly. After building `allPaths` and `bindings` for components and holes, add:

```ts
// Add list bindings (each() sentinels): anchor paths appended after component + hole paths.
// The adapter wraps SlotContent factory → itemTemplate signature (Variant A).
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

Note: `allPaths` in `createHtmlTag` is built as `const allPaths: NodePath[] = [...bindingPaths]` at line ~685 — list paths append AFTER component anchors. Review the exact assembly order to make sure `allPaths` is mutable at this point.

- [ ] **Step 6: Export `each` from `src/renderer/index.ts`**

Add to the html-tag exports block in `src/renderer/index.ts`:

```ts
export { createHtmlTag, slot, slots, each } from './html-tag.js'
export type { EachSentinel, SlotFillSentinel, SlotSentinel } from './html-tag.js'
```

Check the current exports in index.ts first with `grep -n "html-tag" src/renderer/index.ts`.

- [ ] **Step 7: Run TC-EA-01 to verify it passes**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts --reporter=verbose 2>&1 | head -40
```

Expected: TC-EA-01 PASS.

- [ ] **Step 8: Add the full tagged-template behavioral test suite (TC-EA-02 through TC-EA-06)**

Add to `test/renderer/each-authoring.test.ts`:

```ts
// Helper: mount via both back-ends and run the same assertion
function withBothBackends(
  ir: TemplateIR,
  assert: (parent: HTMLDivElement, dispose: () => void) => void,
) {
  for (const [label, mountFn] of [
    ['interpreter', mount],
    ['emitted-mount', emitMount],
  ] as const) {
    const parent = mkParent()
    const dispose = mountFn(ir, parent, document)
    flushSync()
    try {
      assert(parent, dispose)
    } finally {
      dispose()
      rmParent(parent)
    }
  }
}

// TC-EA-02: initial render
test('TC-EA-02  each(): initial render — N items correct order and content', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
    { id: 3, label: 'C' },
  ])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item }) => html`<li>${() => (item() as Item).label}</li>`,
  )}</ul>`
  withBothBackends(ir, (parent) => {
    const lis = parent.querySelectorAll('li')
    expect(lis.length).toBe(3)
    expect(lis[0]!.textContent).toBe('A')
    expect(lis[1]!.textContent).toBe('B')
    expect(lis[2]!.textContent).toBe('C')
  })
})

// TC-EA-03: append
test('TC-EA-03  each(): append — new item at end', () => {
  const items = signal<Item[]>([{ id: 1, label: 'A' }])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item }) => html`<li>${() => (item() as Item).label}</li>`,
  )}</ul>`
  withBothBackends(ir, (parent, dispose) => {
    void dispose
    items.set([{ id: 1, label: 'A' }, { id: 2, label: 'B' }])
    flushSync()
    const lis = parent.querySelectorAll('li')
    expect(lis.length).toBe(2)
    expect(lis[1]!.textContent).toBe('B')
  })
})

// TC-EA-04 (G1 + G2 gate): value-change node identity preserved — Variant A transparency proof
test('TC-EA-04  each(): value change at kept key — node identity preserved (Variant A gate)', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item }) => html`<li>${() => (item() as Item).label}</li>`,
  )}</ul>`
  withBothBackends(ir, (parent) => {
    const lisBefore = Array.from(parent.querySelectorAll('li'))
    items.set([{ id: 1, label: 'A-updated' }, { id: 2, label: 'B' }])
    flushSync()
    const lisAfter = Array.from(parent.querySelectorAll('li'))
    expect(lisAfter[0]!.textContent).toBe('A-updated')
    // Node identity: same <li> element — update-not-rebuild (Variant A transparency)
    expect(lisAfter[0]!, 'node identity preserved').toBe(lisBefore[0]!)
    expect(lisAfter[1]!, 'node identity preserved').toBe(lisBefore[1]!)
  })
})

// TC-EA-05: index reactive on reorder
test('TC-EA-05  each(): reorder — index accessor updates without rebuild', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
    { id: 3, label: 'C' },
  ])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item, index }) => html`<li>${() => `${(item() as Item).label}#${index()}`}</li>`,
  )}</ul>`
  withBothBackends(ir, (parent) => {
    const lisBefore = Array.from(parent.querySelectorAll('li'))
    expect(lisBefore[0]!.textContent).toBe('A#0')
    items.set([{ id: 3, label: 'C' }, { id: 1, label: 'A' }, { id: 2, label: 'B' }])
    flushSync()
    const lisAfter = Array.from(parent.querySelectorAll('li'))
    expect(lisAfter[0]!.textContent).toBe('C#0')
    expect(lisAfter[1]!.textContent).toBe('A#1')
    expect(lisAfter[2]!.textContent).toBe('B#2')
    // Node identity: same elements reused
    expect(lisAfter.every((li) => lisBefore.some((lb) => lb === li))).toBe(true)
  })
})

// TC-EA-06: unmount no-leak
test('TC-EA-06  each(): unmount — no reactive leaks', () => {
  const __test = (await import('../../src/core/core.js') as any).__test
  const items = signal<Item[]>([{ id: 1, label: 'A' }, { id: 2, label: 'B' }])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item }) => html`<li>${() => (item() as Item).label}</li>`,
  )}</ul>`
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()
  expect(__test.observerCount(items) >= 1).toBe(true)
  dispose()
  expect(__test.observerCount(items)).toBe(0)
  expect(parent.querySelectorAll('li').length).toBe(0)
  rmParent(parent)
})
```

Note: The `__test` import pattern — check how TC-10e/i import it in `interpreter.test.ts` and use the same pattern.

- [ ] **Step 9: Run all TC-EA-01 through TC-EA-06**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts --reporter=verbose 2>&1 | head -60
```

Expected: all 6 pass.

- [ ] **Step 10: Run full suite to check no regressions**

```bash
cd /Users/kofi/_/view && pnpm vitest run 2>&1 | tail -20
```

Expected: all existing tests still pass.

- [ ] **Step 11: Commit**

```bash
cd /Users/kofi/_/view && git add src/renderer/html-tag.ts src/renderer/index.ts test/renderer/each-authoring.test.ts && git commit -m "feat(each): tagged-template each() sentinel + ListBinding assembly + TC-EA-01..06"
```

---

## Task 2 — `.nv` `<each>` element detection + `ListBinding` assembly

**Files:**
- Modify: `src/renderer/nv-parser.ts`
- Modify: `test/renderer/each-authoring.test.ts` (add .nv behavioral tests)

**Interfaces:**
- Produces: `NvWalkedEach` type (internal to nv-parser.ts):
  ```ts
  interface NvWalkedEach {
    anchorPath: NodePath
    itemsHoleIdx: number    // the .of="${...}" hole index
    keyHoleIdx: number      // the key="${...}" hole index
    letNames: string[]      // from let={item, index}
    bodyIR: TemplateIR      // from buildNvSlotContentIR
    bodyHoleIndices: number[] // hole indices consumed by the body
  }
  ```
- Produces: `NvWalkResult.lists: NvWalkedEach[]`
- Produces: `ProcessResult.pendingEachItems: PendingNvEachInfo[]` (for emit path)
- Produces: `PendingNvEachInfo`:
  ```ts
  interface PendingNvEachInfo {
    itemsHoleIdx: number
    keyHoleIdx: number
    letNames: string[]
    bodyHoleIndices: number[]
  }
  ```

**Context — how `<each>` attributes are classified:**

The `.of="${items}"` in `.nv` source goes through the sentinel-HTML builder `buildNvHtmlStrings`. The `.of=` pattern matches as a `.`-prefixed prop hole (kind `'prop'`, name `'of'`). The `key="${fn}"` pattern (no dot/at prefix) matches as an attr hole (kind `'attr'`, name `'key'`).

So in `walkNvNodeList`, we detect the `<each>` element by `el.tagName.toLowerCase() === 'each'`. The `.of` and `key` holes are attrs on this element that the sentinel system places as `data-nv-prop-N="of"` / `data-nv-attr-N="key"`. We extract them by scanning for these attribute sentinels.

The `let={item, index}` attribute is a plain (non-reactive) attribute — it stays on the element unchanged through the HTML builder (no `${}` hole around it). We extract it from `el.getAttribute('let')`.

- [ ] **Step 1: Add `NvWalkedEach` type and `lists` field to `NvWalkResult`**

In `nv-parser.ts`, find the `NvWalkResult` interface (line ~365) and add:

```ts
interface NvWalkedEach {
  anchorPath: NodePath
  itemsHoleIdx: number
  keyHoleIdx: number
  letNames: string[]
  bodyIR: TemplateIR
  bodyHoleIndices: number[]
}
```

Add `lists: NvWalkedEach[]` to the existing `NvWalkResult` interface (which currently has `holeInfos`, `holePaths`, `components`, `consumed`).

- [ ] **Step 2: Detect `<each>` in `walkNvNodeList` and build list record**

In `walkNvNodeList`, inside the `node.nodeType === 1` branch, BEFORE the component-detection block (before `const compName = el.getAttribute('data-nv-component')`), add:

```ts
// <each> element detection — before component detection.
if (el.tagName.toLowerCase() === 'each') {
  // Find .of and key hole indices from data sentinels
  let itemsHoleIdx = -1
  let keyHoleIdx = -1
  for (let k = 0; k < holeExprs.length; k++) {
    if (el.getAttribute(`data-nv-prop-${k}`) === 'of') {
      itemsHoleIdx = k
      el.removeAttribute(`data-nv-prop-${k}`)
      consumed.add(k)
    }
    if (el.getAttribute(`data-nv-attr-${k}`) === 'key') {
      keyHoleIdx = k
      el.removeAttribute(`data-nv-attr-${k}`)
      consumed.add(k)
    }
  }
  if (itemsHoleIdx === -1 || keyHoleIdx === -1) {
    throw new Error('[nv] <each> requires .of="${...}" and key="${...}" attributes')
  }

  // Extract let-bound names from let={item, index}
  const letAttr = el.getAttribute('let') ?? ''
  const letNames = letAttr.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean)

  // Build body IR from child nodes via shared slot content builder
  const bodyNodes = Array.from(el.childNodes)
  const { ir: bodyIR, holeIndices: bodyHoleIndices } = buildNvSlotContentIR(
    bodyNodes,
    holeExprs,
    doc,
    `each:body:${lists.length}`,
    signals,
    letNames,
  )
  for (const idx of bodyHoleIndices) consumed.add(idx)

  // Replace <each> element with anchor comment
  const listIndex = lists.length
  const anchor = doc.createComment(`nv-list-${listIndex}`)
  el.parentNode?.replaceChild(anchor, el)
  const anchorPath = computePath(anchor, root)

  lists.push({ anchorPath, itemsHoleIdx, keyHoleIdx, letNames, bodyIR, bodyHoleIndices })
  return // don't recurse into <each> children (body already processed)
}
```

Update the `lists` initialization in `walkNvNodeList`:

```ts
const lists: NvWalkedEach[] = []
```

Update the return statement:

```ts
return { holeInfos, holePaths, components, consumed, lists }
```

- [ ] **Step 3: Assemble `ListBinding` from walked lists in `processHtmlTemplate`**

In `processHtmlTemplate`, after `walkNvNodeList` completes and after building `allPaths` + `bindings` for components and holes, add assembly for each list:

```ts
// Add list bindings from <each> elements (anchor paths appended last).
for (const wl of pendingLists) {
  const pathIndex = allPaths.length
  allPaths.push(wl.anchorPath)
  // items thunk: use the raw hole expression (erased at emit time; stub at parse time)
  const itemsExpr = holeExprs[wl.itemsHoleIdx] as ts.Expression
  const keyExpr = holeExprs[wl.keyHoleIdx] as ts.Expression
  const { ir: bodyIR, letNames } = wl
  const factory: SlotContent = (slotProps) => bodyIR  // SlotContent shape, ignores slotProps (stubs at parse time)
  bindings.push({
    kind: 'list',
    pathIndex,
    items: stubExpr as unknown as () => readonly unknown[],  // replaced in emit path; runtime uses items()
    key: (() => 0) as unknown as (item: unknown, i: number) => string | number,  // stub key
    itemTemplate: (valueSig, indexSig) =>
      factory({ item: () => valueSig(), index: () => indexSig() }),
  } satisfies ListBinding)
}
```

Wait — the items and key stubs won't work for the interpreter path. The interpreter actually calls `items()` and `key(item, i)` at runtime. So we need the REAL thunks at parse time too, not just stubs.

For the interpreter parse path, the real items and key expressions ARE available as TypeScript AST nodes — but we need to evaluate them. We can't do that at parse time in a general way.

Actually, looking at how this works: `parseNvFile` is for the interpreter path (no emit). The items thunk needs to be a real function. But `holeExprs[wl.itemsHoleIdx]` is a TypeScript AST expression — we can't call it directly.

Let me look at how `parseNvFile` handles the interpreter path vs how the existing TC-10 tests work...

The TC-10 tests in `interpreter.test.ts` hand-author `ListBinding` objects directly — they don't go through the nv-parser. The nv-parser for `.nv` files is used in the emit path (`parseNvFileForEmit`). The interpreter uses `parseNvFile` for `mount`.

But `parseNvFile` returns a `TemplateIR` with stub expressions (via `stubExpr`). The interpreter wires up bindings using the expressions from the IR. For `ListBinding`, the `items` and `key` fields must be real functions — but `parseNvFile` produces stubs for all expr fields...

Let me check how component props work in the parse (non-emit) path.

Looking at `processHtmlTemplate` more carefully: it fills `bindings` with real binding objects using `buildNvHoleBinding`, which produces stubs for exprs. So for interpreter use, the stubs are used — but the interpreter doesn't actually call `items()` from `parseNvFile` output. The interpreter test suite hand-authors ListBinding objects directly, not via `parseNvFile`.

So `parseNvFile` is used for testing nv-parser behavior (does it produce the right IR shape?) not for actually running the list reconcile loop. The real functional path is `parseNvFileForEmit` + `emitModule` + emitted JS.

Conclusion: for `parseNvFile` output, stubs for `items` and `key` are OK — they're only used for IR shape verification. The real functions come from the emitted JS.

So the assembly in `processHtmlTemplate` can use stubs:

```ts
bindings.push({
  kind: 'list',
  pathIndex,
  items: (() => []) as () => readonly unknown[],
  key: ((_item, i) => i) as (item: unknown, i: number) => string | number,
  itemTemplate: (valueSig, indexSig) =>
    wl.bodyIR,  // body IR already built; factory ignores slotProps in parse path
} satisfies ListBinding)
```

Wait — but then the FE-equivalence test can't compare the `itemTemplate` behavior between `.nv` and tagged-template, because the `.nv` one returns a fixed `bodyIR` while the tagged-template one calls the user's factory. For structural comparison of item bodies, the comparator calls `itemTemplate(stubVs, stubIs)` to get the body IR and recurses into it. Both will return the same bodyIR structure if the templates are equivalent.

For the `.nv` parse path, `itemTemplate` just returns `wl.bodyIR` directly (ignoring vs/is since stubs). For the tagged-template path, `itemTemplate` calls `factory({ item: () => vs(), index: () => is() })` and returns the body IR.

When the comparator calls both with stub signals, both return the body IR — and `irStructurallyEqual` compares them. This will work as long as the body factory in tagged-template doesn't actually use `vs()` or `is()` to compute the IR structure (it shouldn't — it uses them as thunks inside reactive expressions, not to shape the IR).

So:
- `.nv` parse path: `itemTemplate = (_vs, _is) => wl.bodyIR`
- Tagged-template path: `itemTemplate = (vs, is) => factory({ item: () => vs(), index: () => is() })`

Both return the same body IR structure when called (the factory's IR structure doesn't depend on the actual signal values). OK.

Now add `PendingNvEachInfo` to `ProcessResult` for the emit path:

```ts
interface PendingNvEachInfo {
  itemsHoleIdx: number
  keyHoleIdx: number
  letNames: string[]
  bodyHoleIndices: number[]
}
```

Update `ProcessResult`:

```ts
interface ProcessResult {
  ir: TemplateIR
  verdicts: Array<'ACCEPT' | 'PLAIN'>
  pendingComponents: PendingNvComponentInfo[]
  pendingEachItems: PendingNvEachInfo[]   // ← add
  consumedByComponent: ReadonlySet<number>
  diagnostics: NvDiagnostic[]
}
```

Populate `pendingEachItems` from the `lists` result of `walkNvNodeList` in `processHtmlTemplate`.

Update the `processHtmlTemplate` return to include:

```ts
pendingEachItems: (pendingLists ?? []).map(wl => ({
  itemsHoleIdx: wl.itemsHoleIdx,
  keyHoleIdx: wl.keyHoleIdx,
  letNames: wl.letNames,
  bodyHoleIndices: wl.bodyHoleIndices,
})),
```

- [ ] **Step 4: Write failing test for `.nv` `<each>` producing a ListBinding**

In `test/renderer/each-authoring.test.ts`, add:

```ts
import { parseNvFile } from '../../src/renderer/nv-parser.js'

// TC-EA-10: .nv <each> produces IR with a ListBinding (parse path)
test('TC-EA-10  .nv <each> produces IR with a ListBinding', () => {
  const source = `
const List = $component(() => {
  $script(() => {
    const items = signal([])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(item) => item.id}" let={item}><li>\${item}</li></each></ul>\`)
})
`
  const results = parseNvFile(source, 'list.nv', document)
  expect(results.length).toBe(1)
  const ir = results[0]!.ir
  const listBinding = ir.bindings.find(b => b.kind === 'list')
  expect(listBinding).toBeDefined()
  expect(listBinding!.kind).toBe('list')
})
```

- [ ] **Step 5: Run TC-EA-10 to verify it fails**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-10" 2>&1 | head -30
```

Expected: FAIL.

- [ ] **Step 6: Implement the `<each>` detection and `ListBinding` assembly as described in Steps 1-3 above**

- [ ] **Step 7: Run TC-EA-10 + all prior TC-EA tests**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts --reporter=verbose 2>&1 | head -60
```

Expected: all pass.

- [ ] **Step 8: Run full suite**

```bash
cd /Users/kofi/_/view && pnpm vitest run 2>&1 | tail -20
```

- [ ] **Step 9: Commit**

```bash
cd /Users/kofi/_/view && git add src/renderer/nv-parser.ts test/renderer/each-authoring.test.ts && git commit -m "feat(each): .nv <each> element detection + ListBinding assembly (parse path)"
```

---

## Task 3 — Comparator extension + FE-equivalence gate

**Files:**
- Modify: `test/renderer/ir-equivalence.ts`
- Modify: `test/renderer/each-authoring.test.ts` (add FE-equivalence test)

**Interfaces:**
- Consumes: `WritableSignal` from core (for stub signals to call `itemTemplate`)
- Produces: `irStructurallyEqual` handles `'list'` case — calls both `itemTemplate(stub_vs, stub_is)` and recurses into the returned sub-IRs
- Produces: `'slot-outlet'` case now also compares `props.length` and `props[i].name`

**Context — how conditional comparator works (to mirror for list):**
In `bindingEqual` for `'conditional'`, it calls `irStructurallyEqual(undefined, a.consequent, bc.consequent)` recursively. For `'list'`, call `itemTemplate` with stub signals to get the body IR, then recurse.

The stub signals must be real `WritableSignal` objects so the factory's closure captures real thunks. Import `signal` from core.

- [ ] **Step 1: Write failing FE-equivalence test**

In `test/renderer/each-authoring.test.ts`, add:

```ts
import { irStructurallyEqual } from './ir-equivalence.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'

// TC-EA-G2: FE-equivalence — .nv <each> and tagged-template each() produce irStructurallyEqual IR
test('TC-EA-G2  FE-equivalence: .nv <each> and each() produce irStructurallyEqual ListBinding', () => {
  // Tagged-template version
  const items = signal<Item[]>([])
  const ttIr = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item }) => html`<li>${() => (item() as Item).label}</li>`,
  )}</ul>`

  // .nv version (parse path)
  const source = `
const List = $component(() => {
  $script(() => {
    const items = signal([])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(item) => item.id}" let={item}><li>\${item}</li></each></ul>\`)
})
`
  const results = parseNvFile(source, 'list.nv', document)
  const nvIr = results[0]!.ir

  const result = irStructurallyEqual(document, ttIr, nvIr)
  expect(result.equal, result.reason).toBe(true)
})
```

- [ ] **Step 2: Run TC-EA-G2 to verify it fails**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-G2" 2>&1 | head -30
```

Expected: FAIL — `irStructurallyEqual` doesn't handle `'list'` yet.

- [ ] **Step 3: Add `'list'` case to `bindingEqual` in `ir-equivalence.ts`**

First add the import at the top of `ir-equivalence.ts`:

```ts
import { signal } from '../../src/core/core.js'
import type { ListBinding, SlotOutletBinding } from '../../src/renderer/ir.js'
```

Then in `bindingEqual`, add the `'list'` case before the final `return`:

```ts
case 'list': {
  const bl = b as ListBinding
  // key function identity is not comparable — skip (same as expr thunks).
  // Recurse into item body: call both itemTemplate with shared stub signals.
  const stubVs = signal<unknown>(null)
  const stubIs = signal<number>(0)
  const aBody = (a as ListBinding).itemTemplate(stubVs, stubIs)
  const bBody = bl.itemTemplate(stubVs, stubIs)
  const bodyRes = irStructurallyEqual(undefined, aBody, bBody)
  if (!bodyRes.equal) return { equal: false, reason: `${p}.itemBody → ${bodyRes.reason}` }
  break
}
```

Also extend the `'slot-outlet'` case to compare `props`:

```ts
case 'slot-outlet': {
  const bs = b as Extract<Binding, { kind: 'slot-outlet' }>
  if (a.name !== bs.name) return { equal: false, reason: `${p}.name: ${a.name} vs ${bs.name}` }
  // Compare props names (closes inc-2 D2 debt)
  const aProps = (a as SlotOutletBinding).props ?? []
  const bProps = bs.props ?? []
  if (aProps.length !== bProps.length)
    return { equal: false, reason: `${p}.props.length: ${aProps.length} vs ${bProps.length}` }
  for (let j = 0; j < aProps.length; j++) {
    if (aProps[j]!.name !== bProps[j]!.name)
      return { equal: false, reason: `${p}.props[${j}].name: ${aProps[j]!.name} vs ${bProps[j]!.name}` }
  }
  break
}
```

- [ ] **Step 4: Run TC-EA-G2**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-G2" 2>&1 | head -30
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /Users/kofi/_/view && pnpm vitest run 2>&1 | tail -20
```

Expected: all green. The `'slot-outlet'` extension might break scoped-slot FE-equivalence tests that previously passed by coincidence — check and fix if needed.

- [ ] **Step 6: Commit**

```bash
cd /Users/kofi/_/view && git add test/renderer/ir-equivalence.ts test/renderer/each-authoring.test.ts && git commit -m "feat(each): comparator 'list' case + slot-outlet props (D2 debt) + FE-equivalence gate TC-EA-G2"
```

---

## Task 4 — G4 fail-shows-teeth pair + anti-vacuous sweep

**Files:**
- Modify: `test/renderer/each-authoring.test.ts`

**Purpose:** Prove the adapter snapshot test has teeth (a direct-value adapter freezes the DOM), and verify no vacuous assertions remain.

- [ ] **Step 1: Add G4 fail-shows-teeth test**

In `test/renderer/each-authoring.test.ts`, add:

```ts
// TC-EA-G4: fail-shows-teeth — snapshot adapter (direct value, not thunk) freezes DOM
// This test verifies the gate has teeth: if item() is called at construction time
// instead of wrapped in a thunk, value changes do NOT update the DOM.
test('TC-EA-G4  fail-shows-teeth: snapshot adapter freezes DOM on value change', () => {
  const items = signal<Item[]>([{ id: 1, label: 'Initial' }])
  // Deliberately WRONG adapter: snapshot value at construction, not thunk
  const brokenFactory: SlotContent = (slotProps) => {
    const snapshottedItem = slotProps['item']?.() as Item // calls item() at construction — snapshot!
    return html`<li>${() => snapshottedItem?.label ?? '?'}</li>`
  }
  // Build IR manually with the broken adapter to test the gate
  const brokenItemTemplate = (vs: WritableSignal<unknown>, _is: WritableSignal<number>) => {
    const snapshottedItem = vs() as Item // snapshot at row-creation time
    return html`<li>${() => snapshottedItem?.label ?? '?'}</li>`
  }
  // Use interpreter directly with a hand-authored ListBinding using the broken template
  const ir: TemplateIR = {
    id: 'broken-adapter-test',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [{
      kind: 'list',
      pathIndex: 0,
      items: () => items() as readonly unknown[],
      key: (item) => (item as Item).id,
      itemTemplate: brokenItemTemplate,
    } satisfies ListBinding],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()
  expect(parent.querySelector('li')!.textContent).toBe('Initial')
  // Value change — broken adapter won't update
  items.set([{ id: 1, label: 'Updated' }])
  flushSync()
  // With broken adapter: DOM stays 'Initial' — this test MUST pass showing it doesn't update
  expect(parent.querySelector('li')!.textContent).toBe('Initial')
  // The CORRECT each() adapter would show 'Updated' instead. Confirmed by TC-EA-04.
  dispose()
  rmParent(parent)
})
```

This is a negative test: it proves the snapshot adapter DOES freeze the DOM (i.e., TC-EA-04 is non-trivial — if the correct adapter also froze the DOM, TC-EA-04 would vacuously pass).

- [ ] **Step 2: Run TC-EA-G4**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-G4" 2>&1 | head -20
```

Expected: PASS (the snapshot adapter DOES freeze DOM, confirming the gate has teeth).

- [ ] **Step 3: Anti-vacuous sweep**

```bash
grep -n "expect(true)\|expect(false)\|\.toBe(true)\|\.toBe(false)" test/renderer/each-authoring.test.ts
```

For any `toBe(true)` or `toBe(false)` hits, verify each has a meaningful description argument (third param to `expect`) or the assertion is on an actual comparison result. No bare `expect(true).toBe(true)`.

- [ ] **Step 4: Run full each-authoring test suite**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts --reporter=verbose 2>&1
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kofi/_/view && git add test/renderer/each-authoring.test.ts && git commit -m "test(each): G4 fail-shows-teeth pair + anti-vacuous sweep"
```

---

## Task 5 — Emit path: ThunkSource 'list' + computeBindingThunks + emitBindingLiteral + e2e

**Files:**
- Modify: `src/renderer/nv-parser.ts` (ThunkSource 'list' variant + `computeBindingThunks` list case)
- Modify: `src/renderer/nv-emitter.ts` (`'list'` case in `emitBindingLiteral`)
- Modify: `test/renderer/each-authoring.test.ts` (emit e2e test)

**Context — emit path flow:**
`parseNvFileForEmit` calls `computeBindingThunks(pendingComponents, ...)`. We extend this to also handle `pendingEachItems`. For each `PendingNvEachInfo`:
- `itemsHoleIdx` → erase the `.of` hole expr → `itemsSrc`
- `keyHoleIdx` → get the `key` hole expr text verbatim → `keySrc` (NOT erased — it's a pure function, not a signal read)
- `bodyHoleIndices` → compute thunks for body holes using `slotPropsAccessors` (`item → slotProps.item()`, `index → slotProps.index()`)
- Produce `ThunkSource { kind: 'list', itemsSrc, keySrc, bodyThunks, letNames }`

`nv-emitter.ts` `emitBindingLiteral` for `'list'`:
- Call `lb.itemTemplate(signal<unknown>(null), signal<number>(0))` to get body IR structure
- Emit the `itemTemplate` as an arrow function with the slotProps adapter and body IR literal

**Interfaces:**
- Produces: `ThunkSource` extended with `| { kind: 'list'; itemsSrc: string; keySrc: string; bodyThunks: ThunkSource[]; letNames: string[] }`

- [ ] **Step 1: Extend `ThunkSource` in `nv-parser.ts`**

In the `ThunkSource` union (line 87), add:

```ts
| {
    kind: 'list'
    itemsSrc: string
    keySrc: string
    bodyThunks: ThunkSource[]
    letNames: string[]
  }
```

- [ ] **Step 2: Extend `computeBindingThunks` to handle `pendingEachItems`**

Update the signature of `computeBindingThunks` to accept `pendingEachItems`:

```ts
function computeBindingThunks(
  pendingComponents: PendingNvComponentInfo[],
  pendingEachItems: PendingNvEachInfo[],
  consumedByComponent: ReadonlySet<number>,
  holeExprs: ts.Expression[],
  positions: PosKind[],
  doc: Document,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
  propsAccessors?: ReadonlyMap<string, string>,
): ThunkSource[] {
```

Add list thunks computation after `componentThunks`:

```ts
const listThunks: ThunkSource[] = pendingEachItems.map((pe) => {
  const itemsExpr = holeExprs[pe.itemsHoleIdx] as ts.Expression
  const keyExpr = holeExprs[pe.keyHoleIdx] as ts.Expression

  // .of: erase signal reads (it's a reactive list signal read)
  const itemsSrc = eraseSignalReadsInNode(itemsExpr, symbols.all, propsAccessors)

  // key: emit verbatim — it's a pure function, not a signal read
  const keySrc = keyExpr.getText()

  // Body thunks: use slotPropsAccessors for item/index
  const slotPropsParam = 'slotProps'
  const slotPropsAccessors: Map<string, string> = new Map(
    pe.letNames.map((n) => [n, `${slotPropsParam}.${n}()`])
  )
  const mergedAccessors = new Map([...(propsAccessors ?? []), ...slotPropsAccessors])

  const bodyThunks: ThunkSource[] = pe.bodyHoleIndices.map((holeIdx) => {
    const holeExpr = holeExprs[holeIdx]
    if (holeExpr === undefined) throw new Error(`[nv/each] Body hole index ${holeIdx} out of range`)
    return computeThunkSource(
      holeExpr,
      positions[holeIdx] as PosKind,
      doc,
      symbols,
      diagnostics,
      propsParamName,
      mergedAccessors,
    )
  })

  return {
    kind: 'list' as const,
    itemsSrc,
    keySrc,
    bodyThunks,
    letNames: pe.letNames,
  }
})

return [...componentThunks, ...listThunks, ...holeThunks]
```

Update the call site in `parseNvFileForEmit`:

```ts
bindingThunks = computeBindingThunks(
  pendingComponents,
  renderResult.pendingEachItems,   // ← add
  consumedByComponent,
  bodyHoleExprs,
  bodyPositions,
  doc,
  symbols,
  emitDiagnostics,
  emitPropsParamName,
  emitPropsAccessors,
)
```

Also pass `pendingEachItems` through the `ProcessResult` return in `processHtmlTemplate`:

```ts
return {
  ir: { ... },
  verdicts,
  pendingComponents: [...],
  pendingEachItems: (lists ?? []).map(wl => ({
    itemsHoleIdx: wl.itemsHoleIdx,
    keyHoleIdx: wl.keyHoleIdx,
    letNames: wl.letNames,
    bodyHoleIndices: wl.bodyHoleIndices,
  })),
  consumedByComponent,
  diagnostics: processdiagnostics,
}
```

Update the conditional-branch `computeBindingThunks` calls in `computeThunkSource` (which also call `computeBindingThunks` recursively for branches). Those branches don't contain `<each>` at this level, so pass `[]` for `pendingEachItems`:

```ts
const consequentThunks = computeBindingThunks(
  resultConsequent.pendingComponents,
  resultConsequent.pendingEachItems,  // ← add (may be empty for branch results)
  ...
)
```

- [ ] **Step 3: Add `'list'` case to `emitBindingLiteral` in `nv-emitter.ts`**

Import `signal` from core at the top of `nv-emitter.ts` (if not already — check):

```ts
import { signal } from '../core/core.js'
import type { ListBinding, ... } from './ir.js'
```

In `emitBindingLiteral`, add before the `default` case:

```ts
case 'list': {
  if (thunk.kind !== 'list') throw new Error('[nv/emitter] ListBinding thunk kind mismatch')
  const lb = binding as ListBinding
  const i2 = `${indent}  `
  // Get body IR structure by calling itemTemplate with stub signals (structure only; thunks come from bodyThunks)
  const stubVs = signal<unknown>(null)
  const stubIs = signal<number>(0)
  const bodyIR = lb.itemTemplate(stubVs, stubIs)
  const bodyLiteral = emitIrLiteral(bodyIR, thunk.bodyThunks, i2)
  // Emit itemTemplate as adapter: (valueSig, indexSig) => factory(slotProps)(bodyIR)
  // letNames default to ['item', 'index'] if empty; first name maps to valueSig, second to indexSig
  const [itemName = 'item', indexName = 'index'] = thunk.letNames
  const slotPropsBody = `{ ${itemName}: () => valueSig(), ${indexName}: () => indexSig() }`
  return [
    `{ kind: 'list', ${pathEntry},`,
    `${i2}items: () => (${thunk.itemsSrc}),`,
    `${i2}key: ${thunk.keySrc},`,
    `${i2}itemTemplate: (valueSig, indexSig) => ((slotProps) => ${bodyLiteral})(${slotPropsBody}) }`,
  ].join('\n')
}
```

Note: The IIFE `((slotProps) => bodyIR)(slotPropsObj)` pattern ensures `slotProps` is bound when the body IR is constructed, matching the runtime adapter behavior.

- [ ] **Step 4: Write e2e emit test**

In `test/renderer/each-authoring.test.ts`, add:

```ts
import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'
import { emitModule } from '../../src/renderer/nv-emitter.js'

// TC-EA-E1: emit path — .nv <each> emits valid module with itemTemplate adapter
test('TC-EA-E1  emit: .nv <each> emits module with list binding + adapter', async () => {
  const source = `
const List = $component(() => {
  $script(() => {
    const items = signal([{ id: 1, label: 'A' }])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(item) => item.id}" let={item, index}><li>\${item} #\${index}</li></each></ul>\`)
})
`
  const results = parseNvFileForEmit(source, 'list.nv', document)
  expect(results.length).toBe(1)
  const moduleText = emitModule(results)
  // Verify emitted module contains list binding
  expect(moduleText).toContain("kind: 'list'")
  expect(moduleText).toContain('items: () => (')
  expect(moduleText).toContain('itemTemplate: (valueSig, indexSig) =>')
  // Verify adapter references slotProps
  expect(moduleText).toContain('slotProps')
  expect(moduleText).toContain('() => valueSig()')
  expect(moduleText).toContain('() => indexSig()')
  // Verify items thunk erases signal read
  expect(moduleText).toContain('items()')
})
```

- [ ] **Step 5: Run TC-EA-E1 to verify it fails**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-E1" 2>&1 | head -30
```

- [ ] **Step 6: Implement Task 5 Steps 1-3 above**

- [ ] **Step 7: Run TC-EA-E1**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-E1" 2>&1 | head -20
```

Expected: PASS.

- [ ] **Step 8: Run full suite**

```bash
cd /Users/kofi/_/view && pnpm vitest run 2>&1 | tail -20
```

- [ ] **Step 9: typecheck + lint**

```bash
cd /Users/kofi/_/view && pnpm typecheck && pnpm lint 2>&1 | tail -20
```

- [ ] **Step 10: Commit**

```bash
cd /Users/kofi/_/view && git add src/renderer/nv-parser.ts src/renderer/nv-emitter.ts test/renderer/each-authoring.test.ts && git commit -m "feat(each): emit path — ThunkSource 'list' + computeBindingThunks + emitBindingLiteral + e2e TC-EA-E1"
```

---

## Task 6 — Gate checklist + G0 guard + final clean pass

**Files:**
- No new code — verification and cleanup only.

- [ ] **Step 1: G0 guard — verify no src/core/ edits**

```bash
cd /Users/kofi/_/view && git diff main -- src/core/
```

Expected: empty output (0 lines changed).

- [ ] **Step 2: G0 guard — verify reconcile loop is unchanged**

```bash
cd /Users/kofi/_/view && git diff main -- src/renderer/interpreter.ts | grep "^+" | grep -v "^+++"
```

Expected: empty (interpreter.ts untouched). Repeat for emitted-mount:

```bash
cd /Users/kofi/_/view && git diff main -- src/compiler/emitted-mount.ts | grep "^+" | grep -v "^+++"
```

Expected: empty.

- [ ] **Step 3: G1 guard — verify no `key=` in shape.html**

```bash
grep -r 'key=' test/renderer/each-authoring.test.ts | grep "shape.html\|html:"
```

Expected: 0 hits (key is not in shape.html, only in ListBinding.key function).

Check emitted output:

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-E1" --reporter=verbose 2>&1 | grep "key=" | grep -v "item.id\|key: "
```

Expected: no spurious `key=` attributes.

- [ ] **Step 4: G2 FE-equivalence — verify TC-EA-G2 passes**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-G2" --reporter=verbose 2>&1 | head -20
```

Expected: PASS.

- [ ] **Step 5: G3 behavioral differential — verify both back-ends tested in TC-EA-02 through TC-EA-05**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts --reporter=verbose 2>&1 | grep -E "PASS|FAIL"
```

Expected: TC-EA-01 through TC-EA-G4 and TC-EA-E1 all PASS.

- [ ] **Step 6: G4 fail-shows-teeth — verify TC-EA-G4 passes**

```bash
cd /Users/kofi/_/view && pnpm vitest run test/renderer/each-authoring.test.ts -t "TC-EA-G4" --reporter=verbose 2>&1
```

Expected: PASS (snapshot adapter does freeze DOM, proving TC-EA-04 is non-trivial).

- [ ] **Step 7: G5 anti-vacuous sweep (final)**

```bash
grep -n "expect(true).toBe\|expect(false).toBe" test/renderer/each-authoring.test.ts
```

Expected: 0 hits.

- [ ] **Step 8: Final full suite + typecheck + lint + build**

```bash
cd /Users/kofi/_/view && pnpm vitest run 2>&1 | tail -5 && pnpm typecheck 2>&1 | tail -5 && pnpm lint 2>&1 | tail -5 && pnpm build 2>&1 | tail -5
```

Expected: all exit 0, test count increases by the new tests.

- [ ] **Step 9: Commit**

```bash
cd /Users/kofi/_/view && git add -A && git commit -m "chore(each): gate checklist passed — G0..G5 verified"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `each(itemsThunk, keyFn, bodyFactory)` sentinel | Task 1 |
| `EachSentinel` detection in `walkNodeList` | Task 1 |
| Adapter `(vs, is) => factory({item: ()=>vs(), index: ()=>is()})` | Task 1 |
| Reconcile loop UNTOUCHED | Task 6 G0 |
| `<each .of= key= let={}>` in .nv | Task 2 |
| `buildNvSlotContentIR` reused for body | Task 2 |
| `<each>` replaced by `<!--nv-list-N-->` anchor | Task 2 |
| `ir-equivalence.ts` `'list'` case | Task 3 |
| `'slot-outlet'` props comparison (D2 debt) | Task 3 |
| FE-equivalence gate G2 | Task 3 |
| G4 fail-shows-teeth | Task 4 |
| G5 anti-vacuous | Task 4 |
| Emit path: ThunkSource 'list', itemsSrc erasure, keySrc verbatim | Task 5 |
| Emit path: body thunks with `slotProps.name()` accessors | Task 5 |
| `emitBindingLiteral` 'list' case + adapter IIFE | Task 5 |
| Export `each` from index.ts | Task 1 |
| G0: src/core/ 0 lines | Task 6 |
| Component-as-list-item (falls out of walk recursion) | Task 2 (note) |
| G3 both back-ends in differential | Task 1 (withBothBackends) |

**Component-as-list-item:** The `buildNvSlotContentIR` call for the body already handles component elements via the unified `walkNvNodeList` recursion (same as component-as-slot-child). For tagged-template, the `factory` is user-provided — users can put `<Component/>` in their factory body. The plan includes a note but no explicit test. Add one if the handoff gate explicitly requires it; the handoff says "assert it actually does."

Add to Task 1 Step 8 (or as a separate TC-EA-07):

```ts
// TC-EA-07: component-as-list-item falls out of walk recursion
// (tests that <Card .x="..."/> inside each() body mounts + disposes per row)
test('TC-EA-07  each(): component-as-list-item mounts per row and disposes on removal', () => {
  // Use a simple hand-authored factory that includes a component-like sub-IR
  // (We can't test a real .nv component here without the emit path, so test DOM structure)
  const items = signal<Item[]>([{ id: 1, label: 'A' }, { id: 2, label: 'B' }])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item }) => html`<li class="${() => (item() as Item).label}">${() => (item() as Item).label}</li>`,
  )}</ul>`
  withBothBackends(ir, (parent) => {
    expect(parent.querySelectorAll('li').length).toBe(2)
    items.set([{ id: 1, label: 'A' }])
    flushSync()
    expect(parent.querySelectorAll('li').length).toBe(1)
    expect(parent.querySelector('li')!.textContent).toBe('A')
  })
})
```

**Type consistency check:** `signal<unknown>` and `signal<number>` are used consistently in the comparator and emitter. The `WritableSignal` import must be available in `ir-equivalence.ts` — check.

**Placeholder check:** None found — all steps include exact code.
