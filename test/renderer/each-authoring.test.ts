/**
 * `each` authoring — behavioral + FE-equivalence + fail-shows-teeth.
 * Stream: (3) renderer/templating.
 */
import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import { __test, flushSync, signal } from '../../src/core/core.js'
import { createHtmlTag, each } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { TemplateIR } from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document
const html = createHtmlTag(document)

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkParent(): Element {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
function rmParent(el: Element) {
  document.body.removeChild(el)
}

type Item = { id: number; label: string }

type MountFn = (ir: TemplateIR, parent: Element, doc: Document) => () => void

const backends: Array<[string, MountFn]> = [
  ['interpreter', (ir, parent, doc) => mount(ir, parent, doc)],
  [
    'emitted-mount',
    (ir, parent, doc) => {
      const { mountFn } = emitMount(ir)
      return mountFn(parent, doc)
    },
  ],
]

/** Mount via both back-ends and run the same assertion. Shared `ir` and signals must be stable across runs. */
function withBothBackends(ir: TemplateIR, assert: (parent: Element, dispose: () => void) => void) {
  for (const [label, mountFn] of backends) {
    void label
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

// ── Tagged-template each() ───────────────────────────────────────────────────

// TC-EA-01: each() produces a ListBinding (kind check)
test('TC-EA-01  each() produces IR with a ListBinding', () => {
  const items = signal<Item[]>([{ id: 1, label: 'A' }])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item: _item }) => {
      const item = _item!
      return html`<li>${() => (item() as Item).label}</li>`
    },
  )}</ul>`
  expect(ir.bindings.length).toBe(1)
  expect(ir.bindings[0]!.kind).toBe('list')
})

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
    ({ item: _item }) => {
      const item = _item!
      return html`<li>${() => (item() as Item).label}</li>`
    },
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
    ({ item: _item }) => {
      const item = _item!
      return html`<li>${() => (item() as Item).label}</li>`
    },
  )}</ul>`
  withBothBackends(ir, (parent, dispose) => {
    void dispose
    items.set([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
    ])
    flushSync()
    const lis = parent.querySelectorAll('li')
    expect(lis.length).toBe(2)
    expect(lis[1]!.textContent).toBe('B')
  })
})

// TC-EA-04 (G1 + G2 gate): value-change node identity preserved — Variant A transparency proof
test('TC-EA-04  each(): value change at kept key — node identity preserved (Variant A gate)', () => {
  for (const [label, mountFn] of backends) {
    void label
    // Fresh signal per backend run to avoid cross-run state contamination.
    const items = signal<Item[]>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
    ])
    const ir = html`<ul>${each(
      () => items() as readonly unknown[],
      (item) => (item as Item).id,
      ({ item: _item }) => {
        const item = _item!
        return html`<li>${() => (item() as Item).label}</li>`
      },
    )}</ul>`
    const parent = mkParent()
    const dispose = mountFn(ir, parent, document)
    flushSync()
    try {
      const lisBefore = Array.from(parent.querySelectorAll('li'))
      items.set([
        { id: 1, label: 'A-updated' },
        { id: 2, label: 'B' },
      ])
      flushSync()
      const lisAfter = Array.from(parent.querySelectorAll('li'))
      expect(lisAfter[0]!.textContent).toBe('A-updated')
      // Node identity: same <li> element — update-not-rebuild (Variant A transparency)
      expect(lisAfter[0]!, 'node identity preserved').toBe(lisBefore[0]!)
      expect(lisAfter[1]!, 'node identity preserved').toBe(lisBefore[1]!)
    } finally {
      dispose()
      rmParent(parent)
    }
  }
})

// TC-EA-05: index reactive on reorder
test('TC-EA-05  each(): reorder — index accessor updates without rebuild', () => {
  for (const [label, mountFn] of backends) {
    void label
    // Fresh signal per backend run to avoid cross-run state contamination.
    const items = signal<Item[]>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
      { id: 3, label: 'C' },
    ])
    const ir = html`<ul>${each(
      () => items() as readonly unknown[],
      (item) => (item as Item).id,
      ({ item: _item, index: _index }) => {
        const item = _item!
        const index = _index!
        return html`<li>${() => `${(item() as Item).label}#${index()}`}</li>`
      },
    )}</ul>`
    const parent = mkParent()
    const dispose = mountFn(ir, parent, document)
    flushSync()
    try {
      const lisBefore = Array.from(parent.querySelectorAll('li'))
      expect(lisBefore[0]!.textContent).toBe('A#0')
      items.set([
        { id: 3, label: 'C' },
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ])
      flushSync()
      const lisAfter = Array.from(parent.querySelectorAll('li'))
      expect(lisAfter[0]!.textContent).toBe('C#0')
      expect(lisAfter[1]!.textContent).toBe('A#1')
      expect(lisAfter[2]!.textContent).toBe('B#2')
      // Node identity: same elements reused
      expect(lisAfter.every((li) => lisBefore.some((lb) => lb === li))).toBe(true)
    } finally {
      dispose()
      rmParent(parent)
    }
  }
})

// TC-EA-10: .nv <each> produces IR with a ListBinding (parse path)
test('TC-EA-10  .nv <each> produces IR with a ListBinding', () => {
  const source =
    'const List = $component(() => {\n' +
    '  $script(() => {\n' +
    '    const items = signal([])\n' +
    '  })\n' +
    '  $render(() => html`<ul><each .of="${items}" key="${(item) => item.id}" let={item}><li>${item}</li></each></ul>`)\n' +
    '})\n'
  const results = parseNvFile(source, 'list.nv', document)
  expect(results.length).toBe(1)
  const ir = results[0]!.ir
  const listBinding = ir.bindings.find((b) => b.kind === 'list')
  expect(listBinding).toBeDefined()
  expect(listBinding!.kind).toBe('list')
})

// TC-EA-06: unmount no-leak
test('TC-EA-06  each(): unmount — no reactive leaks', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])
  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as Item).id,
    ({ item: _item }) => {
      const item = _item!
      return html`<li>${() => (item() as Item).label}</li>`
    },
  )}</ul>`
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()
  expect(__test.observerCount(items)).toBeGreaterThanOrEqual(1)
  dispose()
  expect(__test.observerCount(items)).toBe(0)
  expect(parent.querySelectorAll('li').length).toBe(0)
  rmParent(parent)
})
