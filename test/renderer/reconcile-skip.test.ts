/**
 * Reconcile prefix/suffix skip — Tier-1 correctness corpus
 * Task 3 · Stream: (3) Renderer/templating
 *
 * T1-1 (FIRE — the fence): new reference at index 0 and 999 must update text
 *       even though key is unchanged. A key-only skip fails this; the content-
 *       aware (key + reference) skip passes. This is the single most critical test.
 *
 * T1-2 (op corpus): common list mutations produce correct final DOM text + order.
 *
 * T1-3 (degenerate): first reconcile with no prior state (prevKeys empty) renders
 *       the full list correctly (band = [0, n-1]).
 *
 * T1-4 (no forbidden diff): the prefix/suffix skip changeset (HEAD commit)
 *       touches only interpreter.ts and tests — not src/core/, docs/, or ir.ts.
 */

import { execSync } from 'node:child_process'
import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { flushSync, signal } from '../../src/core/core.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ListBinding, TemplateIR, TextBinding, WritableSignal } from '../../src/renderer/ir.js'

// ── jsdom setup ───────────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document

function mkParent(): Element {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div
}

function rmParent(el: Element): void {
  el.remove()
}

// ── Shared types + helpers ────────────────────────────────────────────────────

type Item = { id: number; label: string }

/** Outer <ul> list IR keyed by item.id. */
function makeListIR(
  items: () => readonly Item[],
  makeItem: (vs: WritableSignal<unknown>, is?: WritableSignal<number>) => TemplateIR,
): TemplateIR {
  return {
    id: 'skip-list',
    shape: {
      html: '<ul><!--nv-0--></ul>',
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: items as () => readonly unknown[],
        key: (item) => (item as Item).id,
        itemTemplate: makeItem,
      } satisfies ListBinding,
    ],
  }
}

/** Outer <ul> list IR keyed by item.id, with itemReadsIndex: true. */
function makeListIRWithIndex(
  items: () => readonly Item[],
  makeItem: (vs: WritableSignal<unknown>, is?: WritableSignal<number>) => TemplateIR,
): TemplateIR {
  return {
    id: 'skip-list-idx',
    shape: {
      html: '<ul><!--nv-0--></ul>',
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: items as () => readonly unknown[],
        key: (item) => (item as Item).id,
        itemTemplate: makeItem,
        itemReadsIndex: true,
      } satisfies ListBinding,
    ],
  }
}

/** Per-item <li> template rendering "label:index" — reads both value and index signals. */
function liIndexTemplate(vs: WritableSignal<unknown>, is?: WritableSignal<number>): TemplateIR {
  return {
    id: 'li-skip-idx',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        // is! safe: only wired to lists with itemReadsIndex: true → interpreter always allocates indexSig
        expr: () => `${(vs() as Item).label}:${is!()}`,
      } satisfies TextBinding,
    ],
  }
}

/** Per-item <li> template whose text tracks valueSig().label. */
function liTextTemplate(vs: WritableSignal<unknown>): TemplateIR {
  return {
    id: 'li-skip',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => (vs() as Item).label,
      } satisfies TextBinding,
    ],
  }
}

/** Read text content of every <li> under parent, in DOM order. */
function liOrder(parent: Element): string[] {
  return Array.from(parent.querySelectorAll('li')).map((el) => el.textContent ?? '')
}

// ── T1-1 (FIRE — the fence) ───────────────────────────────────────────────────
//
// 1000 rows; only index 0 and 999 replaced with new objects (same key, new label).
// Rows 1–998 are reference-identical to initial. The band must include both ends,
// and both text nodes must update. A key-only skip would not update them.

test('T1-1 FIRE: reference-change at boundary positions updates text despite unchanged key', () => {
  const n = 1000
  const initial: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: `item-${i}` }))
  const items = signal<Item[]>(initial)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const ul = parent.querySelector('ul')!
  expect(ul.querySelectorAll('li').length, 'initial: 1000 items').toBe(n)

  // Replace ONLY index 0 and n-1 with new object references.
  // Rows 1–998: exact same references from `initial`.
  const next = initial.slice() // shallow copy — middle entries point to same objects
  next[0] = { id: 0, label: 'updated-0' } // same key id=0, new reference, new label
  next[n - 1] = { id: n - 1, label: 'updated-999' } // same key id=999, new reference

  items.set(next)
  flushSync()

  const lis = ul.querySelectorAll('li')
  expect(lis[0]!.textContent, 'first item label updated').toBe('updated-0')
  expect(lis[n - 1]!.textContent, 'last item label updated').toBe('updated-999')
  // Middle item should be unchanged (reference-identical, not updated)
  expect(lis[500]!.textContent, 'middle item unchanged').toBe('item-500')

  dispose()
  rmParent(parent)
})

// ── T1-2 (op corpus) ──────────────────────────────────────────────────────────

test('T1-2 op-corpus: remove-one at front', () => {
  const n = 10
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const next = base.slice(1) // remove index 0
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'remove-front: correct order + content').toEqual(
    next.map((it) => it.label),
  )
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: remove-one at tail', () => {
  const n = 10
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const next = base.slice(0, -1) // remove last
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'remove-tail: correct order + content').toEqual(
    next.map((it) => it.label),
  )
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: remove-one at middle', () => {
  const n = 10
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const mid = Math.floor(n / 2)
  const next = base.filter((_, i) => i !== mid)
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'remove-middle: correct order + content').toEqual(
    next.map((it) => it.label),
  )
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: append one item at end', () => {
  const n = 10
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const next: Item[] = [...base, { id: n, label: 'appended' }]
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'append: correct order + content').toEqual(next.map((it) => it.label))
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: prepend one item at front', () => {
  const n = 10
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const next: Item[] = [{ id: -1, label: 'prepended' }, ...base]
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'prepend: correct order + content').toEqual(next.map((it) => it.label))
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: swap index 1 and n-2 (n=10)', () => {
  const n = 10
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const next = base.slice()
  ;[next[1], next[n - 2]] = [next[n - 2]!, next[1]!]
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'swap n=10: correct order').toEqual(next.map((it) => it.label))
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: swap index 1 and n-2 (n=100)', () => {
  const n = 100
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const next = base.slice()
  ;[next[1], next[n - 2]] = [next[n - 2]!, next[1]!]
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'swap n=100: correct order').toEqual(next.map((it) => it.label))
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: reverse (n=1000)', () => {
  const n = 1000
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const next = base.slice().reverse()
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'reverse n=1000: correct order').toEqual(next.map((it) => it.label))
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: update-10th (replace every 10th item — new reference, same key, new label)', () => {
  const n = 100
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  // Replace every 10th item with a new object reference (same key, updated label)
  const next = base.map((it, i) => (i % 10 === 0 ? { id: it.id, label: `u-${it.label}` } : it))
  items.set(next)
  flushSync()

  expect(liOrder(parent), 'update-10th: correct labels').toEqual(next.map((it) => it.label))
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: clear (set to empty array)', () => {
  const n = 10
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  items.set([])
  flushSync()

  expect(liOrder(parent), 'clear: no li elements').toEqual([])
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: identity (set to same array reference — no-op reconcile)', () => {
  const n = 10
  const arr: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: String(i) }))
  const items = signal<Item[]>(arr)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const before = liOrder(parent)
  items.set(arr) // same array reference — no structural change
  flushSync()

  expect(liOrder(parent), 'identity: order and content unchanged').toEqual(before)
  dispose()
  rmParent(parent)
})

test('T1-2 op-corpus: shuffle (n=100, odd-indices-reversed then even-indices-forward)', () => {
  const n = 100
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: `item-${i}` }))
  const items = signal<Item[]>(base)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  // Deterministic non-contiguous permutation:
  // odd indices in reverse order, then even indices in forward order.
  const odds = base.filter((_, i) => i % 2 !== 0).reverse()
  const evens = base.filter((_, i) => i % 2 === 0)
  const next: Item[] = [...odds, ...evens]

  items.set(next)
  flushSync()

  expect(liOrder(parent), 'shuffle n=100: correct order + content').toEqual(
    next.map((it) => it.label),
  )
  dispose()
  rmParent(parent)
})

// ── T2-4 (key-call count) ─────────────────────────────────────────────────────
//
// Wraps binding.key in a counting proxy and asserts it's called exactly n times
// during a reconcile (once per item in nextKeys pass), not ~4n as in naive impls.

test('T2-4 key-call count: reconcile calls key exactly n times (n=100)', () => {
  const n = 100
  const base: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, label: `item-${i}` }))
  const items = signal<Item[]>(base)

  let keyCallCount = 0
  const ir = makeListIR(
    () => items(),
    (vs) => liTextTemplate(vs),
  )

  // Patch the key function on the list binding to count calls
  const listBinding = ir.bindings[0] as ListBinding
  const originalKey = listBinding.key
  listBinding.key = (item, i) => {
    keyCallCount++
    return originalKey(item, i)
  }

  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  // Initial render: should call key n times
  const initialCount = keyCallCount
  expect(initialCount, 'initial render: key called n times').toBe(n)

  // Reconcile: same keys, different content (new object refs, same ids, new labels)
  keyCallCount = 0
  const next = base.map((it) => ({ id: it.id, label: `updated-${it.label}` }))
  items.set(next)
  flushSync()

  expect(keyCallCount, 'reconcile: key called exactly n times (not ~4n)').toBe(n)

  dispose()
  rmParent(parent)
})

// ── T1-3 (degenerate) ─────────────────────────────────────────────────────────
//
// First reconcile: prevKeys is empty, so the band is [0, n-1] (full scan).
// Assert all n items render with correct labels in correct order.

test('T1-3 degenerate: first reconcile with no prior state renders n=5 items correctly', () => {
  const initial: Item[] = Array.from({ length: 5 }, (_, i) => ({ id: i, label: `x-${i}` }))
  const items = signal<Item[]>(initial)
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  expect(liOrder(parent), 'n=5 initial render: correct labels in order').toEqual(
    initial.map((it) => it.label),
  )
  dispose()
  rmParent(parent)
})

// ── T1-4 (no forbidden diff) ──────────────────────────────────────────────────
//
// The prefix/suffix skip optimization landed as HEAD (421a61f).
// Diff HEAD~1..HEAD to confirm the changeset is scoped to interpreter.ts + tests only.
// Any touch to src/core/, docs/, or src/renderer/ir.ts is a contract violation.

test('T1-4 no-forbidden-diff: prefix/suffix skip changeset confined to interpreter.ts + tests', () => {
  const raw = execSync('git diff 421a61f^ 421a61f --name-only', {
    encoding: 'utf8',
    cwd: process.cwd(),
  })

  const changed = raw
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)

  const forbidden = changed.filter(
    (f) => f.startsWith('src/core/') || f.startsWith('docs/') || f === 'src/renderer/ir.ts',
  )

  expect(
    forbidden,
    `Changeset must not touch src/core/, docs/, or src/renderer/ir.ts. Violating files: ${JSON.stringify(forbidden)}`,
  ).toEqual([])
})

// ── T1-5 (index-reading list, suffix index staleness guard) ───────────────────
//
// When a band operation changes the list length (remove-at-front, prepend),
// suffix rows retain reference-identical values but shift to new absolute positions.
// Their indexSig must be updated or index-reading templates show stale indices.
//
// Bug: before the fix, suffix rows kept their old lastIndex because the
// Ops 1/3/4 loop only iterated start..nextEnd, skipping suffix rows entirely.

test('T1-5 suffix-index-staleness: remove-at-front and prepend update suffix row indices', () => {
  // Initial: 5 rows [a,b,c,d,e] at indices 0..4
  const a: Item = { id: 1, label: 'a' }
  const b: Item = { id: 2, label: 'b' }
  const c: Item = { id: 3, label: 'c' }
  const d: Item = { id: 4, label: 'd' }
  const e: Item = { id: 5, label: 'e' }

  const items = signal<Item[]>([a, b, c, d, e])
  const ir = makeListIRWithIndex(() => items(), liIndexTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  expect(liOrder(parent)).toEqual(['a:0', 'b:1', 'c:2', 'd:3', 'e:4'])

  // Remove-at-front: [b,c,d,e] — band is index 0 (removed), suffix = [b,c,d,e]
  // Expected: b→0, c→1, d→2, e→3
  items.set([b, c, d, e])
  flushSync()
  expect(liOrder(parent)).toEqual(['b:0', 'c:1', 'd:2', 'e:3'])

  // Prepend: [z,b,c,d,e] — band is index 0 (new z), suffix = [b,c,d,e]
  // Expected: z→0, b→1, c→2, d→3, e→4
  const z: Item = { id: 0, label: 'z' }
  items.set([z, b, c, d, e])
  flushSync()
  expect(liOrder(parent)).toEqual(['z:0', 'b:1', 'c:2', 'd:3', 'e:4'])

  dispose()
  rmParent(parent)
})
