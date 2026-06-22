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
import type { ListBinding, TemplateIR, WritableSignal } from '../../src/renderer/ir.js'
import { emitModule } from '../../src/renderer/nv-emitter.js'
import { parseNvFile, parseNvFileForEmit } from '../../src/renderer/nv-parser.js'
import { irStructurallyEqual } from './ir-equivalence.js'

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
      expect(
        lisAfter.every((li) => lisBefore.some((lb) => lb === li)),
        'DOM nodes should be reused (identity preserved) after reorder',
      ).toBe(true)
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
  const source =
    'const List = $component(() => {\n' +
    '  $script(() => {\n' +
    '    const items = signal([])\n' +
    '  })\n' +
    '  $render(() => html`<ul><each .of="${items}" key="${(item) => item.id}" let={item}><li>${item}</li></each></ul>`)\n' +
    '})\n'
  const results = parseNvFile(source, 'list.nv', document)
  const nvIr = results[0]!.ir

  const result = irStructurallyEqual(document, ttIr, nvIr)
  expect(result.equal, result.reason).toBe(true)
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

// TC-EA-G4: fail-shows-teeth — snapshot adapter (direct value, not thunk) freezes DOM
// This test verifies the gate has teeth: if item() is called at construction time
// instead of wrapped in a thunk, value changes do NOT update the DOM.
// Contrast with TC-EA-04 which proves the correct each() adapter DOES update the DOM.
test('TC-EA-G4  fail-shows-teeth: snapshot adapter freezes DOM on value change', () => {
  const items = signal<Item[]>([{ id: 1, label: 'Initial' }])
  // Deliberately WRONG item template: snapshots value at row-creation time instead of reading signal reactively
  const brokenItemTemplate = (vs: WritableSignal<unknown>, _is: WritableSignal<number>) => {
    const snapshottedItem = vs() as Item // snapshot at row-creation time — NOT reactive
    return html`<li>${() => snapshottedItem?.label ?? '?'}</li>`
  }
  // Hand-authored IR using the broken template to test that the gate has teeth
  const ir: TemplateIR = {
    id: 'broken-adapter-test',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => items() as readonly unknown[],
        key: (item) => (item as Item).id,
        itemTemplate: brokenItemTemplate,
      } satisfies ListBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()
  expect(parent.querySelector('li')!.textContent).toBe('Initial')
  // Update the signal — broken adapter won't re-read the value
  items.set([{ id: 1, label: 'Updated' }])
  flushSync()
  // With broken (snapshot) adapter: DOM stays 'Initial', confirming TC-EA-04 is non-trivial
  expect(parent.querySelector('li')!.textContent).toBe('Initial')
  dispose()
  rmParent(parent)
})

// TC-EA-E1: emit path — .nv <each> emits valid module with itemTemplate adapter
test('TC-EA-E1  emit: .nv <each> emits module with list binding + adapter', async () => {
  const source =
    'const List = $component(() => {\n' +
    '  $script(() => {\n' +
    "    const items = signal([{ id: 1, label: 'A' }])\n" +
    '  })\n' +
    '  $render(() => html`<ul><each .of="${items}" key="${(item) => item.id}" let={item, index}><li>${item} #${index}</li></each></ul>`)\n' +
    '})\n'
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
